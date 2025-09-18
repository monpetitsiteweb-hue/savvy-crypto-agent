import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== Calibration Aggregator Started ===');
    const body = await req.json().catch(() => ({}));
    
    // Use the already-parsed body for scheduled detection
    const isScheduled = body?.scheduled === true;
    const hdrSecret = req.headers.get('x-cron-secret') ?? '';

    // Note: Some projects don't expose the `vault` schema via PostgREST.
    // To avoid 500s, we fallback to the CRON_SECRET env if vault isn't reachable.

    // --- Scheduled-call auth (dual-source: vault -> env) ---
    if (isScheduled) {
      let expected = '';

      // 1) Try vault (preferred)
      const { data: secretRow, error: vaultErr } = await supabase
        .from('vault.decrypted_secrets') // schema-qualified; may fail if schema not exposed by PostgREST
        .select('decrypted_secret')
        .eq('name', 'CRON_SECRET')
        .maybeSingle();

      if (secretRow?.decrypted_secret) {
        expected = secretRow.decrypted_secret;
      } else {
        console.warn('Vault lookup unavailable, falling back to env CRON_SECRET', vaultErr?.message ?? '');
      }

      // 2) Fallback to env
      if (!expected) {
        expected = Deno.env.get('CRON_SECRET') ?? '';
      }

      // 3) If still empty, this is a server misconfig (no secret source available)
      if (!expected) {
        console.error('No cron secret available (vault+env both unavailable)');
        return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 4) Compare header
      if (hdrSecret !== expected) {
        console.error('Invalid or missing cron secret');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    // --- end scheduled auth block ---

    // Define horizons and confidence bands
    const horizons = ['15m', '1h', '4h', '24h'];
    const confidenceBands = [
      { min: 0.50, max: 0.60, label: '[0.50-0.60)' },
      { min: 0.60, max: 0.70, label: '[0.60-0.70)' },
      { min: 0.70, max: 0.80, label: '[0.70-0.80)' },
      { min: 0.80, max: 0.90, label: '[0.80-0.90)' },
      { min: 0.90, max: 1.00, label: '[0.90-1.00]' }
    ];

    // Calculate 30-day window
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - 30);
    const windowEnd = new Date();
    const timeWindow = '30d';

    console.log(`Computing calibration metrics for window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);

    let totalProcessed = 0;
    let totalUpserted = 0;

    // Get all users with strategies, filtering out null user_id values
    const { data: users, error: usersError } = await supabase
      .from('trading_strategies')
      .select('user_id')
      .not('user_id', 'is', null);

    if (usersError) {
      throw new Error(`Error fetching users: ${usersError.message}`);
    }

    // Filter out invalid UUIDs and "null" strings
    const isValidUUID = (uuid: string): boolean => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      return typeof uuid === 'string' && uuid !== 'null' && uuidRegex.test(uuid);
    };

    const allUserIds = users?.map(u => u.user_id).filter(Boolean) || [];
    const uniqueUsers = [...new Set(allUserIds)].filter(isValidUUID);
    console.log(`Processing ${uniqueUsers.length} valid users (filtered from ${allUserIds.length} total)`);

    for (const userId of uniqueUsers) {
      // Additional safety check for valid UUID
      if (!userId || typeof userId !== 'string' || userId === 'null') {
        console.warn(`Skipping invalid user_id: ${userId}`);
        continue;
      }

      console.log(`Processing user: ${userId}`);

      // Get user's strategies
      const { data: strategies, error: strategiesError } = await supabase
        .from('trading_strategies')
        .select('id')
        .eq('user_id', userId);

      if (strategiesError) {
        console.error(`Error fetching strategies for user ${userId}:`, strategiesError);
        continue;
      }

      for (const strategy of strategies || []) {
        console.log(`Processing strategy: ${strategy.id}`);

        // Get decision outcomes with events in the time window
        const { data: outcomes, error: outcomesError } = await supabase
          .from('decision_outcomes')
          .select(`
            *,
            decision_events!inner(
              confidence,
              strategy_id,
              decision_ts
            )
          `)
          .eq('user_id', userId)
          .eq('decision_events.strategy_id', strategy.id)
          .gte('decision_events.decision_ts', windowStart.toISOString())
          .lte('decision_events.decision_ts', windowEnd.toISOString());

        if (outcomesError) {
          console.error(`Error fetching outcomes for strategy ${strategy.id}:`, outcomesError);
          continue;
        }

        // Group by symbol and horizon
        const groups = new Map<string, any[]>();
        
        for (const outcome of outcomes || []) {
          const key = `${outcome.symbol}_${outcome.horizon}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(outcome);
        }

        // Process each symbol-horizon combination
        for (const [key, groupOutcomes] of groups) {
          const [symbol, horizon] = key.split('_');
          
          console.log(`Processing ${symbol} - ${horizon}: ${groupOutcomes.length} outcomes`);

          // Process each confidence band
          for (const band of confidenceBands) {
            const bandOutcomes = groupOutcomes.filter(o => 
              o.decision_events.confidence >= band.min && 
              o.decision_events.confidence < band.max
            );

            if (bandOutcomes.length === 0) continue;

            // Compute metrics with data quality guards
            const sampleCount = bandOutcomes.length;
            const winningOutcomes = bandOutcomes.filter(o => 
              o.realized_pnl_pct != null && !isNaN(o.realized_pnl_pct) && isFinite(o.realized_pnl_pct) && o.realized_pnl_pct > 0
            );
            const winRate = sampleCount > 0 ? Math.min(100, Math.max(0, (winningOutcomes.length / sampleCount * 100))) : 0;
            
            const validPnlOutcomes = bandOutcomes.filter(o => 
              o.realized_pnl_pct != null && !isNaN(o.realized_pnl_pct) && isFinite(o.realized_pnl_pct)
            );
            const meanRealizedPnl = validPnlOutcomes.length > 0 
              ? validPnlOutcomes.reduce((sum, o) => sum + o.realized_pnl_pct, 0) / validPnlOutcomes.length
              : 0;

            const tpHits = bandOutcomes.filter(o => o.hit_tp === true).length;
            const tpHitRate = sampleCount > 0 ? Math.min(100, Math.max(0, (tpHits / sampleCount * 100))) : 0;

            const slHits = bandOutcomes.filter(o => o.hit_sl === true).length;
            const slHitRate = sampleCount > 0 ? Math.min(100, Math.max(0, (slHits / sampleCount * 100))) : 0;

            // Prepare upsert data
            const calibrationData = {
              user_id: userId,
              strategy_id: strategy.id,
              symbol,
              horizon,
              time_window: timeWindow,
              confidence_band: band.label,
              window_start_ts: windowStart.toISOString(),
              window_end_ts: windowEnd.toISOString(),
              sample_count: sampleCount,
              win_rate_pct: Math.round(Math.min(100, Math.max(0, winRate)) * 100) / 100,
              mean_realized_pnl_pct: !isNaN(meanRealizedPnl) && isFinite(meanRealizedPnl) 
                ? Math.round(Math.min(1000, Math.max(-1000, meanRealizedPnl)) * 100) / 100 : 0,
              tp_hit_rate_pct: Math.round(Math.min(100, Math.max(0, tpHitRate)) * 100) / 100,
              sl_hit_rate_pct: Math.round(Math.min(100, Math.max(0, slHitRate)) * 100) / 100,
              // Set other fields to defaults for MVP
              coverage_pct: 0,
              median_realized_pnl_pct: null,
              median_mfe_pct: null,
              median_mae_pct: null,
              missed_opportunity_pct: 0,
              mean_expectation_error_pct: null,
              reliability_correlation: null,
              volatility_regime: null,
              computed_at: new Date().toISOString()
            };

            // Upsert into calibration_metrics
            const { data: upsertResult, error: upsertError } = await supabase
              .from('calibration_metrics')
              .upsert(calibrationData, {
                onConflict: 'user_id,strategy_id,symbol,horizon,time_window,confidence_band',
                ignoreDuplicates: false
              });

            if (upsertError) {
              console.error(`Error upserting calibration metric:`, upsertError);
            } else {
              totalUpserted++;
              console.log(`✅ Upserted metric for ${symbol}-${horizon}-${band.label}: ${sampleCount} samples, ${winRate.toFixed(1)}% win rate`);
            }

            totalProcessed++;
          }
        }
      }
    }

    const summary = {
      success: true,
      window: `${windowStart.toISOString()} to ${windowEnd.toISOString()}`,
      users_processed: uniqueUsers.length,
      metrics_processed: totalProcessed,
      metrics_upserted: totalUpserted,
      computed_at: new Date().toISOString()
    };

    console.log('=== Calibration Aggregation Complete ===');
    console.log(JSON.stringify(summary, null, 2));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in calibration aggregator:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});