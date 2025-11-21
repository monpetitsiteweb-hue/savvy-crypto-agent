import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OptimizationRequest {
  user_id: string;
  strategy_id: string;
  symbol: string;
  horizon: string;
  time_window?: string;
}

interface CalibrationMetric {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  horizon: string;
  time_window: string;
  confidence_band: string;
  sample_count: number;
  coverage_pct: number;
  win_rate_pct: number;
  median_realized_pnl_pct: number | null;
  mean_realized_pnl_pct: number | null;
  median_mfe_pct: number | null;
  median_mae_pct: number | null;
  tp_hit_rate_pct: number;
  sl_hit_rate_pct: number;
  missed_opportunity_pct: number;
  mean_expectation_error_pct: number | null;
  reliability_correlation: number | null;
  volatility_regime: string | null;
  window_start_ts: string;
  window_end_ts: string;
  window_days: number;
  computed_at: string;
  created_at: string;
  updated_at: string;
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
      console.error('❌ Missing Supabase configuration');
      return new Response(JSON.stringify({ error: 'Missing Supabase configuration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Parse input
    const input: OptimizationRequest = await req.json();
    console.log('📥 OPTIMIZER-V0: Received input:', JSON.stringify(input));

    const { user_id, strategy_id, symbol, horizon, time_window = '30' } = input;

    // Validate required fields
    if (!user_id || !strategy_id || !symbol || !horizon) {
      console.error('❌ Missing required fields:', { user_id, strategy_id, symbol, horizon });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'missing_required_fields',
          required: ['user_id', 'strategy_id', 'symbol', 'horizon']
        }), 
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Fetch most recent calibration metric
    console.log(`🔍 Fetching calibration_metrics for: user_id=${user_id}, strategy_id=${strategy_id}, symbol=${symbol}, horizon=${horizon}, time_window=${time_window}`);
    
    const { data: calibrationRows, error: calibrationError } = await supabase
      .from('calibration_metrics')
      .select('*')
      .eq('user_id', user_id)
      .eq('strategy_id', strategy_id)
      .eq('symbol', symbol)
      .eq('horizon', horizon)
      .eq('time_window', time_window)
      .order('window_end_ts', { ascending: false })
      .limit(1);

    if (calibrationError) {
      console.error('❌ Error fetching calibration_metrics:', calibrationError);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'calibration_fetch_error',
          error: calibrationError.message 
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    if (!calibrationRows || calibrationRows.length === 0) {
      console.log('⚠️ No calibration row found for the given criteria');
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'no_calibration_row' 
        }), 
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const calibration: CalibrationMetric = calibrationRows[0];
    console.log(`✅ Found calibration row: id=${calibration.id}, sample_count=${calibration.sample_count}, win_rate=${calibration.win_rate_pct}%`);

    // Build suggestion
    const basedOnWindow = time_window === '30' ? '30d' : `${time_window}d`;
    
    // Construct reason text summarizing key metrics
    const reason = `Based on ${calibration.sample_count} samples over ${basedOnWindow}: ` +
      `Win Rate ${calibration.win_rate_pct.toFixed(1)}%, ` +
      `Mean PnL ${calibration.mean_realized_pnl_pct?.toFixed(2) ?? 'N/A'}%, ` +
      `TP Hit ${calibration.tp_hit_rate_pct.toFixed(1)}%, ` +
      `SL Hit ${calibration.sl_hit_rate_pct.toFixed(1)}%`;

    // Calculate confidence score (bounded [0.0, 1.0])
    const confidenceScore = Math.max(0.0, Math.min(1.0, calibration.win_rate_pct / 100.0));

    const suggestionPayload = {
      user_id,
      strategy_id,
      symbol,
      horizon,
      suggestion_type: 'review_performance',
      current_value: null,
      suggested_value: null,
      expected_impact_pct: null,
      reason,
      confidence_score: confidenceScore,
      sample_size: calibration.sample_count,
      status: 'pending',
      based_on_window: basedOnWindow,
    };

    console.log('📝 Inserting suggestion:', JSON.stringify(suggestionPayload));

    const { data: insertedSuggestion, error: insertError } = await supabase
      .from('calibration_suggestions')
      .insert(suggestionPayload)
      .select()
      .single();

    if (insertError) {
      console.error('❌ Error inserting suggestion:', insertError);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'suggestion_insert_error',
          error: insertError.message 
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`✅ Suggestion created: id=${insertedSuggestion.id}`);

    return new Response(
      JSON.stringify({ 
        ok: true, 
        suggestion: insertedSuggestion 
      }), 
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return new Response(
      JSON.stringify({ 
        ok: false, 
        reason: 'unexpected_error',
        error: error.message 
      }), 
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
