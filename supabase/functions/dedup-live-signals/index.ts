// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Calls dedup_live_signals_batch() RPC in a loop until no more duplicates.
 * ?dry_run=true  — count only
 * ?max_rounds=50 — safety cap (default 50)
 * ?batch_size=1000
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === 'true';
  const maxRounds = parseInt(url.searchParams.get('max_rounds') || '50', 10);
  const batchSize = parseInt(url.searchParams.get('batch_size') || '1000', 10);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const log: string[] = [];
  const emit = (msg: string) => { console.info(msg); log.push(msg); };

  try {
    let totalDeleted = 0;
    let round = 0;

    emit(`[DEDUP_START] dry_run=${dryRun} max_rounds=${maxRounds} batch_size=${batchSize}`);

    while (round < maxRounds) {
      round++;
      const { data, error } = await supabase.rpc('dedup_live_signals_batch', {
        p_batch_size: batchSize,
        p_dry_run: dryRun,
      });

      if (error) {
        emit(`[DEDUP_ERROR] round=${round}: ${error.message}`);
        break;
      }

      const deleted = data?.deleted ?? 0;
      totalDeleted += deleted;
      emit(`[DEDUP_ROUND] round=${round} deleted=${deleted} total=${totalDeleted}`);

      if (deleted === 0) {
        emit('[DEDUP_DONE] No more duplicates found.');
        break;
      }
    }

    emit(`[DEDUP_COMPLETE] rounds=${round} total_deleted=${totalDeleted} dry_run=${dryRun}`);

    if (!dryRun && totalDeleted > 0) {
      emit('[DEDUP_INDEX] Run manually in SQL Editor:');
      emit('  CREATE UNIQUE INDEX CONCURRENTLY uq_live_signals_dedup ON public.live_signals (source, signal_type, symbol, "timestamp");');
    }

    return new Response(JSON.stringify({ success: true, total_deleted: totalDeleted, rounds: round, dry_run: dryRun, log }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    emit(`[DEDUP_FATAL] ${error.message}`);
    return new Response(JSON.stringify({ success: false, error: error.message, log }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
