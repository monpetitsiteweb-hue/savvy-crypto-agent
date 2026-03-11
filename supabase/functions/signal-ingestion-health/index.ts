import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.info('[SIGNAL_HEALTH] Running staleness check...');

    // Get all known sources and their expected intervals
    const { data: sources, error: srcErr } = await supabase
      .from('signal_source_health')
      .select('*');

    if (srcErr) throw srcErr;
    if (!sources || sources.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No sources configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = [];
    const now = Date.now();

    for (const src of sources) {
      // Get latest signal and 24h count for this source
      const { data: latest } = await supabase
        .from('live_signals')
        .select('timestamp')
        .eq('source', src.source)
        .order('timestamp', { ascending: false })
        .limit(1);

      const { count } = await supabase
        .from('live_signals')
        .select('id', { count: 'exact', head: true })
        .eq('source', src.source)
        .gte('timestamp', new Date(now - 24 * 60 * 60 * 1000).toISOString());

      const lastSignalAt = latest?.[0]?.timestamp || null;
      const signalCount24h = count || 0;

      // Staleness: no signal for > 2× expected interval
      let status = 'healthy';
      if (!lastSignalAt) {
        status = 'dead';
        console.warn(`[SIGNAL_STALE_WARNING] source=${src.source} status=dead (no signals ever)`);
      } else {
        const ageMs = now - new Date(lastSignalAt).getTime();
        const thresholdMs = src.expected_interval_seconds * 2 * 1000;
        if (ageMs > thresholdMs) {
          status = 'stale';
          console.warn(`[SIGNAL_STALE_WARNING] source=${src.source} age_min=${Math.round(ageMs / 60000)} threshold_min=${Math.round(thresholdMs / 60000)}`);
        }
      }

      // Update health row
      await supabase
        .from('signal_source_health')
        .update({
          last_signal_at: lastSignalAt,
          signal_count_24h: signalCount24h,
          status,
          checked_at: new Date().toISOString(),
        })
        .eq('source', src.source);

      results.push({
        source: src.source,
        status,
        last_signal_at: lastSignalAt,
        signal_count_24h: signalCount24h,
      });

      console.info(`[SIGNAL_INGESTION_EVENT] source=${src.source} status=${status} count_24h=${signalCount24h}`);
    }

    return new Response(JSON.stringify({ success: true, sources: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[SIGNAL_HEALTH] Error:', error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
