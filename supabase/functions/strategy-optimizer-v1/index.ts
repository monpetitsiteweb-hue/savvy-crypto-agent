// supabase/functions/strategy-optimizer-v1/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Constants for optimization rules
const MIN_SAMPLES = 30;
const DELTA = 0.05;
const MIN_CONF = 0.30;
const MAX_CONF = 0.90;
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
  optimization_iteration: number;
  metadata: any;
}

interface MetricGroup {
  totalSamples: number;
  weightedSumWinRate: number;
}

interface UpdateRecord {
  strategy_id: string;
  symbol: string;
  prev_min_confidence: number;
  new_min_confidence: number;
  avg_win_rate_pct: number;
  total_sample_count: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Authenticate user
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.error('[strategy-optimizer-v1] Auth failed:', userError);
      return new Response(
        JSON.stringify({ status: 'error', message: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    console.log('[strategy-optimizer-v1] Starting optimization for user:', userId);

    // Step 1: Fetch calibration metrics
    const { data: metricsData, error: metricsError } = await supabaseClient
      .from('calibration_metrics')
      .select('*')
      .eq('user_id', userId)
      .eq('window_days', 30)
      .gte('sample_count', 1);

    if (metricsError) {
      console.error('[strategy-optimizer-v1] Error fetching metrics:', metricsError);
      return new Response(
        JSON.stringify({ status: 'error', message: 'Failed to fetch calibration metrics', details: metricsError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[strategy-optimizer-v1] Fetched metrics rows:', metricsData?.length || 0);

    // Step 2: Group metrics by (strategy_id, symbol)
    const metricGroups = new Map<string, MetricGroup>();

    for (const row of metricsData || []) {
      const metric = row as unknown as CalibrationMetric;
      const winRateNum = metric.win_rate_pct ? parseFloat(metric.win_rate_pct) : null;

      if (winRateNum === null || isNaN(winRateNum)) {
        continue; // Skip rows without valid win_rate_pct
      }

      const key = `${metric.strategy_id}:${metric.symbol}`;
      const existing = metricGroups.get(key) || { totalSamples: 0, weightedSumWinRate: 0 };

      existing.totalSamples += metric.sample_count;
      existing.weightedSumWinRate += winRateNum * metric.sample_count;

      metricGroups.set(key, existing);
    }

    console.log('[strategy-optimizer-v1] Metric groups:', metricGroups.size);

    // Step 3: Fetch existing strategy_parameters
    const { data: paramsData, error: paramsError } = await supabaseClient
      .from('strategy_parameters')
      .select('*')
      .eq('user_id', userId);

    if (paramsError) {
      console.error('[strategy-optimizer-v1] Error fetching strategy_parameters:', paramsError);
      return new Response(
        JSON.stringify({ status: 'error', message: 'Failed to fetch strategy_parameters', details: paramsError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[strategy-optimizer-v1] Fetched strategy_parameters rows:', paramsData?.length || 0);

    // Build map of strategy_parameters by (strategy_id, symbol)
    const paramsMap = new Map<string, StrategyParameter>();
    for (const row of paramsData || []) {
      const param = row as unknown as StrategyParameter;
      const key = `${param.strategy_id}:${param.symbol}`;
      paramsMap.set(key, param);
    }

    // Step 4: Apply optimization rules
    const updatedRows: UpdateRecord[] = [];
    const runId = crypto.randomUUID();
    const runAt = new Date().toISOString();

    for (const [key, group] of metricGroups.entries()) {
      const param = paramsMap.get(key);
      if (!param) {
        continue; // Skip if no strategy_parameters row exists
      }

      if (group.totalSamples < MIN_SAMPLES) {
        continue; // Not enough samples
      }

      const avgWinRate = group.weightedSumWinRate / group.totalSamples;
      const currentMinConf = param.min_confidence ? parseFloat(param.min_confidence) : DEFAULT_MIN_CONF;
      const usedDefaultMinConf = param.min_confidence === null;

      let newMinConf = currentMinConf;

      // Apply rule
      if (avgWinRate < 45) {
        newMinConf = currentMinConf + DELTA;
      } else if (avgWinRate > 60) {
        newMinConf = currentMinConf - DELTA;
      }

      // Clamp
      newMinConf = Math.min(MAX_CONF, Math.max(MIN_CONF, newMinConf));

      // Check if change is meaningful
      if (Math.abs(newMinConf - currentMinConf) < 0.0001) {
        continue; // No change needed
      }

      // Update the row
      const [strategyId, symbol] = key.split(':');

      const updatedMetadata = {
        ...param.metadata,
        last_rule_optimizer_v1: {
          prev_min_confidence: currentMinConf,
          new_min_confidence: newMinConf,
          avg_win_rate_pct: avgWinRate,
          total_sample_count: group.totalSamples,
          used_default_min_confidence: usedDefaultMinConf,
          run_id: runId,
          run_at: runAt,
        },
      };

      const { error: updateError } = await supabaseClient
        .from('strategy_parameters')
        .update({
          min_confidence: newMinConf.toFixed(2),
          optimization_iteration: param.optimization_iteration + 1,
          last_optimizer_run_at: runAt,
          last_updated_by: 'rule_optimizer_v1',
          metadata: updatedMetadata,
        })
        .eq('id', param.id);

      if (updateError) {
        console.error('[strategy-optimizer-v1] Error updating row:', strategyId, symbol, updateError);
        continue; // Log but don't fail the entire run
      }

      updatedRows.push({
        strategy_id: strategyId,
        symbol: symbol,
        prev_min_confidence: currentMinConf,
        new_min_confidence: newMinConf,
        avg_win_rate_pct: avgWinRate,
        total_sample_count: group.totalSamples,
      });
    }

    console.log('[strategy-optimizer-v1] Optimization complete. Updated rows:', updatedRows.length);

    return new Response(
      JSON.stringify({
        status: 'ok',
        user_id: userId,
        run_id: runId,
        updated_rows: updatedRows,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[strategy-optimizer-v1] Unexpected error:', error);
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
