// Backend Shadow Engine - Phase S2/S3: Full Exit Management
// 
// This edge function evaluates trading decisions using the same logic as the frontend
// intelligent engine. Supports two modes:
//   - SHADOW (default): Log decisions to decision_events only, no trades inserted
//   - LIVE: Same decision path, coordinator inserts into mock_trades
// 
// PHASE S2/S3: This engine now handles ALL automatic exits:
//   - TAKE_PROFIT (TP)
//   - STOP_LOSS (SL)
//   - TRAILING_STOP
//   - AUTO_CLOSE_TIME
// 
// Frontend no longer computes automatic exits - they are blocked by FRONTEND_ENGINE_DISABLED.
// 
// Configuration: Set BACKEND_ENGINE_MODE env var to 'SHADOW' or 'LIVE'
// Default: 'SHADOW' (safe, observability-only mode)
// 
// Usage: POST with { userId, strategyId?, symbols?: string[] }
// Returns: { shadow: boolean, decisions: [...], summary: { wouldBuy, wouldSell, wouldHold } }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============= ENGINE MODE CONFIGURATION =============
// Read from environment, default to 'SHADOW' for safety
type EngineMode = 'SHADOW' | 'LIVE';
const BACKEND_ENGINE_MODE: EngineMode = 
  (Deno.env.get('BACKEND_ENGINE_MODE') as EngineMode) || 'SHADOW';

// ============= PHASE B: USER ALLOWLIST FOR BACKEND LIVE =============
// Comma-separated list of user IDs allowed to run in LIVE mode.
// If BACKEND_ENGINE_MODE='LIVE' but user is not in allowlist, force SHADOW behavior.
// If empty or unset, no one is allowlisted (all users run in SHADOW).
const BACKEND_ENGINE_USER_ALLOWLIST_RAW = Deno.env.get('BACKEND_ENGINE_USER_ALLOWLIST') || '';

function parseAllowlist(raw: string): Set<string> {
  if (!raw.trim()) return new Set();
  return new Set(raw.split(',').map(s => s.trim()).filter(s => s.length > 0));
}

function isUserAllowlisted(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const allowlist = parseAllowlist(BACKEND_ENGINE_USER_ALLOWLIST_RAW);
  if (allowlist.size === 0) return false;
  return allowlist.has(userId);
}
// ============= END PHASE B ALLOWLIST =============

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ShadowDecision {
  symbol: string;
  side: 'BUY' | 'SELL' | 'HOLD';
  action: string;
  reason: string;
  confidence: number;
  fusionScore?: number;
  wouldExecute: boolean;
  timestamp: string;
  metadata: Record<string, any>;
}

// ============= PHASE S2: POSITION INTERFACE =============
interface OpenPosition {
  cryptocurrency: string;
  totalAmount: number;
  averagePrice: number;
  oldestPurchaseDate: string;
  totalBuyValue: number;
  tradeIds: string[];
}

// ============= PHASE S2: EXIT CONTEXT TYPES =============
type ExitContext = 'AUTO_TP' | 'AUTO_SL' | 'AUTO_TRAIL' | 'AUTO_CLOSE';
type ExitTrigger = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'AUTO_CLOSE_TIME';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  // ============= PHASE B: EFFECTIVE SHADOW MODE CALCULATION =============
  const isModeConfiguredShadow = BACKEND_ENGINE_MODE === 'SHADOW';
  
  try {
    console.log(`🌑 BACKEND ENGINE: Starting run in ${BACKEND_ENGINE_MODE} mode`);
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { userId, strategyId, symbols: requestedSymbols } = body;

    if (!userId) {
      return new Response(JSON.stringify({ 
        error: 'userId is required',
        shadow: true 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // PHASE B: Calculate effective shadow mode with allowlist check
    const isUserAllowedForLive = !isModeConfiguredShadow && isUserAllowlisted(userId);
    const effectiveShadowMode = isModeConfiguredShadow || !isUserAllowedForLive;
    
    // Log the mode computation for observability
    if (BACKEND_ENGINE_MODE === 'LIVE' && !isUserAllowedForLive) {
      console.log(`🌑 BACKEND_ENGINE_MODE=LIVE but user ${userId.substring(0, 8)}... is not in BACKEND_ENGINE_USER_ALLOWLIST – forcing SHADOW behavior`);
    }
    console.log(`   → engineMode=${BACKEND_ENGINE_MODE}, effectiveShadowMode=${effectiveShadowMode}, userAllowedForLive=${isUserAllowedForLive}`);

    console.log(`🌑 ${BACKEND_ENGINE_MODE}: Evaluating for user ${userId}, strategyId=${strategyId || 'all'}`);

    // Step 1: Fetch active strategies (same as frontend)
    let strategiesQuery = supabaseClient
      .from('trading_strategies')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);
    
    if (strategyId) {
      strategiesQuery = strategiesQuery.eq('id', strategyId);
    }

    const { data: strategies, error: strategiesError } = await strategiesQuery;

    if (strategiesError || !strategies?.length) {
      console.log(`🌑 ${BACKEND_ENGINE_MODE}: No active strategies found`);
      return new Response(JSON.stringify({ 
        shadow: effectiveShadowMode,
        mode: BACKEND_ENGINE_MODE,
        effectiveShadowMode,
        userAllowedForLive: isUserAllowedForLive,
        decisions: [],
        summary: { wouldBuy: 0, wouldSell: 0, wouldHold: 0, total: 0 },
        message: 'No active strategies found',
        elapsed_ms: Date.now() - startTime
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`🌑 ${BACKEND_ENGINE_MODE}: Found ${strategies.length} active strategies`);

    const allDecisions: ShadowDecision[] = [];

    // Step 2: Process each strategy
    for (const strategy of strategies) {
      const config = strategy.configuration || {};
      const selectedCoins = requestedSymbols || config.selectedCoins || ['BTC', 'ETH'];
      
      console.log(`🌑 ${BACKEND_ENGINE_MODE}: Processing strategy "${strategy.strategy_name}" with coins: ${selectedCoins.join(', ')}`);

      // ============= PHASE S2: FETCH OPEN POSITIONS FOR EXIT EVALUATION =============
      const openPositions = await fetchOpenPositions(supabaseClient, userId, strategy.id);
      console.log(`🌑 ${BACKEND_ENGINE_MODE}: Found ${openPositions.length} open positions for exit evaluation`);

      // ============= PHASE S2: EVALUATE EXITS FOR EACH OPEN POSITION =============
      for (const position of openPositions) {
        const baseSymbol = position.cryptocurrency.replace('-EUR', '');
        const symbol = `${baseSymbol}-EUR`;
        
        try {
          // Fetch current price
          let currentPrice = 0;
          try {
            const tickerResponse = await fetch(`https://api.exchange.coinbase.com/products/${symbol}/ticker`);
            if (tickerResponse.ok) {
              const tickerData = await tickerResponse.json();
              currentPrice = parseFloat(tickerData.price) || 0;
            }
          } catch (priceErr) {
            console.warn(`🌑 ${BACKEND_ENGINE_MODE}: Could not fetch price for ${symbol}:`, priceErr);
          }

          if (currentPrice <= 0) {
            console.log(`🌑 ${BACKEND_ENGINE_MODE}: Skipping exit evaluation for ${symbol} - no valid price`);
            continue;
          }

          // Calculate P&L
          const pnlPercentage = ((currentPrice - position.averagePrice) / position.averagePrice) * 100;
          const hoursSincePurchase = (Date.now() - new Date(position.oldestPurchaseDate).getTime()) / (1000 * 60 * 60);
          
          // Evaluate exit conditions
          const exitDecision = evaluateExitConditions(config, position, currentPrice, pnlPercentage, hoursSincePurchase);
          
          if (exitDecision) {
            console.log(`🌑 ${BACKEND_ENGINE_MODE}: EXIT TRIGGERED for ${baseSymbol} - trigger=${exitDecision.trigger}, pnl=${pnlPercentage.toFixed(2)}%`);
            
            // Generate unique identifiers
            const backendRequestId = crypto.randomUUID();
            const timestamp = Date.now();
            const idempotencyKey = `exit_${userId}_${strategy.id}_${baseSymbol}_${exitDecision.trigger}_${timestamp}`;
            
            // Build SELL intent
            const sellIntent = {
              userId,
              strategyId: strategy.id,
              symbol: baseSymbol,
              side: 'SELL' as const,
              source: 'intelligent' as const,
              confidence: 0.95, // High confidence for risk exits
              reason: exitDecision.trigger,
              qtySuggested: position.totalAmount,
              metadata: {
                mode: 'mock',
                engine: 'intelligent',
                is_test_mode: true,
                context: effectiveShadowMode ? 'BACKEND_SHADOW' : exitDecision.context,
                trigger: exitDecision.trigger,
                pnlPercentage: pnlPercentage.toFixed(4),
                entryPrice: position.averagePrice,
                currentPrice,
                hoursSincePurchase: hoursSincePurchase.toFixed(2),
                backend_request_id: backendRequestId,
                backend_ts: new Date().toISOString(),
                // PHASE S3: Mark as backend auto-exit
                origin: effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE',
                exit_type: 'automatic',
              },
              ts: new Date().toISOString(),
              idempotencyKey,
            };

            if (effectiveShadowMode) {
              // SHADOW MODE: Log decision but don't execute
              console.log(`🌑 SHADOW: Would SELL ${baseSymbol} via ${exitDecision.trigger} (pnl=${pnlPercentage.toFixed(2)}%)`);
              allDecisions.push({
                symbol: baseSymbol,
                side: 'SELL',
                action: 'WOULD_SELL',
                reason: exitDecision.trigger,
                confidence: 0.95,
                wouldExecute: true,
                timestamp: new Date().toISOString(),
                metadata: {
                  ...sellIntent.metadata,
                  strategyId: strategy.id,
                  strategyName: strategy.strategy_name,
                  shadow_only: true,
                }
              });
            } else {
              // LIVE MODE: Send SELL intent to coordinator
              console.log(`🔥 LIVE: Executing SELL for ${baseSymbol} via ${exitDecision.trigger}`);
              
              const { data: coordinatorResponse, error: coordError } = await supabaseClient.functions.invoke(
                'trading-decision-coordinator',
                { body: { intent: sellIntent } }
              );

              if (coordError) {
                console.error(`🌑 ${BACKEND_ENGINE_MODE}: Coordinator error for ${baseSymbol} SELL:`, coordError);
                allDecisions.push({
                  symbol: baseSymbol,
                  side: 'SELL',
                  action: 'ERROR',
                  reason: coordError.message || 'coordinator_error',
                  confidence: 0.95,
                  wouldExecute: false,
                  timestamp: new Date().toISOString(),
                  metadata: { error: coordError, trigger: exitDecision.trigger }
                });
              } else {
                let parsed = coordinatorResponse;
                if (typeof parsed === 'string') {
                  try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
                }
                const decision = parsed?.decision || parsed;
                const action = decision?.action || 'UNKNOWN';
                
                allDecisions.push({
                  symbol: baseSymbol,
                  side: 'SELL',
                  action,
                  reason: exitDecision.trigger,
                  confidence: 0.95,
                  wouldExecute: action === 'SELL',
                  timestamp: new Date().toISOString(),
                  metadata: {
                    ...sellIntent.metadata,
                    strategyId: strategy.id,
                    strategyName: strategy.strategy_name,
                    coordinatorResponse: decision,
                  }
                });
              }
            }
          }
        } catch (exitErr) {
          console.error(`🌑 ${BACKEND_ENGINE_MODE}: Error evaluating exit for ${position.cryptocurrency}:`, exitErr);
        }
      }

      // Step 3: For each symbol, evaluate BUY opportunities (existing logic)
      for (const coin of selectedCoins) {
        const symbol = coin.includes('-') ? coin : `${coin}-EUR`;
        const baseSymbol = coin.replace('-EUR', '');
        
        try {
          // Fetch current price (same as frontend would)
          let currentPrice = 0;
          try {
            const tickerResponse = await fetch(`https://api.exchange.coinbase.com/products/${symbol}/ticker`);
            if (tickerResponse.ok) {
              const tickerData = await tickerResponse.json();
              currentPrice = parseFloat(tickerData.price) || 0;
            }
          } catch (priceErr) {
            console.warn(`🌑 ${BACKEND_ENGINE_MODE}: Could not fetch price for ${symbol}:`, priceErr);
          }

          if (currentPrice <= 0) {
            console.log(`🌑 ${BACKEND_ENGINE_MODE}: Skipping ${symbol} - no valid price`);
            allDecisions.push({
              symbol: baseSymbol,
              side: 'HOLD',
              action: 'SKIP',
              reason: 'no_valid_price',
              confidence: 0,
              wouldExecute: false,
              timestamp: new Date().toISOString(),
              metadata: { priceError: true }
            });
            continue;
          }

          // Calculate suggested quantity (same logic as frontend)
          const tradeAllocation = config.perTradeAllocation || 50;
          const qtySuggested = tradeAllocation / currentPrice;

          // Build intent matching frontend shape
          const intentMetadata = effectiveShadowMode ? {
            mode: 'mock',
            engine: 'intelligent',
            is_test_mode: true,
            execMode: 'SHADOW',
            context: 'BACKEND_SHADOW',
            shadow_run_ts: new Date().toISOString(),
            currentPrice,
          } : {
            mode: 'mock',
            engine: 'intelligent',
            is_test_mode: true,
            context: 'BACKEND_LIVE',
            backend_live_ts: new Date().toISOString(),
            currentPrice,
          };

          // Generate unique identifiers
          const backendRequestId = crypto.randomUUID();
          const timestamp = Date.now();
          const idempotencyKey = `live_${userId}_${strategy.id}_${baseSymbol}_${timestamp}`;
          
          const intent = {
            userId,
            strategyId: strategy.id,
            symbol: baseSymbol,
            side: 'BUY' as const,
            source: 'intelligent' as const,
            confidence: 0.65,
            reason: effectiveShadowMode ? 'BACKEND_SHADOW_EVALUATION' : 'BACKEND_LIVE_DECISION',
            qtySuggested,
            metadata: {
              ...intentMetadata,
              backend_request_id: backendRequestId,
              backend_ts: new Date().toISOString(),
            },
            ts: new Date().toISOString(),
            idempotencyKey: idempotencyKey
          };

          console.log(`🌑 ${BACKEND_ENGINE_MODE}: Calling coordinator for ${baseSymbol} BUY intent (effectiveShadow=${effectiveShadowMode})`);

          // Call coordinator with shadow flag
          const { data: coordinatorResponse, error: coordError } = await supabaseClient.functions.invoke(
            'trading-decision-coordinator',
            { body: { intent } }
          );

          if (coordError) {
            console.error(`🌑 ${BACKEND_ENGINE_MODE}: Coordinator error for ${baseSymbol}:`, coordError);
            allDecisions.push({
              symbol: baseSymbol,
              side: 'BUY',
              action: 'ERROR',
              reason: coordError.message || 'coordinator_error',
              confidence: intent.confidence,
              wouldExecute: false,
              timestamp: new Date().toISOString(),
              metadata: { error: coordError }
            });
            continue;
          }

          // Parse coordinator response
          let parsed = coordinatorResponse;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
          }

          const decision = parsed?.decision || parsed;
          const action = decision?.action || 'UNKNOWN';
          const reason = decision?.reason || 'no_reason';
          const fusionScore = decision?.fusion_score || decision?.fusionScore;

          console.log(`🌑 ${BACKEND_ENGINE_MODE}: ${baseSymbol} → action=${action}, reason=${reason}`);

          const wouldExecute = action === 'BUY' || action === 'SELL';
          let side: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
          if (action === 'BUY') side = 'BUY';
          else if (action === 'SELL') side = 'SELL';

          allDecisions.push({
            symbol: baseSymbol,
            side,
            action,
            reason,
            confidence: intent.confidence,
            fusionScore,
            wouldExecute,
            timestamp: new Date().toISOString(),
            metadata: {
              strategyId: strategy.id,
              strategyName: strategy.strategy_name,
              price: currentPrice,
              qtySuggested,
              coordinatorResponse: decision,
              engineMode: BACKEND_ENGINE_MODE,
              effectiveShadowMode,
              userAllowedForLive: isUserAllowedForLive,
            }
          });

        } catch (symbolErr) {
          console.error(`🌑 ${BACKEND_ENGINE_MODE}: Error processing ${coin}:`, symbolErr);
          allDecisions.push({
            symbol: baseSymbol,
            side: 'HOLD',
            action: 'ERROR',
            reason: String(symbolErr),
            confidence: 0,
            wouldExecute: false,
            timestamp: new Date().toISOString(),
            metadata: { error: String(symbolErr) }
          });
        }
      }
    }

    // Step 4: Compute summary
    const summary = {
      wouldBuy: allDecisions.filter(d => d.side === 'BUY' && d.wouldExecute).length,
      wouldSell: allDecisions.filter(d => d.side === 'SELL' && d.wouldExecute).length,
      wouldHold: allDecisions.filter(d => d.side === 'HOLD' || !d.wouldExecute).length,
      total: allDecisions.length,
      deferred: allDecisions.filter(d => d.action === 'DEFER').length,
      blocked: allDecisions.filter(d => d.action === 'BLOCK').length,
      autoExits: allDecisions.filter(d => d.side === 'SELL' && ['TAKE_PROFIT', 'STOP_LOSS', 'TRAILING_STOP', 'AUTO_CLOSE_TIME'].includes(d.reason)).length,
    };

    const elapsed_ms = Date.now() - startTime;
    
    console.log(`🌑 ${BACKEND_ENGINE_MODE}: Run complete. wouldBuy=${summary.wouldBuy}, wouldSell=${summary.wouldSell}, autoExits=${summary.autoExits}, elapsed=${elapsed_ms}ms`);

    // Log ALL decisions to decision_events
    for (const dec of allDecisions) {
      try {
        const eventMetadata = effectiveShadowMode ? {
          ...dec.metadata,
          origin: 'BACKEND_SHADOW',
          shadow_only: true,
          no_trade_inserted: true,
          wouldExecute: dec.wouldExecute,
          engineMode: BACKEND_ENGINE_MODE,
          effectiveShadowMode: true,
          userAllowedForLive: isUserAllowedForLive,
        } : {
          ...dec.metadata,
          origin: 'BACKEND_LIVE',
          shadow_only: false,
          no_trade_inserted: !dec.wouldExecute,
          wouldExecute: dec.wouldExecute,
          engineMode: BACKEND_ENGINE_MODE,
          effectiveShadowMode: false,
          userAllowedForLive: isUserAllowedForLive,
          backend_live_ts: new Date().toISOString(),
          idempotency_key: dec.metadata?.idempotencyKey || null,
          backend_request_id: dec.metadata?.backend_request_id || null,
        };

        const { error: insertError } = await supabaseClient.from('decision_events').insert({
          user_id: userId,
          strategy_id: dec.metadata.strategyId,
          symbol: dec.symbol,
          side: dec.side,
          source: 'intelligent',
          confidence: dec.confidence,
          reason: `${dec.action}:${dec.reason}`,
          entry_price: dec.metadata.price || dec.metadata.currentPrice,
          metadata: eventMetadata,
          decision_ts: dec.timestamp,
        });
        
        if (insertError) {
          console.warn(`🌑 ${BACKEND_ENGINE_MODE}: Insert error for ${dec.symbol}:`, insertError.message);
        } else {
          console.log(`🌑 ${BACKEND_ENGINE_MODE}: Logged decision_event for ${dec.symbol} action=${dec.action} (origin=${effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE'})`);
        }
      } catch (logErr) {
        console.warn(`🌑 ${BACKEND_ENGINE_MODE}: Could not log decision_event for ${dec.symbol}:`, logErr);
      }
    }

    return new Response(JSON.stringify({
      shadow: effectiveShadowMode,
      mode: BACKEND_ENGINE_MODE,
      effectiveShadowMode,
      userAllowedForLive: isUserAllowedForLive,
      decisions: allDecisions,
      summary,
      strategies_evaluated: strategies.length,
      elapsed_ms,
      message: effectiveShadowMode 
        ? 'Shadow evaluation complete - NO trades were executed'
        : 'Live evaluation complete - trades may have been executed',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(`🌑 ${BACKEND_ENGINE_MODE}: Fatal error:`, error);
    return new Response(JSON.stringify({ 
      shadow: true,
      mode: BACKEND_ENGINE_MODE,
      effectiveShadowMode: true,
      error: error.message,
      elapsed_ms: Date.now() - startTime
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// ============= PHASE S2: FETCH OPEN POSITIONS =============
async function fetchOpenPositions(supabaseClient: any, userId: string, strategyId: string): Promise<OpenPosition[]> {
  try {
    // Fetch all BUY and SELL trades for this user/strategy
    const { data: trades, error } = await supabaseClient
      .from('mock_trades')
      .select('id, trade_type, cryptocurrency, amount, price, executed_at')
      .eq('user_id', userId)
      .eq('strategy_id', strategyId)
      .eq('is_test_mode', true)
      .order('executed_at', { ascending: true });

    if (error || !trades) {
      console.error('Error fetching trades for positions:', error);
      return [];
    }

    // Calculate net positions per symbol
    const positionMap = new Map<string, {
      totalBuyAmount: number;
      totalSellAmount: number;
      buyTrades: Array<{ amount: number; price: number; executedAt: string; id: string }>;
    }>();

    for (const trade of trades) {
      const symbol = trade.cryptocurrency.replace('-EUR', '');
      if (!positionMap.has(symbol)) {
        positionMap.set(symbol, { totalBuyAmount: 0, totalSellAmount: 0, buyTrades: [] });
      }
      const pos = positionMap.get(symbol)!;
      
      if (trade.trade_type === 'buy') {
        pos.totalBuyAmount += Number(trade.amount);
        pos.buyTrades.push({
          amount: Number(trade.amount),
          price: Number(trade.price),
          executedAt: trade.executed_at,
          id: trade.id,
        });
      } else if (trade.trade_type === 'sell') {
        pos.totalSellAmount += Number(trade.amount);
      }
    }

    // Build open positions with net amount > 0
    const openPositions: OpenPosition[] = [];
    
    for (const [symbol, pos] of positionMap) {
      const netAmount = pos.totalBuyAmount - pos.totalSellAmount;
      
      if (netAmount > 0.00000001) { // Small epsilon to avoid floating point issues
        // Calculate weighted average price from remaining buys
        let totalValue = 0;
        let totalAmount = 0;
        const tradeIds: string[] = [];
        let oldestDate = '';
        
        for (const buy of pos.buyTrades) {
          totalValue += buy.amount * buy.price;
          totalAmount += buy.amount;
          tradeIds.push(buy.id);
          if (!oldestDate || buy.executedAt < oldestDate) {
            oldestDate = buy.executedAt;
          }
        }
        
        const averagePrice = totalAmount > 0 ? totalValue / totalAmount : 0;
        
        openPositions.push({
          cryptocurrency: symbol,
          totalAmount: netAmount,
          averagePrice,
          oldestPurchaseDate: oldestDate,
          totalBuyValue: totalValue,
          tradeIds,
        });
      }
    }

    return openPositions;
  } catch (err) {
    console.error('Error in fetchOpenPositions:', err);
    return [];
  }
}

// ============= PHASE S2: EVALUATE EXIT CONDITIONS =============
interface ExitDecision {
  trigger: ExitTrigger;
  context: ExitContext;
  reason: string;
}

function evaluateExitConditions(
  config: any,
  position: OpenPosition,
  currentPrice: number,
  pnlPercentage: number,
  hoursSincePurchase: number
): ExitDecision | null {
  const epsilonPnLBufferPct = config.epsilonPnLBufferPct || 0.03;
  
  // 1. AUTO CLOSE AFTER HOURS (highest priority)
  const autoCloseHours = config.autoCloseAfterHours;
  const isAutoCloseConfigured = 
    typeof autoCloseHours === 'number' &&
    Number.isFinite(autoCloseHours) &&
    autoCloseHours > 0;
  
  if (isAutoCloseConfigured && hoursSincePurchase >= autoCloseHours) {
    console.log(`[BackendExit] AUTO_CLOSE_TIME triggered for ${position.cryptocurrency}: held ${hoursSincePurchase.toFixed(2)}h >= ${autoCloseHours}h`);
    return {
      trigger: 'AUTO_CLOSE_TIME',
      context: 'AUTO_CLOSE',
      reason: `Position held ${hoursSincePurchase.toFixed(2)}h >= configured ${autoCloseHours}h`,
    };
  }

  // 2. STOP LOSS CHECK - STRICT ENFORCEMENT
  const configuredSL = config.stopLossPercentage;
  const hasSLConfigured = typeof configuredSL === 'number' && configuredSL > 0;
  const adjustedStopLoss = hasSLConfigured ? Math.abs(configuredSL) + epsilonPnLBufferPct : 0;
  const slThresholdMet = hasSLConfigured && pnlPercentage <= -adjustedStopLoss;
  
  console.log(`[BackendExit][SL_CHECK] ${position.cryptocurrency}: pnl=${pnlPercentage.toFixed(4)}% <= -${adjustedStopLoss.toFixed(4)}% = ${slThresholdMet}`);
  
  if (slThresholdMet) {
    console.log(`[BackendExit] STOP_LOSS triggered for ${position.cryptocurrency}: ${pnlPercentage.toFixed(2)}% <= -${adjustedStopLoss.toFixed(2)}%`);
    return {
      trigger: 'STOP_LOSS',
      context: 'AUTO_SL',
      reason: `P&L ${pnlPercentage.toFixed(2)}% <= -${adjustedStopLoss.toFixed(2)}% (SL + buffer)`,
    };
  }

  // 3. TAKE PROFIT CHECK - STRICT ENFORCEMENT
  const configuredTP = config.takeProfitPercentage;
  const hasTPConfigured = typeof configuredTP === 'number' && configuredTP > 0;
  const adjustedTakeProfit = hasTPConfigured ? Math.abs(configuredTP) + epsilonPnLBufferPct : 0;
  const tpThresholdMet = hasTPConfigured && pnlPercentage >= adjustedTakeProfit;
  
  console.log(`[BackendExit][TP_CHECK] ${position.cryptocurrency}: pnl=${pnlPercentage.toFixed(4)}% >= ${adjustedTakeProfit.toFixed(4)}% = ${tpThresholdMet}`);
  
  if (tpThresholdMet) {
    console.log(`[BackendExit] TAKE_PROFIT triggered for ${position.cryptocurrency}: ${pnlPercentage.toFixed(2)}% >= ${adjustedTakeProfit.toFixed(2)}%`);
    return {
      trigger: 'TAKE_PROFIT',
      context: 'AUTO_TP',
      reason: `P&L ${pnlPercentage.toFixed(2)}% >= ${adjustedTakeProfit.toFixed(2)}% (TP + buffer)`,
    };
  }

  // 4. TRAILING STOP (if configured)
  const trailingStopPct = config.trailingStopLossPercentage;
  const trailingMinProfit = config.trailingStopMinProfitThreshold || 0.5;
  
  if (typeof trailingStopPct === 'number' && trailingStopPct > 0) {
    // Trailing stop only activates if position is in profit
    if (pnlPercentage >= trailingMinProfit) {
      // TODO: Implement proper high-water-mark tracking in database
      // For now, simplified: trailing stop triggers if profit drops below threshold
      const trailingThreshold = pnlPercentage - trailingStopPct;
      if (trailingThreshold > 0 && pnlPercentage <= trailingThreshold) {
        console.log(`[BackendExit] TRAILING_STOP triggered for ${position.cryptocurrency}: pnl dropped to ${pnlPercentage.toFixed(2)}%`);
        return {
          trigger: 'TRAILING_STOP',
          context: 'AUTO_TRAIL',
          reason: `Trailing stop triggered at ${pnlPercentage.toFixed(2)}%`,
        };
      }
    }
  }

  return null; // No exit condition met
}
