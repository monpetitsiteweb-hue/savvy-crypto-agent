// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Chunked dedup of live_signals — no full-table scans.
 *
 * Processes one source at a time, paginating by id.
 * Groups rows in-memory by (source, signal_type, symbol, timestamp),
 * keeps newest (created_at DESC), deletes the rest in small batches.
 *
 * Query params:
 *   ?dry_run=true        — count only, no deletes
 *   ?source=xxx          — process only one source (recommended)
 *   ?page_size=500       — rows per page (default 500)
 *   ?max_pages=100       — safety cap on pages (default 100)
 *   ?create_index=true   — attempt unique index after dedup
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === 'true';
  const sourceFilter = url.searchParams.get('source');
  const pageSize = Math.min(parseInt(url.searchParams.get('page_size') || '500', 10), 1000);
  const maxPages = parseInt(url.searchParams.get('max_pages') || '200', 10);
  const createIndex = url.searchParams.get('create_index') === 'true';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const log: string[] = [];
  const emit = (msg: string) => { console.info(msg); log.push(msg); };

  try {
    // 1. Get distinct sources via small paginated scan
    let sources: string[] = [];
    if (sourceFilter) {
      sources = [sourceFilter];
    } else {
      // Fetch sources by paginating with distinct-like approach
      const sourceSet = new Set<string>();
      let offset = 0;
      for (let p = 0; p < 20; p++) {
        const { data } = await supabase
          .from('live_signals')
          .select('source')
          .range(offset, offset + 999);
        if (!data || data.length === 0) break;
        for (const r of data) sourceSet.add(r.source);
        offset += 1000;
        if (data.length < 1000) break;
      }
      sources = [...sourceSet].sort();
    }

    emit(`[DEDUP] Sources to process: ${JSON.stringify(sources)}`);

    let grandTotalRemoved = 0;

    for (const source of sources) {
      emit(`[DEDUP_SOURCE_START] source=${source}`);

      // Paginate all rows for this source using cursor (id-based)
      // Accumulate into a map, process in chunks to avoid OOM
      const groupMap = new Map<string, { id: string; created_at: string }[]>();
      let cursor: string | null = null;
      let totalRows = 0;
      let pagesRead = 0;

      while (pagesRead < maxPages) {
        let query = supabase
          .from('live_signals')
          .select('id, signal_type, symbol, timestamp, created_at')
          .eq('source', source)
          .order('id', { ascending: true })
          .limit(pageSize);

        if (cursor) {
          query = query.gt('id', cursor);
        }

        const { data: page, error: pageErr } = await query;
        if (pageErr) {
          emit(`[DEDUP_ERROR] fetch page ${pagesRead}: ${pageErr.message}`);
          break;
        }
        if (!page || page.length === 0) break;

        pagesRead++;
        totalRows += page.length;
        cursor = page[page.length - 1].id;

        for (const row of page) {
          const key = `${row.signal_type}|${row.symbol}|${row.timestamp}`;
          if (!groupMap.has(key)) groupMap.set(key, []);
          groupMap.get(key)!.push({ id: row.id, created_at: row.created_at });
        }

        // Log progress every 20 pages
        if (pagesRead % 20 === 0) {
          emit(`[DEDUP_PROGRESS] source=${source} pages=${pagesRead} rows=${totalRows} groups=${groupMap.size}`);
        }
      }

      emit(`[DEDUP_SCAN_DONE] source=${source} total_rows=${totalRows} groups=${groupMap.size} pages=${pagesRead}`);

      // Find duplicates — keep newest created_at per group
      const idsToDelete: string[] = [];
      for (const [, rows] of groupMap) {
        if (rows.length <= 1) continue;
        rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
        for (let i = 1; i < rows.length; i++) {
          idsToDelete.push(rows[i].id);
        }
      }

      emit(`[DEDUP_ANALYSIS] source=${source} duplicates_to_remove=${idsToDelete.length}`);

      if (idsToDelete.length > 0 && !dryRun) {
        // Delete in batches of 100
        const batchSize = 100;
        let deleted = 0;
        for (let i = 0; i < idsToDelete.length; i += batchSize) {
          const batch = idsToDelete.slice(i, i + batchSize);
          const { error: delErr } = await supabase
            .from('live_signals')
            .delete()
            .in('id', batch);

          if (delErr) {
            emit(`[DEDUP_ERROR] delete batch ${i}: ${delErr.message}`);
          } else {
            deleted += batch.length;
          }

          // Progress every 1000 deletions
          if (deleted % 1000 === 0 && deleted > 0) {
            emit(`[DEDUP_ROWS_REMOVED] source=${source} progress=${deleted}/${idsToDelete.length}`);
          }
        }
        emit(`[DEDUP_ROWS_REMOVED] source=${source} final=${deleted}`);
        grandTotalRemoved += deleted;
      } else if (dryRun) {
        grandTotalRemoved += idsToDelete.length;
      }

      emit(`[DEDUP_SOURCE_COMPLETE] source=${source} removed=${idsToDelete.length} dry_run=${dryRun}`);
      groupMap.clear(); // free memory
    }

    emit(`[DEDUP_COMPLETE] total_removed=${grandTotalRemoved} dry_run=${dryRun}`);

    // Optional: create unique index
    let indexResult = null;
    if (createIndex && !dryRun && grandTotalRemoved >= 0) {
      emit('[DEDUP_INDEX] ℹ️ Unique index must be created manually via SQL Editor after confirming 0 duplicates:');
      emit('  CREATE UNIQUE INDEX uq_live_signals_dedup ON public.live_signals (source, signal_type, symbol, "timestamp");');
      indexResult = 'manual_required';
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      sources_processed: sources,
      total_removed: grandTotalRemoved,
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
