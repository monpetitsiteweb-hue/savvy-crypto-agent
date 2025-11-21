import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

interface CalibrationMetric {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  horizon: string;
  time_window: string;
  sample_count: number;
  win_rate_pct: number;
  mean_realized_pnl_pct: number | null;
  tp_hit_rate_pct: number;
  sl_hit_rate_pct: number;
  missed_opportunity_pct: number;
  reliability_correlation: number | null;
  window_end_ts: string;
}

interface StrategyParameter {
  user_id: string;
  strategy_id: string;
  symbol: string;
  tp_pct: number;
  sl_pct: number;
  min_confidence: number;
}

interface SuggestionResult {
  suggestion_type: string;
  symbol: string;
  horizon: string;
  action: 'created' | 'updated' | 'skipped';
  reason?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase configuration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    console.log('=== Strategy Optimizer Agent (v0) Started ===');

    // Fetch calibration metrics from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    console.log(`📅 OPTIMIZER: Reading calibration_metrics from 30-day window (since ${thirtyDaysAgo.toISOString()})`);

    const { data: metrics, error: metricsError } = await supabase
      .from('calibration_metrics')
      .select('*')
      .gte('window_end_ts', thirtyDaysAgo.toISOString())
      .gte('sample_count', 30);  // Only consider metrics with sufficient samples

    if (metricsError) {
      throw new Error(`Failed to fetch calibration_metrics: ${metricsError.message}`);
    }

    if (!metrics || metrics.length === 0) {
      console.log('⚠️ OPTIMIZER: No calibration metrics found with sufficient samples');
      return new Response(JSON.stringify({ 
        ok: true, 
        processed_rows: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        message: 'No metrics to process'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`📊 OPTIMIZER: Found ${metrics.length} calibration metrics to analyze`);

    // Fetch all strategy parameters for these users/strategies/symbols
    const uniqueKeys = new Set<string>();
    metrics.forEach((m: CalibrationMetric) => {
      uniqueKeys.add(`${m.user_id}|${m.strategy_id}|${m.symbol}`);
    });

    const { data: parameters, error: paramsError } = await supabase
      .from('strategy_parameters')
      .select('user_id, strategy_id, symbol, tp_pct, sl_pct, min_confidence');

    if (paramsError) {
      throw new Error(`Failed to fetch strategy_parameters: ${paramsError.message}`);
    }

    console.log(`📋 OPTIMIZER: Found ${parameters?.length || 0} strategy parameter records`);

    // Create a lookup map for parameters
    const paramsMap = new Map<string, StrategyParameter>();
    (parameters || []).forEach((p: StrategyParameter) => {
      const key = `${p.user_id}|${p.strategy_id}|${p.symbol}`;
      paramsMap.set(key, p);
    });

    // Process each metric and generate suggestions
    const results: SuggestionResult[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const metric of metrics as CalibrationMetric[]) {
      const key = `${metric.user_id}|${metric.strategy_id}|${metric.symbol}`;
      const params = paramsMap.get(key);

      if (!params) {
        console.log(`⚠️ No strategy parameters found for ${metric.symbol} (${metric.user_id}/${metric.strategy_id})`);
        skipped++;
        continue;
      }

      // Apply heuristic rules
      const suggestions = await applyHeuristics(metric, params, supabase);
      results.push(...suggestions);

      suggestions.forEach(s => {
        if (s.action === 'created') created++;
        else if (s.action === 'updated') updated++;
        else skipped++;
      });
    }

    console.log(`✅ OPTIMIZER: Processed ${metrics.length} metrics → ${created} created, ${updated} updated, ${skipped} skipped`);

    return new Response(JSON.stringify({ 
      ok: true, 
      processed_rows: metrics.length,
      created,
      updated,
      skipped,
      details: results
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ OPTIMIZER ERROR:', error);
    return new Response(JSON.stringify({ 
      ok: false,
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

/**
 * Apply deterministic heuristics to generate suggestions.
 * 
 * Rule 1: Lower TP if win_rate high but pnl low
 * Rule 2: Tighten SL if SL hits too often and pnl < 0
 * Rule 3: Raise min_confidence if reliability is poor
 */
async function applyHeuristics(
  metric: CalibrationMetric, 
  params: StrategyParameter,
  supabase: any
): Promise<SuggestionResult[]> {
  const results: SuggestionResult[] = [];
  const { user_id, strategy_id, symbol, horizon, sample_count, time_window } = metric;
  const { win_rate_pct, mean_realized_pnl_pct, sl_hit_rate_pct, reliability_correlation } = metric;
  const { tp_pct, sl_pct, min_confidence } = params;

  // Rule 1: Lower TP if win_rate high but pnl low
  if (
    sample_count >= 30 &&
    win_rate_pct >= 60 &&
    (mean_realized_pnl_pct ?? 0) >= 0 &&
    (mean_realized_pnl_pct ?? 0) <= 0.3
  ) {
    const suggested_tp = tp_pct * 0.7;
    const confidence = calculateConfidence(sample_count, reliability_correlation);
    
    const result = await upsertSuggestion(supabase, {
      user_id,
      strategy_id,
      symbol,
      horizon,
      suggestion_type: 'tp_pct',
      current_value: tp_pct,
      suggested_value: suggested_tp,
      expected_impact_pct: 10,
      reason: `High win rate (${win_rate_pct.toFixed(1)}%) but low PnL (${(mean_realized_pnl_pct ?? 0).toFixed(2)}%). Suggest lowering TP to lock profits earlier.`,
      confidence_score: confidence,
      sample_size: sample_count,
      based_on_window: time_window,
    });

    results.push({
      suggestion_type: 'tp_pct',
      symbol,
      horizon,
      action: result.action,
      reason: result.reason
    });
  }

  // Rule 2: Tighten SL if SL hits too often and pnl < 0
  if (
    sample_count >= 30 &&
    (mean_realized_pnl_pct ?? 0) < 0 &&
    sl_hit_rate_pct > 40
  ) {
    const suggested_sl = sl_pct * 0.8;
    const confidence = calculateConfidence(sample_count, reliability_correlation);

    const result = await upsertSuggestion(supabase, {
      user_id,
      strategy_id,
      symbol,
      horizon,
      suggestion_type: 'sl_pct',
      current_value: sl_pct,
      suggested_value: suggested_sl,
      expected_impact_pct: 15,
      reason: `High SL hit rate (${sl_hit_rate_pct.toFixed(1)}%) with negative PnL (${(mean_realized_pnl_pct ?? 0).toFixed(2)}%). Suggest tightening SL to reduce losses.`,
      confidence_score: confidence,
      sample_size: sample_count,
      based_on_window: time_window,
    });

    results.push({
      suggestion_type: 'sl_pct',
      symbol,
      horizon,
      action: result.action,
      reason: result.reason
    });
  }

  // Rule 3: Raise min_confidence if reliability is poor
  if (
    sample_count >= 30 &&
    (reliability_correlation ?? 0) < 0.2 &&
    (mean_realized_pnl_pct ?? 0) <= 0
  ) {
    const suggested_confidence = Math.min(min_confidence + 0.05, 0.95);
    const confidence = calculateConfidence(sample_count, reliability_correlation);

    const result = await upsertSuggestion(supabase, {
      user_id,
      strategy_id,
      symbol,
      horizon,
      suggestion_type: 'min_confidence',
      current_value: min_confidence,
      suggested_value: suggested_confidence,
      expected_impact_pct: 5,
      reason: `Low reliability correlation (${(reliability_correlation ?? 0).toFixed(2)}) with weak PnL (${(mean_realized_pnl_pct ?? 0).toFixed(2)}%). Suggest raising confidence threshold.`,
      confidence_score: confidence,
      sample_size: sample_count,
      based_on_window: time_window,
    });

    results.push({
      suggestion_type: 'min_confidence',
      symbol,
      horizon,
      action: result.action,
      reason: result.reason
    });
  }

  return results;
}

/**
 * Calculate confidence score based on sample size and reliability.
 * Returns value between 0.0 and 1.0.
 */
function calculateConfidence(sample_count: number, reliability_correlation: number | null): number {
  // Base confidence from sample size (0.5 at 30 samples, 0.8 at 100+)
  const sampleFactor = Math.min(0.5 + (sample_count - 30) / 140, 0.8);
  
  // Boost from reliability (0 to 0.2 range)
  const reliabilityBoost = Math.max(0, (reliability_correlation ?? 0)) * 0.2;
  
  return Math.min(sampleFactor + reliabilityBoost, 1.0);
}

/**
 * Upsert suggestion with idempotency:
 * - If a pending suggestion exists for this tuple, update it
 * - Otherwise, create a new one
 */
async function upsertSuggestion(
  supabase: any,
  data: {
    user_id: string;
    strategy_id: string;
    symbol: string;
    horizon: string;
    suggestion_type: string;
    current_value: number;
    suggested_value: number;
    expected_impact_pct: number;
    reason: string;
    confidence_score: number;
    sample_size: number;
    based_on_window: string;
  }
): Promise<{ action: 'created' | 'updated' | 'skipped', reason?: string }> {
  // Check for existing pending suggestion with same key
  const { data: existing, error: fetchError } = await supabase
    .from('calibration_suggestions')
    .select('id, status')
    .eq('user_id', data.user_id)
    .eq('strategy_id', data.strategy_id)
    .eq('symbol', data.symbol)
    .eq('horizon', data.horizon)
    .eq('suggestion_type', data.suggestion_type)
    .eq('based_on_window', data.based_on_window)
    .eq('status', 'pending')
    .maybeSingle();

  if (fetchError) {
    console.error(`⚠️ Error checking existing suggestion: ${fetchError.message}`);
    return { action: 'skipped', reason: `DB error: ${fetchError.message}` };
  }

  if (existing) {
    // Update existing suggestion
    const { error: updateError } = await supabase
      .from('calibration_suggestions')
      .update({
        current_value: data.current_value,
        suggested_value: data.suggested_value,
        expected_impact_pct: data.expected_impact_pct,
        reason: data.reason,
        confidence_score: data.confidence_score,
        sample_size: data.sample_size,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (updateError) {
      console.error(`⚠️ Error updating suggestion: ${updateError.message}`);
      return { action: 'skipped', reason: `Update error: ${updateError.message}` };
    }

    console.log(`♻️ Updated existing suggestion ${data.suggestion_type} for ${data.symbol}/${data.horizon}`);
    return { action: 'updated' };
  } else {
    // Create new suggestion
    const { error: insertError } = await supabase
      .from('calibration_suggestions')
      .insert({
        user_id: data.user_id,
        strategy_id: data.strategy_id,
        symbol: data.symbol,
        horizon: data.horizon,
        suggestion_type: data.suggestion_type,
        current_value: data.current_value,
        suggested_value: data.suggested_value,
        expected_impact_pct: data.expected_impact_pct,
        reason: data.reason,
        confidence_score: data.confidence_score,
        sample_size: data.sample_size,
        based_on_window: data.based_on_window,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error(`⚠️ Error inserting suggestion: ${insertError.message}`);
      return { action: 'skipped', reason: `Insert error: ${insertError.message}` };
    }

    console.log(`✨ Created new suggestion ${data.suggestion_type} for ${data.symbol}/${data.horizon}`);
    return { action: 'created' };
  }
}
