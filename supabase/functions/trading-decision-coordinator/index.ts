import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Types for the unified trading system
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
}

interface TradeDecision {
  approved: boolean;
  action: 'BUY' | 'SELL' | 'HOLD';
  reason: string;
  qty?: number;
}

interface UnifiedConfig {
  enableUnifiedDecisions: boolean;
  minHoldPeriodMs: number;
  cooldownBetweenOppositeActionsMs: number;
  confidenceOverrideThreshold: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { intent } = await req.json() as { intent: TradeIntent };
    
    console.log(`🎯 COORDINATOR: Processing intent:`, JSON.stringify(intent, null, 2));

    // Validate intent
    if (!intent?.userId || !intent?.strategyId || !intent?.symbol || !intent?.side) {
      return new Response(JSON.stringify({
        approved: false,
        action: 'HOLD',
        reason: 'Invalid intent: missing required fields'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
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
      return new Response(JSON.stringify({
        approved: false,
        action: 'HOLD',
        reason: 'Strategy not found or access denied'
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const unifiedConfig: UnifiedConfig = strategy.unified_config || {
      enableUnifiedDecisions: false,
      minHoldPeriodMs: 120000,
      cooldownBetweenOppositeActionsMs: 30000,
      confidenceOverrideThreshold: 0.70
    };

    // If unified decisions are disabled, approve all intents (backward compatibility)
    if (!unifiedConfig.enableUnifiedDecisions) {
      console.log('🔄 COORDINATOR: Unified decisions disabled, approving intent');
      
      // Still log for audit purposes
      await supabaseClient
        .from('trade_decisions_log')
        .insert({
          user_id: intent.userId,
          strategy_id: intent.strategyId,
          symbol: intent.symbol,
          intent_side: intent.side,
          intent_source: intent.source,
          confidence: intent.confidence,
          decision_action: intent.side,
          decision_reason: 'Unified decisions disabled - auto-approved',
          metadata: intent.metadata || {}
        });

      return new Response(JSON.stringify({
        approved: true,
        action: intent.side,
        reason: 'Auto-approved (unified decisions disabled)',
        qty: intent.qtySuggested
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Acquire advisory lock for this {user, strategy, symbol} combination
    const lockKey = generateLockKey(intent.userId, intent.strategyId, intent.symbol);
    console.log(`🔒 COORDINATOR: Acquiring lock for key: ${lockKey}`);

    // CRITICAL: Shorter lock timeout to reduce contention
    const { data: lockResult } = await supabaseClient.rpc('pg_try_advisory_lock', {
      key: lockKey
    });

    if (!lockResult) {
      console.log('⏳ COORDINATOR: Could not acquire lock, concurrent processing detected');
      // CRITICAL: Return HTTP 200 with HOLD decision, not 429
      return new Response(JSON.stringify({
        ok: true,
        decision: {
          approved: false,
          action: 'HOLD',
          reason: 'blocked_by_lock'
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      // Process the intent with unified decision logic
      const decision = await processUnifiedDecision(supabaseClient, intent, unifiedConfig, strategy.configuration);
      
      // Log the decision
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
            request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          }
        });

      // Execute the trade if approved
      if (decision.approved && decision.action !== 'HOLD') {
        const executionResult = await executeTradeOrder(supabaseClient, intent, decision, strategy.configuration);
        if (!executionResult.success) {
          decision.approved = false;
          decision.reason = `execution_failed: ${executionResult.error}`;
          decision.action = 'HOLD';
        }
      }

      console.log(`✅ COORDINATOR: Decision made:`, JSON.stringify(decision, null, 2));
      
      // CRITICAL: Always return HTTP 200 with structured decision
      return new Response(JSON.stringify({
        ok: true,
        decision: decision
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } finally {
      // CRITICAL: Always release the advisory lock
      try {
        await supabaseClient.rpc('pg_advisory_unlock', { key: lockKey });
        console.log(`🔓 COORDINATOR: Released lock for key: ${lockKey}`);
      } catch (unlockError) {
        console.error(`❌ COORDINATOR: Failed to release lock ${lockKey}:`, unlockError);
      }
    }

  } catch (error) {
    console.error('❌ COORDINATOR: Error:', error);
    return new Response(JSON.stringify({
      approved: false,
      action: 'HOLD',
      reason: `Internal error: ${error.message}`
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Generate a consistent lock key for {user, strategy, symbol}
function generateLockKey(userId: string, strategyId: string, symbol: string): number {
  const combined = `${userId}_${strategyId}_${symbol}`;
  // Use PostgreSQL's hashtext function equivalent - simple hash
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Core unified decision logic
async function processUnifiedDecision(
  supabaseClient: any,
  intent: TradeIntent,
  config: UnifiedConfig,
  strategyConfig: any
): Promise<TradeDecision> {
  
  // DEBUG: Log configuration values at decision time
  console.log(`🔍 COORDINATOR DEBUG: Strategy ${intent.strategyId} config:`, {
    enableUnifiedDecisions: config.enableUnifiedDecisions,
    minHoldPeriodMs: config.minHoldPeriodMs,
    cooldownBetweenOppositeActionsMs: config.cooldownBetweenOppositeActionsMs,
    confidenceOverrideThreshold: config.confidenceOverrideThreshold
  });
  
  console.log(`🧠 COORDINATOR: Processing unified decision for ${intent.symbol} ${intent.side} from ${intent.source}`);

  // Check recent trade history for anti-flip-flop logic
  const recentTrades = await getRecentTrades(supabaseClient, intent.userId, intent.strategyId, intent.symbol);
  
  // Apply precedence rules in exact order specified
  // 1. Manual overrides - always execute
  if (intent.source === 'manual') {
    return {
      approved: true,
      action: intent.side,
      reason: 'manual_override',
      qty: intent.qtySuggested
    };
  }

  // 2. Hard risk (stop-loss / invalid order)
  if (intent.source === 'automated' && intent.reason?.includes('stop_loss')) {
    return {
      approved: true,
      action: intent.side,
      reason: 'blocked_by_precedence:HARD_RISK',
      qty: intent.qtySuggested
    };
  }

  // 3. Pool exits (secure TP, trailing stop hit)
  if (intent.source === 'pool' && intent.side === 'SELL') {
    // Check if there are any recent opposing intents within cooldown
    const hasRecentBuy = recentTrades.some(trade => 
      trade.trade_type === 'buy' && 
      (Date.now() - new Date(trade.executed_at).getTime()) < config.cooldownBetweenOppositeActionsMs
    );
    
    if (hasRecentBuy) {
      return {
        approved: false,
        action: 'HOLD',
        reason: 'blocked_by_cooldown'
      };
    }
    
    return {
      approved: true,
      action: intent.side,
      reason: 'blocked_by_precedence:POOL_EXIT',
      qty: intent.qtySuggested
    };
  }

  // 4. Technical SELL
  if (intent.source === 'automated' && intent.side === 'SELL' && intent.reason?.includes('technical')) {
    // Check minimum hold period
    const lastBuy = recentTrades.find(trade => trade.trade_type === 'buy');
    if (lastBuy) {
      const timeSinceBuy = Date.now() - new Date(lastBuy.executed_at).getTime();
      if (timeSinceBuy < config.minHoldPeriodMs) {
        return {
          approved: false,
          action: 'HOLD',
          reason: 'min_hold_period_not_met'
        };
      }
    }
    
    return {
      approved: true,
      action: intent.side,
      reason: 'technical_sell_approved',
      qty: intent.qtySuggested
    };
  }

  // 5. AI/News/Whale BUY
  if (['intelligent', 'news', 'whale'].includes(intent.source) && intent.side === 'BUY') {
    // Check cooldown after recent SELL
    const lastSell = recentTrades.find(trade => trade.trade_type === 'sell');
    if (lastSell) {
      const timeSinceSell = Date.now() - new Date(lastSell.executed_at).getTime();
      if (timeSinceSell < config.cooldownBetweenOppositeActionsMs) {
        // Only allow if confidence is very high
        if (intent.confidence < config.confidenceOverrideThreshold) {
          return {
            approved: false,
            action: 'HOLD',
            reason: 'confidence_below_threshold'
          };
        }
      }
    }
    
    return {
      approved: true,
      action: intent.side,
      reason: `${intent.source}_buy_approved`,
      qty: intent.qtySuggested
    };
  }

  // 6. Scheduler BUY (lowest precedence)
  if (intent.source === 'automated' && intent.side === 'BUY') {
    // Most restrictive checks for scheduler
    const lastSell = recentTrades.find(trade => trade.trade_type === 'sell');
    if (lastSell) {
      const timeSinceSell = Date.now() - new Date(lastSell.executed_at).getTime();
      if (timeSinceSell < config.cooldownBetweenOppositeActionsMs * 2) { // Double cooldown for scheduler
        return {
          approved: false,
          action: 'HOLD',
          reason: 'blocked_by_cooldown'
        };
      }
    }
    
    return {
      approved: true,
      action: intent.side,
      reason: 'scheduler_buy_approved',
      qty: intent.qtySuggested
    };
  }

  // Default case - hold
  return {
    approved: false,
    action: 'HOLD',
    reason: 'blocked_by_lock'
  };
}

// Get recent trades for anti-flip-flop analysis
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

// Execute the actual trade order
async function executeTradeOrder(
  supabaseClient: any,
  intent: TradeIntent,
  decision: TradeDecision,
  strategyConfig: any
): Promise<{ success: boolean; error?: string }> {
  
  try {
    console.log(`💱 COORDINATOR: Executing ${decision.action} order for ${intent.symbol}`);
    
    // CRITICAL FIX: Get REAL market price instead of placeholder
    let realMarketPrice = 100; // Fallback only
    const symbol = intent.symbol.replace('-EUR', '');
    
    // Try to get real market price from Coinbase API
    try {
      const response = await fetch(`https://api.exchange.coinbase.com/products/${intent.symbol}/ticker`);
      if (response.ok) {
        const data = await response.json();
        realMarketPrice = parseFloat(data.price) || 100;
        console.log(`💱 COORDINATOR: Got real price for ${intent.symbol}: €${realMarketPrice}`);
      } else {
        console.warn(`⚠️ COORDINATOR: Failed to fetch price for ${intent.symbol}, using fallback: €100`);
      }
    } catch (priceError) {
      console.warn(`⚠️ COORDINATOR: Price fetch error for ${intent.symbol}:`, priceError.message);
    }
    
    // CRITICAL FIX: Calculate quantity based on REAL price
    let qty: number;
    const tradeAllocation = strategyConfig?.perTradeAllocation || 1000;
    
    if (decision.action === 'SELL') {
      // For SELL, use suggested quantity or default
      qty = decision.qty || intent.qtySuggested || 0.001;
    } else {
      // For BUY, calculate quantity: EUR_amount / real_price
      qty = tradeAllocation / realMarketPrice;
    }
    
    const totalValue = qty * realMarketPrice;
    
    console.log(`💱 COORDINATOR: Trade calculation - ${decision.action} ${qty} ${symbol} at €${realMarketPrice} = €${totalValue}`);
    
    // Execute with REAL prices and amounts
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
      notes: `Unified coordinator: ${decision.reason}`,
      strategy_trigger: `unified_${intent.source}`
    };

    const { error } = await supabaseClient
      .from('mock_trades')
      .insert(mockTrade);

    if (error) {
      console.error('❌ COORDINATOR: Trade execution failed:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ COORDINATOR: Trade executed successfully');
    return { success: true };

  } catch (error) {
    console.error('❌ COORDINATOR: Trade execution error:', error);
    return { success: false, error: error.message };
  }
}