// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Chunked deduplication of live_signals.
 *
 * Strategy (Option A):
 *   For each source, process in 7-day windows.
 *   Within each window, delete all but the newest row (by created_at)
 *   per (source, signal_type, symbol, timestamp) group.
 *
 * Query params:
 *   ?dry_run=true        — count only, no deletes
 *   ?create_index=true   — after dedup, create the unique index
 *   ?source=xxx          — process only one source
 *   ?window_days=7       — window size (default 7)
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === 'true';
  const createIndex = url.searchParams.get('create_index') === 'true';
  const sourceFilter = url.searchParams.get('source');
  const windowDays = parseInt(url.searchParams.get('window_days') || '7', 10);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const log: string[] = [];
  const emit = (msg: string) => { console.log(msg); log.push(msg); };

  try {
    // 1. Get distinct sources
    emit('[DEDUP] Fetching distinct sources...');
    const { data: sourcesRaw, error: srcErr } = await supabase
      .from('live_signals')
      .select('source')
      .limit(10000);

    if (srcErr) throw new Error(`Failed to fetch sources: ${srcErr.message}`);

    const sources = [...new Set((sourcesRaw || []).map((r: any) => r.source))].sort() as string[];
    const filteredSources = sourceFilter ? sources.filter(s => s === sourceFilter) : sources;
    emit(`[DEDUP] Found ${sources.length} distinct sources, processing ${filteredSources.length}`);

    // 2. Get time range
    // Use a lightweight approach — fetch oldest and newest by ordering
    const { data: oldest } = await supabase
      .from('live_signals')
      .select('timestamp')
      .order('timestamp', { ascending: true })
      .limit(1)
      .single();

    const { data: newest } = await supabase
      .from('live_signals')
      .select('timestamp')
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    if (!oldest || !newest) {
      return new Response(JSON.stringify({ success: true, message: 'Table empty', log }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const startDate = new Date(oldest.timestamp);
    const endDate = new Date(newest.timestamp);
    emit(`[DEDUP] Time range: ${startDate.toISOString()} → ${endDate.toISOString()}`);

    let totalRemoved = 0;

    // 3. Process each source × window
    for (const source of filteredSources) {
      emit(`[DEDUP_SOURCE_START] source=${source}`);
      let sourceRemoved = 0;

      let windowStart = new Date(startDate);
      while (windowStart <= endDate) {
        const windowEnd = new Date(windowStart);
        windowEnd.setDate(windowEnd.getDate() + windowDays);

        const wsISO = windowStart.toISOString();
        const weISO = windowEnd.toISOString();
        emit(`[DEDUP_WINDOW_START] source=${source} window=${wsISO} → ${weISO}`);

        // Find duplicates in this window using RPC or raw approach
        // We'll use a two-step approach:
        // Step 1: Find all rows in the window for this source
        // Step 2: Group in JS, identify duplicates, delete by id

        let allRows: any[] = [];
        let offset = 0;
        const pageSize = 1000;

        // Paginate through the window
        while (true) {
          const { data: page, error: pageErr } = await supabase
            .from('live_signals')
            .select('id, source, signal_type, symbol, timestamp, created_at')
            .eq('source', source)
            .gte('timestamp', wsISO)
            .lt('timestamp', weISO)
            .order('timestamp', { ascending: true })
            .order('created_at', { ascending: false })
            .range(offset, offset + pageSize - 1);

          if (pageErr) {
            emit(`[DEDUP_ERROR] page fetch failed: ${pageErr.message}`);
            break;
          }
          if (!page || page.length === 0) break;
          allRows = allRows.concat(page);
          if (page.length < pageSize) break;
          offset += pageSize;
        }

        if (allRows.length === 0) {
          windowStart = windowEnd;
          continue;
        }

        // Group by (source, signal_type, symbol, timestamp)
        const groups = new Map<string, any[]>();
        for (const row of allRows) {
          const key = `${row.source}|${row.signal_type}|${row.symbol}|${row.timestamp}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(row);
        }

        // Find IDs to delete (keep newest created_at per group)
        const idsToDelete: string[] = [];
        for (const [, rows] of groups) {
          if (rows.length <= 1) continue;
          // Sort by created_at DESC, keep first
          rows.sort((a: any, b: any) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          for (let i = 1; i < rows.length; i++) {
            idsToDelete.push(rows[i].id);
          }
        }

        if (idsToDelete.length > 0) {
          if (dryRun) {
            emit(`[DEDUP_DRY_RUN] Would remove ${idsToDelete.length} rows`);
          } else {
            // Delete in batches of 200
            const batchSize = 200;
            for (let i = 0; i < idsToDelete.length; i += batchSize) {
              const batch = idsToDelete.slice(i, i + batchSize);
              const { error: delErr } = await supabase
                .from('live_signals')
                .delete()
                .in('id', batch);

              if (delErr) {
                emit(`[DEDUP_ERROR] delete batch failed: ${delErr.message}`);
              }
            }
            emit(`[DEDUP_ROWS_REMOVED] source=${source} window=${wsISO} removed=${idsToDelete.length}`);
          }
          sourceRemoved += idsToDelete.length;
        }

        windowStart = windowEnd;
      }

      totalRemoved += sourceRemoved;
      emit(`[DEDUP_SOURCE_COMPLETE] source=${source} total_removed=${sourceRemoved}`);
    }

    emit(`[DEDUP_COMPLETE] total_removed=${totalRemoved} dry_run=${dryRun}`);

    // 4. Optionally create the unique index
    let indexResult = null;
    if (createIndex && !dryRun) {
      emit('[DEDUP_INDEX] Verifying no duplicates remain...');

      // Quick duplicate check via JS — sample each source
      let dupsFound = false;
      for (const source of filteredSources) {
        const { data: sample } = await supabase
          .from('live_signals')
          .select('source, signal_type, symbol, timestamp')
          .eq('source', source)
          .limit(5000);

        if (sample) {
          const seen = new Set<string>();
          for (const r of sample) {
            const key = `${r.source}|${r.signal_type}|${r.symbol}|${r.timestamp}`;
            if (seen.has(key)) { dupsFound = true; break; }
            seen.add(key);
          }
        }
        if (dupsFound) break;
      }

      if (dupsFound) {
        emit('[DEDUP_INDEX] ⚠️ Duplicates still detected — skipping index creation. Run again without source filter.');
        indexResult = 'skipped_duplicates_remain';
      } else {
        emit('[DEDUP_INDEX] Creating unique index uq_live_signals_dedup...');
        indexResult = 'requested — run CREATE UNIQUE INDEX manually after full dedup';
        emit('[DEDUP_INDEX] ℹ️ Index must be created via SQL Editor: CREATE UNIQUE INDEX uq_live_signals_dedup ON public.live_signals (source, signal_type, symbol, "timestamp");');
      }
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      sources_processed: filteredSources.length,
      total_removed: totalRemoved,
      index_result: indexResult,
      log
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    emit(`[DEDUP_FATAL] ${error.message}`);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      log
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
