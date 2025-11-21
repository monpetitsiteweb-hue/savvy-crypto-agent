// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Symbol normalization utilities (inlined for Deno)
type BaseSymbol = string;        // e.g., "BTC"
type PairSymbol = `${string}-EUR`; // e.g., "BTC-EUR"

const toBaseSymbol = (input: string): BaseSymbol =>
  input.includes("-") ? input.split("-")[0] : input;

const toPairSymbol = (base: BaseSymbol): PairSymbol =>
  `${toBaseSymbol(base)}-EUR` as PairSymbol;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Enhanced types for the unified trading system
interface TradeIntent {
  userId: string;
  strategyId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  source: 'automated' | 'intelligent' | 'pool' | 'manual' | 'news' | 'whale';
  confidence: number;
  reason?: string;
  qtySuggested?: number;
  metadata?: Record<string, any>;
  ts?: string;
  idempotencyKey?: string;
}

// STEP 1: Standardized response types
type DecisionAction = "BUY" | "SELL" | "HOLD" | "DEFER";
type Reason =
  | "unified_decisions_disabled_direct_path"
  | "no_conflicts_detected"
  | "hold_min_period_not_met"
  | "blocked_by_cooldown"
  | "blocked_by_precedence:POOL_EXIT"
  | "queue_overload_defer"
  | "direct_execution_failed"
  | "internal_error"
  | "atomic_section_busy_defer"
  | "insufficient_price_freshness"
  | "spread_too_wide"
  | "blocked_by_spread"
  | "blocked_by_liquidity"
  | "blocked_by_whale_conflict"
  | "blocked_by_insufficient_profit"
  | "tp_hit"
  | "manual_override_precedence"
  | "confidence_override_applied"
  | "tp_execution_failed"
  | "tp_execution_error"
  | "tp_lock_contention"
  | "signal_too_weak"
  | "no_position_to_sell"
  | "insufficient_position_size"
  | "no_position_found";

interface TradeDecision {
  action: DecisionAction;
  reason: Reason;
  request_id: string;
  retry_in_ms: number;
  qty?: number;
}

interface UnifiedConfig {
  enableUnifiedDecisions: boolean;
  minHoldPeriodMs: number;
  cooldownBetweenOppositeActionsMs: number;
  confidenceOverrideThreshold: number;
}

interface ProfitAwareConfig {
  takeProfitPercentage: number;
  stopLossPercentage: number;
  minEdgeBpsForExit: number;
  minProfitEurForExit: number;
  confidenceThresholdForExit: number;
}

// In-memory caches for performance
const recentDecisionCache = new Map<string, { decision: TradeDecision; timestamp: number }>();
const symbolQueues = new Map<string, TradeIntent[]>();
const processingLocks = new Set<string>();

// Metrics tracking
let metrics = {
  totalRequests: 0,
  blockedByLockCount: 0,
  deferCount: 0,
  executionTimes: [] as number[],
  lastReset: Date.now()
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  metrics.totalRequests++;

  try {
    // STEP 2: CONFIRM FUNCTION HAS CREDENTIALS
    console.log('[FUNC] env SUPABASE_URL set:', !!Deno.env.get('SUPABASE_URL'));
    console.log('[FUNC] env SERVICE_ROLE set:', !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body - support both wrapped and direct intent formats
    const body = await req.json();
    const intent: TradeIntent = body.intent || body;
    
    // Log if no 'mode' field present - default to normal DECIDE flow
    const mode = (intent as any).mode || intent?.metadata?.mode;
    if (!mode) {
      console.log('[coordinator] No "mode" field, defaulting to DECIDE flow');
    }
    
    // STRUCTURED LOGGING
    console.log('[coordinator] intent', JSON.stringify({
      userId: intent?.userId,
      strategyId: intent?.strategyId,
      symbol: intent?.symbol,
      side: intent?.side,
      source: intent?.source,
      mode: mode || 'decide',
      qtySuggested: intent?.qtySuggested,
      flags: intent?.metadata?.flags || null,
      force: intent?.metadata?.force === true,
      currentPrice: intent?.metadata?.currentPrice ?? null,
    }, null, 2));
    
    // STEP 2: COORDINATOR ENTRY LOGS
    console.log('============ STEP 2: COORDINATOR ENTRY ============');
    console.log('received intent (full JSON):', JSON.stringify(intent, null, 2));
    
    const resolvedSymbol = toBaseSymbol(intent.symbol); // symbol for DB lookups
    console.log('resolvedSymbol (for DB lookups):', resolvedSymbol);
    console.log('mode (mock vs real wallet):', mode || 'decide');
    
    // Generate request ID and idempotency key
    const requestId = generateRequestId();
    const idempotencyKey = generateIdempotencyKey(intent);
    intent.idempotencyKey = idempotencyKey;

    // Validate intent
    if (!intent?.userId || !intent?.strategyId || !intent?.symbol || !intent?.side) {
      return respond('HOLD', 'internal_error', requestId);
    }

    // FAST PATH FOR MANUAL/MOCK/FORCE
    if (intent.source === 'manual' && (intent.metadata?.force === true || mode === 'mock')) {
      console.log('[coordinator] fast-path triggered for manual/mock/force');
      
      const exitPrice = Number(intent?.metadata?.currentPrice);
      if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
        return new Response(JSON.stringify({ ok:false, error:'missing/invalid currentPrice for mock sell' }), { 
          status: 400,
          headers: corsHeaders 
        });
      }

      // FIFO snapshot calculation for manual SELL
      const baseSymbol = toBaseSymbol(intent.symbol);
      const sellAmount = intent.qtySuggested || 0;
      
      // Get all BUY trades for this user/strategy/symbol to calculate FIFO
      const { data: buyTrades } = await supabaseClient
        .from('mock_trades')
        .select('*')
        .eq('user_id', intent.userId)
        .eq('strategy_id', intent.strategyId)  
        .eq('cryptocurrency', baseSymbol)
        .eq('trade_type', 'buy')
        .eq('is_test_mode', true)
        .order('executed_at', { ascending: true });

      // Get existing SELL trades to calculate remaining amounts in each BUY
      const { data: sellTrades } = await supabaseClient
        .from('mock_trades')
        .select('original_purchase_amount, executed_at')
        .eq('user_id', intent.userId)
        .eq('strategy_id', intent.strategyId)
        .eq('cryptocurrency', baseSymbol) 
        .eq('trade_type', 'sell')
        .eq('is_test_mode', true)
        .not('original_purchase_amount', 'is', null);

      // Calculate FIFO snapshot fields
      let totalPurchaseAmount = 0;
      let totalPurchaseValue = 0;
      let needAmount = sellAmount;

      for (const buyTrade of buyTrades || []) {
        if (needAmount <= 0) break;
        
        // Calculate how much of this BUY has been consumed by previous SELLs
        const consumedByPreviousSells = (sellTrades || [])
          .filter(sell => new Date(sell.executed_at) >= new Date(buyTrade.executed_at))
          .reduce((sum, sell) => sum + (sell.original_purchase_amount || 0), 0);
        
        const remainingAmount = buyTrade.amount - consumedByPreviousSells;
        
        if (remainingAmount > 0) {
          const takeAmount = Math.min(needAmount, remainingAmount);
          totalPurchaseAmount += takeAmount;
          totalPurchaseValue += takeAmount * buyTrade.price;
          needAmount -= takeAmount;
        }
      }

      const exitValue = sellAmount * exitPrice;
      const avgPurchasePrice = totalPurchaseAmount > 0 ? totalPurchaseValue / totalPurchaseAmount : 0;
      const realizedPnL = exitValue - totalPurchaseValue;
      const realizedPnLPct = totalPurchaseValue > 0 ? (realizedPnL / totalPurchaseValue) * 100 : 0;

      // Insert mock SELL with FIFO snapshot fields  
      const payload = {
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        trade_type: 'sell',
        cryptocurrency: baseSymbol,
        amount: sellAmount,
        price: exitPrice,
        total_value: exitValue,
        executed_at: new Date().toISOString(),
        original_purchase_amount: totalPurchaseAmount,
        original_purchase_price: avgPurchasePrice,
        original_purchase_value: totalPurchaseValue,
        exit_value: exitValue,
        realized_pnl: realizedPnL,
        realized_pnl_pct: realizedPnLPct,
        buy_fees: 0,
        sell_fees: 0,
        notes: 'Manual mock SELL via force override (coordinator fast-path)',
        is_test_mode: true,
      };

      const { error: insErr } = await supabaseClient.from('mock_trades').insert([payload]);
      if (insErr) {
        console.error('[coordinator] mock sell insert failed', insErr);
        return new Response(JSON.stringify({ ok:false, error: insErr.message }), { 
          status: 500,
          headers: corsHeaders 
        });
      }

      // Add symbol quarantine to prevent automation races
      await supabaseClient
        .from('execution_holds')
        .upsert({
          user_id: intent.userId,
          symbol: baseSymbol,
          hold_until: new Date(Date.now() + 5000).toISOString(), // 5 second hold
          reason: 'manual_sell_quarantine'
        });

      console.log('[coordinator] mock sell inserted', payload);
      return new Response(JSON.stringify({ 
        ok:true, 
        decision:{ action:'SELL', reason:'manual_fast_path' } 
      }), { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // STEP 4: GATE OVERRIDES FOR MANUAL SELL (force debugging path)
    const force = intent.source === 'manual' && (intent.metadata?.force === true);
    if (force) {
      console.log('🔥 MANUAL FORCE OVERRIDE: bypassing all gates for debugging');
      const base = toBaseSymbol(intent.symbol);
      const qty = intent.qtySuggested || 0.001;
      const priceData = await getMarketPrice(base, 15000);
      const exec = await executeTradeOrder(supabaseClient, { ...intent, symbol: base, qtySuggested: qty }, {}, requestId, priceData);
      return exec.success
        ? (logDecisionAsync(supabaseClient, intent, 'SELL', 'manual_override_precedence', { enableUnifiedDecisions: false } as UnifiedConfig, requestId, undefined, exec.tradeId, priceData?.price, exec.effectiveConfig || {}),
           respond('SELL', 'manual_override_precedence', requestId, 0, { qty: exec.qty }))
        : new Response(JSON.stringify({
            ok: true,
            decision: { 
              action: 'DEFER', 
              reason: `Guards tripped: executionFailed - manual force override failed`
            }
          }), { 
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
    }

    // Check for duplicate/idempotent request
    const cachedDecision = getCachedDecision(idempotencyKey);
    if (cachedDecision) {
      console.log(`🔄 COORDINATOR: Returning cached decision for key: ${idempotencyKey}`);
      return respond(cachedDecision.decision.action, cachedDecision.decision.reason, cachedDecision.decision.request_id, cachedDecision.decision.retry_in_ms, cachedDecision.decision.qty ? { qty: cachedDecision.decision.qty } : {});
    }

    // Get strategy configuration
    const { data: strategy, error: strategyError } = await supabaseClient
      .from('trading_strategies')
      .select('unified_config, configuration')
      .eq('id', intent.strategyId)
      .eq('user_id', intent.userId)
      .single();

    if (strategyError || !strategy) {
      console.error('❌ COORDINATOR: Strategy not found:', strategyError);
      return respond('HOLD', 'internal_error', requestId);
    }

    const unifiedConfig: UnifiedConfig = strategy.unified_config || {
      enableUnifiedDecisions: false,
      minHoldPeriodMs: 120000,
      cooldownBetweenOppositeActionsMs: 30000,
      confidenceOverrideThreshold: 0.70
    };

    // 🚨 HARD GATE: If unified decisions disabled, bypass ALL coordinator logic
    if (!unifiedConfig.enableUnifiedDecisions) {
      console.log('🎯 UD_MODE=OFF → DIRECT EXECUTION: bypassing all locks and conflict detection');
      
      // Execute trade directly without any coordinator gating
      const executionResult = await executeTradeDirectly(supabaseClient, intent, strategy.configuration, requestId);
      
      if (executionResult.success) {
        console.log(`🎯 UD_MODE=OFF → DIRECT EXECUTION: action=${intent.side} symbol=${intent.symbol} lock=NONE`);
        // Log decision for audit (async, non-blocking) with execution price
        logDecisionAsync(supabaseClient, intent, intent.side, 'unified_decisions_disabled_direct_path', unifiedConfig, requestId, undefined, executionResult.tradeId, executionResult.executed_price, strategy.configuration);
        return respond(intent.side, 'unified_decisions_disabled_direct_path', requestId, 0, { qty: executionResult.qty });
      } else {
        const guardReport = {
          minNotionalFail: false,
          cooldownActive: false,
          riskLimitExceeded: false,
          positionNotFound: false,
          qtyMismatch: false,
          marketClosed: false,
          executionFailed: true,
          other: executionResult.error,
        };
        console.log('[coordinator] defer', guardReport);
        
        console.error(`❌ UD_MODE=OFF → DIRECT EXECUTION FAILED: ${executionResult.error}`);
        // Log decision for audit (async, non-blocking) - pass price even for DEFER
        const priceForLog = intent.metadata?._coordinator_price || null;
        logDecisionAsync(supabaseClient, intent, 'DEFER', 'direct_execution_failed', unifiedConfig, requestId, undefined, undefined, priceForLog, strategy.configuration);
        
        return new Response(JSON.stringify({
          ok: true,
          decision: { 
            action: 'DEFER', 
            reason: `Guards tripped: executionFailed - ${executionResult.error}`
          }
        }), { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Check for manual quarantine before proceeding (only for automated traffic)
    if (intent.source !== 'manual') {
      const { data: holdData } = await supabaseClient
        .from('execution_holds')
        .select('hold_until')
        .eq('user_id', intent.userId)
        .eq('symbol', resolvedSymbol)
        .gt('hold_until', new Date().toISOString())
        .maybeSingle();

      if (holdData) {
        const guardReport = {
          minNotionalFail: false,
          cooldownActive: false,
          riskLimitExceeded: false,
          positionNotFound: false,
          qtyMismatch: false,
          marketClosed: false,
          holdPeriodNotMet: false,
          manualQuarantine: true,
          other: null,
        };
        console.log('[coordinator] defer', guardReport);
        
        console.log(`🎯 UD_MODE=ON → DEFER: reason=manual_quarantine symbol=${intent.symbol}`);
        
        return new Response(JSON.stringify({
          ok: true,
          decision: { 
            action: 'DEFER', 
            reason: `Guards tripped: manualQuarantine`
          }
        }), { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // PHASE 3.1: PRE-EXECUTION CIRCUIT BREAKER GATE
    const breakerCheck = await checkCircuitBreakers(supabaseClient, intent);
    if (breakerCheck.blocked) {
      console.log(`🚫 COORDINATOR: Blocked by circuit breaker - ${breakerCheck.reason}`);
      const guardReport = { circuitBreakerActive: true };
      console.log('[coordinator] defer', guardReport);
      
      // Get current price for context
      const baseSymbol = toBaseSymbol(intent.symbol);
      const priceData = await getMarketPrice(baseSymbol, 15000);
      
      logDecisionAsync(supabaseClient, intent, 'DEFER', 'blocked_by_circuit_breaker', unifiedConfig, requestId, { breaker_types: breakerCheck.breaker_types }, undefined, priceData.price, strategy.configuration);
      return new Response(JSON.stringify({
        ok: true,
        decision: { 
          action: 'DEFER', 
          reason: `Guards tripped: circuitBreakerActive - ${breakerCheck.reason}`
        }
      }), { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ============= CONFIDENCE GATE =============
    // Extract base confidence threshold from config
    const rawThreshold = strategy.configuration?.aiIntelligenceConfig?.aiConfidenceThreshold ?? 60;
    const baseMinConfidence = rawThreshold / 100;
    
    // Get dynamic min_confidence from strategy_parameters
    const confidenceConfig = await getEffectiveMinConfidenceForDecision({
      supabaseClient,
      userId: intent.userId,
      strategyId: intent.strategyId,
      symbol: resolvedSymbol,
      baseMinConfidence
    });
    
    const confidenceThreshold = confidenceConfig.effectiveMinConfidence;
    const effectiveConfidence = normalizeConfidence(intent.confidence);
    
    console.log('[coordinator] Confidence gate:', {
      threshold: confidenceThreshold,
      effectiveConfidence,
      source: confidenceConfig.source,
      optimizer: confidenceConfig.optimizer
    });
    
    // Apply confidence gate (unless confidence is null)
    try {
      if (effectiveConfidence !== null && effectiveConfidence < confidenceThreshold) {
        console.log('[coordinator] 🚫 Decision blocked by confidence gate', {
          symbol: intent.symbol,
          side: intent.side,
          effectiveConfidence,
          threshold: confidenceThreshold,
        });
        
        // Get current price for context
        const baseSymbol = toBaseSymbol(intent.symbol);
        const priceData = await getMarketPrice(baseSymbol, 15000);
        
        // Log decision event with confidence_below_threshold reason
        await logDecisionAsync(
          supabaseClient,
          intent,
          'HOLD',
          'signal_too_weak',
          unifiedConfig,
          requestId,
          { effectiveConfidence, confidenceThreshold },
          undefined,
          priceData.price,
          strategy.configuration,
          confidenceConfig  // Pass confidence source/optimizer info
        );
        
        return new Response(JSON.stringify({
          ok: true,
          decision: {
            action: 'HOLD',
            reason: 'confidence_below_threshold',
            request_id: requestId,
            retry_in_ms: 0,
          }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    } catch (err) {
      console.error('[coordinator] ⚠️ Confidence gate failure:', {
        symbol: intent.symbol,
        side: intent.side,
        error: err?.message || String(err),
      });
      
      // Return HOLD response without throwing (skip logging on error)
      return new Response(JSON.stringify({
        ok: true,
        decision: {
          action: 'HOLD',
          reason: 'confidence_below_threshold',
          request_id: requestId,
          retry_in_ms: 0,
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Unified Decisions ON - Use conflict detection approach
    console.log('🎯 UD_MODE=ON → CONFLICT DETECTION: checking for holds and conflicts');

    const symbolKey = `${intent.userId}_${intent.strategyId}_${intent.symbol}`;
    
    // Check micro-queue for this symbol
    const queueLength = getQueueLength(symbolKey);
     if (queueLength > 1) {
       // Too many concurrent requests for this symbol - defer with jitter
       const retryMs = 300 + Math.random() * 500; // 300-800ms jitter
       metrics.deferCount++;
       
       const guardReport = {
         minNotionalFail: false,
         cooldownActive: false,
         riskLimitExceeded: false,
         positionNotFound: false,
         qtyMismatch: false,
         marketClosed: false,
         queueOverload: true,
         other: null,
       };
       console.log('[coordinator] defer', guardReport);
       
       console.log(`🎯 UD_MODE=ON → DEFER: reason=queue_overload_defer symbol=${intent.symbol} retry=${retryMs}ms`);
       
       return new Response(JSON.stringify({
         ok: true,
         decision: { 
           action: 'DEFER', 
           reason: `Guards tripped: queueOverload`
         }
       }), { 
         status: 200,
         headers: { ...corsHeaders, 'Content-Type': 'application/json' }
       });
     }

    // Add to queue and process
    addToQueue(symbolKey, intent);
    
    try {
      // Use timestamp-based conflict detection (NO DB LOCKS)
      const conflictResult = await detectConflicts(supabaseClient, intent, unifiedConfig);
      
      if (conflictResult.hasConflict) {
        const guardReport = conflictResult.guardReport || {};
        console.log('[coordinator] defer', guardReport);
        
        const guardNames = Object.entries(guardReport)
          .filter(([,v]) => v)
          .map(([k]) => k)
          .join(', ') || 'unknown';
        
        const reasonWithGuards = `Guards tripped: ${guardNames}`;
        
        console.log(`🎯 UD_MODE=ON → DEFER: reason=${conflictResult.reason} symbol=${intent.symbol}`);
        cacheDecision(idempotencyKey, { action: 'DEFER', reason: conflictResult.reason as Reason, request_id: requestId, retry_in_ms: 0 });
        
        // Get current price for context
        const baseSymbol = toBaseSymbol(intent.symbol);
        const priceData = await getMarketPrice(baseSymbol, 15000);
        
        logDecisionAsync(supabaseClient, intent, 'DEFER', conflictResult.reason as Reason, unifiedConfig, requestId, undefined, undefined, priceData.price, strategy.configuration);
        
        return new Response(JSON.stringify({
          ok: true,
          decision: { 
            action: 'DEFER', 
            reason: reasonWithGuards 
          }
        }), { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // No conflicts - proceed with execution using advisory lock ONLY for atomic section
      const decision = await executeWithMinimalLock(supabaseClient, intent, unifiedConfig, strategy.configuration, requestId);
      
      cacheDecision(idempotencyKey, decision);
      
      // Track metrics
      const executionTime = Date.now() - startTime;
      metrics.executionTimes.push(executionTime);
      if (metrics.executionTimes.length > 100) {
        metrics.executionTimes = metrics.executionTimes.slice(-50);
      }
      
      return respond(decision.action, decision.reason, decision.request_id, decision.retry_in_ms, decision.qty ? { qty: decision.qty } : {});
      
    } finally {
      removeFromQueue(symbolKey, intent);
    }

  } catch (error) {
    console.error('❌ COORDINATOR: Error:', error);
    return respond('HOLD', 'internal_error', generateRequestId());
  }
});

// ============= HELPER FUNCTIONS =============

// Normalize confidence values (handles both 0-1 and 0-100 formats)
function normalizeConfidence(input: number | undefined | null): number | null {
  if (input == null || Number.isNaN(input)) return null;
  // If it looks like 0-100, convert to 0-1
  if (input > 1.0) return Math.min(100, Math.max(0, input)) / 100;
  // Already in 0-1 range
  return Math.min(1, Math.max(0, input));
}

// Generate unique request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Generate idempotency key based on intent contents
function generateIdempotencyKey(intent: TradeIntent): string {
  // 1) If client provided one (FE buckets to seconds), use it.
  if (intent.idempotencyKey) return intent.idempotencyKey;

  // 2) Otherwise, bucket ts to seconds to avoid millisecond churn.
  const tsSec =
    intent.ts
      ? Math.floor(new Date(intent.ts).getTime() / 1000).toString()
      : Math.floor(Date.now() / 1000).toString();

  const normalized = {
    userId: intent.userId,
    strategyId: intent.strategyId,
    symbol: intent.symbol,
    side: intent.side,
    source: intent.source,
    clientTs: tsSec
  };

  const keyString = JSON.stringify(normalized);
  let hash = 0;
  for (let i = 0; i < keyString.length; i++) {
    const char = keyString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `idem_${Math.abs(hash).toString(16)}`;
}

// STEP 1: Single response helper (enforces one shape always)
const respond = (action: DecisionAction, reason: Reason, request_id: string, retry_in_ms = 0, extra: Record<string, any> = {}): Response => {
  const decision = { action, reason, request_id, retry_in_ms, ...extra };
  return new Response(JSON.stringify({
    ok: true,
    decision
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
};

// Cache management
function getCachedDecision(key: string): { decision: TradeDecision; timestamp: number } | null {
  const cached = recentDecisionCache.get(key);
  if (cached && Date.now() - cached.timestamp < 30000) { // 30s cache
    return cached;
  }
  if (cached) {
    recentDecisionCache.delete(key); // Expired
  }
  return null;
}

function cacheDecision(key: string, decision: TradeDecision): void {
  recentDecisionCache.set(key, {
    decision: { ...decision },
    timestamp: Date.now()
  });
  
  // Cleanup old entries
  if (recentDecisionCache.size > 1000) {
    const entries = Array.from(recentDecisionCache.entries());
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
    recentDecisionCache.clear();
    entries.slice(0, 500).forEach(([k, v]) => recentDecisionCache.set(k, v));
  }
}

// Direct execution path (UD=OFF)
async function executeTradeDirectly(
  supabaseClient: any,
  intent: TradeIntent,
  strategyConfig: any,
  requestId: string
): Promise<{ success: boolean; error?: string; qty?: number }> {
  try {
    // Get real market price using symbol utilities with freshness check
    const baseSymbol = toBaseSymbol(intent.symbol);
    const sc = strategyConfig || {};
    const priceStaleMaxMs = sc.priceStaleMaxMs || 15000;
    const spreadThresholdBps = sc.spreadThresholdBps || 15;
    
      const priceData = await getMarketPrice(baseSymbol, priceStaleMaxMs);
      const realMarketPrice = priceData.price;
      
      // Store price for decision logging
      intent.metadata = intent.metadata || {};
      intent.metadata._coordinator_price = realMarketPrice;
      
      // Phase 2: Hold period enforcement for ALL SELLs
    if (intent.side === 'SELL') {
      // Fetch the most recent BUY for the same user/strategy/symbol
      const { data: recentBuys } = await supabaseClient
        .from('mock_trades')
        .select('executed_at')
        .eq('user_id', intent.userId)
        .eq('strategy_id', intent.strategyId)
        .eq('cryptocurrency', baseSymbol)
        .eq('trade_type', 'buy')
        .order('executed_at', { ascending: false })
        .limit(1);

      if (recentBuys && recentBuys.length > 0) {
        const lastBuyTime = new Date(recentBuys[0].executed_at).getTime();
        const timeSinceBuy = Date.now() - lastBuyTime;
        const minHoldPeriodMs = sc.minHoldPeriodMs || 300000; // 5 min default
        
        if (timeSinceBuy < minHoldPeriodMs) {
          console.log(`🚫 DIRECT: SELL blocked - hold period not met (${timeSinceBuy}ms < ${minHoldPeriodMs}ms)`);
          
          // Log decision for consistency
          const pseudoUnifiedConfig = {
            enableUnifiedDecisions: false,
            minHoldPeriodMs: sc.minHoldPeriodMs || 300000,
            cooldownBetweenOppositeActionsMs: sc.cooldownBetweenOppositeActionsMs || 180000,
            confidenceOverrideThreshold: 0.70
          };
          
          await logDecisionAsync(supabaseClient, intent, 'DEFER', 'hold_min_period_not_met', pseudoUnifiedConfig, requestId, undefined, undefined, realMarketPrice, strategyConfig);
          
          return { success: false, error: 'hold_min_period_not_met' };
        }
      }
    }
    
    // Phase 3: Price freshness and spread gates (for SELL operations)
    if (intent.side === 'SELL') {
      if (priceData.tickAgeMs > priceStaleMaxMs) {
        console.log(`🚫 DIRECT: SELL blocked - price too stale (${priceData.tickAgeMs}ms > ${priceStaleMaxMs}ms)`);
        return { success: false, error: `insufficient_price_freshness: ${priceData.tickAgeMs}ms > ${priceStaleMaxMs}ms` };
      }
      
      if (priceData.spreadBps > spreadThresholdBps) {
        console.log(`🚫 DIRECT: SELL blocked - spread too wide (${priceData.spreadBps.toFixed(1)}bps > ${spreadThresholdBps}bps)`);
        return { success: false, error: `spread_too_wide: ${priceData.spreadBps.toFixed(1)}bps > ${spreadThresholdBps}bps` };
      }
    }
    
    // CRITICAL FIX: Check available EUR balance BEFORE executing BUY trades
    const tradeAllocation = sc?.perTradeAllocation || 50; // match app defaults
    let qty: number;
    
    if (intent.side === 'BUY') {
      // Calculate current EUR balance from all trades
      const { data: allTrades } = await supabaseClient
        .from('mock_trades')
        .select('trade_type, total_value')
        .eq('user_id', intent.userId)
        .eq('is_test_mode', true);
      
      let availableEur = 30000; // Starting balance
      
      if (allTrades) {
        allTrades.forEach((trade: any) => {
          const value = parseFloat(trade.total_value);
          if (trade.trade_type === 'buy') {
            availableEur -= value;
          } else if (trade.trade_type === 'sell') {
            availableEur += value;
          }
        });
      }
      
      console.log(`💰 DIRECT: Available EUR balance: €${availableEur.toFixed(2)}`);
      
      // TEST MODE: Bypass balance check for test mode trades  
    const isTestMode = intent.metadata?.mode === 'mock' || sc?.is_test_mode;
      if (isTestMode) {
        console.log(`🧪 TEST MODE: Bypassing balance check - using virtual paper trading`);
        qty = intent.qtySuggested || (tradeAllocation / realMarketPrice);
      } else {
        // Check if we have sufficient balance
        if (availableEur < tradeAllocation) {
          const adjustedAllocation = Math.max(0, availableEur);
          if (adjustedAllocation < 10) { // Minimum €10 trade
            console.log(`🚫 DIRECT: Insufficient balance - €${availableEur.toFixed(2)} available, €${tradeAllocation} requested`);
            return { 
              success: false, 
              error: `Insufficient EUR balance: €${availableEur.toFixed(2)} available, €${tradeAllocation} requested` 
            };
          }
          console.log(`⚠️ DIRECT: Adjusting trade from €${tradeAllocation} to €${adjustedAllocation.toFixed(2)} (available balance)`);
          qty = adjustedAllocation / realMarketPrice;
        } else {
          qty = tradeAllocation / realMarketPrice;
        }
      }
    } else {
      // STEP 3: PROVE WALLET/POSITION STATE for SELL orders
      console.log('============ STEP 3: WALLET/POSITION STATE ============');
      
      // Query position aggregates for this symbol  
      const { data: allTrades } = await supabaseClient
        .from('mock_trades')
        .select('trade_type, amount, cryptocurrency')
        .eq('user_id', intent.userId)
        .eq('strategy_id', intent.strategyId)
        .in('cryptocurrency', [baseSymbol, `${baseSymbol}-EUR`]); // Check both forms for legacy compatibility
      
      let sumBuys = 0, sumSells = 0;
      let buysBaseForm = 0, buysPairForm = 0, sellsBaseForm = 0, sellsPairForm = 0;
      
      if (allTrades) {
        allTrades.forEach(trade => {
          const amount = parseFloat(trade.amount);
          if (trade.cryptocurrency === baseSymbol) {
            if (trade.trade_type === 'buy') {
              buysBaseForm += amount;
              sumBuys += amount;
            } else {
              sellsBaseForm += amount;
              sumSells += amount;
            }
          } else if (trade.cryptocurrency === `${baseSymbol}-EUR`) {
            if (trade.trade_type === 'buy') {
              buysPairForm += amount;
              sumBuys += amount;
            } else {
              sellsPairForm += amount; 
              sumSells += amount;
            }
          }
        });
      }
      
      const netPosition = sumBuys - sumSells;
      console.log('sum(buys):', sumBuys);
      console.log('sum(sells):', sumSells);
      console.log('net available_qty:', netPosition);
      console.log('cryptocurrency key queried:', `both "${baseSymbol}" and "${baseSymbol}-EUR"`);
      console.log(`Legacy data check: buys base=${buysBaseForm}, buys pair=${buysPairForm}, sells base=${sellsBaseForm}, sells pair=${sellsPairForm}`);
      
      if (netPosition <= 0) {
        console.log(`🚫 DIRECT: SELL blocked - no position (net=${netPosition})`);
        return { success: false, error: 'no_position_to_sell' };
      }
      
      // For SELL orders, use the suggested quantity
      qty = intent.qtySuggested || 0.001;
    }
    
    const totalValue = qty * realMarketPrice;
    
    console.log(`💱 DIRECT: ${intent.side} ${qty} ${baseSymbol} at €${realMarketPrice} = €${totalValue}`);
    
    // Insert trade record - store base symbol only
    const mockTrade = {
      user_id: intent.userId,
      strategy_id: intent.strategyId,
      trade_type: intent.side.toLowerCase(),
      cryptocurrency: baseSymbol, // Store base symbol only
      amount: qty,
      price: realMarketPrice,
      total_value: totalValue,
      executed_at: new Date().toISOString(),
      is_test_mode: true,
      notes: `Direct path: UD=OFF`,
      strategy_trigger: `direct_${intent.source}|req:${requestId}`
    };

    const { error } = await supabaseClient
      .from('mock_trades')
      .insert(mockTrade);

    if (error) {
      console.log('============ STEP 4: WRITE FAILED ============');
      console.log('DB insert error:', error);
      throw new Error(`DB insert failed: ${error.message}`);
    }

    // STEP 4: PROVE THE WRITE - log successful insert
    console.log('============ STEP 4: WRITE SUCCESSFUL ============');
    console.log('Inserted mockTrade:', JSON.stringify(mockTrade, null, 2));
    
    // Query back the inserted row for confirmation
    const { data: insertedRow } = await supabaseClient
      .from('mock_trades')
      .select('id, cryptocurrency, trade_type, amount, original_purchase_amount, original_purchase_price')
      .eq('user_id', intent.userId)
      .eq('trade_type', intent.side.toLowerCase())
      .order('executed_at', { ascending: false })
      .limit(1);
      
    if (insertedRow && insertedRow.length > 0) {
      console.log('New row id:', insertedRow[0].id);
      console.log('Echo inserted fields:', insertedRow[0]);
    } else {
      console.log('⚠️ Could not query back inserted row');
    }

    console.log('✅ DIRECT: Trade executed successfully');
    
    // STEP 5: FINAL DECISION - log for user 
    console.log('============ STEP 5: FINAL DECISION ============');
    console.log('decision.action:', intent.side);
    console.log('decision.reason: unified_decisions_disabled_direct_path');
    
    return { success: true, qty };

  } catch (error) {
    console.log('============ STEP 4: EXECUTION FAILED ============');
    console.log('Error message:', error.message);
    console.log('============ STEP 5: FINAL DECISION ============');
    console.log('decision.action: DEFER');
    console.log('decision.reason:', error.message);
    
    console.error('❌ DIRECT: Execution failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Get real-time prices from Coinbase API with freshness tracking (Phase 3)
async function getMarketPrice(symbol: string, maxStaleMs: number = 15000): Promise<{price: number, tickAgeMs: number, spreadBps: number}> {
  try {
    const baseSymbol = toBaseSymbol(symbol);
    const pairSymbol = toPairSymbol(baseSymbol);
    const fetchStartTime = Date.now();
    console.log('💱 EXECUTION PRICE LOOKUP: base=', baseSymbol, 'pair=', pairSymbol, 'url=/products/', pairSymbol, '/ticker');
    
    const response = await fetch(`https://api.exchange.coinbase.com/products/${pairSymbol}/ticker`);
    const data = await response.json();
    const fetchEndTime = Date.now();
    const tickAgeMs = fetchEndTime - fetchStartTime;
    
    if (response.ok && data.price) {
      const price = parseFloat(data.price);
      const bid = parseFloat(data.bid) || price;
      const ask = parseFloat(data.ask) || price;
      const spread = ask - bid;
      const spreadBps = price > 0 ? (spread / price) * 10000 : 0; // Convert to basis points
      
      console.log(`💱 COORDINATOR: Got real price for ${pairSymbol}: €${price} (spread: ${spreadBps.toFixed(1)}bps, age: ${tickAgeMs}ms)`);
      
      // Phase 3: Check price freshness  
      if (tickAgeMs > maxStaleMs) {
        console.log(`⚠️ PRICE FRESHNESS WARNING: ${pairSymbol} tick age ${tickAgeMs}ms > ${maxStaleMs}ms threshold`);
      }
      
      return { price, tickAgeMs, spreadBps };
    }
    
    throw new Error(`Invalid price response: ${data.message || 'Unknown error'}`);
  } catch (error) {
    console.error('❌  Price fetch error for', symbol, ':', error.message);
    throw error;
  }
}

// Async decision logging - Enhanced for Phase 1 Learning Loop
async function logDecisionAsync(
  supabaseClient: any,
  intent: TradeIntent,
  action: DecisionAction,
  reason: Reason,
  unifiedConfig: UnifiedConfig,
  requestId: string,
  profitMetadata?: any,
  tradeId?: string,
  executionPrice?: number,
  strategyConfig?: any,
  confidenceConfig?: {
    source: 'default' | 'strategy_parameters';
    optimizer: string | null;
    optimizerMetadata: any | null;
  }
): Promise<void> {
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);
    
    // Normalize confidence to [0,1] fraction for logging
    const normalizedConfidence = normalizeConfidence(intent.confidence);
    
    // Map executed decisions to semantic actions
    const actionToLog = 
      action === 'BUY' ? 'ENTER' :
      action === 'SELL' ? 'EXIT' :
      action;
    
    // Log to existing trade_decisions_log for compatibility
    await supabaseClient
      .from('trade_decisions_log')
      .insert({
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        symbol: baseSymbol, // Store base symbol only
        intent_side: intent.side,
        intent_source: intent.source,
        confidence: normalizedConfidence,  // Store as fraction
        decision_action: actionToLog,
        decision_reason: reason,
        metadata: {
          ...intent.metadata,
          qtySuggested: intent.qtySuggested,
          unifiedConfig,
          request_id: requestId,
          idempotencyKey: intent.idempotencyKey,
          ...(profitMetadata && { profitAnalysis: profitMetadata })
        }
      });

    // PHASE 2: Read execution mode (default TEST)
    const executionMode = Deno.env.get("EXECUTION_MODE") || "TEST";

    // PHASE 1 ENHANCEMENT: Log to decision_events for learning loop
    // Log ALL decisions unconditionally (BUY/SELL/BLOCK/DEFER/HOLD) for complete audit trail
    if (action === 'BUY' || action === 'SELL' || action === 'BLOCK' || action === 'DEFER' || action === 'HOLD') {
      // Extract EFFECTIVE TP/SL/min_confidence from strategy config (after overrides)
      // These values should be the actual parameters used for the decision, not the base strategy defaults
      const effectiveTpPct = strategyConfig?.takeProfitPercentage || strategyConfig?.configuration?.takeProfitPercentage || 1.5;
      const effectiveSlPct = strategyConfig?.stopLossPercentage || strategyConfig?.configuration?.stopLossPercentage || 0.8;
      const effectiveMinConf = strategyConfig?.minConfidence || (strategyConfig?.configuration?.aiConfidenceThreshold ? (strategyConfig.configuration.aiConfidenceThreshold / 100) : 0.5);
      const finalEntryPrice = executionPrice || profitMetadata?.entry_price || intent.metadata?.entry_price || profitMetadata?.currentPrice || null;

      console.log(`[coordinator] logging decision with effective params`, {
        symbol: baseSymbol,
        tp_pct: effectiveTpPct,
        sl_pct: effectiveSlPct,
        min_confidence: effectiveMinConf,
        confidence: normalizedConfidence,
      });

      console.log(`📌 LEARNING: logDecisionAsync - symbol=${baseSymbol}, side=${intent.side}, action=${action}, execution_mode=${executionMode}, entry_price=${finalEntryPrice}, tp_pct=${effectiveTpPct}, sl_pct=${effectiveSlPct}, min_confidence=${effectiveMinConf}, confidence=${normalizedConfidence}, expected_pnl_pct=${intent.metadata?.expectedPnL || null}`);

      // Validate and normalize source for decision_events constraint
      // Allowed values: 'automated', 'manual', 'system', 'intelligent'
      const allowedSources = ['automated', 'manual', 'system', 'intelligent'];
      const normalizedSource = allowedSources.includes(intent.source) 
        ? intent.source 
        : (intent.source === 'pool' || intent.source === 'news' || intent.source === 'whale' ? 'system' : 'manual');

      const eventPayload = {
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        symbol: baseSymbol,  // Always use extracted base symbol (e.g., "SOL" from "SOL-EUR")
        side: intent.side, // Use intent.side (BUY/SELL), not action
        source: normalizedSource,  // Validated source - one of: automated, manual, system, intelligent
        confidence: normalizedConfidence,  // Store as fraction [0,1]
        reason: `${reason}: ${intent.reason || 'No additional details'}`,
        expected_pnl_pct: intent.metadata?.expectedPnL || null,
        tp_pct: effectiveTpPct,  // Use effective TP after overrides
        sl_pct: effectiveSlPct,  // Use effective SL after overrides
        entry_price: finalEntryPrice,
        qty_suggested: intent.qtySuggested,
        decision_ts: new Date().toISOString(),
        trade_id: tradeId,
        metadata: {
          action: action, // Store action (BUY/SELL/BLOCK/DEFER/HOLD) in metadata
          request_id: requestId,
          unifiedConfig,
          profitAnalysis: profitMetadata,
          rawIntent: {
            symbol: intent.symbol,
            idempotencyKey: intent.idempotencyKey,
            ts: intent.ts
          },
          effective_min_confidence: effectiveMinConf,  // Store effective min_confidence for reference
          confidence_source: confidenceConfig?.source || 'default',  // Dynamic or default
          confidence_optimizer: confidenceConfig?.optimizer || null,  // Which optimizer (if any)
          confidence_optimizer_metadata: confidenceConfig?.optimizerMetadata 
            ? { run_id: confidenceConfig.optimizerMetadata.run_id, run_at: confidenceConfig.optimizerMetadata.run_at }
            : null  // Trimmed metadata for audit trail
        },
        raw_intent: intent as any
      };

      console.log('📌 LEARNING: decision_events payload', eventPayload);

      const { data: decisionInsertResult, error: decisionInsertError } = await supabaseClient
        .from('decision_events')
        .insert([eventPayload])
        .select('id');

      if (decisionInsertError) {
        console.error('❌ LEARNING: decision_events insert failed', {
          message: decisionInsertError.message,
          details: decisionInsertError.details,
          hint: decisionInsertError.hint
        });
      } else {
        console.log('✅ LEARNING: Successfully logged decision event row', {
          id: decisionInsertResult?.[0]?.id || null,
          symbol: baseSymbol,
          side: intent.side,
          reason
        });
      }
    }
  } catch (error) {
    console.error('❌ COORDINATOR: Failed to log decision:', error.message);
  }
}

// ============= PHASE 1: TP DETECTION FUNCTIONS =============

// Evaluate if current position has reached take-profit threshold
async function evaluatePositionStatus(
  supabaseClient: any,
  intent: TradeIntent,
  strategyConfig: any,
  currentPrice: number,
  requestId: string
): Promise<{ shouldSell: boolean; pnlPct: number; tpPct: number; metadata: any } | null> {
  
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);
    
    // Extract TP config
    const tpPercentage = strategyConfig?.takeProfitPercentage || 0.5; // Default 0.5%
    
    // Get BUY trades to check if we have a position
    const { data: buyTrades } = await supabaseClient
      .from('mock_trades')
      .select('amount, price, executed_at')
      .eq('user_id', intent.userId)
      .eq('strategy_id', intent.strategyId)  
      .eq('cryptocurrency', baseSymbol)
      .eq('trade_type', 'buy')
      .order('executed_at', { ascending: true }); // FIFO order

    if (!buyTrades || buyTrades.length === 0) {
      return null; // No position to evaluate
    }

    // Get existing SELL trades to calculate what's already been sold
    const { data: sellTrades } = await supabaseClient
      .from('mock_trades')
      .select('original_purchase_amount')
      .eq('user_id', intent.userId)
      .eq('strategy_id', intent.strategyId)
      .eq('cryptocurrency', baseSymbol) 
      .eq('trade_type', 'sell')
      .not('original_purchase_amount', 'is', null);

    // Calculate remaining position using FIFO
    let totalSold = 0;
    if (sellTrades) {
      totalSold = sellTrades.reduce((sum: number, sell: any) => sum + parseFloat(sell.original_purchase_amount), 0);
    }

    let totalPurchaseValue = 0;
    let totalPurchaseAmount = 0;
    let tempSold = totalSold;
    
    // Calculate average purchase price for remaining position
    for (const buy of buyTrades) {
      const buyAmount = parseFloat(buy.amount);
      const buyPrice = parseFloat(buy.price);
      
      // Calculate how much of this buy is still available
      const availableFromThisBuy = Math.max(0, buyAmount - tempSold);
      if (availableFromThisBuy <= 0) {
        tempSold -= buyAmount;
        continue;
      }
      
      // Add available amount to remaining position
      totalPurchaseAmount += availableFromThisBuy;
      totalPurchaseValue += availableFromThisBuy * buyPrice;
      tempSold = Math.max(0, tempSold - buyAmount);
    }

    if (totalPurchaseAmount === 0) {
      return null; // No remaining position
    }

    const avgPurchasePrice = totalPurchaseValue / totalPurchaseAmount;
    const pnlPct = ((currentPrice - avgPurchasePrice) / avgPurchasePrice) * 100;

    const metadata = {
      avgPurchasePrice: avgPurchasePrice.toFixed(2),
      currentPrice: currentPrice.toFixed(2),
      pnlPct: pnlPct.toFixed(2),
      tpPct: tpPercentage.toFixed(2),
      positionSize: totalPurchaseAmount.toFixed(8),
      evaluation: 'tp_detection'
    };

    // Check if TP threshold is reached
    if (pnlPct >= tpPercentage) {
      return { 
        shouldSell: true, 
        pnlPct: parseFloat(pnlPct.toFixed(2)), 
        tpPct: tpPercentage,
        metadata 
      };
    }

    return null; // TP not reached
    
  } catch (error) {
    console.error(`❌ COORDINATOR: TP evaluation error for ${intent.symbol}:`, error);
    return null;
  }
}

// ============= MAIN EXECUTION LOGIC =============

// Micro-queue management
function getQueueLength(symbolKey: string): number {
  const queue = symbolQueues.get(symbolKey);
  return queue ? queue.length : 0;
}

function addToQueue(symbolKey: string, intent: TradeIntent): void {
  if (!symbolQueues.has(symbolKey)) {
    symbolQueues.set(symbolKey, []);
  }
  const queue = symbolQueues.get(symbolKey)!;
  queue.push(intent);
}

function removeFromQueue(symbolKey: string, intent: TradeIntent): void {
  const queue = symbolQueues.get(symbolKey);
  if (queue) {
    const index = queue.findIndex(i => i.idempotencyKey === intent.idempotencyKey);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    if (queue.length === 0) {
      symbolQueues.delete(symbolKey);
    }
  }
}

// Timestamp-based conflict detection (NO DB LOCKS)
async function detectConflicts(
  supabaseClient: any,
  intent: TradeIntent,
  config: UnifiedConfig
): Promise<{ hasConflict: boolean; reason: string; guardReport?: any }> {
  
  // Initialize guard report
  const guardReport = {
    minNotionalFail: false,
    cooldownActive: false,
    riskLimitExceeded: false,
    positionNotFound: false,
    qtyMismatch: false,
    marketClosed: false,
    holdPeriodNotMet: false,
    other: null as string | null,
  };
  
  // Get recent trades for this symbol
  const baseSymbol = toBaseSymbol(intent.symbol);
  const { data: recentTrades } = await supabaseClient
    .from('mock_trades')
    .select('trade_type, executed_at, amount, price')
    .eq('user_id', intent.userId)
    .eq('strategy_id', intent.strategyId)
    .eq('cryptocurrency', baseSymbol)
    .gte('executed_at', new Date(Date.now() - 600000).toISOString()) // Last 10 minutes
    .order('executed_at', { ascending: false })
    .limit(20);

  const trades = recentTrades || [];
  
  // Apply precedence-based conflict rules
  if (intent.source === 'manual') {
    return { hasConflict: false, reason: 'manual_override_precedence', guardReport };
  }

  if (intent.source === 'pool' && intent.side === 'SELL') {
    // Pool exits get high precedence but check cooldown
    const recentBuy = trades.find(t => 
      t.trade_type === 'buy' && 
      (Date.now() - new Date(t.executed_at).getTime()) < config.cooldownBetweenOppositeActionsMs
    );
    
    if (recentBuy) {
      guardReport.cooldownActive = true;
      return { hasConflict: true, reason: 'blocked_by_precedence:POOL_EXIT', guardReport };
    }
    
    return { hasConflict: false, reason: 'no_conflicts_detected', guardReport };
  }

  // UNIVERSAL HOLD PERIOD CHECK - All SELL intents (first in order)
  // Skip for position management intents that already have entry_price
  if (intent.side === 'SELL') {
    const isPositionManagement = intent.metadata?.position_management === true && intent.metadata?.entry_price != null;
    
    if (!isPositionManagement) {
      const lastBuy = trades.find(t => t.trade_type === 'buy');
      if (lastBuy) {
        const timeSinceBuy = Date.now() - new Date(lastBuy.executed_at).getTime();
        const minHoldPeriodMs = config.minHoldPeriodMs || 300000; // 5 minutes default
        
        if (timeSinceBuy < minHoldPeriodMs) {
          guardReport.holdPeriodNotMet = true;
          return { hasConflict: true, reason: 'hold_min_period_not_met', guardReport };
        }
      } else {
        guardReport.positionNotFound = true;
        return { hasConflict: true, reason: 'no_position_found', guardReport };
      }
    } else {
      console.log(`✅ POSITION MANAGEMENT: Skipping FIFO validation for ${intent.symbol} SELL with entry_price=${intent.metadata.entry_price}`);
    }
  }

  // Check cooldown for opposite actions (no double penalty for automated BUYs)
  const oppositeAction = intent.side === 'BUY' ? 'sell' : 'buy';
  const recentOpposite = trades.find(t => t.trade_type === oppositeAction);
  
  if (recentOpposite) {
    const timeSinceOpposite = Date.now() - new Date(recentOpposite.executed_at).getTime();
    const cooldownRequired = config.cooldownBetweenOppositeActionsMs;
    
    if (timeSinceOpposite < cooldownRequired) {
      // Check confidence override for high-confidence sources
      if (['intelligent', 'news', 'whale'].includes(intent.source) && 
          intent.confidence >= config.confidenceOverrideThreshold) {
        return { hasConflict: false, reason: 'confidence_override_applied', guardReport };
      }
      
      guardReport.cooldownActive = true;
      return { hasConflict: true, reason: 'blocked_by_cooldown', guardReport };
    }
  }

  return { hasConflict: false, reason: 'no_conflicts_detected', guardReport };
}

// Execute with minimal advisory lock (atomic section only)
async function executeWithMinimalLock(
  supabaseClient: any,
  intent: TradeIntent,
  config: UnifiedConfig,
  strategyConfig: any,
  requestId: string
): Promise<TradeDecision> {

  // Short-lived advisory lock ONLY for the atomic execution section
  const lockKey = generateLockKey(intent.userId, intent.strategyId, intent.symbol);
  let lockAcquired = false;
  
  try {
    // PRICE FRESHNESS AND SPREAD GATES (before acquiring lock)
    const baseSymbol = toBaseSymbol(intent.symbol);
    const priceStaleMaxMs = strategyConfig?.priceStaleMaxMs || 15000; // DEFAULT_VALUES.PRICE_STALE_MAX_MS
    const spreadThresholdBps = strategyConfig?.spreadThresholdBps || 15; // DEFAULT_VALUES.SPREAD_THRESHOLD_BPS
    
    const priceData = await getMarketPrice(baseSymbol, priceStaleMaxMs);
    
    // Price freshness gate
    if (priceData.tickAgeMs > priceStaleMaxMs) {
      console.log(`🚫 COORDINATOR: Trade blocked - insufficient price freshness (${priceData.tickAgeMs}ms > ${priceStaleMaxMs}ms)`);
      logDecisionAsync(supabaseClient, intent, 'DEFER', 'insufficient_price_freshness', config, requestId, undefined, undefined, priceData.price, strategyConfig);
      return { action: 'DEFER', reason: 'insufficient_price_freshness', request_id: requestId, retry_in_ms: 0 };
    }
    
    // Spread gate
    if (priceData.spreadBps > spreadThresholdBps) {
      console.log(`🚫 COORDINATOR: Trade blocked - spread too wide (${priceData.spreadBps.toFixed(1)}bps > ${spreadThresholdBps}bps)`);
      logDecisionAsync(supabaseClient, intent, 'DEFER', 'spread_too_wide', config, requestId, undefined, undefined, priceData.price, strategyConfig);
      return { action: 'DEFER', reason: 'spread_too_wide', request_id: requestId, retry_in_ms: 0 };
    }
    
    // PHASE 3.1: PRE-EXECUTION CIRCUIT BREAKER GATE
    const breakerCheck = await checkCircuitBreakers(supabaseClient, intent);
    if (breakerCheck.blocked) {
      console.log(`🚫 COORDINATOR: Blocked by circuit breaker - ${breakerCheck.reason}`);
      logDecisionAsync(supabaseClient, intent, 'DEFER', 'blocked_by_circuit_breaker', config, requestId, { breaker_types: breakerCheck.breaker_types }, undefined, priceData.price, strategyConfig);
      return { action: 'DEFER', reason: 'blocked_by_circuit_breaker', request_id: requestId, retry_in_ms: 0 };
    }
    
    // PHASE 1: TP DETECTION - Check if position reached take-profit threshold
    let tpEvaluation = null;
    try {
      tpEvaluation = await evaluatePositionStatus(
        supabaseClient, intent, strategyConfig, priceData.price, requestId
      );
    } catch (error) {
      console.error(`❌ COORDINATOR: TP evaluation failed:`, error);
      tpEvaluation = null;
    }
    
    if (tpEvaluation && tpEvaluation.shouldSell) {
      console.log(`✅ COORDINATOR: TP hit → SELL now (pnl_pct=${tpEvaluation.pnlPct} ≥ tp=${tpEvaluation.tpPct}) req=${requestId}`);
      
      // Check if TP override respects existing gates (hold period and cooldown)
      const baseSymbol = toBaseSymbol(intent.symbol);
      const recentTrades = await getRecentTrades(supabaseClient, intent.userId, intent.strategyId, baseSymbol);
      
      // Check minimum hold period
      const minHoldMs = config?.minHoldPeriodMs || 0;
      if (minHoldMs > 0) {
        const lastBuy = recentTrades.find(t => t.trade_type === 'buy');
        if (lastBuy) {
          const holdTime = Date.now() - new Date(lastBuy.executed_at).getTime();
          if (holdTime < minHoldMs) {
            console.log(`🚫 COORDINATOR: TP blocked by minimum hold period (${holdTime}ms < ${minHoldMs}ms)`);
            // Continue with original intent instead of TP override
          } else {
            // Check cooldown before executing TP SELL
            const cooldownMs = config?.cooldownBetweenOppositeActionsMs || 0;
            if (cooldownMs > 0) {
              const recentBuy = recentTrades.find(t => t.trade_type === 'buy');
              if (recentBuy) {
                const timeSinceBuy = Date.now() - new Date(recentBuy.executed_at).getTime();
                if (timeSinceBuy < cooldownMs) {
                // TP SELL: Skip cooldown check - TP exits should be fast
                console.log(`🎯 COORDINATOR: TP SELL bypassing cooldown - taking profit at ${tpEvaluation.pnlPct}%`);
                return await executeTPSellWithLock(supabaseClient, intent, tpEvaluation, config, requestId, lockKey, strategyConfig);
                }
              }
            }
            
            // TP override is allowed, proceed with locked TP SELL
            return await executeTPSellWithLock(supabaseClient, intent, tpEvaluation, config, requestId, lockKey, strategyConfig);
          }
        }
      } else {
        // No hold period restriction, check cooldown
        const cooldownMs = config?.cooldownBetweenOppositeActionsMs || 0;
        if (cooldownMs > 0) {
          const recentBuy = recentTrades.find(t => t.trade_type === 'buy');
          if (recentBuy) {
            const timeSinceBuy = Date.now() - new Date(recentBuy.executed_at).getTime();
            if (timeSinceBuy < cooldownMs) {
            // TP SELL: Skip cooldown check - TP exits should be fast
            console.log(`🎯 COORDINATOR: TP SELL bypassing cooldown - taking profit at ${tpEvaluation.pnlPct}%`);
            return await executeTPSellWithLock(supabaseClient, intent, tpEvaluation, config, requestId, lockKey, strategyConfig);
            }
          }
        }
        
        // No restrictions, proceed with locked TP SELL
        return await executeTPSellWithLock(supabaseClient, intent, tpEvaluation, config, requestId, lockKey, strategyConfig);
      }
    }
    
    // Check if this is a position_management intent with entry_price (no lock needed)
    const isPositionManagement = intent.metadata?.position_management === true;
    const hasEntryPrice = typeof intent.metadata?.entry_price === 'number';
    const needsLock = !(isPositionManagement && hasEntryPrice);
    
    if (needsLock) {
      // Try to acquire lock with 300ms timeout for non-position-management intents
      console.log(`🔒 COORDINATOR: Acquiring minimal lock for atomic section: ${lockKey}`);
      
      const { data: lockResult } = await supabaseClient.rpc('pg_try_advisory_lock', {
        key: lockKey
      });

      if (!lockResult) {
        // Lock contention in atomic section - defer briefly
        metrics.blockedByLockCount++;
        console.log(`🎯 UD_MODE=ON → DEFER: reason=atomic_section_busy_defer symbol=${intent.symbol} retry=${Math.round(200 + Math.random() * 300)}ms`);
        
        const retryMs = Math.round(200 + Math.random() * 300);
        return { action: 'DEFER', reason: 'atomic_section_busy_defer', request_id: requestId, retry_in_ms: retryMs };
      }

      lockAcquired = true;
      console.log(`🔒 COORDINATOR: Minimal lock acquired - executing atomic section`);
    } else {
      console.log(`✅ POSITION MANAGEMENT: Skipping lock for ${intent.symbol} SELL with entry_price=${intent.metadata.entry_price}`);
    }

    // PHASE 3.1: Capture decision timestamp for latency tracking
    const decision_at = new Date().toISOString();

    // ATOMIC SECTION: Execute trade with real price data
    const executionResult = await executeTradeOrder(supabaseClient, intent, strategyConfig, requestId, priceData, decision_at);
    
    if (executionResult.success) {
      console.log(`🎯 UD_MODE=ON → EXECUTE: action=${intent.side} symbol=${intent.symbol} lock=OK`);
      
      // PHASE 3.1: Post-execution quality logging and breaker evaluation
      await logExecutionQuality(supabaseClient, intent, executionResult, decision_at, priceData);
      await evaluateCircuitBreakers(supabaseClient, intent);
      
      // Log ENTER/EXIT on successful execution with trade_id, execution price, and EFFECTIVE config (with overrides)
      await logDecisionAsync(supabaseClient, intent, intent.side, 'no_conflicts_detected', config, requestId, undefined, executionResult.tradeId, executionResult.executed_price, executionResult.effectiveConfig || strategyConfig);
      
      return { action: intent.side as DecisionAction, reason: 'no_conflicts_detected', request_id: requestId, retry_in_ms: 0, qty: executionResult.qty };
    } else {
      console.error(`❌ UD_MODE=ON → EXECUTE FAILED: ${executionResult.error}`);
      return { action: 'DEFER', reason: 'direct_execution_failed', request_id: requestId, retry_in_ms: 0 };
    }

  } finally {
    // Always release lock
    if (lockAcquired) {
      try {
        await supabaseClient.rpc('pg_advisory_unlock', { key: lockKey });
        console.log(`🔓 COORDINATOR: Released minimal lock: ${lockKey}`);
      } catch (unlockError) {
        console.error(`❌ COORDINATOR: Failed to release minimal lock:`, unlockError);
      }
    }
  }
}

// Generate lock key (kept for minimal lock usage)
function generateLockKey(userId: string, strategyId: string, symbol: string): number {
  const combined = `${userId}_${strategyId}_${symbol}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// Get recent trades (timestamp-based, no locks)
async function getRecentTrades(supabaseClient: any, userId: string, strategyId: string, symbol: string) {
  const baseSymbol = toBaseSymbol(symbol);
  const { data: trades } = await supabaseClient
    .from('mock_trades')
    .select('trade_type, executed_at, amount, price')
    .eq('user_id', userId)
    .eq('strategy_id', strategyId)
    .eq('cryptocurrency', baseSymbol) // Use base symbol for DB lookup
    .gte('executed_at', new Date(Date.now() - 300000).toISOString()) // Last 5 minutes
    .order('executed_at', { ascending: false })
    .limit(10);

  return trades || [];
}

// PHASE 4: Load strategy parameters from DB
async function loadStrategyParameters(
  supabaseClient: any,
  strategyId: string,
  symbol: string
): Promise<any | null> {
  const { data, error } = await supabaseClient
    .from('strategy_parameters')
    .select('*')
    .eq('strategy_id', strategyId)
    .eq('symbol', symbol)
    .maybeSingle();

  if (error) {
    console.warn(`[coordinator] Failed to load strategy_parameters: ${error.message}`);
    return null;
  }

  return data;
}

// Helper to get effective min_confidence with dynamic overrides
async function getEffectiveMinConfidenceForDecision(args: {
  supabaseClient: any;
  userId: string;
  strategyId: string;
  symbol: string;
  baseMinConfidence: number;
}): Promise<{
  effectiveMinConfidence: number;
  source: 'default' | 'strategy_parameters';
  optimizer: string | null;
  optimizerMetadata: any | null;
}> {
  const CONF_MIN = 0.30;
  const CONF_MAX = 0.90;
  
  try {
    // Query strategy_parameters for this (userId, strategyId, symbol)
    const { data: paramRow, error } = await args.supabaseClient
      .from('strategy_parameters')
      .select('min_confidence, last_updated_by, optimization_iteration, metadata')
      .eq('user_id', args.userId)
      .eq('strategy_id', args.strategyId)
      .eq('symbol', args.symbol)
      .maybeSingle();

    if (error) {
      console.warn(`[coordinator] Failed to query strategy_parameters for confidence: ${error.message}`);
      return {
        effectiveMinConfidence: args.baseMinConfidence,
        source: 'default',
        optimizer: null,
        optimizerMetadata: null
      };
    }

    if (!paramRow || paramRow.min_confidence === null || paramRow.min_confidence === undefined) {
      console.log(`[coordinator] No strategy_parameters row or null min_confidence for ${args.symbol}, using base: ${args.baseMinConfidence}`);
      return {
        effectiveMinConfidence: args.baseMinConfidence,
        source: 'default',
        optimizer: null,
        optimizerMetadata: null
      };
    }

    // Parse and clamp min_confidence
    const parsedConf = typeof paramRow.min_confidence === 'string' 
      ? parseFloat(paramRow.min_confidence) 
      : paramRow.min_confidence;
    
    if (isNaN(parsedConf)) {
      console.warn(`[coordinator] Invalid min_confidence value for ${args.symbol}: ${paramRow.min_confidence}, using base`);
      return {
        effectiveMinConfidence: args.baseMinConfidence,
        source: 'default',
        optimizer: null,
        optimizerMetadata: null
      };
    }

    const clampedConf = Math.max(CONF_MIN, Math.min(CONF_MAX, parsedConf));
    
    // Extract optimizer info from metadata
    let optimizerMetadata = null;
    if (paramRow.metadata) {
      // Prefer AI optimizer metadata, else rule optimizer
      if (paramRow.metadata.last_ai_optimizer_v1) {
        optimizerMetadata = paramRow.metadata.last_ai_optimizer_v1;
      } else if (paramRow.metadata.last_rule_optimizer_v1) {
        optimizerMetadata = paramRow.metadata.last_rule_optimizer_v1;
      }
    }

    console.log(`[coordinator] Using dynamic min_confidence for ${args.symbol}: ${clampedConf} (source: strategy_parameters, optimizer: ${paramRow.last_updated_by || 'unknown'})`);
    
    return {
      effectiveMinConfidence: clampedConf,
      source: 'strategy_parameters',
      optimizer: paramRow.last_updated_by || null,
      optimizerMetadata: optimizerMetadata
    };

  } catch (err) {
    console.error(`[coordinator] Error in getEffectiveMinConfidenceForDecision: ${err?.message || String(err)}`);
    return {
      effectiveMinConfidence: args.baseMinConfidence,
      source: 'default',
      optimizer: null,
      optimizerMetadata: null
    };
  }
}

// Execute trade (reused by both paths)
async function executeTradeOrder(
  supabaseClient: any,
  intent: TradeIntent,
  strategyConfig: any,
  requestId: string,
  priceData?: { price: number; tickAgeMs: number; spreadBps: number },
  decision_at?: string
): Promise<{ 
  success: boolean; 
  error?: string; 
  qty?: number; 
  tradeId?: string; 
  executed_at?: string; 
  decision_price?: number; 
  executed_price?: number; 
  partial_fill?: boolean;
  effectiveConfig?: any;  // Return the effective config with overrides applied
}> {
  
  try {
    // PHASE 4: Load optimized parameters (override hard-coded config)
    const baseSymbol = toBaseSymbol(intent.symbol);
    const params = await loadStrategyParameters(supabaseClient, intent.strategyId, baseSymbol);
    
    // Create effective config by merging overrides
    let effectiveConfig = { ...strategyConfig };
    
    // Apply parameters (override strategy config if available)
    if (params) {
      console.log(`[coordinator] Using optimized parameters for ${baseSymbol}: TP=${params.tp_pct}%, SL=${params.sl_pct}%, confidence=${params.min_confidence}`);
      effectiveConfig = {
        ...strategyConfig,
        takeProfitPercentage: params.tp_pct,
        stopLossPercentage: params.sl_pct,
        minConfidence: params.min_confidence
      };
    }

    // PHASE 5: Read execution mode for branching
    const executionMode = Deno.env.get("EXECUTION_MODE") || "TEST";
    console.log(`[coordinator] EXECUTION_MODE=${executionMode} for ${intent.side} ${baseSymbol}`);
    console.log(`💱 COORDINATOR: Executing ${intent.side} order for ${intent.symbol}`);
    
    // Use provided price data or fetch new price
    let realMarketPrice: number;
    if (priceData) {
      realMarketPrice = priceData.price;
    } else {
      const marketPrice = await getMarketPrice(baseSymbol);
      realMarketPrice = marketPrice.price;
    }
    
    console.log(`💱 COORDINATOR: Got real price for ${toPairSymbol(baseSymbol)}: €${realMarketPrice}`);
    
    // CRITICAL FIX: Check available EUR balance BEFORE executing BUY trades
    let qty: number;
    const tradeAllocation = effectiveConfig?.perTradeAllocation || 50; // match app defaults
    
    if (intent.side === 'BUY') {
      // Calculate current EUR balance from all trades
      const { data: allTrades } = await supabaseClient
        .from('mock_trades')
        .select('trade_type, total_value')
        .eq('user_id', intent.userId)
        .eq('is_test_mode', true);
      
      let availableEur = 30000; // Starting balance
      
      if (allTrades) {
        allTrades.forEach((trade: any) => {
          const value = parseFloat(trade.total_value);
          if (trade.trade_type === 'buy') {
            availableEur -= value;
          } else if (trade.trade_type === 'sell') {
            availableEur += value;
          }
        });
      }
      
      console.log(`💰 COORDINATOR: Available EUR balance: €${availableEur.toFixed(2)}`);
      
      // TEST MODE: Bypass balance check for test mode trades
      const isTestMode = intent.metadata?.mode === 'mock' || effectiveConfig?.is_test_mode;
      if (isTestMode) {
        console.log(`🧪 TEST MODE: Bypassing balance check - using virtual paper trading`);
        qty = intent.qtySuggested || (tradeAllocation / realMarketPrice);
      } else {
        // Check if we have sufficient balance
        if (availableEur < tradeAllocation) {
          const adjustedAllocation = Math.max(0, availableEur);
          if (adjustedAllocation < 10) { // Minimum €10 trade
            console.log(`🚫 COORDINATOR: Insufficient balance - €${availableEur.toFixed(2)} available, €${tradeAllocation} requested`);
            return { 
              success: false, 
              error: `Insufficient EUR balance: €${availableEur.toFixed(2)} available, €${tradeAllocation} requested` 
            };
          }
          console.log(`⚠️ COORDINATOR: Adjusting trade from €${tradeAllocation} to €${adjustedAllocation.toFixed(2)} (available balance)`);
          qty = adjustedAllocation / realMarketPrice;
        } else {
          qty = tradeAllocation / realMarketPrice;
        }
      }
    } else {
      // SELL GATE: Profit-aware logic
      if (intent.side === 'SELL') {
        // Pass entry_price from metadata if available (position management)
        const entryPriceOverride = intent.metadata?.entry_price;
        if (entryPriceOverride) {
          console.log(`📍 Using entry_price from metadata: ${entryPriceOverride} for profit gate evaluation`);
        }
        
        const profitGateResult = await evaluateProfitGate(
          supabaseClient, intent, effectiveConfig, realMarketPrice, requestId, entryPriceOverride
        );
        
        if (!profitGateResult.allowed) {
          console.log(`🚫 COORDINATOR: SELL blocked - ${profitGateResult.reason}`);
          
          // Log decision with profit metadata and current price
          await logDecisionAsync(
            supabaseClient, intent, 'BLOCK', 'blocked_by_insufficient_profit',
            { enableUnifiedDecisions: true } as UnifiedConfig, requestId, profitGateResult.metadata, undefined, profitGateResult.metadata?.currentPrice, effectiveConfig
          );
          
          return { 
            success: false, 
            error: `blocked_by_insufficient_profit: ${profitGateResult.reason}`,
            effectiveConfig  // Return effective config even on error
          };
        }
        
        // Log successful profit gate evaluation
        console.log(`✅ COORDINATOR: SELL allowed - profit gate passed`, profitGateResult.metadata);
      }
      
      // For SELL orders, use the suggested quantity
      qty = intent.qtySuggested || 0.001;
    }
    
    let totalValue = qty * realMarketPrice;
    
    console.log(`💱 COORDINATOR: Trade calculation - ${intent.side} ${qty} ${baseSymbol} at €${realMarketPrice} = €${totalValue}`);
    
    // For SELL orders, compute FIFO accounting fields and cap quantity
    let fifoFields = {};
    if (intent.side === 'SELL') {
      // Recompute FIFO for this specific SELL quantity (already computed in profit gate)
      const { data: buyTrades } = await supabaseClient
        .from('mock_trades')
        .select('amount, price, executed_at')
        .eq('user_id', intent.userId)
        .eq('strategy_id', intent.strategyId)
        .eq('cryptocurrency', baseSymbol)
        .eq('trade_type', 'buy')
        .order('executed_at', { ascending: true });

      const { data: sellTrades } = await supabaseClient
        .from('mock_trades')
        .select('original_purchase_amount')
        .eq('user_id', intent.userId)
        .eq('strategy_id', intent.strategyId)
        .eq('cryptocurrency', baseSymbol)
        .eq('trade_type', 'sell')
        .not('original_purchase_amount', 'is', null);

      if (buyTrades && buyTrades.length > 0) {
        let totalSold = sellTrades ? sellTrades.reduce((sum, sell) => sum + parseFloat(sell.original_purchase_amount), 0) : 0;
        let remainingQty = qty;
        let fifoValue = 0;
        let fifoAmount = 0;

        for (const buy of buyTrades) {
          if (remainingQty <= 0) break;
          const buyAmount = parseFloat(buy.amount);
          const buyPrice = parseFloat(buy.price);
          const availableFromBuy = Math.max(0, buyAmount - totalSold);
          
          if (availableFromBuy > 0) {
            const takeAmount = Math.min(remainingQty, availableFromBuy);
            fifoAmount += takeAmount;
            fifoValue += takeAmount * buyPrice;
            remainingQty -= takeAmount;
          }
          totalSold -= Math.min(totalSold, buyAmount);
        }

        if (!fifoAmount || fifoAmount <= 0) {
          console.log(`🚫 COORDINATOR: SELL blocked - insufficient_position_size`);
          // Log BLOCK decision before returning
          await logDecisionAsync(
            supabaseClient, intent, 'BLOCK', 'insufficient_position_size',
            { enableUnifiedDecisions: true } as UnifiedConfig, requestId, { realMarketPrice }, undefined, realMarketPrice, effectiveConfig
          );
          return { success: false, error: 'insufficient_position_size', effectiveConfig };
        }

        // Cap the sell size to what's actually available under FIFO
        if (qty > fifoAmount) {
          console.log(`⚠️ COORDINATOR: Capping SELL qty from ${qty} to ${fifoAmount} (FIFO remaining)`);
          qty = fifoAmount;
        }

        // Recompute totalValue after any cap
        totalValue = qty * realMarketPrice;

        fifoFields = {
          original_purchase_amount: fifoAmount,
          original_purchase_value: fifoValue,
          original_purchase_price: fifoValue / fifoAmount
        };
      } else {
        console.log(`🚫 COORDINATOR: SELL blocked - no buy history found`);
        // Log BLOCK decision before returning
        await logDecisionAsync(
          supabaseClient, intent, 'BLOCK', 'insufficient_position_size',
          { enableUnifiedDecisions: true } as UnifiedConfig, requestId, { realMarketPrice }, undefined, realMarketPrice, effectiveConfig
        );
        return { success: false, error: 'insufficient_position_size', effectiveConfig };
      }
    }

    // PHASE 3.1: Capture execution timestamp and compute metrics
    const executed_at = new Date().toISOString();
    const execution_latency_ms = decision_at ? new Date(executed_at).getTime() - new Date(decision_at).getTime() : null;
    const decision_price = priceData?.price || realMarketPrice;
    const executed_price = realMarketPrice;
    const slippage_bps = ((executed_price - decision_price) / decision_price) * 10000;
    const partial_fill = false; // Mock trades are always full fills
    
    // PHASE 5: Branch execution based on mode
    if (executionMode === "TEST") {
      // TEST mode → mock_trades with is_test_mode=true
      console.log(`[coordinator] TEST MODE: Writing to mock_trades (is_test_mode=true)`);
      
      const mockTrade = {
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        trade_type: intent.side.toLowerCase(),
        cryptocurrency: baseSymbol,
        amount: qty,
        price: realMarketPrice,
        total_value: totalValue,
        executed_at,
        is_test_mode: true,  // SECONDARY source
        notes: `Coordinator: UD=ON (TEST)`,
        strategy_trigger: intent.source === 'coordinator_tp' ? `coord_tp|req:${requestId}` : `coord_${intent.source}|req:${requestId}`,
        market_conditions: { execution_mode: executionMode, decision_at, executed_at, latency_ms: execution_latency_ms, request_id: requestId },
        ...fifoFields
      };

      const { data: insertResult, error } = await supabaseClient
        .from('mock_trades')
        .insert(mockTrade)
        .select('id');

      if (error) {
        console.error('❌ COORDINATOR: Mock trade insert failed:', error);
        return { success: false, error: error.message };
      }

      // STEP 4: PROVE THE WRITE - log successful insert
      console.log('============ STEP 4: WRITE SUCCESSFUL (TEST MODE) ============');
      console.log('Inserted row ID:', insertResult?.[0]?.id || 'ID_NOT_RETURNED');
      console.log('Inserted trade data:', JSON.stringify({
        symbol: mockTrade.cryptocurrency,
        side: mockTrade.trade_type,
        amount: mockTrade.amount,
        price: mockTrade.price,
        total_value: mockTrade.total_value,
        is_test_mode: mockTrade.is_test_mode,
        fifo_fields: fifoFields
      }, null, 2));
      console.log(`📊 Execution metrics: latency=${execution_latency_ms}ms, slippage=${slippage_bps}bps, partial_fill=${partial_fill}`);

      console.log('✅ COORDINATOR TEST: Trade executed successfully');
      return { 
        success: true, 
        qty, 
        tradeId: insertResult?.[0]?.id,
        executed_at,
        decision_price,
        executed_price,
        partial_fill,
        effectiveConfig  // Return the effective config with overrides
      };

    } else if (executionMode === "LIVE") {
      // LIVE mode → trades table (or exchange API)
      console.log(`[coordinator] LIVE MODE: Would execute real trade (currently disabled for safety)`);
      
      // TODO: Integrate with real exchange API
      // const exchangeResult = await exchangeAPI.executeTrade({...});
      
      // For now, return error to prevent accidental LIVE execution
      return { 
        success: false, 
        error: 'LIVE mode execution not yet implemented - manual control required',
        effectiveConfig  // Return effective config even on error
      };
    }

    // Fallback (should never reach)
    console.error('[coordinator] Unknown EXECUTION_MODE:', executionMode);
    return { success: false, error: `Unknown execution mode: ${executionMode}`, effectiveConfig };

  } catch (error) {
    console.error('❌ COORDINATOR: Trade execution error:', error.message);
    return { success: false, error: error.message, effectiveConfig: strategyConfig };  // Return original config on error
  }
}

// ============= PHASE 3.1: EXECUTION QUALITY & CIRCUIT BREAKERS =============

// Check circuit breakers before execution
async function checkCircuitBreakers(
  supabaseClient: any,
  intent: TradeIntent
): Promise<{ blocked: boolean; reason?: string; breaker_types?: string[] }> {
  try {
    const { data: breakers } = await supabaseClient
      .from('execution_circuit_breakers')
      .select('breaker_type, threshold_value')
      .eq('user_id', intent.userId)
      .eq('strategy_id', intent.strategyId)
      .eq('symbol', toBaseSymbol(intent.symbol))
      .eq('is_active', true);

    if (breakers && breakers.length > 0) {
      const breaker_types = breakers.map((b: any) => b.breaker_type);
      return {
        blocked: true,
        reason: `Active breakers: ${breaker_types.join(', ')}`,
        breaker_types
      };
    }

    return { blocked: false };
  } catch (error) {
    console.error('❌ BREAKER CHECK: Error checking circuit breakers:', error);
    return { blocked: false }; // Fail open to avoid blocking all trades
  }
}

// Log execution quality metrics
async function logExecutionQuality(
  supabaseClient: any,
  intent: TradeIntent,
  executionResult: any,
  decision_at: string,
  priceData: any
): Promise<void> {
  try {
    const executed_at = executionResult.executed_at || new Date().toISOString();
    const execution_latency_ms = new Date(executed_at).getTime() - new Date(decision_at).getTime();
    const decision_price = priceData?.price || executionResult.decision_price;
    const executed_price = executionResult.executed_price;
    const slippage_bps = ((executed_price - decision_price) / decision_price) * 10000;
    const decision_qty = intent.qtySuggested || 0;
    const executed_qty = executionResult.qty || 0;
    const partial_fill = executed_qty < decision_qty;
    
    // Optional context fields - best effort
    const spread_bps = priceData?.spread || null;
    const market_depth = null; // Could be enhanced later
    const volatility_regime = null; // Could be enhanced later

    const qualityLog = {
      user_id: intent.userId,
      strategy_id: intent.strategyId,
      symbol: toBaseSymbol(intent.symbol),
      side: intent.side.toLowerCase(),
      decision_at,
      executed_at,
      execution_latency_ms,
      decision_price,
      executed_price,
      decision_qty,
      executed_qty,
      partial_fill,
      slippage_bps,
      spread_bps,
      market_depth,
      volatility_regime,
      trade_id: executionResult.tradeId
    };

    await supabaseClient.from('execution_quality_log').insert([qualityLog]);
    console.log('📊 EXECUTION QUALITY: Logged execution metrics', {
      symbol: qualityLog.symbol,
      side: qualityLog.side,
      slippage_bps: qualityLog.slippage_bps,
      execution_latency_ms: qualityLog.execution_latency_ms,
      partial_fill: qualityLog.partial_fill
    });
  } catch (error) {
    console.error('❌ EXECUTION QUALITY: Failed to log metrics:', error);
  }
}

// Evaluate circuit breaker conditions and trip if needed
async function evaluateCircuitBreakers(
  supabaseClient: any,
  intent: TradeIntent
): Promise<void> {
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);
    const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    
    // Get recent execution quality logs for this {user, strategy, symbol}
    const { data: recentLogs } = await supabaseClient
      .from('execution_quality_log')
      .select('slippage_bps, partial_fill, executed_at')
      .eq('user_id', intent.userId)
      .eq('strategy_id', intent.strategyId)
      .eq('symbol', baseSymbol)
      .gte('executed_at', windowStart)
      .order('executed_at', { ascending: false });

    if (!recentLogs || recentLogs.length === 0) return;

    // SLIPPAGE BREAKER: avg(abs(slippage_bps)) > 50 across ≥3 fills
    if (recentLogs.length >= 3) {
      const avgAbsSlippage = recentLogs.reduce((sum: number, log: any) => sum + Math.abs(log.slippage_bps), 0) / recentLogs.length;
      if (avgAbsSlippage > 50) {
        console.log(`🚨 BREAKER TRIP: Slippage threshold exceeded (${avgAbsSlippage.toFixed(1)}bps avg)`);
        await tripBreaker(supabaseClient, intent, 'slippage', 50, `Avg slippage ${avgAbsSlippage.toFixed(1)}bps > 50bps`);
      }
    }

    // PARTIAL FILL BREAKER: partial_fill ratio > 0.30
    const partialFills = recentLogs.filter((log: any) => log.partial_fill).length;
    const partialFillRate = partialFills / recentLogs.length;
    if (partialFillRate > 0.30) {
      console.log(`🚨 BREAKER TRIP: Partial fill rate exceeded (${(partialFillRate * 100).toFixed(1)}%)`);
      await tripBreaker(supabaseClient, intent, 'partial_fill_rate', 0.30, `Partial fill rate ${(partialFillRate * 100).toFixed(1)}% > 30%`);
    }

  } catch (error) {
    console.error('❌ BREAKER EVALUATION: Error evaluating circuit breakers:', error);
  }
}

// Trip a circuit breaker
async function tripBreaker(
  supabaseClient: any,
  intent: TradeIntent,
  breaker_type: string,
  threshold_value: number,
  reason: string
): Promise<void> {
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);
    
    await supabaseClient
      .from('execution_circuit_breakers')
      .upsert({
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        symbol: baseSymbol,
        breaker_type,
        threshold_value,
        is_active: true,
        last_trip_at: new Date().toISOString(),
        trip_count: supabaseClient.raw('COALESCE(trip_count, 0) + 1'),
        trip_reason: reason
      }, {
        onConflict: 'user_id,strategy_id,symbol,breaker_type'
      });

    console.log(`🚨 BREAKER TRIPPED: ${breaker_type} for ${baseSymbol} - ${reason}`);
  } catch (error) {
    console.error('❌ BREAKER TRIP: Failed to trip breaker:', error);
  }
}

// ============= PROFIT-AWARE COORDINATOR (Milestone 1) =============

// Evaluate profit gate for SELL orders
async function evaluateProfitGate(
  supabaseClient: any,
  intent: TradeIntent,
  strategyConfig: any,
  currentPrice: number,
  requestId: string,
  entryPriceOverride?: number
): Promise<{ allowed: boolean; reason?: string; metadata: any }> {
  
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);
    
    // Extract profit-aware config with defaults
    const profitConfig: ProfitAwareConfig = {
      takeProfitPercentage: strategyConfig?.takeProfitPercentage || 1.5,
      stopLossPercentage: strategyConfig?.stopLossPercentage || 0.8,
      minEdgeBpsForExit: strategyConfig?.minEdgeBpsForExit || 8,
      minProfitEurForExit: strategyConfig?.minProfitEurForExit || 0.20,
      confidenceThresholdForExit: strategyConfig?.confidenceThresholdForExit || 0.60
    };

    // Get recent BUY trades to calculate FIFO position cost basis (skip if using override)
    let buyTrades: any[] | null = null;
    let sellTrades: any[] | null = null;
    
    if (!entryPriceOverride) {
      const buyResult = await supabaseClient
        .from('mock_trades')
        .select('amount, price, executed_at')
        .eq('user_id', intent.userId)
        .eq('strategy_id', intent.strategyId)  
        .eq('cryptocurrency', baseSymbol)
        .eq('trade_type', 'buy')
        .order('executed_at', { ascending: true }); // FIFO order
      
      buyTrades = buyResult.data;
      
      // Get existing SELL trades to calculate what's already been sold
      const sellResult = await supabaseClient
        .from('mock_trades')
        .select('original_purchase_amount, original_purchase_value')
        .eq('user_id', intent.userId)
        .eq('strategy_id', intent.strategyId)
        .eq('cryptocurrency', baseSymbol) 
        .eq('trade_type', 'sell')
        .not('original_purchase_amount', 'is', null);
      
      sellTrades = sellResult.data;
      
      if (!buyTrades || buyTrades.length === 0) {
        return {
          allowed: false,
          reason: 'no_position_to_sell',
          metadata: { error: 'No BUY trades found for position' }
        };
      }
    } else {
      console.log(`📍 Skipping FIFO queries - using entry price override: ${entryPriceOverride}`);
      buyTrades = [];
      sellTrades = [];
    }

    // Calculate remaining position using FIFO
    let totalSold = 0;
    if (sellTrades) {
      totalSold = sellTrades.reduce((sum: number, sell: any) => sum + parseFloat(sell.original_purchase_amount), 0);
    }

    // Guardrail: Quick check to prevent obvious oversells
    let totalAvailable = 0;
    for (const buy of buyTrades) {
      totalAvailable += parseFloat(buy.amount);
    }
    totalAvailable -= totalSold;
    
    if ((intent.qtySuggested || 0.001) > totalAvailable + 1e-12) {
      return {
        allowed: false,
        reason: 'insufficient_position_size',
        metadata: { 
          requested_qty: intent.qtySuggested, 
          remaining_fifo: totalAvailable,
          error: 'Requested quantity exceeds available FIFO position'
        }
      };
    }

    let remainingAmount = intent.qtySuggested || 0.001;
    let totalPurchaseValue = 0;
    let totalPurchaseAmount = 0;
    
    // FIFO matching to get average cost basis for this SELL quantity
    for (const buy of buyTrades) {
      if (remainingAmount <= 0) break;
      
      const buyAmount = parseFloat(buy.amount);
      const buyPrice = parseFloat(buy.price);
      
      // Calculate how much of this buy is still available
      const availableFromThisBuy = Math.max(0, buyAmount - totalSold);
      if (availableFromThisBuy <= 0) {
        totalSold -= buyAmount;
        continue;
      }
      
      // Take what we need from this buy lot
      const takeAmount = Math.min(remainingAmount, availableFromThisBuy);
      totalPurchaseAmount += takeAmount;
      totalPurchaseValue += takeAmount * buyPrice;
      remainingAmount -= takeAmount;
      totalSold -= (buyAmount - availableFromThisBuy);
    }

    // Use override entry price if provided (from position management metadata)
    let avgPurchasePrice: number;
    if (entryPriceOverride != null) {
      avgPurchasePrice = entryPriceOverride;
      totalPurchaseAmount = intent.qtySuggested || 0.001; // Use suggested qty for position management
      totalPurchaseValue = avgPurchasePrice * totalPurchaseAmount;
      console.log(`📍 Using entry price override: ${avgPurchasePrice} for P&L calculation`);
    } else {
      if (totalPurchaseAmount === 0) {
        return {
          allowed: false,
          reason: 'insufficient_position_size',
          metadata: { error: 'No remaining position to sell' }
        };
      }
      avgPurchasePrice = totalPurchaseValue / totalPurchaseAmount;
    }
    const sellAmount = intent.qtySuggested || 0.001;
    const sellValue = sellAmount * currentPrice;
    const pnlEur = sellValue - totalPurchaseValue;
    const pnlPct = ((currentPrice - avgPurchasePrice) / avgPurchasePrice) * 100;

    // Calculate edge (bid-ask spread impact approximation)
    const edgeBps = Math.abs(pnlPct) * 100; // Simplified: convert P&L% to basis points
    
    // Check take profit condition
    const tpHit = pnlPct >= profitConfig.takeProfitPercentage;
    
    // Check stop loss condition  
    const slHit = pnlPct <= -profitConfig.stopLossPercentage;
    
    // Check edge + EUR + confidence conditions
    const edgeCondition = edgeBps >= profitConfig.minEdgeBpsForExit;
    const eurCondition = pnlEur >= profitConfig.minProfitEurForExit;
    const confidenceCondition = intent.confidence >= profitConfig.confidenceThresholdForExit;
    const allConditionsMet = edgeCondition && eurCondition && confidenceCondition;

    const metadata = {
      pnl_eur: Number(pnlEur.toFixed(2)),
      edge_bps: Number(edgeBps.toFixed(1)),
      confidence: Number(intent.confidence.toFixed(3)),
      tp_hit: tpHit,
      sl_hit: slHit,
      thresholds: {
        tp_pct: profitConfig.takeProfitPercentage,
        sl_pct: profitConfig.stopLossPercentage,
        min_edge_bps: profitConfig.minEdgeBpsForExit,
        min_profit_eur: profitConfig.minProfitEurForExit,
        min_conf: profitConfig.confidenceThresholdForExit
      },
      conditions: {
        edge_met: edgeCondition,
        eur_met: eurCondition,
        confidence_met: confidenceCondition
      },
      position: {
        avg_purchase_price: Number(avgPurchasePrice.toFixed(2)),
        current_price: Number(currentPrice.toFixed(2)),
        pnl_pct: Number(pnlPct.toFixed(2))
      }
    };

    // Allow SELL if any condition is met
    const allowed = tpHit || slHit || allConditionsMet;
    
    if (!allowed) {
      let reason = 'Insufficient profit conditions: ';
      if (!tpHit) reason += `P&L ${pnlPct.toFixed(2)}% < TP ${profitConfig.takeProfitPercentage}%, `;
      if (!slHit) reason += `P&L ${pnlPct.toFixed(2)}% > SL -${profitConfig.stopLossPercentage}%, `;
      if (!allConditionsMet) {
        reason += 'Edge/EUR/Confidence not all met: ';
        if (!edgeCondition) reason += `edge ${edgeBps.toFixed(1)}bps < ${profitConfig.minEdgeBpsForExit}bps, `;
        if (!eurCondition) reason += `P&L €${pnlEur.toFixed(2)} < €${profitConfig.minProfitEurForExit}, `;
        if (!confidenceCondition) reason += `confidence ${intent.confidence.toFixed(3)} < ${profitConfig.confidenceThresholdForExit}`;
      }
      
      return { allowed: false, reason: reason.replace(/, $/, ''), metadata };
    }

    let reason = 'Profit gate passed: ';
    if (tpHit) reason += `Take Profit hit (${pnlPct.toFixed(2)}%)`;
    else if (slHit) reason += `Stop Loss hit (${pnlPct.toFixed(2)}%)`;
    else reason += `Edge/EUR/Confidence conditions met`;
    
    return { allowed: true, reason, metadata };
    
  } catch (error) {
    console.error('❌ PROFIT GATE: Evaluation error:', error);
    return {
      allowed: false,
      reason: `profit_evaluation_error: ${error.message}`,
      metadata: { error: error.message }
    };
  }
}

// Execute TP-triggered SELL
async function executeTPSell(
  supabaseClient: any,
  intent: TradeIntent,
  tpEvaluation: any,
  config: UnifiedConfig,
  requestId: string,
  strategyConfig: any
): Promise<TradeDecision> {
  
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);
    
    // Create TP SELL intent - sell the position size detected
    const tpSellIntent: TradeIntent = {
      ...intent,
      side: 'SELL',
      qtySuggested: parseFloat(tpEvaluation.metadata.positionSize),
      reason: `TP hit: ${tpEvaluation.pnlPct}% ≥ ${tpEvaluation.tpPct}%`,
      source: 'coordinator_tp' // Tag as TP-triggered
    };
    
    // Get current price for execution
    const priceData = await getMarketPrice(baseSymbol);
    
    // Execute the TP SELL
    const executionResult = await executeTradeOrder(supabaseClient, tpSellIntent, strategyConfig, requestId, priceData);
    
    if (executionResult.success) {
      console.log(`✅ COORDINATOR: TP SELL executed successfully`);
      
      // Log TP decision with detailed metadata and execution price and EFFECTIVE config (with overrides)
      await logDecisionAsync(
        supabaseClient, 
        intent, 
        'SELL', 
        'tp_hit_fastpath', 
        config, 
        requestId, 
        tpEvaluation.metadata,
        executionResult.tradeId,
        executionResult.executed_price,
        executionResult.effectiveConfig || strategyConfig
      );
      
      return { 
        action: 'SELL', 
        reason: 'tp_hit', 
        request_id: requestId, 
        retry_in_ms: 0, 
        qty: executionResult.qty 
      };
    } else {
      console.error(`❌ COORDINATOR: TP SELL execution failed: ${executionResult.error}`);
      return { action: 'DEFER', reason: 'tp_execution_failed', request_id: requestId, retry_in_ms: 0 };
    }
    
  } catch (error) {
    console.error('❌ COORDINATOR: TP SELL error:', error);
    return { action: 'DEFER', reason: 'tp_execution_error', request_id: requestId, retry_in_ms: 0 };
  }
}

// Execute TP-triggered SELL with advisory lock protection
async function executeTPSellWithLock(
  supabaseClient: any,
  intent: TradeIntent,
  tpEvaluation: any,
  config: UnifiedConfig,
  requestId: string,
  lockKey: number,
  strategyConfig: any
): Promise<TradeDecision> {
  
  let lockAcquired = false;
  
  try {
    // Acquire the same advisory lock used by the main execution path
    console.log(`🔒 COORDINATOR: Acquiring TP lock for atomic TP SELL: ${lockKey}`);
    
    const { data: lockResult } = await supabaseClient.rpc('pg_try_advisory_lock', {
      key: lockKey
    });

    if (!lockResult) {
      console.log(`🚫 COORDINATOR: TP SELL blocked by lock contention, deferring`);
      return { action: 'DEFER', reason: 'tp_lock_contention', request_id: requestId, retry_in_ms: 200 };
    }

    lockAcquired = true;
    console.log(`🔒 COORDINATOR: TP lock acquired - executing TP SELL`);
    
    const baseSymbol = toBaseSymbol(intent.symbol);
    
    // Create TP SELL intent - sell the position size detected
    const tpSellIntent: TradeIntent = {
      ...intent,
      side: 'SELL',
      qtySuggested: parseFloat(tpEvaluation.metadata.positionSize),
      reason: `TP hit: ${tpEvaluation.pnlPct}% ≥ ${tpEvaluation.tpPct}%`,
      source: 'coordinator_tp' // Tag as TP-triggered
    };
    
    // Get current price for execution
    const priceData = await getMarketPrice(baseSymbol);
    
    // Execute the TP SELL
    const executionResult = await executeTradeOrder(supabaseClient, tpSellIntent, strategyConfig, requestId, priceData);
    
    if (executionResult.success) {
      console.log(`✅ COORDINATOR: TP SELL executed successfully under lock`);
      
      // Log TP decision with detailed metadata and execution price and EFFECTIVE config (with overrides)
      await logDecisionAsync(
        supabaseClient, 
        intent, 
        'SELL', 
        'tp_hit_fastpath', 
        config, 
        requestId, 
        tpEvaluation.metadata,
        executionResult.tradeId,
        executionResult.executed_price,
        executionResult.effectiveConfig || strategyConfig
      );
      
      return {
        action: 'SELL', 
        reason: 'tp_hit', 
        request_id: requestId, 
        retry_in_ms: 0, 
        qty: executionResult.qty 
      };
    } else {
      console.error(`❌ COORDINATOR: TP SELL execution failed: ${executionResult.error}`);
      return { action: 'DEFER', reason: 'tp_execution_failed', request_id: requestId, retry_in_ms: 0 };
    }
    
  } catch (error) {
    console.error(`❌ COORDINATOR: TP SELL error:`, error);
    return { action: 'DEFER', reason: 'tp_execution_error', request_id: requestId, retry_in_ms: 0 };
  } finally {
    // Always release lock
    if (lockAcquired) {
      try {
        await supabaseClient.rpc('pg_advisory_unlock', { key: lockKey });
        console.log(`🔓 COORDINATOR: Released TP lock: ${lockKey}`);
      } catch (unlockError) {
        console.error(`❌ COORDINATOR: Failed to release TP lock:`, unlockError);
      }
    }
  }
}

// ============= END PHASE 1: TP DETECTION =============

// ============= END PROFIT-AWARE COORDINATOR =============

  // Cleanup old cached data periodically
  setInterval(() => {
    const now = Date.now();
    
    // Clean decision cache
    for (const [key, value] of recentDecisionCache.entries()) {
      if (now - value.timestamp > 60000) { // 1 minute
        recentDecisionCache.delete(key);
      }
    }
    
    // Clean empty queues
    for (const [key, queue] of symbolQueues.entries()) {
      if (queue.length === 0) {
        symbolQueues.delete(key);
      }
    }
    
    // Reset metrics every 30 minutes
    if (now - metrics.lastReset > 1800000) {
      console.log(`📊 COORDINATOR METRICS (30min):`, {
        totalRequests: metrics.totalRequests,
        atomicSectionBusyPct: ((metrics.blockedByLockCount / metrics.totalRequests) * 100).toFixed(2),
        deferRate: ((metrics.deferCount / metrics.totalRequests) * 100).toFixed(2),
        avgLatency: metrics.executionTimes.length > 0 
          ? (metrics.executionTimes.reduce((a, b) => a + b, 0) / metrics.executionTimes.length).toFixed(0) 
          : 0,
        p95Latency: metrics.executionTimes.length > 0 
          ? metrics.executionTimes.sort((a, b) => a - b)[Math.floor(metrics.executionTimes.length * 0.95)]
          : 0
      });
    
      // Reset metrics
      metrics.totalRequests = 0;
      metrics.blockedByLockCount = 0;
      metrics.deferCount = 0;
      metrics.executionTimes = [];
      metrics.lastReset = now;
    }
  }, 60000); // Run every minute