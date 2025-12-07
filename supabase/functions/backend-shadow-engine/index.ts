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
  const isShadowMode = BACKEND_ENGINE_MODE === 'SHADOW';
  
  try {
    console.log(`🌑 BACKEND ENGINE: Starting run in ${BACKEND_ENGINE_MODE} mode`);
    console.log(`   → isShadowMode=${isShadowMode}, trades_will_insert=${!isShadowMode}`);
    
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
        shadow: isShadowMode,
        mode: BACKEND_ENGINE_MODE,
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

      // Step 3: For each symbol, build intent and call coordinator in SHADOW mode
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
          // Mode-conditional metadata for SHADOW vs LIVE
          const intentMetadata = isShadowMode ? {
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
            reason: isShadowMode ? 'BACKEND_SHADOW_EVALUATION' : 'BACKEND_LIVE_DECISION',
            qtySuggested,
            metadata: intentMetadata,
            ts: new Date().toISOString(),
            idempotencyKey: `${isShadowMode ? 'shadow' : 'live'}_${strategy.id}_${baseSymbol}_${Date.now()}`
          };

          console.log(`🌑 ${BACKEND_ENGINE_MODE}: Calling coordinator for ${baseSymbol} BUY intent`);

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
              engineMode: BACKEND_ENGINE_MODE,
              shadowMode: isShadowMode,
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
          // Mode-conditional metadata for decision_events
          const eventMetadata = isShadowMode ? {
            ...dec.metadata,
            origin: 'BACKEND_SHADOW',
            shadow_only: true,
            no_trade_inserted: true,
          } : {
            ...dec.metadata,
            origin: 'BACKEND_LIVE',
            shadow_only: false,
            no_trade_inserted: false,
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
          console.log(`🌑 ${BACKEND_ENGINE_MODE}: Logged decision_event for ${dec.symbol} (origin=BACKEND_${BACKEND_ENGINE_MODE})`);
        }
      } catch (logErr) {
        console.warn(`🌑 ${BACKEND_ENGINE_MODE}: Could not log decision_event for ${dec.symbol}:`, logErr);
      }
    }

    return new Response(JSON.stringify({
      shadow: isShadowMode,
      mode: BACKEND_ENGINE_MODE,
      decisions: allDecisions,
      summary,
      strategies_evaluated: strategies.length,
      elapsed_ms,
      message: isShadowMode 
        ? 'Shadow evaluation complete - NO trades were executed'
        : 'Live evaluation complete - trades may have been executed',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(`🌑 ${BACKEND_ENGINE_MODE}: Fatal error:`, error);
    return new Response(JSON.stringify({ 
      shadow: isShadowMode,
      mode: BACKEND_ENGINE_MODE,
      error: error.message,
      elapsed_ms: Date.now() - startTime
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
