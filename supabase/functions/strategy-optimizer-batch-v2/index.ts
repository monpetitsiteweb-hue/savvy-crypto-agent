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
  suggestion_types?: string[];
}

interface SymbolTypeResult {
  symbol: string;
  suggestion_type: string;
  status: 'applied' | 'error_v2' | 'error_agent_v2' | 'error_autotune_v2' | 'not_eligible';
  suggestion_id?: string;
  prev_value?: number;
  new_value?: number;
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
    console.log('[batch-v2] Input:', JSON.stringify(input));

    // Validate required fields
    if (!input.user_id || !input.strategy_id) {
      return new Response(
        JSON.stringify({ ok: false, reason: 'missing_required_fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const horizon = input.horizon || '4h';
    const timeWindow = input.time_window || '30';
    const suggestionTypes = input.suggestion_types || ['confidence_threshold', 'tp_pct', 'sl_pct', 'technical_weight', 'ai_weight'];

    console.log(`[batch-v2] Horizon: ${horizon}, Time Window: ${timeWindow}, Types: ${suggestionTypes.join(', ')}`);

    // Determine symbols
    let symbols: string[] = [];
    
    if (input.symbols && input.symbols.length > 0) {
      symbols = input.symbols;
      console.log(`[batch-v2] Using provided symbols: ${symbols.join(', ')}`);
    } else {
      const { data: metricsData, error: metricsError } = await supabase
        .from('calibration_metrics')
        .select('symbol')
        .eq('user_id', input.user_id)
        .eq('strategy_id', input.strategy_id)
        .eq('time_window', timeWindow)
        .eq('horizon', horizon)
        .gte('sample_count', 3);

      if (metricsError) {
        console.error('[batch-v2] Error fetching calibration_metrics:', metricsError);
        throw metricsError;
      }

      if (!metricsData || metricsData.length === 0) {
        return new Response(
          JSON.stringify({ ok: false, reason: 'no_symbols_found_for_calibration' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const uniqueSymbols = [...new Set(metricsData.map(m => m.symbol))];
      symbols = uniqueSymbols.sort();
      console.log(`[batch-v2] Derived symbols: ${symbols.join(', ')}`);
    }

    // Process each symbol
    const results: SymbolTypeResult[] = [];

    for (const symbol of symbols) {
      console.log(`[batch-v2] ========== Processing symbol: ${symbol} ==========`);
      
      try {
        // Step 1: Call strategy-optimizer-v2
        const v2Body = {
          user_id: input.user_id,
          strategy_id: input.strategy_id,
          symbol: symbol,
          horizon: horizon,
          time_window: timeWindow,
          suggestion_types: suggestionTypes
        };

        console.log(`[batch-v2] Calling strategy-optimizer-v2 for ${symbol}`);
        const v2Response = await fetch(
          `${SUPABASE_URL}/functions/v1/strategy-optimizer-v2`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(v2Body)
          }
        );

        const v2Data = await v2Response.json();
        console.log(`[batch-v2] v2 response for ${symbol}:`, JSON.stringify(v2Data));

        if (!v2Data.ok || !v2Data.suggestions || v2Data.suggestions.length === 0) {
          // No suggestions generated
          const reason = v2Data.reason || v2Data.details || 'No suggestions generated';
          for (const type of suggestionTypes) {
            results.push({
              symbol: symbol,
              suggestion_type: type,
              status: 'error_v2',
              reason: reason
            });
          }
          continue;
        }

        // Process each suggestion
        for (const suggestion of v2Data.suggestions) {
          const suggestionId = suggestion.id;
          const suggestionType = suggestion.suggestion_type;

          console.log(`[batch-v2] Processing ${symbol} / ${suggestionType}`);

          try {
            // Step 2: Call strategy-optimizer-agent-v2
            console.log(`[batch-v2] Calling agent-v2 for ${symbol}/${suggestionType}`);
            const agentResponse = await fetch(
              `${SUPABASE_URL}/functions/v1/strategy-optimizer-agent-v2`,
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
            console.log(`[batch-v2] agent-v2 response for ${symbol}/${suggestionType}:`, JSON.stringify(agentData));

            if (!agentData.ok) {
              results.push({
                symbol: symbol,
                suggestion_type: suggestionType,
                status: 'error_agent_v2',
                suggestion_id: suggestionId,
                reason: agentData.reason || 'agent-v2 failed'
              });
              continue;
            }

            // Step 3: Call strategy-optimizer-autotune-v2
            console.log(`[batch-v2] Calling autotune-v2 for ${symbol}/${suggestionType}`);
            const autotuneResponse = await fetch(
              `${SUPABASE_URL}/functions/v1/strategy-optimizer-autotune-v2`,
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
            console.log(`[batch-v2] autotune-v2 response for ${symbol}/${suggestionType}:`, JSON.stringify(autotuneData));

            if (!autotuneData.ok) {
              // Not eligible or error
              results.push({
                symbol: symbol,
                suggestion_type: suggestionType,
                status: autotuneData.reason === 'not_eligible_for_autotune' ? 'not_eligible' : 'error_autotune_v2',
                suggestion_id: suggestionId,
                reason: autotuneData.reason || 'autotune-v2 failed'
              });
              continue;
            }

            // Extract results
            const strategyParams = autotuneData.strategy_parameters;
            const parameterColumn = getParameterColumn(suggestionType);
            const newValue = strategyParams?.[parameterColumn];
            
            let prevValue: number | undefined;
            const optimizerHistory = strategyParams?.metadata?.optimizer_history;
            if (optimizerHistory && Array.isArray(optimizerHistory) && optimizerHistory.length > 0) {
              const lastEntry = optimizerHistory[optimizerHistory.length - 1];
              if (lastEntry?.parameter === parameterColumn) {
                prevValue = lastEntry?.old;
              }
            }

            const expectedImpact = autotuneData.suggestion?.expected_impact_pct;

            results.push({
              symbol: symbol,
              suggestion_type: suggestionType,
              status: 'applied',
              suggestion_id: suggestionId,
              new_value: newValue,
              prev_value: prevValue,
              expected_impact_pct: expectedImpact
            });

          } catch (error) {
            console.error(`[batch-v2] Error processing ${symbol}/${suggestionType}:`, error);
            results.push({
              symbol: symbol,
              suggestion_type: suggestionType,
              status: 'error_v2',
              reason: error.message || 'unexpected error'
            });
          }
        }

      } catch (error) {
        console.error(`[batch-v2] Error processing ${symbol}:`, error);
        for (const type of suggestionTypes) {
          results.push({
            symbol: symbol,
            suggestion_type: type,
            status: 'error_v2',
            reason: error.message || 'unexpected error during symbol processing'
          });
        }
      }
    }

    // Return summary
    const response = {
      ok: true,
      user_id: input.user_id,
      strategy_id: input.strategy_id,
      horizon: horizon,
      time_window: timeWindow,
      suggestion_types: suggestionTypes,
      symbols_count: symbols.length,
      results: results
    };

    console.log('[batch-v2] Final response summary:', {
      symbols_count: response.symbols_count,
      results_count: results.length,
      applied: results.filter(r => r.status === 'applied').length,
      not_eligible: results.filter(r => r.status === 'not_eligible').length,
      errors: results.filter(r => r.status.startsWith('error')).length
    });

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[batch-v2] Unexpected error:', error);
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

function getParameterColumn(suggestionType: string): string {
  switch (suggestionType) {
    case 'confidence_threshold': return 'min_confidence';
    case 'tp_pct': return 'tp_pct';
    case 'sl_pct': return 'sl_pct';
    case 'technical_weight': return 'technical_weight';
    case 'ai_weight': return 'ai_weight';
    default: return 'min_confidence';
  }
}
