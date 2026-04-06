// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5'
import { corsHeaders, withCors } from '../_shared/cors.ts'
import { logger } from '../_shared/logger.ts'

const SYMBOLS = [
  'BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'SOL-EUR', 'AVAX-EUR',
  'LTC-EUR', 'ADA-EUR', 'DOT-EUR', 'LINK-EUR', 'BCH-EUR'
];
const HOT_WINDOW_DAYS = 45;
const PRUNE_BATCH_SIZE = 500;
const PRUNE_SLEEP_MS = 200;
const SAFETY_CAP_PER_SYMBOL = 50_000;
const TIMEOUT_MS = 50_000;
const EXPORT_PAGE_SIZE = 1000;

// Standardised CSV columns in exact order
const CSV_COLUMNS = [
  'timestamp', 'symbol', 'open_price', 'high_price',
  'low_price', 'close_price', 'volume', 'interval_type'
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function computeSHA256(data: Uint8Array): Promise<string> {
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data[i];
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}

/**
 * FIX 1 — Paginated export using .range() to bypass PostgREST 1000-row default limit.
 */
async function exportAllRows(
  supabase: any,
  symbol: string,
  cutoffISO: string,
  runId: string
): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('price_data')
      .select('timestamp, symbol, open_price, high_price, low_price, close_price, volume, interval_type')
      .eq('symbol', symbol)
      .lt('timestamp', cutoffISO)
      .order('timestamp', { ascending: true })
      .range(offset, offset + EXPORT_PAGE_SIZE - 1);

    if (error) throw new Error(`Export page failed for ${symbol} at offset ${offset}: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...data);
    offset += EXPORT_PAGE_SIZE;

    if (data.length < EXPORT_PAGE_SIZE) break;
  }

  return rows;
}

/**
 * Build ML-ready CSV with exactly the 8 standardised columns.
 */
function buildCSV(rows: any[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    const line = CSV_COLUMNS.map(col => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(',');
    lines.push(line);
  }
  return lines.join('\n');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ── AUTH CHECK ──
  const cronSecret = Deno.env.get('CRON_SECRET');
  const providedSecret = req.headers.get('x-cron-secret');
  if (!cronSecret || providedSecret !== cronSecret) {
    logger.error(`[lifecycle] Unauthorized request`);
    return withCors({ success: false, error: 'Unauthorized' }, 401);
  }

  const runId = crypto.randomUUID();
  const startTime = Date.now();
  const elapsed = () => Date.now() - startTime;

  logger.info(`[lifecycle][${runId}] === Run Started ===`);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HOT_WINDOW_DAYS);
  const cutoffISO = cutoff.toISOString();
  const archiveDate = new Date().toISOString().split('T')[0];

  logger.info(`[lifecycle][${runId}] Cutoff: ${cutoffISO}`);

  // ── Insert audit row ──
  let logId: string | null = null;
  try {
    const { data: logRow, error: logInsertErr } = await supabase
      .from('price_data_archive_log')
      .insert({
        run_id: runId,
        archive_date: archiveDate,
        file_path: 'pending',
        cutoff_timestamp: cutoffISO,
        row_count_exported: 0,
        row_count_deleted: 0,
        per_symbol_counts: {},
        prune_status: 'pending',
      })
      .select('id')
      .single();

    if (logInsertErr) {
      logger.error(`[lifecycle][${runId}] Audit log insert failed: ${logInsertErr.message}`);
    } else {
      logId = logRow.id;
    }
  } catch (e) {
    logger.error(`[lifecycle][${runId}] Audit log exception: ${e.message}`);
  }

  async function updateLog(updates: Record<string, unknown>) {
    if (!logId) return;
    const { error } = await supabase
      .from('price_data_archive_log')
      .update(updates)
      .eq('id', logId);
    if (error) logger.error(`[lifecycle][${runId}] Log update failed: ${error.message}`);
  }

  try {
    // ═══════════════════════════════════════════════════
    // STEP 1 — Count rows in DB per symbol (authoritative)
    // ═══════════════════════════════════════════════════
    logger.info(`[lifecycle][${runId}] Step 1: Count`);
    const dbCounts: Record<string, number> = {};
    let totalExpected = 0;

    for (const sym of SYMBOLS) {
      const { count, error } = await supabase
        .from('price_data')
        .select('*', { count: 'exact', head: true })
        .eq('symbol', sym)
        .lt('timestamp', cutoffISO);

      if (error) throw new Error(`Count failed for ${sym}: ${error.message}`);
      dbCounts[sym] = count ?? 0;
      totalExpected += dbCounts[sym];
    }

    if (totalExpected === 0) {
      logger.info(`[lifecycle][${runId}] No rows to archive`);
      await updateLog({ file_path: 'none', prune_status: 'skipped', per_symbol_counts: dbCounts });
      return withCors({ success: true, run_id: runId, message: 'No rows to archive' });
    }

    logger.info(`[lifecycle][${runId}] Total expected: ${totalExpected} rows`);

    // ═══════════════════════════════════════════════════
    // STEP 2 — Export all rows via pagination (FIX 1)
    // ═══════════════════════════════════════════════════
    logger.info(`[lifecycle][${runId}] Step 2: Paginated export`);
    const allRows: any[] = [];
    const perSymbolCounts: Record<string, number> = {};

    for (const sym of SYMBOLS) {
      if (dbCounts[sym] === 0) {
        perSymbolCounts[sym] = 0;
        continue;
      }

      // Safety cap
      if (dbCounts[sym] > SAFETY_CAP_PER_SYMBOL) {
        const msg = `Safety cap exceeded for ${sym}: ${dbCounts[sym]} rows`;
        logger.error(`[lifecycle][${runId}] ${msg}`);
        await updateLog({ prune_status: 'skipped', error_message: msg, per_symbol_counts: dbCounts });
        return withCors({ success: false, run_id: runId, error: msg }, 500);
      }

      const rows = await exportAllRows(supabase, sym, cutoffISO, runId);
      perSymbolCounts[sym] = rows.length;
      allRows.push(...rows);
      logger.info(`[lifecycle][${runId}] ${sym}: exported ${rows.length} rows (expected ${dbCounts[sym]})`);
    }

    const totalExported = allRows.length;

    // ═══════════════════════════════════════════════════
    // STEP 3 — Validate: count_in_memory vs count_in_db (FIX 2)
    //          If mismatch → STOP, do NOT upload
    // ═══════════════════════════════════════════════════
    logger.info(`[lifecycle][${runId}] Step 3: Validate counts`);

    for (const sym of SYMBOLS) {
      if (dbCounts[sym] === 0) continue;
      if (perSymbolCounts[sym] !== dbCounts[sym]) {
        const msg = `Validation failed: ${sym} count mismatch (db=${dbCounts[sym]}, exported=${perSymbolCounts[sym]})`;
        logger.error(`[lifecycle][${runId}] ${msg}`);
        await updateLog({
          prune_status: 'failed',
          error_message: msg,
          per_symbol_counts: perSymbolCounts,
        });
        return withCors({ success: false, run_id: runId, error: msg }, 500);
      }
    }

    if (totalExported !== totalExpected) {
      const msg = `Total mismatch: exported=${totalExported}, expected=${totalExpected}`;
      logger.error(`[lifecycle][${runId}] ${msg}`);
      await updateLog({ prune_status: 'failed', error_message: msg });
      return withCors({ success: false, run_id: runId, error: msg }, 500);
    }

    logger.info(`[lifecycle][${runId}] Validation passed: ${totalExported} rows match DB counts`);

    // ═══════════════════════════════════════════════════
    // STEP 4 — Build CSV (FIX 3: standardised ML-ready format)
    // ═══════════════════════════════════════════════════
    // Sort by (symbol ASC, timestamp ASC) before writing
    allRows.sort((a, b) => {
      const symCmp = a.symbol.localeCompare(b.symbol);
      if (symCmp !== 0) return symCmp;
      return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
    });

    const csvContent = buildCSV(allRows);
    const csvBytes = new TextEncoder().encode(csvContent);
    const checksum = await computeSHA256(csvBytes);
    logger.info(`[lifecycle][${runId}] CSV: ${totalExported} rows, ${csvBytes.length} bytes, SHA-256: ${checksum}`);

    // ═══════════════════════════════════════════════════
    // STEP 5 — Upload to Storage (AFTER validation)
    // ═══════════════════════════════════════════════════
    const filePath = `${archiveDate}/${runId}.csv`;
    const { error: uploadError } = await supabase.storage
      .from('price-data-archives')
      .upload(filePath, csvBytes, { contentType: 'text/csv', upsert: false });

    if (uploadError) {
      const msg = `Storage upload failed: ${uploadError.message}`;
      logger.error(`[lifecycle][${runId}] ${msg}`);
      await updateLog({ prune_status: 'failed', error_message: msg });
      return withCors({ success: false, run_id: runId, error: msg }, 500);
    }

    // ═══════════════════════════════════════════════════
    // STEP 6 — Verify upload (check file exists + size)
    // ═══════════════════════════════════════════════════
    const { data: fileList } = await supabase.storage
      .from('price-data-archives')
      .list(archiveDate);

    const uploadedFile = fileList?.find(f => f.name === `${runId}.csv`);
    if (!uploadedFile) {
      const msg = 'Upload verification failed: file not found in storage';
      logger.error(`[lifecycle][${runId}] ${msg}`);
      await updateLog({ prune_status: 'failed', error_message: msg });
      return withCors({ success: false, run_id: runId, error: msg }, 500);
    }

    logger.info(`[lifecycle][${runId}] Upload verified: ${filePath} (${uploadedFile.metadata?.size ?? '?'} bytes)`);

    // Compute earliest/latest timestamps
    let earliestTs: string | null = null;
    let latestTs: string | null = null;
    if (allRows.length > 0) {
      earliestTs = allRows[0].timestamp;
      latestTs = allRows[allRows.length - 1].timestamp;
    }

    // ═══════════════════════════════════════════════════
    // STEP 7 — Update audit log (pre-prune)
    // ═══════════════════════════════════════════════════
    await updateLog({
      file_path: filePath,
      row_count_exported: totalExported,
      per_symbol_counts: perSymbolCounts,
      earliest_timestamp: earliestTs,
      latest_timestamp: latestTs,
      file_checksum: checksum,
      prune_status: 'pending',
    });

    // ═══════════════════════════════════════════════════
    // STEP 8 — Prune via batched RPC
    // ═══════════════════════════════════════════════════
    logger.info(`[lifecycle][${runId}] Step 8: Prune`);
    let totalDeleted = 0;
    const completedSymbols: string[] = [];
    let timedOut = false;

    for (const sym of SYMBOLS) {
      if ((perSymbolCounts[sym] ?? 0) === 0) {
        completedSymbols.push(sym);
        continue;
      }

      if (elapsed() > TIMEOUT_MS) {
        timedOut = true;
        logger.warn(`[lifecycle][${runId}] Timeout before ${sym}`);
        break;
      }

      let symDeleted = 0;
      let batchNum = 0;

      while (true) {
        if (elapsed() > TIMEOUT_MS) { timedOut = true; break; }
        batchNum++;

        const { data: deleted, error: pruneError } = await supabase.rpc(
          'prune_price_data_batch',
          { p_symbol: sym, p_cutoff: cutoffISO, p_batch_size: PRUNE_BATCH_SIZE }
        );

        if (pruneError) {
          logger.error(`[lifecycle][${runId}] Prune error ${sym} batch ${batchNum}: ${pruneError.message}`);
          await updateLog({
            row_count_deleted: totalDeleted,
            prune_status: 'partial',
            error_message: `Prune failed at ${sym} batch ${batchNum}: ${pruneError.message}`,
          });
          return withCors({
            success: false, run_id: runId, error: `Prune failed at ${sym}`,
            exported: totalExported, deleted: totalDeleted, completed_symbols: completedSymbols,
          }, 500);
        }

        const batchDeleted = deleted ?? 0;
        symDeleted += batchDeleted;
        totalDeleted += batchDeleted;
        if (batchDeleted < PRUNE_BATCH_SIZE) break;
        await sleep(PRUNE_SLEEP_MS);
      }

      if (timedOut) {
        logger.info(`[lifecycle][${runId}] ${sym}: partially pruned ${symDeleted} (timeout)`);
        break;
      }

      completedSymbols.push(sym);
      logger.info(`[lifecycle][${runId}] ${sym}: pruned ${symDeleted} rows`);
    }

    // ═══════════════════════════════════════════════════
    // STEP 8b — Prune 5m OHLCV + Features (45-day retention)
    // ═══════════════════════════════════════════════════
    logger.info(`[lifecycle][${runId}] Step 8b: Prune 5m market data`);
    let total5mDeleted = 0;

    for (const table of ['market_ohlcv_raw', 'market_features_v0'] as const) {
      if (elapsed() > TIMEOUT_MS) break;
      let batchNum = 0;

      while (true) {
        if (elapsed() > TIMEOUT_MS) break;
        batchNum++;

        const { data: deleted, error: delErr } = await supabase.rpc(
          'prune_5m_market_data_batch',
          { p_table: table, p_cutoff: cutoffISO, p_batch_size: PRUNE_BATCH_SIZE }
        );

        if (delErr) {
          logger.error(`[lifecycle][${runId}] 5m prune error ${table}: ${delErr.message}`);
          break;
        }

        const batchDeleted = deleted ?? 0;
        total5mDeleted += batchDeleted;
        if (batchDeleted < PRUNE_BATCH_SIZE) break;
        await sleep(PRUNE_SLEEP_MS);
      }
    }

    // ═══════════════════════════════════════════════════
    // STEP 9/10 — Final audit log update
    // ═══════════════════════════════════════════════════
    const finalStatus = timedOut ? 'partial' : 'success';
    const elapsedSec = (elapsed() / 1000).toFixed(1);

    await updateLog({
      row_count_deleted: totalDeleted,
      prune_status: finalStatus,
      error_message: timedOut
        ? `Timeout at ${elapsedSec}s. Completed: [${completedSymbols.join(', ')}]. Deleted: ${totalDeleted}/${totalExported}. 5m: ${total5mDeleted}.`
        : null,
    });

    logger.info(`[lifecycle][${runId}] === Complete in ${elapsedSec}s: ${finalStatus}, exported=${totalExported}, deleted=${totalDeleted}, 5m=${total5mDeleted} ===`);

    return withCors({
      success: true, run_id: runId, cutoff: cutoffISO, status: finalStatus,
      exported: totalExported, deleted: totalDeleted, pruned_5m: total5mDeleted,
      per_symbol_counts: perSymbolCounts, completed_symbols: completedSymbols,
      file_path: filePath, checksum, elapsed_seconds: parseFloat(elapsedSec),
    });

  } catch (error) {
    const elapsedSec = (elapsed() / 1000).toFixed(1);
    logger.error(`[lifecycle][${runId}] Fatal error at ${elapsedSec}s: ${error.message}`);
    await updateLog({ prune_status: 'failed', error_message: error.message });
    return withCors({ success: false, run_id: runId, error: error.message, elapsed_seconds: parseFloat(elapsedSec) }, 500);
  }
});
