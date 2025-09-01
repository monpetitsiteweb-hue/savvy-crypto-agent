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
  | "bracket_policy_precedence"
  | "min_hold_period_not_met"
  | "blocked_by_cooldown"
  | "blocked_by_pnl_guard"
  | "strong_bearish_override"
  | "blocked_by_precedence:POOL_EXIT"
  | "queue_overload_defer"
  | "direct_execution_failed"
  | "internal_error"
  | "atomic_section_busy_defer"
  | "blocked_by_spread"
  | "blocked_by_liquidity"
  | "blocked_by_whale_conflict";

interface TradeDecision {
  action: DecisionAction;
  reason: Reason;
  request_id: string;
  retry_in_ms: number;
  qty?: number;
}

interface UnifiedDecisionResult {
  action: DecisionAction;
  reason: Reason;
  retry_in_ms?: number;
  metadata?: {
    pnl_guard?: {
      applied: boolean;
      penalty: number;
      s_total_before: number;
      s_total_after: number;
    };
    position_context?: {
      unrealized_pnl_pct: number;
      position_age_sec: number;
      distance_to_sl_pct: number;
    };
    bracket_context?: {
      sl_triggered: boolean;
      tp_triggered: boolean;
      sl_pct: number;
      tp_pct?: number;
    };
    fusion_context?: {
      s_total: number;
      enter_threshold: number;
      exit_threshold: number;
      override_threshold: number;
    };
  };
}

interface UnifiedConfig {
  enableUnifiedDecisions: boolean;
  minHoldPeriodMs: number;
  cooldownBetweenOppositeActionsMs: number;
  confidenceOverrideThreshold: number;
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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { intent } = await req.json() as { intent: TradeIntent };
    
    // Generate request ID and idempotency key
    const requestId = generateRequestId();
    const idempotencyKey = generateIdempotencyKey(intent);
    intent.idempotencyKey = idempotencyKey;
    
    console.log(`🎯 COORDINATOR: Processing intent [${requestId}]:`, JSON.stringify({
      ...intent,
      idempotencyKey
    }, null, 2));

    // Validate intent
    if (!intent?.userId || !intent?.strategyId || !intent?.symbol || !intent?.side) {
      return respond('HOLD', 'internal_error', requestId);
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
        // Log decision for audit (async, non-blocking)
        logDecisionAsync(supabaseClient, intent, intent.side, 'unified_decisions_disabled_direct_path', unifiedConfig, requestId);
        return respond(intent.side, 'unified_decisions_disabled_direct_path', requestId, 0, { qty: executionResult.qty });
      } else {
        console.error(`❌ UD_MODE=OFF → DIRECT EXECUTION FAILED: ${executionResult.error}`);
        // Log decision for audit (async, non-blocking)
        logDecisionAsync(supabaseClient, intent, 'HOLD', 'direct_execution_failed', unifiedConfig, requestId);
        return respond('HOLD', 'direct_execution_failed', requestId);
      }
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
      
      console.log(`🎯 UD_MODE=ON → DEFER: reason=queue_overload_defer symbol=${intent.symbol} retry=${retryMs}ms`);
      
      return respond('DEFER', 'queue_overload_defer', requestId, Math.round(retryMs));
    }

    // Add to queue and process
    addToQueue(symbolKey, intent);
    
    try {
      // Use timestamp-based conflict detection (NO DB LOCKS)
      const conflictResult = await detectConflicts(supabaseClient, intent, unifiedConfig);
      
      if (conflictResult.hasConflict) {
        console.log(`🎯 UD_MODE=ON → HOLD: reason=${conflictResult.reason} symbol=${intent.symbol}`);
        cacheDecision(idempotencyKey, { action: 'HOLD', reason: conflictResult.reason as Reason, request_id: requestId, retry_in_ms: 0 });
        logDecisionAsync(supabaseClient, intent, 'HOLD', conflictResult.reason as Reason, unifiedConfig, requestId);
        
        return respond('HOLD', conflictResult.reason as Reason, requestId);
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

// Generate unique request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Generate idempotency key based on intent contents
function generateIdempotencyKey(intent: TradeIntent): string {
  const normalized = {
    userId: intent.userId,
    strategyId: intent.strategyId,
    symbol: intent.symbol,
    side: intent.side,
    source: intent.source,
    clientTs: intent.ts || Date.now().toString()
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
    // Get real market price using symbol utilities
    const baseSymbol = toBaseSymbol(intent.symbol); 
    const realMarketPrice = await getMarketPrice(baseSymbol);
    
    // CRITICAL FIX: Check available EUR balance BEFORE executing BUY trades
    const tradeAllocation = strategyConfig?.perTradeAllocation || 1000;
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
      const isTestMode = intent.metadata?.mode === 'mock' || strategyConfig?.is_test_mode;
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
      strategy_trigger: `direct_${intent.source}`
    };

    const { error } = await supabaseClient
      .from('mock_trades')
      .insert(mockTrade);

    if (error) {
      throw new Error(`DB insert failed: ${error.message}`);
    }

    console.log('✅ DIRECT: Trade executed successfully');
    return { success: true, qty };

  } catch (error) {
    console.error('❌ DIRECT: Execution failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Get real-time prices from Coinbase API
async function getMarketPrice(symbol: string): Promise<number> {
  try {
    const baseSymbol = toBaseSymbol(symbol);
    const pairSymbol = toPairSymbol(baseSymbol);
    console.log('💱 EXECUTION PRICE LOOKUP: base=', baseSymbol, 'pair=', pairSymbol, 'url=/products/', pairSymbol, '/ticker');
    
    const response = await fetch(`https://api.exchange.coinbase.com/products/${pairSymbol}/ticker`);
    const data = await response.json();
    
    if (response.ok && data.price) {
      const price = parseFloat(data.price);
      console.log('💱 COORDINATOR: Got real price for', pairSymbol, ':', '€' + price);
      return price;
    }
    
    throw new Error(`Invalid price response: ${data.message || 'Unknown error'}`);
  } catch (error) {
    console.error('❌  Price fetch error for', symbol, ':', error.message);
    throw error;
  }
}

// Async decision logging (non-blocking)
async function logDecisionAsync(
  supabaseClient: any,
  intent: TradeIntent,
  action: DecisionAction,
  reason: Reason,
  unifiedConfig: UnifiedConfig,
  requestId: string
): Promise<void> {
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);
    await supabaseClient
      .from('trade_decisions_log')
      .insert({
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        symbol: baseSymbol, // Store base symbol only
        intent_side: intent.side,
        intent_source: intent.source,
        confidence: intent.confidence,
        decision_action: action,
        decision_reason: reason,
        metadata: {
          ...intent.metadata,
          qtySuggested: intent.qtySuggested,
          unifiedConfig,
          request_id: requestId,
          idempotencyKey: intent.idempotencyKey
        }
      });
  } catch (error) {
    console.error('❌ COORDINATOR: Failed to log decision:', error.message);
  }
}

// Enhanced decision logging with position context
async function logEnhancedDecision(
  supabaseClient: any,
  intent: TradeIntent,
  decision: UnifiedDecisionResult,
  config: UnifiedConfig,
  requestId: string
): Promise<void> {
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);
    await supabaseClient
      .from('trade_decisions_log')
      .insert({
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        symbol: baseSymbol,
        intent_side: intent.side,
        intent_source: intent.source,
        confidence: intent.confidence,
        decision_action: decision.action,
        decision_reason: decision.reason,
        metadata: {
          ...intent.metadata,
          qtySuggested: intent.qtySuggested,
          unifiedConfig: config,
          request_id: requestId,
          idempotencyKey: intent.idempotencyKey,
          // Enhanced context from unified decision
          ...decision.metadata
        }
      });
  } catch (error) {
    console.error('❌ COORDINATOR: Failed to log enhanced decision:', error.message);
  }
}

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
): Promise<{ hasConflict: boolean; reason: string }> {
  
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
    return { hasConflict: false, reason: 'manual_override_precedence' };
  }

  // BRACKET PRECEDENCE: TP/SL always fire before fusion evaluation
  if (intent.side === 'SELL' && intent.metadata?.position_management) {
    const reason = intent.reason || '';
    if (['STOP_LOSS', 'TAKE_PROFIT', 'AUTO_CLOSE_TIME', 'TRAILING_STOP'].includes(reason)) {
      console.log(`🎯 BRACKET PRECEDENCE: ${reason} fires immediately - bypassing gates`);
      return { hasConflict: false, reason: 'bracket_policy_precedence' };
    }
  }

  // POSITION-AWARE EXIT GUARD: Prevent noise-driven exits at small negative P&L
  if (intent.side === 'SELL' && intent.metadata?.position_management) {
    const positionAwareResult = await checkPositionAwareExitGuard(
      supabaseClient, intent, trades, config
    );
    if (positionAwareResult.blocked) {
      return { hasConflict: true, reason: positionAwareResult.reason };
    }
  }

  if (intent.source === 'pool' && intent.side === 'SELL') {
    // Pool exits get high precedence but check cooldown
    const recentBuy = trades.find(t => 
      t.trade_type === 'buy' && 
      (Date.now() - new Date(t.executed_at).getTime()) > config.minHoldPeriodMs
    );
    
    if (recentBuy) {
      return { hasConflict: true, reason: 'blocked_by_precedence:POOL_EXIT' };
    }
    
    return { hasConflict: false, reason: 'no_conflicts_detected' };
  }

  // Check minimum hold period for technical sells
  if (intent.source === 'automated' && intent.side === 'SELL' && intent.reason?.includes('technical')) {
    const lastBuy = trades.find(t => t.trade_type === 'buy');
    if (lastBuy) {
      const timeSinceBuy = Date.now() - new Date(lastBuy.executed_at).getTime();
      if (timeSinceBuy < config.minHoldPeriodMs) {
        return { hasConflict: true, reason: 'min_hold_period_not_met' };
      }
    }
  }

  // Check cooldown for opposite actions
  const oppositeAction = intent.side === 'BUY' ? 'sell' : 'buy';
  const recentOpposite = trades.find(t => t.trade_type === oppositeAction);
  
  if (recentOpposite) {
    const timeSinceOpposite = Date.now() - new Date(recentOpposite.executed_at).getTime();
    let cooldownRequired = config.cooldownBetweenOppositeActionsMs;
    
    // Scheduler gets double cooldown
    if (intent.source === 'automated' && intent.side === 'BUY') {
      cooldownRequired *= 2;
    }
    
    if (timeSinceOpposite < cooldownRequired) {
      // Check confidence override for high-confidence sources
      if (['intelligent', 'news', 'whale'].includes(intent.source) && 
          intent.confidence >= config.confidenceOverrideThreshold) {
        return { hasConflict: false, reason: 'confidence_override_applied' };
      }
      
      return { hasConflict: true, reason: 'blocked_by_cooldown' };
    }
  }

  return { hasConflict: false, reason: 'no_conflicts_detected' };
}

// Position-Aware Exit Guard - prevents noise-driven SELLs at small negative P&L
async function checkPositionAwareExitGuard(
  supabaseClient: any,
  intent: TradeIntent,
  trades: any[],
  config: UnifiedConfig
): Promise<{ blocked: boolean; reason: string; metadata?: any }> {
  
  try {
    const metadata = intent.metadata || {};
    const currentPrice = metadata.current_price;
    const entryPrice = metadata.entry_price;
    const gainPct = metadata.gain_percentage;
    
    // Skip guard if essential data missing
    if (!currentPrice || !entryPrice || gainPct === undefined) {
      return { blocked: false, reason: 'insufficient_position_data' };
    }
    
    // Get strategy config for stop-loss percentage (use existing config)
    const { data: strategy } = await supabaseClient
      .from('trading_strategies')
      .select('configuration')
      .eq('id', intent.strategyId)
      .single();
    
    const stopLossPercentage = strategy?.configuration?.stopLossPercentage || 0.5; // Default 0.5%
    const positionAgeMs = Date.now() - new Date(metadata.oldest_purchase_date || Date.now()).getTime();
    const positionAgeSec = Math.floor(positionAgeMs / 1000);
    
    // Calculate distance to stop-loss
    const distanceToStopLoss = Math.abs(gainPct) - stopLossPercentage;
    
    console.log(`🛡️ POSITION GUARD: P&L ${gainPct.toFixed(2)}%, SL ${stopLossPercentage}%, Distance ${distanceToStopLoss.toFixed(2)}%`);
    
    // GUARD LOGIC: Block exits at small negative P&L that are still inside SL boundary
    if (gainPct < 0 && distanceToStopLoss < 0) {
      // Position is at a loss but still inside stop-loss boundary
      
      // Calculate penalty based on how close we are to SL
      const slProximityFactor = Math.abs(distanceToStopLoss) / stopLossPercentage; // 0 = at SL, 1 = at breakeven
      const penalty = 0.3 * slProximityFactor; // Higher penalty when further from SL
      
      // Apply penalty to confidence - reduce likelihood of exit
      const adjustedConfidence = intent.confidence - penalty;
      
      console.log(`🛡️ POSITION GUARD: Applying penalty ${penalty.toFixed(2)} -> confidence ${adjustedConfidence.toFixed(2)}`);
      
      // Block if adjusted confidence falls below threshold (use existing config)
      const exitThreshold = 0.7; // From existing config defaults
      if (adjustedConfidence < exitThreshold) {
        return {
          blocked: true,
          reason: 'blocked_by_pnl_guard',
          metadata: {
            unrealized_pnl: gainPct,
            position_age_sec: positionAgeSec,
            distance_to_sl: distanceToStopLoss,
            pnl_guard_applied: true,
            penalty_applied: penalty,
            original_confidence: intent.confidence,
            adjusted_confidence: adjustedConfidence
          }
        };
      }
    }
    
    // Allow strong bearish signals to override (very low confidence means strong bearish)
    if (intent.confidence <= 0.2) {
      console.log(`🛡️ POSITION GUARD: Strong bearish override - confidence ${intent.confidence}`);
      return {
        blocked: false,
        reason: 'strong_bearish_override',
        metadata: {
          unrealized_pnl: gainPct,
          position_age_sec: positionAgeSec,
          distance_to_sl: distanceToStopLoss,
          strong_bearish_override: true
        }
      };
    }
    
    return { blocked: false, reason: 'position_guard_passed' };
    
  } catch (error) {
    console.error('❌ POSITION GUARD: Error in exit guard:', error);
    return { blocked: false, reason: 'guard_error' };
  }
}

// UNIFIED SELL DECISION EVALUATION - Bracket precedence + Fusion + Position guard
async function evaluateUnifiedSellDecision(
  supabaseClient: any,
  intent: TradeIntent,
  config: UnifiedConfig,
  strategyConfig: any,
  requestId: string
): Promise<UnifiedDecisionResult> {
  
  try {
    const metadata = intent.metadata || {};
    
    // STEP 1: BRACKET PRECEDENCE - Check TP/SL first (highest precedence)
    if (intent.side === 'SELL' && intent.metadata?.position_management) {
      const reason = intent.reason || '';
      const stopLossPercentage = strategyConfig?.stopLossPercentage || 0.5;
      const takeProfitPercentage = strategyConfig?.takeProfitPercentage;
      const gainPct = metadata.gain_percentage;
      
      // Check if SL or TP triggered
      const slTriggered = gainPct !== undefined && gainPct <= -Math.abs(stopLossPercentage);
      const tpTriggered = takeProfitPercentage && gainPct !== undefined && gainPct >= takeProfitPercentage;
      
      if (slTriggered || tpTriggered || ['STOP_LOSS', 'TAKE_PROFIT', 'AUTO_CLOSE_TIME', 'TRAILING_STOP'].includes(reason)) {
        console.log(`🎯 BRACKET PRECEDENCE: ${reason} fires immediately - bypassing all other evaluation`);
        
        return {
          action: 'SELL',
          reason: 'bracket_policy_precedence',
          metadata: {
            bracket_context: {
              sl_triggered: slTriggered,
              tp_triggered: tpTriggered,
              sl_pct: stopLossPercentage,
              tp_pct: takeProfitPercentage
            },
            position_context: {
              unrealized_pnl_pct: gainPct || 0,
              position_age_sec: Math.floor((Date.now() - new Date(metadata.oldest_purchase_date || Date.now()).getTime()) / 1000),
              distance_to_sl_pct: Math.max(0, stopLossPercentage - Math.abs(gainPct || 0))
            }
          }
        };
      }
    }
    
    // STEP 2: AI FUSION EVALUATION (only if brackets not triggered)
    if (intent.side === 'SELL') {
      const fusionResult = await evaluateAIFusionForSell(supabaseClient, intent, strategyConfig);
      
      if (fusionResult) {
        const { s_total_before, s_total_after, enter_threshold, exit_threshold, override_threshold, penalty, position_context } = fusionResult;
        
        // Check strong bearish override first
        if (s_total_before <= override_threshold) {
          console.log(`🎯 STRONG BEARISH OVERRIDE: S_total ${s_total_before.toFixed(3)} <= override ${override_threshold.toFixed(3)}`);
          return {
            action: 'SELL',
            reason: 'strong_bearish_override',
            metadata: {
              pnl_guard: {
                applied: penalty > 0,
                penalty,
                s_total_before,
                s_total_after
              },
              position_context,
              fusion_context: {
                s_total: s_total_before,
                enter_threshold,
                exit_threshold,
                override_threshold
              }
            }
          };
        }
        
        // Check if exit signal after penalty
        if (s_total_after <= -exit_threshold) {
          console.log(`🎯 FUSION EXIT: S_total_after ${s_total_after.toFixed(3)} <= exit_threshold ${-exit_threshold.toFixed(3)}`);
          return {
            action: 'SELL',
            reason: 'no_conflicts_detected',
            metadata: {
              pnl_guard: {
                applied: penalty > 0,
                penalty,
                s_total_before,
                s_total_after
              },
              position_context,
              fusion_context: {
                s_total: s_total_after,
                enter_threshold,
                exit_threshold,
                override_threshold
              }
            }
          };
        }
        
        // Position guard blocked the exit
        console.log(`🛡️ POSITION GUARD BLOCKED: S_total_after ${s_total_after.toFixed(3)} > exit_threshold ${-exit_threshold.toFixed(3)}`);
        return {
          action: 'HOLD',
          reason: 'blocked_by_pnl_guard',
          metadata: {
            pnl_guard: {
              applied: true,
              penalty,
              s_total_before,
              s_total_after
            },
            position_context,
            fusion_context: {
              s_total: s_total_after,
              enter_threshold,
              exit_threshold,
              override_threshold
            }
          }
        };
      }
    }
    
    // STEP 3: DEFAULT - No special logic for BUY or non-fusion SELL
    return {
      action: intent.side,
      reason: 'no_conflicts_detected',
      metadata: {}
    };
    
  } catch (error) {
    console.error('❌ UNIFIED DECISION: Error evaluating decision:', error);
    return {
      action: 'HOLD',
      reason: 'internal_error',
      metadata: {}
    };
  }
}

// AI Fusion evaluation for SELL decisions with position-aware penalties
async function evaluateAIFusionForSell(
  supabaseClient: any,
  intent: TradeIntent,
  strategyConfig: any
): Promise<{
  s_total_before: number;
  s_total_after: number;
  enter_threshold: number;
  exit_threshold: number;
  override_threshold: number;
  penalty: number;
  position_context: {
    unrealized_pnl_pct: number;
    position_age_sec: number;
    distance_to_sl_pct: number;
  };
} | null> {
  
  try {
    const metadata = intent.metadata || {};
    
    // Check if AI fusion is enabled
    const aiConfig = strategyConfig?.aiIntelligenceConfig?.features?.fusion;
    const legacyFusion = strategyConfig?.signalFusion;
    const fusionConfig = aiConfig || legacyFusion;
    
    if (!fusionConfig?.enabled) {
      return null; // No fusion evaluation
    }
    
    // Get thresholds from config (existing keys only)
    const enter_threshold = fusionConfig.enterThreshold || 0.65;
    const exit_threshold = fusionConfig.exitThreshold || 0.35;
    const gap = enter_threshold - exit_threshold;
    const override_threshold = exit_threshold - 0.5 * gap;
    
    // Calculate mock S_total for SELL (simplified for this implementation)
    // In real implementation, this would be the actual fusion score
    const confidence_normalized = (intent.confidence - 0.5) * 2; // Convert [0,1] to [-1,1]
    const s_total_before = -Math.abs(confidence_normalized); // Negative for SELL signals
    
    // Get position context
    const gainPct = metadata.gain_percentage || 0;
    const positionAgeMs = Date.now() - new Date(metadata.oldest_purchase_date || Date.now()).getTime();
    const positionAgeSec = Math.floor(positionAgeMs / 1000);
    
    // Get stop-loss from bracket policy or legacy config
    const bracketPolicy = strategyConfig?.aiIntelligenceConfig?.features?.bracketPolicy;
    const sl = bracketPolicy?.stopLossPctWhenNotAtr || strategyConfig?.stopLossPercentage || 0.5;
    
    const dd = Math.abs(gainPct); // Drawdown magnitude (positive value)
    const insideSL = dd < sl;
    const distance_to_sl_pct = Math.max(0, sl - dd);
    
    // Apply position-aware penalty formula (derived from existing config)
    let penalty = 0;
    if (gainPct < 0 && insideSL) {
      penalty = gap * (1 - dd / sl); // More protection near entry, less near SL
    }
    
    const s_total_after = s_total_before + penalty; // Apply penalty (makes exit less likely)
    
    console.log(`🔬 FUSION EVAL: S_before=${s_total_before.toFixed(3)}, penalty=${penalty.toFixed(3)}, S_after=${s_total_after.toFixed(3)}, exit_thresh=${-exit_threshold.toFixed(3)}`);
    
    return {
      s_total_before,
      s_total_after,
      enter_threshold,
      exit_threshold,
      override_threshold,
      penalty,
      position_context: {
        unrealized_pnl_pct: gainPct,
        position_age_sec: positionAgeSec,
        distance_to_sl_pct
      }
    };
    
  } catch (error) {
    console.error('❌ AI FUSION: Error in fusion evaluation:', error);
    return null;
  }
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
    // Try to acquire lock with 300ms timeout
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

    // UNIFIED DECISION PATH: Apply bracket precedence, fusion evaluation, and position guard
    const unifiedDecision = await evaluateUnifiedSellDecision(supabaseClient, intent, config, strategyConfig, requestId);
    
    if (unifiedDecision.action === 'SELL') {
      // Execute the trade
      const executionResult = await executeTradeOrder(supabaseClient, intent, strategyConfig);
      
      if (executionResult.success) {
        console.log(`🎯 UD_MODE=ON → EXECUTE: action=${intent.side} symbol=${intent.symbol} lock=OK`);
        
        // Enhanced logging with position context
        await logEnhancedDecision(supabaseClient, intent, unifiedDecision, config, requestId);
        
        return { action: intent.side as DecisionAction, reason: unifiedDecision.reason, request_id: requestId, retry_in_ms: 0, qty: executionResult.qty };
      } else {
        console.error(`❌ UD_MODE=ON → EXECUTE FAILED: ${executionResult.error}`);
        return { action: 'HOLD', reason: 'direct_execution_failed', request_id: requestId, retry_in_ms: 0 };
      }
    } else {
      // Decision was HOLD/DEFER due to guard or other logic
      console.log(`🎯 UD_MODE=ON → ${unifiedDecision.action}: reason=${unifiedDecision.reason} symbol=${intent.symbol}`);
      
      // Enhanced logging with position context
      await logEnhancedDecision(supabaseClient, intent, unifiedDecision, config, requestId);
      
      return { action: unifiedDecision.action, reason: unifiedDecision.reason, request_id: requestId, retry_in_ms: unifiedDecision.retry_in_ms || 0 };
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

// Execute trade (reused by both paths)
async function executeTradeOrder(
  supabaseClient: any,
  intent: TradeIntent,
  strategyConfig: any
): Promise<{ success: boolean; error?: string; qty?: number }> {
  
  try {
    console.log(`💱 COORDINATOR: Executing ${intent.side} order for ${intent.symbol}`);
    
    // Get real market price using symbol utilities
    const baseSymbol = toBaseSymbol(intent.symbol);
    const realMarketPrice = await getMarketPrice(baseSymbol);
    
    console.log(`💱 COORDINATOR: Got real price for ${toPairSymbol(baseSymbol)}: €${realMarketPrice}`);
    
    // CRITICAL FIX: Check available EUR balance BEFORE executing BUY trades
    let qty: number;
    const tradeAllocation = strategyConfig?.perTradeAllocation || 1000;
    
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
      const isTestMode = intent.metadata?.mode === 'mock' || strategyConfig?.is_test_mode;
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
      // For SELL orders, use the suggested quantity
      qty = intent.qtySuggested || 0.001;
    }
    
    const totalValue = qty * realMarketPrice;
    
    console.log(`💱 COORDINATOR: Trade calculation - ${intent.side} ${qty} ${baseSymbol} at €${realMarketPrice} = €${totalValue}`);
    
    // Execute trade - store base symbol only
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
      notes: `Coordinator: UD=ON`,
      strategy_trigger: `coord_${intent.source}`
    };

    const { error } = await supabaseClient
      .from('mock_trades')
      .insert(mockTrade);

    if (error) {
      console.error('❌ COORDINATOR: Trade execution failed:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ COORDINATOR: Trade executed successfully');
    return { success: true, qty };

  } catch (error) {
    console.error('❌ COORDINATOR: Trade execution error:', error);
    return { success: false, error: error.message };
  }
}

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
    
      metrics = {
        totalRequests: 0,
        blockedByLockCount: 0,
        deferCount: 0,
        executionTimes: [],
        lastReset: now
      };
    }
  }, 60000); // Run every minute