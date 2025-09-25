import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    // Initialize Supabase client with service role for writes
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase configuration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Parse input - check both URL params and body for scheduled flag
    const url = new URL(req.url);
    const isScheduledFromQuery = url.searchParams.get('scheduled') === 'true';
    const body = await req.json().catch(() => ({}));
    const isScheduledFromBody = body?.scheduled === true;
    const isScheduled = isScheduledFromQuery || isScheduledFromBody;

    // Security: Validate cron secret for scheduled calls
    if (isScheduled) {
      const cronSecret = Deno.env.get('CRON_SECRET');
      const headerSecret = req.headers.get('x-cron-secret');
      
      if (!cronSecret || headerSecret !== cronSecret) {
        return new Response(JSON.stringify({ error: 'Unauthorized (cron secret mismatch)' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    console.log('=== Calibration Aggregator Started ===');
    console.log(`Scheduled: ${isScheduled}`);

    // Query last 30 days from decision_outcomes directly
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: outcomes, error: outcomesError } = await supabase
      .from('decision_outcomes')
      .select('user_id, strategy_id, symbol, horizon, confidence_band, realized_pnl_pct, hit_tp, hit_sl, decision_ts')
      .gte('decision_ts', thirtyDaysAgo.toISOString())
      .order('decision_ts', { ascending: false });

    if (outcomesError) {
      throw new Error(`Failed to fetch decision outcomes: ${outcomesError.message}`);
    }

    // Define confidence bands
    const confidenceBands = [
      { min: 0.50, max: 0.60, label: '[0.50-0.60)' },
      { min: 0.60, max: 0.70, label: '[0.60-0.70)' },
      { min: 0.70, max: 0.80, label: '[0.70-0.80)' },
      { min: 0.80, max: 0.90, label: '[0.80-0.90)' },
      { min: 0.90, max: 1.00, label: '[0.90-1.00]' }
    ];

    // Aggregate in memory by (user_id, strategy_id, symbol, horizon, confidence_band)
    const aggregates = new Map<string, {
      user_id: string;
      strategy_id: string;
      symbol: string;
      horizon: string;
      confidence_band: string;
      outcomes: any[];
    }>();

    for (const outcome of outcomes || []) {
      // Skip if missing required fields
      if (!outcome.user_id || !outcome.strategy_id || !outcome.symbol || !outcome.horizon || !outcome.confidence_band) {
        continue;
      }

      // Create aggregate key
      const key = `${outcome.user_id}-${outcome.strategy_id}-${outcome.symbol}-${outcome.horizon}-${outcome.confidence_band}`;
      
      if (!aggregates.has(key)) {
        aggregates.set(key, {
          user_id: outcome.user_id,
          strategy_id: outcome.strategy_id,
          symbol: outcome.symbol,
          horizon: outcome.horizon,
          confidence_band: outcome.confidence_band,
          outcomes: []
        });
      }
      
      aggregates.get(key)!.outcomes.push(outcome);
    }

    console.log(`Processing ${aggregates.size} aggregates from ${outcomes?.length || 0} outcomes`);

    // Calculate metrics and prepare upserts
    const metricsToUpsert = [];
    const now = new Date();

    for (const [key, aggregate] of aggregates) {
      const { outcomes: groupOutcomes } = aggregate;
      
      // Sample count
      const sampleCount = groupOutcomes.length;
      
      // Filter out non-finite PnL values (guardrail)
      const validPnlOutcomes = groupOutcomes.filter(o => 
        o.realized_pnl_pct != null && 
        Number.isFinite(o.realized_pnl_pct)
      );
      
      // Win rate calculation (clamp to [0,1] before converting to percent)
      const winningOutcomes = validPnlOutcomes.filter(o => o.realized_pnl_pct > 0);
      const winRateRatio = sampleCount > 0 ? winningOutcomes.length / sampleCount : 0;
      const winRatePct = Math.round(Math.max(0, Math.min(1, winRateRatio)) * 100 * 100) / 100; // Clamp and round to 2 decimals
      
      // Mean realized PnL calculation (2 decimals)
      const meanPnlPct = validPnlOutcomes.length > 0 
        ? validPnlOutcomes.reduce((sum, o) => sum + o.realized_pnl_pct, 0) / validPnlOutcomes.length
        : 0;
      const meanRealizedPnlPct = Math.round(meanPnlPct * 100) / 100;
      
      // TP hit rate calculation (clamp to [0,1] before converting to percent)
      const tpHits = groupOutcomes.filter(o => o.hit_tp === true).length;
      const tpHitRateRatio = sampleCount > 0 ? tpHits / sampleCount : 0;
      const tpHitRatePct = Math.round(Math.max(0, Math.min(1, tpHitRateRatio)) * 100 * 100) / 100;
      
      // SL hit rate calculation (clamp to [0,1] before converting to percent)
      const slHits = groupOutcomes.filter(o => o.hit_sl === true).length;
      const slHitRateRatio = sampleCount > 0 ? slHits / sampleCount : 0;
      const slHitRatePct = Math.round(Math.max(0, Math.min(1, slHitRateRatio)) * 100 * 100) / 100;

      metricsToUpsert.push({
        user_id: aggregate.user_id,
        strategy_id: aggregate.strategy_id,
        symbol: aggregate.symbol,
        horizon: aggregate.horizon,
        confidence_band: aggregate.confidence_band,
        window_days: 30,
        sample_count: sampleCount,
        win_rate_pct: winRatePct,
        mean_realized_pnl_pct: meanRealizedPnlPct,
        tp_hit_rate_pct: tpHitRatePct,
        sl_hit_rate_pct: slHitRatePct,
        computed_at: now.toISOString(),
        // Set defaults for required fields
        coverage_pct: 0,
        missed_opportunity_pct: 0
      });
    }

    // Upsert all metrics
    if (metricsToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from('calibration_metrics')
        .upsert(metricsToUpsert, {
          onConflict: 'user_id,strategy_id,symbol,horizon,confidence_band,window_days',
          ignoreDuplicates: false
        });

      if (upsertError) {
        throw new Error(`Failed to upsert calibration metrics: ${upsertError.message}`);
      }
    }

    console.log(`✅ Upserted ${metricsToUpsert.length} calibration metrics`);
    console.log('=== Calibration Aggregation Complete ===');

    // Return success response
    return new Response(JSON.stringify({ 
      ok: true, 
      scheduled: isScheduled 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in calibration aggregator:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});