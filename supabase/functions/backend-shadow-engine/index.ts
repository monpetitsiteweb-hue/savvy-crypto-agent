// Backend Shadow Engine - Phase 4.1
// 
// This edge function evaluates trading decisions using the same logic as the frontend
// intelligent engine. Supports two modes:
//   - SHADOW (default): Log decisions to decision_events only, no trades inserted
//   - LIVE: Same decision path, coordinator inserts into mock_trades
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  // ============= PHASE B: EFFECTIVE SHADOW MODE CALCULATION =============
  // 1. Read the configured mode from env (defaults to SHADOW)
  // 2. Check if user is in the allowlist (only matters if mode is LIVE)
  // 3. Compute effectiveShadowMode: forces SHADOW if user not allowlisted
  // ======================================================================
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

      // Step 3: For each symbol, build intent and call coordinator
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
          // Mode-conditional metadata based on effectiveShadowMode
          const intentMetadata = effectiveShadowMode ? {
            mode: 'mock',
            engine: 'intelligent',
            is_test_mode: true,
            // SHADOW MODE FLAGS - coordinator will skip inserts
            execMode: 'SHADOW',
            context: 'BACKEND_SHADOW',
            shadow_run_ts: new Date().toISOString(),
            currentPrice,
          } : {
            mode: 'mock',
            engine: 'intelligent',
            is_test_mode: true,
            // LIVE MODE FLAGS - coordinator will insert trades
            context: 'BACKEND_LIVE',
            backend_live_ts: new Date().toISOString(),
            currentPrice,
          };

          const intent = {
            userId,
            strategyId: strategy.id,
            symbol: baseSymbol,
            side: 'BUY' as const,
            source: 'intelligent' as const,
            confidence: 0.65, // Default confidence
            reason: effectiveShadowMode ? 'BACKEND_SHADOW_EVALUATION' : 'BACKEND_LIVE_DECISION',
            qtySuggested,
            metadata: intentMetadata,
            ts: new Date().toISOString(),
            idempotencyKey: `${effectiveShadowMode ? 'shadow' : 'live'}_${strategy.id}_${baseSymbol}_${Date.now()}`
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

          // Determine what would happen
          const wouldExecute = action === 'BUY' || action === 'SELL' || action === 'EXECUTE';
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
              // Phase B: Include all mode info in metadata
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
    };

    const elapsed_ms = Date.now() - startTime;
    
    console.log(`🌑 ${BACKEND_ENGINE_MODE}: Run complete. wouldBuy=${summary.wouldBuy}, wouldSell=${summary.wouldSell}, wouldHold=${summary.wouldHold}, elapsed=${elapsed_ms}ms`);

    // Log decisions to decision_events with appropriate origin tag
    for (const dec of allDecisions) {
      try {
        // Only log decisions that would execute (for meaningful learning data)
        if (dec.wouldExecute) {
          // Phase B: Mode-conditional metadata for decision_events with all mode info
          const eventMetadata = effectiveShadowMode ? {
            ...dec.metadata,
            origin: 'BACKEND_SHADOW',
            shadow_only: true,
            no_trade_inserted: true,
            // Phase B fields
            engineMode: BACKEND_ENGINE_MODE,
            effectiveShadowMode: true,
            userAllowedForLive: isUserAllowedForLive,
          } : {
            ...dec.metadata,
            origin: 'BACKEND_LIVE',
            shadow_only: false,
            no_trade_inserted: false,
            // Phase B fields
            engineMode: BACKEND_ENGINE_MODE,
            effectiveShadowMode: false,
            userAllowedForLive: isUserAllowedForLive,
          };

          await supabaseClient.from('decision_events').insert({
            user_id: userId,
            strategy_id: dec.metadata.strategyId,
            symbol: dec.symbol,
            side: dec.side,
            source: 'intelligent',
            confidence: dec.confidence,
            reason: dec.reason,
            entry_price: dec.metadata.price,
            metadata: eventMetadata,
            decision_ts: dec.timestamp,
          });
          console.log(`🌑 ${BACKEND_ENGINE_MODE}: Logged decision_event for ${dec.symbol} (origin=${effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE'})`);
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
