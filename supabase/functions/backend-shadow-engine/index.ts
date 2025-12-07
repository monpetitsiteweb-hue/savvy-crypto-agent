// Backend Shadow Engine - Phase 3
// 
// This edge function evaluates trading decisions using the same logic as the frontend
// intelligent engine, but in SHADOW MODE - it never inserts real trades.
// 
// Purpose: Validate backend-driven decision making before migrating from frontend.
// 
// Usage: POST with { userId, strategyId?, symbols?: string[] }
// Returns: { shadow: true, decisions: [...], summary: { wouldBuy, wouldSell, wouldHold } }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  
  try {
    console.log('🌑 BACKEND SHADOW ENGINE: Starting shadow evaluation run');
    
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

    console.log(`🌑 SHADOW: Evaluating for user ${userId}, strategyId=${strategyId || 'all'}`);

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
      console.log('🌑 SHADOW: No active strategies found');
      return new Response(JSON.stringify({ 
        shadow: true,
        decisions: [],
        summary: { wouldBuy: 0, wouldSell: 0, wouldHold: 0, total: 0 },
        message: 'No active strategies found',
        elapsed_ms: Date.now() - startTime
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`🌑 SHADOW: Found ${strategies.length} active strategies`);

    const allDecisions: ShadowDecision[] = [];

    // Step 2: Process each strategy
    for (const strategy of strategies) {
      const config = strategy.configuration || {};
      const selectedCoins = requestedSymbols || config.selectedCoins || ['BTC', 'ETH'];
      
      console.log(`🌑 SHADOW: Processing strategy "${strategy.strategy_name}" with coins: ${selectedCoins.join(', ')}`);

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
            console.warn(`🌑 SHADOW: Could not fetch price for ${symbol}:`, priceErr);
          }

          if (currentPrice <= 0) {
            console.log(`🌑 SHADOW: Skipping ${symbol} - no valid price`);
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
          const intent = {
            userId,
            strategyId: strategy.id,
            symbol: baseSymbol,
            side: 'BUY' as const,
            source: 'intelligent' as const,
            confidence: 0.65, // Default confidence
            reason: 'BACKEND_SHADOW_EVALUATION',
            qtySuggested,
            metadata: {
              mode: 'mock',
              engine: 'intelligent',
              is_test_mode: true,
              // ====== SHADOW MODE FLAG ======
              execMode: 'SHADOW',
              context: 'BACKEND_SHADOW',
              shadow_run_ts: new Date().toISOString(),
              currentPrice,
            },
            ts: new Date().toISOString(),
            idempotencyKey: `shadow_${strategy.id}_${baseSymbol}_${Date.now()}`
          };

          console.log(`🌑 SHADOW: Calling coordinator for ${baseSymbol} BUY intent (SHADOW mode)`);

          // Call coordinator with shadow flag
          const { data: coordinatorResponse, error: coordError } = await supabaseClient.functions.invoke(
            'trading-decision-coordinator',
            { body: { intent } }
          );

          if (coordError) {
            console.error(`🌑 SHADOW: Coordinator error for ${baseSymbol}:`, coordError);
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

          console.log(`🌑 SHADOW: ${baseSymbol} → action=${action}, reason=${reason}`);

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
              shadowMode: true,
            }
          });

        } catch (symbolErr) {
          console.error(`🌑 SHADOW: Error processing ${coin}:`, symbolErr);
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
    
    console.log(`🌑 SHADOW: Run complete. wouldBuy=${summary.wouldBuy}, wouldSell=${summary.wouldSell}, wouldHold=${summary.wouldHold}, elapsed=${elapsed_ms}ms`);

    // Log shadow decisions to decision_events with origin tag (observability)
    for (const dec of allDecisions) {
      try {
        // Only log decisions that would execute (for meaningful learning data)
        if (dec.wouldExecute) {
          await supabaseClient.from('decision_events').insert({
            user_id: userId,
            strategy_id: dec.metadata.strategyId,
            symbol: dec.symbol,
            side: dec.side,
            source: 'intelligent',
            confidence: dec.confidence,
            reason: dec.reason,
            entry_price: dec.metadata.price,
            metadata: {
              ...dec.metadata,
              origin: 'BACKEND_SHADOW',
              shadow_only: true,
              no_trade_inserted: true,
            },
            decision_ts: dec.timestamp,
          });
          console.log(`🌑 SHADOW: Logged decision_event for ${dec.symbol} (origin=BACKEND_SHADOW)`);
        }
      } catch (logErr) {
        console.warn(`🌑 SHADOW: Could not log decision_event for ${dec.symbol}:`, logErr);
      }
    }

    return new Response(JSON.stringify({
      shadow: true,
      decisions: allDecisions,
      summary,
      strategies_evaluated: strategies.length,
      elapsed_ms,
      message: 'Shadow evaluation complete - NO trades were executed',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('🌑 SHADOW: Fatal error:', error);
    return new Response(JSON.stringify({ 
      shadow: true,
      error: error.message,
      elapsed_ms: Date.now() - startTime
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
