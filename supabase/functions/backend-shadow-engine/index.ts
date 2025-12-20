// Backend Shadow Engine - Phase S4: Intelligent Exit Engine with Runner Mode
// 
// This edge function evaluates trading decisions using the same logic as the frontend
// intelligent engine. Supports two modes:
//   - SHADOW (default): Log decisions to decision_events only, no trades inserted
//   - LIVE: Same decision path, coordinator inserts into mock_trades
// 
// PHASE S4: INTELLIGENT EXIT ENGINE:
//   - Default: if PnL >= TP => SELL
//   - Exception: if bull_override (signals indicate continuation) => DON'T sell at TP
//     Switch to RUNNER mode with TRAILING STOP protection
//   - TRAILING_STOP: if price drops from peak by trailing distance => SELL
//   - STOP_LOSS: hard guardrail always active
//   - AUTO_CLOSE_TIME: disabled in MVP (last resort only)
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

// ============= PHASE S4: RUNNER STATE INTERFACE =============
interface RunnerState {
  runner_mode: boolean;
  peak_pnl_pct: number;
  trailing_distance_pct: number;
  trailing_stop_level_pct: number;
}

// ============= PHASE S2: EXIT CONTEXT TYPES =============
type ExitContext = 'AUTO_TP' | 'AUTO_SL' | 'AUTO_TRAIL' | 'AUTO_CLOSE' | 'RUNNER_TRAIL';
type ExitTrigger = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'AUTO_CLOSE_TIME' | 'SELL_TRAILING_RUNNER';

// ============= PHASE S4: EXIT TRACE INTERFACE =============
interface ExitTrace {
  symbol: string;
  strategy_id: string;
  pnl_pct_engine: number;
  tp_pct: number;
  is_tp_met: boolean;
  bull_override: boolean;
  bull_score_used: number;
  bull_threshold: number;
  bull_components: {
    trend: number;
    momentum: number;
    fusion: number;
  };
  runner_mode_before: boolean;
  runner_mode_after: boolean;
  peak_pnl_before: number;
  peak_pnl_after: number;
  trailing_distance_pct: number;
  trailing_stop_level_pct: number;
  is_trailing_hit: boolean;
  sl_pct: number;
  is_sl_met: boolean;
  final_action: 'SELL_TP' | 'HOLD_RUNNER' | 'SELL_TRAILING' | 'SELL_SL' | 'NO_EXIT';
  final_reason: string;
  context: string;
  evaluated_at: string;
}

// ============= SIGNAL SCORING HELPER =============
interface SignalScores {
  trend: number;
  momentum: number;
  volatility: number;
  whale: number;
  sentiment: number;
}

interface MarketFeatures {
  rsi_14?: number | null;
  macd_hist?: number | null;
  ema_20?: number | null;
  ema_50?: number | null;
  ema_200?: number | null;
  vol_1h?: number | null;
}

interface LiveSignal {
  signal_type: string;
  signal_strength: number;
  data?: Record<string, any> | null;
}

/**
 * Compute signal scores from live_signals and market_features_v0
 * Returns normalized scores (-1 to +1) for each signal category
 */
function computeSignalScores(signals: LiveSignal[], features: MarketFeatures | null): SignalScores {
  const scores: SignalScores = {
    trend: 0,
    momentum: 0,
    volatility: 0,
    whale: 0,
    sentiment: 0,
  };

  // Track if we have strong reversal signals (oversold conditions)
  let hasOversoldSignal = false;
  let oversoldStrength = 0;

  // Process ALL live signals (bullish AND bearish)
  for (const sig of signals) {
    const strength = Math.min(1, sig.signal_strength / 100); // Normalize to 0-1
    
    switch (sig.signal_type) {
      // BULLISH signals - add to scores
      case 'trend_bullish':
        scores.trend += strength * 0.8;
        break;
      case 'ma_cross_bullish':
        scores.trend += strength * 0.6;
        scores.momentum += strength * 0.4;
        break;
      case 'momentum_bullish':
        scores.momentum += strength * 0.8;
        break;
      case 'macd_bullish':
        scores.momentum += strength * 0.6;
        scores.trend += strength * 0.3;
        break;
      case 'rsi_oversold_bullish':
        // RSI oversold is a STRONG reversal/buy opportunity signal
        hasOversoldSignal = true;
        oversoldStrength = Math.max(oversoldStrength, strength);
        scores.momentum += strength * 0.7;
        scores.trend += strength * 0.4;
        break;
      
      // EODHD breakout signals - STRONG bullish indicators
      case 'eodhd_price_breakout_bullish':
        scores.trend += strength * 0.7;
        scores.momentum += strength * 0.5;
        console.log(`📈 EODHD BREAKOUT BULLISH: strength=${strength.toFixed(3)}`);
        break;
      case 'eodhd_intraday_volume_spike':
        scores.momentum += strength * 0.4;
        scores.volatility += strength * 0.3;
        break;
      case 'eodhd_unusual_volatility':
        scores.volatility += strength * 0.3;
        break;
      
      // BEARISH signals - subtract from scores
      case 'trend_bearish':
        scores.trend -= strength * 0.8;
        break;
      case 'eodhd_price_breakdown_bearish':
        scores.trend -= strength * 0.7;
        scores.momentum -= strength * 0.4;
        break;
      case 'ma_cross_bearish':
        // MA cross bearish is less impactful if we have oversold conditions
        scores.trend -= strength * 0.4;
        scores.momentum -= strength * 0.2;
        break;
      case 'momentum_bearish':
      case 'ma_momentum_bearish':
        scores.momentum -= strength * 0.6;
        break;
      case 'macd_bearish':
        scores.momentum -= strength * 0.5;
        scores.trend -= strength * 0.2;
        break;
      case 'rsi_overbought_bearish':
        scores.momentum -= strength * 0.7;
        scores.trend -= strength * 0.3;
        break;
      case 'momentum_neutral':
        break;
        
      // Whale signals
      case 'whale_large_movement':
        scores.whale += strength * 0.7;
        break;
      case 'whale_exchange_inflow':
        // Inflow to exchange = potential selling pressure (bearish)
        scores.whale -= strength * 0.3;
        break;
      case 'whale_exchange_outflow':
        // Outflow from exchange = accumulation (bullish)
        scores.whale += strength * 0.5;
        break;
      
      default:
        // Log unknown signal types for debugging
        console.log(`⚠️ Unknown signal type: ${sig.signal_type}`);
    }
  }

  // If we have strong oversold signals, boost the overall scores
  // (buying the dip strategy)
  if (hasOversoldSignal && oversoldStrength > 0.3) {
    scores.trend += oversoldStrength * 0.3;
    scores.momentum += oversoldStrength * 0.2;
    console.log(`🌑 OVERSOLD BOOST: strength=${oversoldStrength.toFixed(3)}, boosting trend/momentum`);
  }

  // Process technical features if available
  if (features) {
    // RSI: < 30 oversold (bullish), > 70 overbought (bearish)
    if (features.rsi_14 != null) {
      if (features.rsi_14 < 30) {
        scores.momentum += 0.4; // Strong oversold = potential bounce
        scores.trend += 0.2;
      } else if (features.rsi_14 < 40) {
        scores.momentum += 0.2; // Moderately oversold
      } else if (features.rsi_14 > 70) {
        scores.momentum -= 0.5; // Overbought = likely pullback
        scores.trend -= 0.2;
      } else if (features.rsi_14 >= 50 && features.rsi_14 <= 60) {
        scores.momentum += 0.1; // Healthy bullish zone
      }
    }

    // MACD histogram: positive = bullish momentum
    if (features.macd_hist != null) {
      if (features.macd_hist > 0) {
        scores.momentum += Math.min(0.4, features.macd_hist * 0.1);
      } else {
        scores.momentum += Math.max(-0.4, features.macd_hist * 0.1);
      }
    }

    // EMA trend: price above EMAs = uptrend
    if (features.ema_20 != null && features.ema_50 != null) {
      if (features.ema_20 > features.ema_50) {
        scores.trend += 0.3; // Short-term above long-term = bullish
      } else {
        scores.trend -= 0.2; // Bearish trend (reduced penalty)
      }
    }
    
    if (features.ema_50 != null && features.ema_200 != null) {
      if (features.ema_50 > features.ema_200) {
        scores.trend += 0.2; // Golden cross territory
      } else {
        scores.trend -= 0.1; // Death cross territory (reduced penalty)
      }
    }

    // Volatility: use vol_1h - moderate volatility is good for trading
    if (features.vol_1h != null) {
      const normalizedVol = Math.min(1, features.vol_1h / 5);
      if (normalizedVol > 0.1 && normalizedVol < 0.5) {
        scores.volatility += 0.2;
      } else if (normalizedVol >= 0.5) {
        scores.volatility -= 0.1;
      }
    }
  }

  // Clamp all scores to -1 to +1
  scores.trend = Math.max(-1, Math.min(1, scores.trend));
  scores.momentum = Math.max(-1, Math.min(1, scores.momentum));
  scores.volatility = Math.max(-1, Math.min(1, scores.volatility));
  scores.whale = Math.max(-1, Math.min(1, scores.whale));
  scores.sentiment = Math.max(-1, Math.min(1, scores.sentiment));

  return scores;
}

/**
 * Compute fusion score from signal scores
 */
function computeFusionScore(scores: SignalScores, config: any): number {
  const fusionWeights = {
    trend: config.trendWeight || 0.35,
    momentum: config.momentumWeight || 0.25,
    volatility: config.volatilityWeight || 0.15,
    whale: config.whaleWeight || 0.15,
    sentiment: config.sentimentWeight || 0.10,
  };
  
  return scores.trend * fusionWeights.trend +
         scores.momentum * fusionWeights.momentum +
         scores.volatility * fusionWeights.volatility +
         scores.whale * fusionWeights.whale +
         scores.sentiment * fusionWeights.sentiment;
}

/**
 * Check if bull_override should prevent TP sell (let winners run)
 * Returns true if signals indicate strong continuation probability
 */
function shouldLetWinnersRun(scores: SignalScores, fusionScore: number, config: any): { shouldRun: boolean; bullScore: number; threshold: number } {
  // Get threshold from config, default 0.40 (MVP: not too aggressive)
  const threshold = config.letWinnersRunThreshold ?? 0.40;
  
  // Bull score = weighted combination (trend more important for continuation)
  const bullScore = (scores.trend * 0.5) + (scores.momentum * 0.35) + (fusionScore * 0.15);
  
  const shouldRun = bullScore >= threshold;
  
  return { shouldRun, bullScore, threshold };
}

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

      // ============= PHASE S4: INTELLIGENT EXIT EVALUATION =============
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
          
          // ============= FETCH SIGNALS FOR BULL OVERRIDE =============
          const signalLookback = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          const { data: liveSignals } = await supabaseClient
            .from('live_signals')
            .select('signal_type, signal_strength, data')
            .or(`symbol.eq.${baseSymbol},symbol.eq.${symbol}`)
            .gte('timestamp', signalLookback)
            .in('signal_type', [
              'ma_cross_bullish', 'rsi_oversold_bullish', 'momentum_bullish', 
              'trend_bullish', 'macd_bullish',
              'eodhd_price_breakout_bullish', 'eodhd_price_breakdown_bearish',
              'eodhd_intraday_volume_spike', 'eodhd_unusual_volatility',
              'ma_cross_bearish', 'rsi_overbought_bearish', 'momentum_bearish',
              'trend_bearish', 'macd_bearish', 'ma_momentum_bearish',
              'momentum_neutral',
              'whale_large_movement', 'whale_exchange_inflow', 'whale_exchange_outflow'
            ])
            .order('timestamp', { ascending: false })
            .limit(50);

          const { data: features } = await supabaseClient
            .from('market_features_v0')
            .select('rsi_14, macd_hist, ema_20, ema_50, ema_200, vol_1h')
            .eq('symbol', symbol)
            .eq('granularity', '1h')
            .order('ts_utc', { ascending: false })
            .limit(1)
            .single();

          const signalScores = computeSignalScores(liveSignals || [], features);
          const fusionScore = computeFusionScore(signalScores, config);
          
          // ============= INTELLIGENT EXIT EVALUATION =============
          const exitResult = await evaluateIntelligentExit(
            supabaseClient,
            config,
            position,
            currentPrice,
            pnlPercentage,
            hoursSincePurchase,
            signalScores,
            fusionScore,
            userId,
            strategy.id,
            effectiveShadowMode
          );
          
          // Log exit trace
          console.log(`📊 EXIT_TRACE [${baseSymbol}]:`, JSON.stringify(exitResult.trace));
          
          if (exitResult.shouldExit && exitResult.exitDecision) {
            console.log(`🌑 ${BACKEND_ENGINE_MODE}: EXIT TRIGGERED for ${baseSymbol} - trigger=${exitResult.exitDecision.trigger}, action=${exitResult.trace.final_action}`);
            
            // Generate unique identifiers
            const backendRequestId = crypto.randomUUID();
            const timestamp = Date.now();
            const idempotencyKey = `exit_${userId}_${strategy.id}_${baseSymbol}_${exitResult.exitDecision.trigger}_${timestamp}`;
            
            // Build SELL intent
            const sellIntent = {
              userId,
              strategyId: strategy.id,
              symbol: baseSymbol,
              side: 'SELL' as const,
              source: 'intelligent' as const,
              confidence: 0.95,
              reason: exitResult.exitDecision.trigger,
              qtySuggested: position.totalAmount,
              metadata: {
                mode: 'mock',
                engine: 'intelligent',
                is_test_mode: true,
                context: effectiveShadowMode ? 'BACKEND_SHADOW' : exitResult.exitDecision.context,
                trigger: exitResult.exitDecision.trigger,
                pnl_at_decision_pct: parseFloat(pnlPercentage.toFixed(4)),
                pnlPercentage: pnlPercentage.toFixed(4),
                entryPrice: position.averagePrice,
                currentPrice,
                hoursSincePurchase: hoursSincePurchase.toFixed(2),
                backend_request_id: backendRequestId,
                backend_ts: new Date().toISOString(),
                origin: effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE',
                exit_type: 'automatic',
                exit_trace: exitResult.trace,
              },
              ts: new Date().toISOString(),
              idempotencyKey,
            };

            if (effectiveShadowMode) {
              // SHADOW MODE: Log decision but don't execute
              console.log(`🌑 SHADOW: Would SELL ${baseSymbol} via ${exitResult.exitDecision.trigger} (pnl=${pnlPercentage.toFixed(2)}%)`);
              allDecisions.push({
                symbol: baseSymbol,
                side: 'SELL',
                action: 'WOULD_SELL',
                reason: exitResult.exitDecision.trigger,
                confidence: 0.95,
                wouldExecute: true,
                timestamp: new Date().toISOString(),
                metadata: {
                  ...sellIntent.metadata,
                  strategyId: strategy.id,
                  strategyName: strategy.strategy_name,
                  shadow_only: true,
                  // ============= EXECUTION TRUTH FIELDS (SELL SHADOW) =============
                  intent_side: 'SELL',
                  execution_status: 'SHADOW_ONLY',
                  execution_reason: null,
                }
              });
            } else {
              // LIVE MODE: Send SELL intent to coordinator
              console.log(`🔥 LIVE: Executing SELL for ${baseSymbol} via ${exitResult.exitDecision.trigger}`);
              
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
                  metadata: { 
                    error: coordError, 
                    trigger: exitResult.exitDecision.trigger, 
                    exit_trace: exitResult.trace,
                    // ============= EXECUTION TRUTH FIELDS (SELL ERROR) =============
                    intent_side: 'SELL',
                    execution_status: 'BLOCKED',
                    execution_reason: `error: ${coordError.message || 'coordinator_error'}`,
                  }
                });
              } else {
                let parsed = coordinatorResponse;
                if (typeof parsed === 'string') {
                  try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
                }
                const decision = parsed?.decision || parsed;
                const action = decision?.action || 'UNKNOWN';
                
                // Determine execution status for SELL
                const sellWasExecuted = action === 'SELL';
                const sellExecutionStatus: 'EXECUTED' | 'BLOCKED' | 'DEFERRED' = 
                  sellWasExecuted ? 'EXECUTED' :
                  action === 'DEFER' ? 'DEFERRED' : 'BLOCKED';
                const sellExecutionReason = sellWasExecuted ? null : (decision?.reason || exitResult.exitDecision.trigger);
                
                allDecisions.push({
                  symbol: baseSymbol,
                  side: 'SELL',
                  action,
                  reason: exitResult.exitDecision.trigger,
                  confidence: 0.95,
                  wouldExecute: sellWasExecuted,
                  timestamp: new Date().toISOString(),
                  metadata: {
                    ...sellIntent.metadata,
                    strategyId: strategy.id,
                    strategyName: strategy.strategy_name,
                    coordinatorResponse: decision,
                    // ============= EXECUTION TRUTH FIELDS (SELL LIVE) =============
                    intent_side: 'SELL',
                    execution_status: sellExecutionStatus,
                    execution_reason: sellExecutionReason,
                  }
                });
              }
            }
          } else {
            // ============= NO EXIT: Log HOLD with full trace =============
            allDecisions.push({
              symbol: baseSymbol,
              side: 'HOLD',
              action: exitResult.trace.final_action === 'HOLD_RUNNER' ? 'HOLD_RUNNER' : 'NO_EXIT',
              reason: exitResult.trace.final_reason,
              confidence: 0,
              wouldExecute: false,
              timestamp: new Date().toISOString(),
              metadata: {
                strategyId: strategy.id,
                strategyName: strategy.strategy_name,
                exit_trace: exitResult.trace,
                origin: effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE',
                exit_evaluation: true,
                // ============= EXECUTION TRUTH FIELDS (HOLD/NO_EXIT) =============
                intent_side: 'HOLD',
                execution_status: 'SKIPPED',
                execution_reason: exitResult.trace.final_reason,
              }
            });
          }
        } catch (exitErr) {
          console.error(`🌑 ${BACKEND_ENGINE_MODE}: Error evaluating exit for ${position.cryptocurrency}:`, exitErr);
        }
      }

      // Step 3: For each symbol, evaluate BUY opportunities WITH SIGNAL INTELLIGENCE
      for (const coin of selectedCoins) {
        const symbol = coin.includes('-') ? coin : `${coin}-EUR`;
        const baseSymbol = coin.replace('-EUR', '');
        
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
            console.log(`🌑 ${BACKEND_ENGINE_MODE}: Skipping ${symbol} - no valid price`);
            allDecisions.push({
              symbol: baseSymbol,
              side: 'HOLD',
              action: 'SKIP',
              reason: 'no_valid_price',
              confidence: 0,
              wouldExecute: false,
              timestamp: new Date().toISOString(),
              metadata: { 
                priceError: true,
                // ============= EXECUTION TRUTH FIELDS (SKIP/NO_PRICE) =============
                intent_side: 'HOLD',
                execution_status: 'SKIPPED',
                execution_reason: 'no_valid_price',
              }
            });
            continue;
          }

          // ============= INTELLIGENT SIGNAL EVALUATION =============
          const signalLookback = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          const { data: liveSignals } = await supabaseClient
            .from('live_signals')
            .select('signal_type, signal_strength, data')
            .or(`symbol.eq.${baseSymbol},symbol.eq.${symbol}`)
            .gte('timestamp', signalLookback)
            .in('signal_type', [
              'ma_cross_bullish', 'rsi_oversold_bullish', 'momentum_bullish', 
              'trend_bullish', 'macd_bullish',
              'eodhd_price_breakout_bullish', 'eodhd_price_breakdown_bearish',
              'eodhd_intraday_volume_spike', 'eodhd_unusual_volatility',
              'ma_cross_bearish', 'rsi_overbought_bearish', 'momentum_bearish',
              'trend_bearish', 'macd_bearish', 'ma_momentum_bearish',
              'momentum_neutral',
              'whale_large_movement', 'whale_exchange_inflow', 'whale_exchange_outflow'
            ])
            .order('timestamp', { ascending: false })
            .limit(50);

          const { data: features } = await supabaseClient
            .from('market_features_v0')
            .select('rsi_14, macd_hist, ema_20, ema_50, ema_200, vol_1h')
            .eq('symbol', symbol)
            .eq('granularity', '1h')
            .order('ts_utc', { ascending: false })
            .limit(1)
            .single();

          // ============= COMPUTE FUSION SCORE =============
          const signalScores = computeSignalScores(liveSignals || [], features);
          const fusionScore = computeFusionScore(signalScores, config);

          // Get thresholds from config
          const enterThreshold = config.enterThreshold || 0.15;
          const minConfidence = config.minConfidence || 0.5;

          // ============= ENTRY DECISION LOGIC =============
          const isTrendPositive = signalScores.trend > -0.1;
          const isMomentumPositive = signalScores.momentum > 0;
          const isNotOverbought = signalScores.momentum > -0.5;
          const meetsThreshold = fusionScore >= enterThreshold;
          
          const shouldBuy = (meetsThreshold && isTrendPositive) || 
                           (isMomentumPositive && signalScores.momentum > 0.3 && isNotOverbought);

          console.log(`🌑 ${BACKEND_ENGINE_MODE}: ${baseSymbol} SIGNAL CHECK → fusion=${fusionScore.toFixed(3)}, threshold=${enterThreshold}, trend=${signalScores.trend.toFixed(3)}, momentum=${signalScores.momentum.toFixed(3)}, shouldBuy=${shouldBuy}`);

          if (!shouldBuy) {
            let skipReason = 'conditions_not_met';
            if (signalScores.trend < -0.1 && signalScores.momentum <= 0.3) {
              skipReason = `trend_negative_${signalScores.trend.toFixed(3)}_no_momentum_boost`;
            } else if (!isNotOverbought) {
              skipReason = `overbought_momentum_${signalScores.momentum.toFixed(3)}`;
            } else if (!meetsThreshold && !isMomentumPositive) {
              skipReason = `fusion_${fusionScore.toFixed(3)}_below_${enterThreshold}_no_momentum`;
            }
            
            allDecisions.push({
              symbol: baseSymbol,
              side: 'HOLD',
              action: 'SKIP',
              reason: skipReason,
              confidence: fusionScore,
              fusionScore,
              wouldExecute: false,
              timestamp: new Date().toISOString(),
              metadata: {
                strategyId: strategy.id,
                strategyName: strategy.strategy_name,
                price: currentPrice,
                signals: signalScores,
                enterThreshold,
                engineMode: BACKEND_ENGINE_MODE,
                // ============= EXECUTION TRUTH FIELDS (SKIP/CONDITIONS) =============
                intent_side: 'HOLD',
                execution_status: 'SKIPPED',
                execution_reason: skipReason,
              }
            });
            continue;
          }

          // ============= SIGNALS POSITIVE - PROCEED WITH BUY INTENT =============
          const tradeAllocation = config.perTradeAllocation || 50;
          const qtySuggested = tradeAllocation / currentPrice;
          const computedConfidence = Math.min(0.95, Math.max(minConfidence, fusionScore));

          const intentMetadata = {
            mode: 'mock',
            engine: 'intelligent',
            is_test_mode: true,
            context: effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE',
            backend_ts: new Date().toISOString(),
            currentPrice,
            fusionScore,
            signalScores,
            enterThreshold,
            isTrendPositive,
            isMomentumPositive,
          };

          const backendRequestId = crypto.randomUUID();
          const timestamp = Date.now();
          const idempotencyKey = `live_${userId}_${strategy.id}_${baseSymbol}_${timestamp}`;
          
          const intent = {
            userId,
            strategyId: strategy.id,
            symbol: baseSymbol,
            side: 'BUY' as const,
            source: 'intelligent' as const,
            confidence: computedConfidence,
            reason: `signal_confirmed_fusion_${fusionScore.toFixed(3)}`,
            qtySuggested,
            metadata: {
              ...intentMetadata,
              backend_request_id: backendRequestId,
              origin: effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE',
            },
            ts: new Date().toISOString(),
            idempotencyKey,
          };

          console.log(`🌑 ${BACKEND_ENGINE_MODE}: ${baseSymbol} SIGNALS POSITIVE → calling coordinator (fusion=${fusionScore.toFixed(3)})`);

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
              confidence: computedConfidence,
              fusionScore,
              wouldExecute: false,
              timestamp: new Date().toISOString(),
              metadata: { error: coordError, signals: signalScores }
            });
            continue;
          }

          let parsed = coordinatorResponse;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
          }

          const decision = parsed?.decision || parsed;
          const action = decision?.action || 'UNKNOWN';
          const reason = decision?.reason || 'no_reason';

          console.log(`🌑 ${BACKEND_ENGINE_MODE}: ${baseSymbol} → action=${action}, reason=${reason}`);

          // ============= EXECUTION STATUS TRUTH =============
          // Determine execution status based on coordinator response
          // EXECUTED = trade was inserted into mock_trades
          // BLOCKED = trade was blocked by exposure/guard/policy
          // DEFERRED = trade was deferred for retry
          const isBlocked = action === 'DEFER' || action === 'BLOCK' || action === 'HOLD';
          const wasExecuted = action === 'BUY' || action === 'SELL';
          
          const execution_status: 'EXECUTED' | 'BLOCKED' | 'DEFERRED' = 
            wasExecuted ? 'EXECUTED' :
            action === 'DEFER' ? 'DEFERRED' : 'BLOCKED';
          
          const execution_reason = wasExecuted ? null : reason;
          
          // wouldExecute = true ONLY if execution actually happened
          const wouldExecute = wasExecuted;
          
          // side = the INTENT (what the engine wanted to do) - always BUY for entry signals
          // The execution_status tells what ACTUALLY happened
          const side: 'BUY' | 'SELL' | 'HOLD' = 'BUY';

          allDecisions.push({
            symbol: baseSymbol,
            side,
            action,
            reason,
            confidence: computedConfidence,
            fusionScore,
            wouldExecute,
            timestamp: new Date().toISOString(),
            metadata: {
              strategyId: strategy.id,
              strategyName: strategy.strategy_name,
              price: currentPrice,
              qtySuggested,
              signalScores,
              coordinatorResponse: decision,
              engineMode: BACKEND_ENGINE_MODE,
              effectiveShadowMode,
              userAllowedForLive: isUserAllowedForLive,
              // ============= EXECUTION TRUTH FIELDS =============
              execution_status,
              execution_reason,
              intent_side: 'BUY',
            }
          });

        } catch (symbolErr) {
          console.error(`🌑 ${BACKEND_ENGINE_MODE}: Error processing ${coin}:`, symbolErr);
          allDecisions.push({
            symbol: baseSymbol,
            side: 'BUY', // intent_side = BUY (we WANTED to buy, but error blocked it)
            action: 'ERROR',
            reason: String(symbolErr),
            confidence: 0,
            wouldExecute: false,
            timestamp: new Date().toISOString(),
            metadata: { 
              error: String(symbolErr),
              // ============= EXECUTION TRUTH FIELDS (ERROR CASE) =============
              intent_side: 'BUY',
              execution_status: 'BLOCKED',
              execution_reason: `error: ${String(symbolErr)}`,
            }
          });
        }
      }
    }

    // Step 4: Compute summary with explicit execution status
    const summary = {
      executed: allDecisions.filter(d => d.metadata?.execution_status === 'EXECUTED').length,
      blocked: allDecisions.filter(d => d.metadata?.execution_status === 'BLOCKED').length,
      deferred: allDecisions.filter(d => d.metadata?.execution_status === 'DEFERRED').length,
      wouldBuy: allDecisions.filter(d => d.side === 'BUY' && d.wouldExecute).length,
      wouldSell: allDecisions.filter(d => d.side === 'SELL' && d.wouldExecute).length,
      wouldHold: allDecisions.filter(d => d.side === 'HOLD' || !d.wouldExecute).length,
      total: allDecisions.length,
      holdRunner: allDecisions.filter(d => d.action === 'HOLD_RUNNER').length,
    };

    const elapsed_ms = Date.now() - startTime;
    console.log(`🌑 ${BACKEND_ENGINE_MODE}: Completed in ${elapsed_ms}ms → executed=${summary.executed}, blocked=${summary.blocked}, deferred=${summary.deferred}, holdRunner=${summary.holdRunner}`);

    // Step 5: Log all decisions to decision_events table for observability
    for (const dec of allDecisions) {
      try {
        const eventMetadata = {
          ...dec.metadata,
          engineMode: BACKEND_ENGINE_MODE,
          effectiveShadowMode,
          shadow_run: effectiveShadowMode,
          is_backend_engine: true,
          origin: effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE',
        };
        
        const { error: insertError } = await supabaseClient
          .from('decision_events')
          .insert({
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
          console.log(`🌑 ${BACKEND_ENGINE_MODE}: Logged decision_event for ${dec.symbol} action=${dec.action}`);
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
    const { data: aggregatedPositions, error: aggError } = await supabaseClient
      .from('mock_trades')
      .select('cryptocurrency, trade_type, amount, price, executed_at, id')
      .eq('user_id', userId)
      .eq('strategy_id', strategyId)
      .eq('is_test_mode', true)
      .order('executed_at', { ascending: true })
      .limit(10000);

    if (aggError) {
      console.error('[fetchOpenPositions] Error fetching trades:', aggError);
      return [];
    }

    const trades = aggregatedPositions || [];
    console.log(`[fetchOpenPositions] Fetched ${trades.length} trades for strategy ${strategyId.substring(0, 8)}...`);

    if (trades.length === 0) {
      console.log('[fetchOpenPositions] No trades found');
      return [];
    }

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

    const openPositions: OpenPosition[] = [];
    
    for (const [symbol, pos] of positionMap) {
      const netAmount = pos.totalBuyAmount - pos.totalSellAmount;
      
      if (netAmount > 0.00000001) {
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

// ============= PHASE S4: INTELLIGENT EXIT EVALUATION =============
interface ExitDecision {
  trigger: ExitTrigger;
  context: ExitContext;
  reason: string;
}

interface IntelligentExitResult {
  shouldExit: boolean;
  exitDecision: ExitDecision | null;
  trace: ExitTrace;
}

async function evaluateIntelligentExit(
  supabaseClient: any,
  config: any,
  position: OpenPosition,
  currentPrice: number,
  pnlPercentage: number,
  hoursSincePurchase: number,
  signalScores: SignalScores,
  fusionScore: number,
  userId: string,
  strategyId: string,
  effectiveShadowMode: boolean
): Promise<IntelligentExitResult> {
  const symbol = position.cryptocurrency.replace('-EUR', '');
  const epsilonPnLBufferPct = config.epsilonPnLBufferPct || 0.03;
  
  // Get config values
  const configuredTP = config.takeProfitPercentage;
  const hasTPConfigured = typeof configuredTP === 'number' && configuredTP > 0;
  const adjustedTakeProfit = hasTPConfigured ? Math.abs(configuredTP) + epsilonPnLBufferPct : 0;
  
  const configuredSL = config.stopLossPercentage;
  const hasSLConfigured = typeof configuredSL === 'number' && configuredSL > 0;
  const adjustedStopLoss = hasSLConfigured ? Math.abs(configuredSL) + epsilonPnLBufferPct : 0;
  
  // Default trailing distance: 0.6% (MVP)
  const trailingDistancePct = config.runnerTrailingDistancePct ?? 0.6;
  
  // ============= FETCH OR CREATE RUNNER STATE =============
  const runnerState = await getOrCreateRunnerState(supabaseClient, userId, strategyId, symbol, pnlPercentage, trailingDistancePct, config);
  
  // Calculate bull override
  const bullCheck = shouldLetWinnersRun(signalScores, fusionScore, config);
  
  // Build initial trace
  const trace: ExitTrace = {
    symbol,
    strategy_id: strategyId,
    pnl_pct_engine: parseFloat(pnlPercentage.toFixed(4)),
    tp_pct: adjustedTakeProfit,
    is_tp_met: hasTPConfigured && pnlPercentage >= adjustedTakeProfit,
    bull_override: false,
    bull_score_used: parseFloat(bullCheck.bullScore.toFixed(4)),
    bull_threshold: bullCheck.threshold,
    bull_components: {
      trend: parseFloat(signalScores.trend.toFixed(4)),
      momentum: parseFloat(signalScores.momentum.toFixed(4)),
      fusion: parseFloat(fusionScore.toFixed(4)),
    },
    runner_mode_before: runnerState.runner_mode,
    runner_mode_after: runnerState.runner_mode,
    peak_pnl_before: runnerState.peak_pnl_pct,
    peak_pnl_after: runnerState.peak_pnl_pct,
    trailing_distance_pct: trailingDistancePct,
    trailing_stop_level_pct: runnerState.trailing_stop_level_pct,
    is_trailing_hit: false,
    sl_pct: adjustedStopLoss,
    is_sl_met: hasSLConfigured && pnlPercentage <= -adjustedStopLoss,
    final_action: 'NO_EXIT',
    final_reason: 'no_exit_condition_met',
    context: effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE',
    evaluated_at: new Date().toISOString(),
  };
  
  // ============= 1. STOP LOSS CHECK (ALWAYS FIRST - HARD GUARD) =============
  if (trace.is_sl_met) {
    trace.final_action = 'SELL_SL';
    trace.final_reason = `P&L ${pnlPercentage.toFixed(2)}% <= -${adjustedStopLoss.toFixed(2)}% (SL hit)`;
    
    // Reset runner state on SL
    await resetRunnerState(supabaseClient, userId, strategyId, symbol);
    
    return {
      shouldExit: true,
      exitDecision: {
        trigger: 'STOP_LOSS',
        context: 'AUTO_SL',
        reason: trace.final_reason,
      },
      trace,
    };
  }
  
  // ============= 2. TRAILING STOP CHECK (FOR RUNNER MODE) =============
  if (runnerState.runner_mode && pnlPercentage > 0) {
    // Update peak if current PnL is higher
    const newPeak = Math.max(runnerState.peak_pnl_pct, pnlPercentage);
    const newTrailingStopLevel = newPeak - trailingDistancePct;
    
    trace.peak_pnl_after = newPeak;
    trace.trailing_stop_level_pct = newTrailingStopLevel;
    
    // Check if trailing stop is hit
    if (pnlPercentage <= newTrailingStopLevel && newTrailingStopLevel > 0) {
      trace.is_trailing_hit = true;
      trace.final_action = 'SELL_TRAILING';
      trace.final_reason = `Trailing stop hit: PnL ${pnlPercentage.toFixed(2)}% <= trailing level ${newTrailingStopLevel.toFixed(2)}% (peak was ${newPeak.toFixed(2)}%)`;
      
      // Reset runner state after trailing stop hit
      await resetRunnerState(supabaseClient, userId, strategyId, symbol);
      
      return {
        shouldExit: true,
        exitDecision: {
          trigger: 'SELL_TRAILING_RUNNER',
          context: 'RUNNER_TRAIL',
          reason: trace.final_reason,
        },
        trace,
      };
    }
    
    // Update runner state with new peak
    await updateRunnerState(supabaseClient, userId, strategyId, symbol, true, newPeak, trailingDistancePct, config);
  }
  
  // ============= 3. TAKE PROFIT CHECK WITH BULL OVERRIDE =============
  if (trace.is_tp_met) {
    // TP condition met - check bull override
    if (bullCheck.shouldRun) {
      // BULL OVERRIDE: Don't sell, switch to runner mode
      trace.bull_override = true;
      trace.runner_mode_after = true;
      trace.peak_pnl_after = Math.max(runnerState.peak_pnl_pct, pnlPercentage);
      trace.trailing_stop_level_pct = trace.peak_pnl_after - trailingDistancePct;
      trace.final_action = 'HOLD_RUNNER';
      trace.final_reason = `Bull override: bullScore=${bullCheck.bullScore.toFixed(3)} >= ${bullCheck.threshold} → switching to RUNNER mode (trailing from ${trace.peak_pnl_after.toFixed(2)}%)`;
      
      // Persist runner mode
      await updateRunnerState(supabaseClient, userId, strategyId, symbol, true, trace.peak_pnl_after, trailingDistancePct, config);
      
      console.log(`🏃 RUNNER MODE ACTIVATED for ${symbol}: bullScore=${bullCheck.bullScore.toFixed(3)}, peak=${trace.peak_pnl_after.toFixed(2)}%, trailing@${trace.trailing_stop_level_pct.toFixed(2)}%`);
      
      return {
        shouldExit: false,
        exitDecision: null,
        trace,
      };
    } else {
      // No bull override, normal TP sell
      trace.final_action = 'SELL_TP';
      trace.final_reason = `P&L ${pnlPercentage.toFixed(2)}% >= ${adjustedTakeProfit.toFixed(2)}% (TP hit, no bull override: bullScore=${bullCheck.bullScore.toFixed(3)} < ${bullCheck.threshold})`;
      
      // Reset runner state on TP exit
      await resetRunnerState(supabaseClient, userId, strategyId, symbol);
      
      return {
        shouldExit: true,
        exitDecision: {
          trigger: 'TAKE_PROFIT',
          context: 'AUTO_TP',
          reason: trace.final_reason,
        },
        trace,
      };
    }
  }
  
  // ============= 4. NO EXIT - CONTINUE HOLDING =============
  // Determine blocking reason
  if (!hasTPConfigured) {
    trace.final_reason = 'tp_not_configured';
  } else if (pnlPercentage < adjustedTakeProfit) {
    trace.final_reason = `pnl_below_tp:${pnlPercentage.toFixed(4)}%_<_${adjustedTakeProfit.toFixed(4)}%`;
  }
  
  // If in runner mode, update peak tracking
  if (runnerState.runner_mode && pnlPercentage > runnerState.peak_pnl_pct) {
    trace.peak_pnl_after = pnlPercentage;
    trace.trailing_stop_level_pct = pnlPercentage - trailingDistancePct;
    await updateRunnerState(supabaseClient, userId, strategyId, symbol, true, pnlPercentage, trailingDistancePct, config);
  }
  
  return {
    shouldExit: false,
    exitDecision: null,
    trace,
  };
}

// ============= RUNNER STATE HELPERS =============
async function getOrCreateRunnerState(
  supabaseClient: any,
  userId: string,
  strategyId: string,
  symbol: string,
  currentPnl: number,
  trailingDistancePct: number,
  config: any
): Promise<RunnerState> {
  // Check coin_pool_states table
  const { data: existing, error } = await supabaseClient
    .from('coin_pool_states')
    .select('is_armed, high_water_price, last_trailing_stop_price, config_snapshot')
    .eq('user_id', userId)
    .eq('strategy_id', strategyId)
    .eq('symbol', symbol)
    .maybeSingle();
  
  if (error) {
    console.warn(`[RunnerState] Error fetching state for ${symbol}:`, error);
  }
  
  if (existing) {
    // Use is_armed as runner_mode, high_water_price as peak
    const storedPeak = existing.config_snapshot?.peak_pnl_pct ?? 0;
    const storedTrailing = existing.config_snapshot?.trailing_distance_pct ?? trailingDistancePct;
    
    return {
      runner_mode: existing.is_armed || false,
      peak_pnl_pct: storedPeak,
      trailing_distance_pct: storedTrailing,
      trailing_stop_level_pct: storedPeak - storedTrailing,
    };
  }
  
  // No existing state - return default (not in runner mode)
  return {
    runner_mode: false,
    peak_pnl_pct: Math.max(0, currentPnl),
    trailing_distance_pct: trailingDistancePct,
    trailing_stop_level_pct: Math.max(0, currentPnl) - trailingDistancePct,
  };
}

async function updateRunnerState(
  supabaseClient: any,
  userId: string,
  strategyId: string,
  symbol: string,
  runnerMode: boolean,
  peakPnl: number,
  trailingDistancePct: number,
  config: any
): Promise<void> {
  const configSnapshot = {
    runner_mode: runnerMode,
    peak_pnl_pct: peakPnl,
    trailing_distance_pct: trailingDistancePct,
    trailing_stop_level_pct: peakPnl - trailingDistancePct,
    updated_at: new Date().toISOString(),
  };
  
  const { error } = await supabaseClient
    .from('coin_pool_states')
    .upsert({
      user_id: userId,
      strategy_id: strategyId,
      symbol: symbol,
      is_armed: runnerMode,
      high_water_price: null, // We use config_snapshot for PnL tracking
      last_trailing_stop_price: null,
      config_snapshot: configSnapshot,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,strategy_id,symbol',
    });
  
  if (error) {
    console.warn(`[RunnerState] Error updating state for ${symbol}:`, error);
  } else {
    console.log(`[RunnerState] Updated ${symbol}: runnerMode=${runnerMode}, peak=${peakPnl.toFixed(2)}%`);
  }
}

async function resetRunnerState(
  supabaseClient: any,
  userId: string,
  strategyId: string,
  symbol: string
): Promise<void> {
  const { error } = await supabaseClient
    .from('coin_pool_states')
    .update({
      is_armed: false,
      config_snapshot: {
        runner_mode: false,
        peak_pnl_pct: 0,
        trailing_distance_pct: 0.6,
        trailing_stop_level_pct: 0,
        reset_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('strategy_id', strategyId)
    .eq('symbol', symbol);
  
  if (error) {
    console.warn(`[RunnerState] Error resetting state for ${symbol}:`, error);
  } else {
    console.log(`[RunnerState] Reset runner state for ${symbol}`);
  }
}
