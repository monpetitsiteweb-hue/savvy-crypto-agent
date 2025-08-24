import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

interface TradeDecision {
  approved?: boolean;
  action: 'BUY' | 'SELL' | 'HOLD' | 'DEFER';
  reason: string;
  qty?: number;
  request_id: string;
  retry_in_ms?: number;
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
      return respondWithDecision({
        action: 'HOLD',
        reason: 'Invalid intent: missing required fields',
        request_id: requestId
      }, 400);
    }

    // Check for duplicate/idempotent request
    const cachedDecision = getCachedDecision(idempotencyKey);
    if (cachedDecision) {
      console.log(`🔄 COORDINATOR: Returning cached decision for key: ${idempotencyKey}`);
      return respondWithDecision(cachedDecision.decision);
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
      return respondWithDecision({
        action: 'HOLD',
        reason: 'Strategy not found or access denied',
        request_id: requestId
      }, 404);
    }

    const unifiedConfig: UnifiedConfig = strategy.unified_config || {
      enableUnifiedDecisions: false,
      minHoldPeriodMs: 120000,
      cooldownBetweenOppositeActionsMs: 30000,
      confidenceOverrideThreshold: 0.70
    };

    // 🚨 HARD GATE: If unified decisions disabled, bypass ALL coordinator logic
    if (!unifiedConfig.enableUnifiedDecisions) {
      console.log('🔓 COORDINATOR: UD=OFF - Direct execution path (NO LOCKS)');
      
      const decision: TradeDecision = {
        action: intent.side,
        reason: 'unified_decisions_disabled_direct_path',
        request_id: requestId,
        qty: intent.qtySuggested
      };

      // Execute trade directly without any coordinator gating
      const executionResult = await executeTradeDirectly(supabaseClient, intent, decision, strategy.configuration);
      
      if (executionResult.success) {
        decision.approved = true;
        console.log(`✅ COORDINATOR: Direct execution successful [NO LOCKS] ${intent.side} ${intent.symbol}`);
      } else {
        decision.action = 'HOLD';
        decision.reason = `direct_execution_failed: ${executionResult.error}`;
        console.error(`❌ COORDINATOR: Direct execution failed: ${executionResult.error}`);
      }

      // Log decision for audit (async, non-blocking)
      logDecisionAsync(supabaseClient, intent, decision, unifiedConfig);
      
      return respondWithDecision(decision);
    }

    // Unified Decisions ON - Use conflict detection approach
    console.log('🧠 COORDINATOR: UD=ON - Using conflict detection approach');
    
    const symbolKey = `${intent.userId}_${intent.strategyId}_${intent.symbol}`;
    
    // Check micro-queue for this symbol
    const queueLength = getQueueLength(symbolKey);
    if (queueLength > 1) {
      // Too many concurrent requests for this symbol - defer with jitter
      const retryMs = 300 + Math.random() * 500; // 300-800ms jitter
      metrics.deferCount++;
      
      console.log(`⏸️ COORDINATOR: Queue overload (${queueLength} pending) - DEFER with ${retryMs}ms retry`);
      
      return respondWithDecision({
        action: 'DEFER',
        reason: 'queue_overload_defer',
        request_id: requestId,
        retry_in_ms: Math.round(retryMs)
      });
    }

    // Add to queue and process
    addToQueue(symbolKey, intent);
    
    try {
      // Use timestamp-based conflict detection (NO DB LOCKS)
      const conflictResult = await detectConflicts(supabaseClient, intent, unifiedConfig);
      
      if (conflictResult.hasConflict) {
        const decision: TradeDecision = {
          action: 'HOLD',
          reason: conflictResult.reason,
          request_id: requestId
        };
        
        cacheDecision(idempotencyKey, decision);
        logDecisionAsync(supabaseClient, intent, decision, unifiedConfig);
        
        return respondWithDecision(decision);
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
      
      return respondWithDecision(decision);
      
    } finally {
      removeFromQueue(symbolKey, intent);
    }

  } catch (error) {
    console.error('❌ COORDINATOR: Error:', error);
    return respondWithDecision({
      action: 'HOLD',
      reason: `Internal error: ${error.message}`,
      request_id: generateRequestId()
    }, 500);
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

// Standardized response format
function respondWithDecision(decision: TradeDecision, status = 200): Response {
  return new Response(JSON.stringify({
    ok: true,
    decision: decision
  }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

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
  decision: TradeDecision,
  strategyConfig: any
): Promise<{ success: boolean; error?: string }> {
  
  try {
    // Get real market price
    const coinbaseSymbol = intent.symbol.includes('-EUR') ? intent.symbol : `${intent.symbol}-EUR`;
    const response = await fetch(`https://api.exchange.coinbase.com/products/${coinbaseSymbol}/ticker`);
    
    if (!response.ok) {
      throw new Error(`Price fetch failed: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const realMarketPrice = parseFloat(data.price);
    
    if (!realMarketPrice || realMarketPrice <= 0) {
      throw new Error(`Invalid price: ${data.price}`);
    }
    
    console.log(`💱 DIRECT: Got price for ${coinbaseSymbol}: €${realMarketPrice}`);
    
    // Calculate quantity
    const tradeAllocation = strategyConfig?.perTradeAllocation || 1000;
    let qty: number;
    
    if (decision.action === 'SELL') {
      qty = decision.qty || intent.qtySuggested || 0.001;
    } else {
      qty = tradeAllocation / realMarketPrice;
    }
    
    const totalValue = qty * realMarketPrice;
    const symbol = intent.symbol.replace('-EUR', '');
    
    console.log(`💱 DIRECT: ${decision.action} ${qty} ${symbol} at €${realMarketPrice} = €${totalValue}`);
    
    // Insert trade record
    const mockTrade = {
      user_id: intent.userId,
      strategy_id: intent.strategyId,
      trade_type: decision.action.toLowerCase(),
      cryptocurrency: symbol,
      amount: qty,
      price: realMarketPrice,
      total_value: totalValue,
      executed_at: new Date().toISOString(),
      is_test_mode: true,
      notes: `Direct path: ${decision.reason}`,
      strategy_trigger: `direct_${intent.source}`
    };

    const { error } = await supabaseClient
      .from('mock_trades')
      .insert(mockTrade);

    if (error) {
      throw new Error(`DB insert failed: ${error.message}`);
    }

    decision.qty = qty;
    console.log('✅ DIRECT: Trade executed successfully');
    return { success: true };

  } catch (error) {
    console.error('❌ DIRECT: Execution failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Async decision logging (non-blocking)
async function logDecisionAsync(
  supabaseClient: any,
  intent: TradeIntent,
  decision: TradeDecision,
  unifiedConfig: UnifiedConfig
): Promise<void> {
  try {
    await supabaseClient
      .from('trade_decisions_log')
      .insert({
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        symbol: intent.symbol,
        intent_side: intent.side,
        intent_source: intent.source,
        confidence: intent.confidence,
        decision_action: decision.action,
        decision_reason: decision.reason,
        metadata: {
          ...intent.metadata,
          qtySuggested: intent.qtySuggested,
          unifiedConfig,
          request_id: decision.request_id,
          idempotencyKey: intent.idempotencyKey
        }
      });
  } catch (error) {
    console.error('❌ COORDINATOR: Failed to log decision:', error.message);
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
  const symbol = intent.symbol.replace('-EUR', '');
  const { data: recentTrades } = await supabaseClient
    .from('mock_trades')
    .select('trade_type, executed_at, amount, price')
    .eq('user_id', intent.userId)
    .eq('strategy_id', intent.strategyId)
    .eq('cryptocurrency', symbol)
    .gte('executed_at', new Date(Date.now() - 600000).toISOString()) // Last 10 minutes
    .order('executed_at', { ascending: false })
    .limit(20);

  const trades = recentTrades || [];
  
  // Apply precedence-based conflict rules
  if (intent.source === 'manual') {
    return { hasConflict: false, reason: 'manual_override_precedence' };
  }

  if (intent.source === 'pool' && intent.side === 'SELL') {
    // Pool exits get high precedence but check cooldown
    const recentBuy = trades.find(t => 
      t.trade_type === 'buy' && 
      (Date.now() - new Date(t.executed_at).getTime()) < config.cooldownBetweenOppositeActionsMs
    );
    
    if (recentBuy) {
      return { hasConflict: true, reason: 'blocked_by_precedence:POOL_EXIT_COOLDOWN' };
    }
    
    return { hasConflict: false, reason: 'pool_exit_approved' };
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

// Execute with minimal advisory lock (atomic section only)
async function executeWithMinimalLock(
  supabaseClient: any,
  intent: TradeIntent,
  config: UnifiedConfig,
  strategyConfig: any,
  requestId: string
): Promise<TradeDecision> {
  
  const decision: TradeDecision = {
    action: intent.side,
    reason: `${intent.source}_approved_after_conflict_check`,
    request_id: requestId,
    qty: intent.qtySuggested
  };

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
      console.log(`⏸️ COORDINATOR: Atomic section busy - DEFER`);
      
      return {
        action: 'DEFER',
        reason: 'atomic_section_busy_defer',
        request_id: requestId,
        retry_in_ms: 200 + Math.random() * 300
      };
    }

    lockAcquired = true;
    console.log(`🔓 COORDINATOR: Minimal lock acquired - executing atomic section`);

    // ATOMIC SECTION: Get price and execute trade
    const executionResult = await executeTradeOrder(supabaseClient, intent, decision, strategyConfig);
    
    if (executionResult.success) {
      decision.approved = true;
      console.log(`✅ COORDINATOR: Atomic execution successful: ${intent.side} ${intent.symbol}`);
    } else {
      decision.action = 'HOLD';
      decision.reason = `atomic_execution_failed: ${executionResult.error}`;
      console.error(`❌ COORDINATOR: Atomic execution failed: ${executionResult.error}`);
    }

    return decision;

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
  const { data: trades } = await supabaseClient
    .from('mock_trades')
    .select('trade_type, executed_at, amount, price')
    .eq('user_id', userId)
    .eq('strategy_id', strategyId)
    .eq('cryptocurrency', symbol.replace('-EUR', ''))
    .gte('executed_at', new Date(Date.now() - 300000).toISOString()) // Last 5 minutes
    .order('executed_at', { ascending: false })
    .limit(10);

  return trades || [];
}

// Execute trade (reused by both paths)
async function executeTradeOrder(
  supabaseClient: any,
  intent: TradeIntent,
  decision: TradeDecision,
  strategyConfig: any
): Promise<{ success: boolean; error?: string }> {
  
  try {
    console.log(`💱 COORDINATOR: Executing ${decision.action} order for ${intent.symbol}`);
    
    // Get real market price
    const symbol = intent.symbol.replace('-EUR', '');
    const coinbaseSymbol = intent.symbol.includes('-EUR') ? intent.symbol : `${intent.symbol}-EUR`;
    
    const response = await fetch(`https://api.exchange.coinbase.com/products/${coinbaseSymbol}/ticker`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const realMarketPrice = parseFloat(data.price);
    
    if (!realMarketPrice || realMarketPrice <= 0) {
      throw new Error(`Invalid price received: ${data.price}`);
    }
    
    console.log(`💱 COORDINATOR: Got real price for ${coinbaseSymbol}: €${realMarketPrice}`);
    
    // Calculate quantity
    let qty: number;
    const tradeAllocation = strategyConfig?.perTradeAllocation || 1000;
    
    if (decision.action === 'SELL') {
      qty = decision.qty || intent.qtySuggested || 0.001;
    } else {
      qty = tradeAllocation / realMarketPrice;
    }
    
    const totalValue = qty * realMarketPrice;
    
    console.log(`💱 COORDINATOR: Trade calculation - ${decision.action} ${qty} ${symbol} at €${realMarketPrice} = €${totalValue}`);
    
    // Execute trade
    const mockTrade = {
      user_id: intent.userId,
      strategy_id: intent.strategyId,
      trade_type: decision.action.toLowerCase(),
      cryptocurrency: symbol,
      amount: qty,
      price: realMarketPrice,
      total_value: totalValue,
      executed_at: new Date().toISOString(),
      is_test_mode: true,
      notes: `Coordinator: ${decision.reason}`,
      strategy_trigger: `coord_${intent.source}`
    };

    const { error } = await supabaseClient
      .from('mock_trades')
      .insert(mockTrade);

    if (error) {
      console.error('❌ COORDINATOR: Trade execution failed:', error);
      return { success: false, error: error.message };
    }

    decision.qty = qty;
    console.log('✅ COORDINATOR: Trade executed successfully');
    return { success: true };

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
      blockedByLockPct: ((metrics.blockedByLockCount / metrics.totalRequests) * 100).toFixed(2),
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