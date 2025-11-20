// supabase/functions/ai-strategy-optimizer/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Constants for optimization rules
const MIN_SAMPLES = 30;
const CONF_MIN = 0.30;
const CONF_MAX = 0.90;
const MAX_STEP = 0.10;
const DEFAULT_MIN_CONF = 0.70;

interface CalibrationMetric {
  strategy_id: string;
  symbol: string;
  sample_count: number;
  coverage_pct: string | null;
  win_rate_pct: string | null;
  mean_realized_pnl_pct: string | null;
  tp_hit_rate_pct: string | null;
  sl_hit_rate_pct: string | null;
}

interface StrategyParameter {
  id: string;
  strategy_id: string;
  symbol: string;
  min_confidence: string | null;
  tp_pct: string | null;
  sl_pct: string | null;
  optimization_iteration: number;
  metadata: any;
}

interface MetricGroup {
  totalSamples: number;
  weightedSumWinRate: number;
  weightedSumMeanPnl: number;
  weightedSumTpHitRate: number;
  weightedSumSlHitRate: number;
}

interface AIEntry {
  strategy_id: string;
  symbol: string;
  total_sample_count: number;
  avg_win_rate_pct: number;
  avg_mean_realized_pnl_pct: number | null;
  avg_tp_hit_rate_pct: number | null;
  avg_sl_hit_rate_pct: number | null;
  current_params: {
    min_confidence: number;
    tp_pct: number | null;
    sl_pct: number | null;
  };
}

interface AISuggestion {
  strategy_id: string;
  symbol: string;
  new_min_confidence: number;
  rationale: string;
}

interface UpdateRecord {
  strategy_id: string;
  symbol: string;
  prev_min_confidence: number;
  new_min_confidence: number;
  avg_win_rate_pct: number;
  total_sample_count: number;
}

interface DiscardedSuggestion {
  strategy_id: string;
  symbol: string;
  reason: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Extract JWT from Authorization header ("Bearer <token>")
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : authHeader.trim();

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          // Keep passing the Authorization header for RLS, but
          // use the explicit JWT when calling auth.getUser(jwt)
          headers: { Authorization: authHeader },
        },
      }
    );

    // Authenticate user using the provided JWT
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(jwt);

    if (userError || !user) {
      console.error('[ai-strategy-optimizer] Auth failed:', userError);
      return new Response(
        JSON.stringify({ status: 'error', message: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    console.log('[ai-strategy-optimizer] Starting AI optimization for user:', userId);

    // Step 1: Fetch calibration metrics
    const { data: metricsData, error: metricsError } = await supabaseClient
      .from('calibration_metrics')
      .select('*')
      .eq('user_id', userId)
      .eq('window_days', 30)
      .gte('sample_count', 1);

    if (metricsError) {
      console.error('[ai-strategy-optimizer] Error fetching metrics:', metricsError);
      return new Response(
        JSON.stringify({ status: 'error', message: 'Failed to fetch calibration metrics', details: metricsError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[ai-strategy-optimizer] Fetched metrics rows:', metricsData?.length || 0);

    // Step 2: Group metrics by (strategy_id, symbol)
    const metricGroups = new Map<string, MetricGroup>();

    for (const row of metricsData || []) {
      const metric = row as unknown as CalibrationMetric;
      const winRateNum = metric.win_rate_pct ? parseFloat(metric.win_rate_pct) : null;

      if (winRateNum === null || isNaN(winRateNum)) {
        continue; // Skip rows without valid win_rate_pct
      }

      const meanPnlNum = metric.mean_realized_pnl_pct ? parseFloat(metric.mean_realized_pnl_pct) : 0;
      const tpHitNum = metric.tp_hit_rate_pct ? parseFloat(metric.tp_hit_rate_pct) : 0;
      const slHitNum = metric.sl_hit_rate_pct ? parseFloat(metric.sl_hit_rate_pct) : 0;

      const key = `${metric.strategy_id}:${metric.symbol}`;
      const existing = metricGroups.get(key) || {
        totalSamples: 0,
        weightedSumWinRate: 0,
        weightedSumMeanPnl: 0,
        weightedSumTpHitRate: 0,
        weightedSumSlHitRate: 0,
      };

      existing.totalSamples += metric.sample_count;
      existing.weightedSumWinRate += winRateNum * metric.sample_count;
      existing.weightedSumMeanPnl += meanPnlNum * metric.sample_count;
      existing.weightedSumTpHitRate += tpHitNum * metric.sample_count;
      existing.weightedSumSlHitRate += slHitNum * metric.sample_count;

      metricGroups.set(key, existing);
    }

    console.log('[ai-strategy-optimizer] Metric groups:', metricGroups.size);

    // Step 3: Fetch existing strategy_parameters
    const { data: paramsData, error: paramsError } = await supabaseClient
      .from('strategy_parameters')
      .select('*')
      .eq('user_id', userId);

    if (paramsError) {
      console.error('[ai-strategy-optimizer] Error fetching strategy_parameters:', paramsError);
      return new Response(
        JSON.stringify({ status: 'error', message: 'Failed to fetch strategy_parameters', details: paramsError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[ai-strategy-optimizer] Fetched strategy_parameters rows:', paramsData?.length || 0);

    // Build map of strategy_parameters by (strategy_id, symbol)
    const paramsMap = new Map<string, StrategyParameter>();
    for (const row of paramsData || []) {
      const param = row as unknown as StrategyParameter;
      const key = `${param.strategy_id}:${param.symbol}`;
      paramsMap.set(key, param);
    }

    // Step 4: Build AI input payload
    const entries: AIEntry[] = [];

    for (const [key, group] of metricGroups.entries()) {
      const param = paramsMap.get(key);
      if (!param) {
        continue; // Skip if no strategy_parameters row exists
      }

      if (group.totalSamples < MIN_SAMPLES) {
        continue; // Not enough samples
      }

      const avgWinRate = group.weightedSumWinRate / group.totalSamples;
      const avgMeanPnl = group.weightedSumMeanPnl / group.totalSamples;
      const avgTpHit = group.weightedSumTpHitRate / group.totalSamples;
      const avgSlHit = group.weightedSumSlHitRate / group.totalSamples;

      const currentMinConf = param.min_confidence ? parseFloat(param.min_confidence) : DEFAULT_MIN_CONF;
      const tpPctNum = param.tp_pct ? parseFloat(param.tp_pct) : null;
      const slPctNum = param.sl_pct ? parseFloat(param.sl_pct) : null;

      const [strategyId, symbol] = key.split(':');

      entries.push({
        strategy_id: strategyId,
        symbol: symbol,
        total_sample_count: group.totalSamples,
        avg_win_rate_pct: avgWinRate,
        avg_mean_realized_pnl_pct: avgMeanPnl,
        avg_tp_hit_rate_pct: avgTpHit,
        avg_sl_hit_rate_pct: avgSlHit,
        current_params: {
          min_confidence: currentMinConf,
          tp_pct: tpPctNum,
          sl_pct: slPctNum,
        },
      });
    }

    console.log('[ai-strategy-optimizer] Built AI input with', entries.length, 'entries');

    if (entries.length === 0) {
      console.log('[ai-strategy-optimizer] No entries to optimize');
      return new Response(
        JSON.stringify({
          status: 'ok',
          user_id: userId,
          run_id: crypto.randomUUID(),
          updated_rows: [],
          discarded_suggestions: [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payloadForAI = {
      constraints: {
        min_confidence: {
          min: CONF_MIN,
          max: CONF_MAX,
          max_step: MAX_STEP,
        },
      },
      entries,
    };

    // Step 5: Call OpenAI
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      console.error('[ai-strategy-optimizer] OPENAI_API_KEY not configured');
      return new Response(
        JSON.stringify({ status: 'error', message: 'OpenAI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `You are an AI strategy optimizer for a crypto trading engine. You receive aggregated performance metrics for different (strategy_id, symbol) pairs and their current min_confidence thresholds. Your job is to propose new min_confidence values within strict numeric bounds.

Constraints:
- You may only change min_confidence.
- For each entry, new_min_confidence must satisfy: ${CONF_MIN} ≤ value ≤ ${CONF_MAX}.
- You must not change min_confidence by more than ${MAX_STEP} (absolute difference) per run.
- If performance is acceptable or you are unsure, keep the current value.
- Prefer small, incremental adjustments.

Output strictly valid JSON with this shape:
{ "suggestions": [ { "strategy_id": string, "symbol": string, "new_min_confidence": number, "rationale": string } ] }

Do not include comments or extra keys. Do not wrap JSON in markdown.
If you decide not to change any entry, return { "suggestions": [] }.`;

    console.log('[ai-strategy-optimizer] Calling OpenAI...');

    let aiResponse: { suggestions: AISuggestion[] };
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(payloadForAI) },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[ai-strategy-optimizer] OpenAI API error:', response.status, errorText);
        return new Response(
          JSON.stringify({ status: 'error', message: 'OpenAI API call failed', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        console.error('[ai-strategy-optimizer] No content in OpenAI response');
        return new Response(
          JSON.stringify({ status: 'error', message: 'No content from OpenAI' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[ai-strategy-optimizer] OpenAI response:', content);

      // Parse AI response
      aiResponse = JSON.parse(content);

      if (!aiResponse.suggestions || !Array.isArray(aiResponse.suggestions)) {
        console.error('[ai-strategy-optimizer] Invalid AI response format');
        return new Response(
          JSON.stringify({ status: 'error', message: 'Invalid AI response format' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (error) {
      console.error('[ai-strategy-optimizer] Error calling OpenAI:', error);
      return new Response(
        JSON.stringify({
          status: 'error',
          message: 'AI optimization failed',
          details: error instanceof Error ? error.message : String(error),
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 6: Validate suggestions
    const validSuggestions: AISuggestion[] = [];
    const discardedSuggestions: DiscardedSuggestion[] = [];

    for (const suggestion of aiResponse.suggestions) {
      const key = `${suggestion.strategy_id}:${suggestion.symbol}`;
      const param = paramsMap.get(key);
      const entry = entries.find(e => e.strategy_id === suggestion.strategy_id && e.symbol === suggestion.symbol);

      if (!param || !entry) {
        console.warn('[ai-strategy-optimizer] Suggestion for unknown key:', key);
        discardedSuggestions.push({
          strategy_id: suggestion.strategy_id,
          symbol: suggestion.symbol,
          reason: 'unknown_key',
        });
        continue;
      }

      if (typeof suggestion.new_min_confidence !== 'number') {
        console.warn('[ai-strategy-optimizer] Invalid new_min_confidence type:', suggestion);
        discardedSuggestions.push({
          strategy_id: suggestion.strategy_id,
          symbol: suggestion.symbol,
          reason: 'invalid_type',
        });
        continue;
      }

      const currentMinConf = entry.current_params.min_confidence;
      const newMinConf = suggestion.new_min_confidence;
      const diff = Math.abs(newMinConf - currentMinConf);

      // Enforce bounds
      if (newMinConf < CONF_MIN || newMinConf > CONF_MAX) {
        console.warn('[ai-strategy-optimizer] Suggestion out of bounds:', suggestion);
        discardedSuggestions.push({
          strategy_id: suggestion.strategy_id,
          symbol: suggestion.symbol,
          reason: 'out_of_bounds',
        });
        continue;
      }

      // Enforce max step
      if (diff > MAX_STEP + 1e-6) {
        console.warn('[ai-strategy-optimizer] Suggestion exceeds max step:', suggestion);
        discardedSuggestions.push({
          strategy_id: suggestion.strategy_id,
          symbol: suggestion.symbol,
          reason: 'exceeded_max_step',
        });
        continue;
      }

      // Skip if no meaningful change
      if (diff < 0.0001) {
        console.log('[ai-strategy-optimizer] No meaningful change for:', key);
        continue;
      }

      validSuggestions.push(suggestion);
    }

    console.log('[ai-strategy-optimizer] Valid suggestions:', validSuggestions.length);
    console.log('[ai-strategy-optimizer] Discarded suggestions:', discardedSuggestions.length);

    // Step 7: Apply valid suggestions
    const updatedRows: UpdateRecord[] = [];
    const runId = crypto.randomUUID();
    const runAt = new Date().toISOString();

    for (const suggestion of validSuggestions) {
      const key = `${suggestion.strategy_id}:${suggestion.symbol}`;
      const param = paramsMap.get(key);
      const entry = entries.find(e => e.strategy_id === suggestion.strategy_id && e.symbol === suggestion.symbol);

      if (!param || !entry) {
        continue;
      }

      const prevMinConf = entry.current_params.min_confidence;
      const newMinConf = suggestion.new_min_confidence;

      const updatedMetadata = {
        ...param.metadata,
        last_ai_optimizer_v1: {
          prev_min_confidence: prevMinConf,
          new_min_confidence: newMinConf,
          avg_win_rate_pct: entry.avg_win_rate_pct,
          total_sample_count: entry.total_sample_count,
          used_default_min_confidence: param.min_confidence === null,
          constraints: { min: CONF_MIN, max: CONF_MAX, max_step: MAX_STEP },
          run_id: runId,
          run_at: runAt,
          rationale: suggestion.rationale,
        },
      };

      const { error: updateError } = await supabaseClient
        .from('strategy_parameters')
        .update({
          min_confidence: newMinConf.toFixed(2),
          optimization_iteration: param.optimization_iteration + 1,
          last_optimizer_run_at: runAt,
          last_updated_by: 'ai_optimizer_v1',
          metadata: updatedMetadata,
        })
        .eq('id', param.id);

      if (updateError) {
        console.error('[ai-strategy-optimizer] Error updating row:', suggestion.strategy_id, suggestion.symbol, updateError);
        continue;
      }

      updatedRows.push({
        strategy_id: suggestion.strategy_id,
        symbol: suggestion.symbol,
        prev_min_confidence: prevMinConf,
        new_min_confidence: newMinConf,
        avg_win_rate_pct: entry.avg_win_rate_pct,
        total_sample_count: entry.total_sample_count,
      });
    }

    console.log('[ai-strategy-optimizer] AI optimization complete. Updated rows:', updatedRows.length);

    return new Response(
      JSON.stringify({
        status: 'ok',
        user_id: userId,
        run_id: runId,
        updated_rows: updatedRows,
        discarded_suggestions: discardedSuggestions,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[ai-strategy-optimizer] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        status: 'error',
        message: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
