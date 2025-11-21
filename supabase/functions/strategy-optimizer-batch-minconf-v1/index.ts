import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface RequestInput {
  user_id: string;
  strategy_id: string;
  symbols?: string[];
  horizon?: string;
  time_window?: string;
}

interface SymbolResult {
  symbol: string;
  status: 'applied' | 'error_v0' | 'error_agent_v1' | 'error_autotune_v1' | 'no_calibration';
  suggestion_id?: string;
  new_min_confidence?: number;
  prev_min_confidence?: number;
  expected_impact_pct?: number;
  reason?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    const input: RequestInput = await req.json();
    console.log('[batch-minconf-v1] Input:', JSON.stringify(input));

    // Validate required fields
    if (!input.user_id || !input.strategy_id) {
      return new Response(
        JSON.stringify({ ok: false, reason: 'missing_required_fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const horizon = input.horizon || '24h';
    const timeWindow = input.time_window || '30';

    // Determine symbols to process
    let symbols: string[] = [];
    
    if (input.symbols && input.symbols.length > 0) {
      symbols = input.symbols;
      console.log(`[batch-minconf-v1] Using provided symbols: ${symbols.join(', ')}`);
    } else {
      // Fetch symbols from calibration_metrics
      const { data: metricsData, error: metricsError } = await supabase
        .from('calibration_metrics')
        .select('symbol')
        .eq('user_id', input.user_id)
        .eq('strategy_id', input.strategy_id)
        .eq('time_window', timeWindow)
        .eq('horizon', horizon)
        .gte('sample_count', 3);

      if (metricsError) {
        console.error('[batch-minconf-v1] Error fetching calibration_metrics:', metricsError);
        throw metricsError;
      }

      if (!metricsData || metricsData.length === 0) {
        return new Response(
          JSON.stringify({ ok: false, reason: 'no_symbols_found_for_calibration' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get distinct symbols
      const uniqueSymbols = [...new Set(metricsData.map(m => m.symbol))];
      symbols = uniqueSymbols.sort();
      console.log(`[batch-minconf-v1] Derived symbols from calibration_metrics: ${symbols.join(', ')}`);
    }

    // Process each symbol
    const results: SymbolResult[] = [];

    for (const symbol of symbols) {
      console.log(`[batch-minconf-v1] Processing symbol: ${symbol}`);
      
      try {
        // Step 1: Call strategy-optimizer-v0
        const v0Body = {
          user_id: input.user_id,
          strategy_id: input.strategy_id,
          symbol: symbol,
          horizon: horizon,
          time_window: timeWindow
        };

        console.log(`[batch-minconf-v1] Calling strategy-optimizer-v0 for ${symbol}`);
        const v0Response = await fetch(
          `${SUPABASE_URL}/functions/v1/strategy-optimizer-v0`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(v0Body)
          }
        );

        const v0Data = await v0Response.json();
        console.log(`[batch-minconf-v1] v0 response for ${symbol}:`, JSON.stringify(v0Data));

        if (!v0Data.ok || !v0Data.suggestion?.id) {
          results.push({
            symbol: symbol,
            status: 'error_v0',
            reason: v0Data.reason || 'strategy-optimizer-v0 failed'
          });
          continue;
        }

        const suggestionId = v0Data.suggestion.id;

        // Step 2: Call strategy-optimizer-agent-v1
        console.log(`[batch-minconf-v1] Calling strategy-optimizer-agent-v1 for ${symbol}`);
        const agentResponse = await fetch(
          `${SUPABASE_URL}/functions/v1/strategy-optimizer-agent-v1`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ suggestion_id: suggestionId })
          }
        );

        const agentData = await agentResponse.json();
        console.log(`[batch-minconf-v1] agent-v1 response for ${symbol}:`, JSON.stringify(agentData));

        if (!agentData.ok) {
          results.push({
            symbol: symbol,
            status: 'error_agent_v1',
            suggestion_id: suggestionId,
            reason: agentData.reason || 'strategy-optimizer-agent-v1 failed'
          });
          continue;
        }

        // Step 3: Call strategy-optimizer-autotune-v1
        console.log(`[batch-minconf-v1] Calling strategy-optimizer-autotune-v1 for ${symbol}`);
        const autotuneResponse = await fetch(
          `${SUPABASE_URL}/functions/v1/strategy-optimizer-autotune-v1`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ suggestion_id: suggestionId })
          }
        );

        const autotuneData = await autotuneResponse.json();
        console.log(`[batch-minconf-v1] autotune-v1 response for ${symbol}:`, JSON.stringify(autotuneData));

        if (!autotuneData.ok) {
          results.push({
            symbol: symbol,
            status: 'error_autotune_v1',
            suggestion_id: suggestionId,
            reason: autotuneData.reason || 'strategy-optimizer-autotune-v1 failed'
          });
          continue;
        }

        // Extract results
        const strategyParams = autotuneData.strategy_parameters;
        const newMinConfidence = strategyParams?.min_confidence;
        
        // Try to extract previous min_confidence from optimizer_history
        let prevMinConfidence: number | undefined;
        const optimizerHistory = strategyParams?.metadata?.optimizer_history;
        if (optimizerHistory && Array.isArray(optimizerHistory) && optimizerHistory.length > 0) {
          const lastEntry = optimizerHistory[optimizerHistory.length - 1];
          prevMinConfidence = lastEntry?.old;
        }

        const expectedImpact = autotuneData.suggestion?.expected_impact_pct;

        results.push({
          symbol: symbol,
          status: 'applied',
          suggestion_id: suggestionId,
          new_min_confidence: newMinConfidence,
          prev_min_confidence: prevMinConfidence,
          expected_impact_pct: expectedImpact
        });

      } catch (error) {
        console.error(`[batch-minconf-v1] Error processing ${symbol}:`, error);
        results.push({
          symbol: symbol,
          status: 'error_v0',
          reason: error.message || 'unexpected error during processing'
        });
      }
    }

    // Return summary
    const response = {
      ok: true,
      user_id: input.user_id,
      strategy_id: input.strategy_id,
      horizon: horizon,
      time_window: timeWindow,
      symbols_count: symbols.length,
      results: results
    };

    console.log('[batch-minconf-v1] Final response:', JSON.stringify(response));

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[batch-minconf-v1] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        ok: false,
        reason: 'unexpected_error',
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
