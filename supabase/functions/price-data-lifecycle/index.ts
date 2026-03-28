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
const SAFETY_CAP_PER_SYMBOL = 10_000;
const TIMEOUT_MS = 50_000; // 50 seconds

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function computeSHA256(data: Uint8Array): Promise<string> {
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fallback: simple hash
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data[i];
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ── AUTH CHECK: Validate x-cron-secret before any logic runs ──
  const cronSecret = Deno.env.get('CRON_SECRET');
  const providedSecret = req.headers.get('x-cron-secret');

  if (!cronSecret || providedSecret !== cronSecret) {
    logger.error(`[lifecycle] Unauthorized request — invalid or missing x-cron-secret`);
    return withCors({ success: false, error: 'Unauthorized' }, 401);
  }

  const runId = crypto.randomUUID();
  const startTime = Date.now();
  const elapsed = () => Date.now() - startTime;

  logger.info(`[lifecycle][${runId}] === Price Data Lifecycle Run Started ===`);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HOT_WINDOW_DAYS);
  const cutoffISO = cutoff.toISOString();
  const archiveDate = new Date().toISOString().split('T')[0];

  logger.info(`[lifecycle][${runId}] Cutoff: ${cutoffISO} (${HOT_WINDOW_DAYS}-day window)`);

  // ── ADDITION 3: Insert audit row at start with 'pending' status ──
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
      logger.error(`[lifecycle][${runId}] Failed to insert audit log: ${logInsertErr.message}`);
    } else {
      logId = logRow.id;
      logger.info(`[lifecycle][${runId}] Audit log created: ${logId}`);
    }
  } catch (e) {
    logger.error(`[lifecycle][${runId}] Audit log insert exception: ${e.message}`);
  }

  // Helper: update the audit log row
  async function updateLog(updates: Record<string, unknown>) {
    if (!logId) return;
    const { error } = await supabase
      .from('price_data_archive_log')
      .update(updates)
      .eq('id', logId);
    if (error) {
      logger.error(`[lifecycle][${runId}] Failed to update audit log: ${error.message}`);
    }
  }

  try {
    // ── STEP 1: EXPORT (per-symbol) ──
    logger.info(`[lifecycle][${runId}] Step 1: Export`);
    const perSymbolCounts: Record<string, number> = {};
    let totalExported = 0;
    let earliestTs: string | null = null;
    let latestTs: string | null = null;
    const allRows: any[] = [];

    for (const sym of SYMBOLS) {
      // Fast count check first to avoid expensive SELECT * on empty results
      const { count: preCount, error: countError } = await supabase
        .from('price_data')
        .select('*', { count: 'exact', head: true })
        .eq('symbol', sym)
        .lt('timestamp', cutoffISO);

      if (countError) {
        logger.error(`[lifecycle][${runId}] Pre-count query failed for ${sym}: ${countError.message}`);
        throw new Error(`Pre-count query failed for ${sym}: ${countError.message}`);
      }

      if ((preCount ?? 0) === 0) {
        perSymbolCounts[sym] = 0;
        logger.info(`[lifecycle][${runId}] ${sym}: 0 rows to archive`);
        continue;
      }

      const { data: rows, error } = await supabase
        .from('price_data')
        .select('*')
        .eq('symbol', sym)
        .lt('timestamp', cutoffISO)
        .order('timestamp', { ascending: true })
        .limit(50000);

      if (error) {
        logger.error(`[lifecycle][${runId}] Export query failed for ${sym}: ${error.message}`);
        throw new Error(`Export query failed for ${sym}: ${error.message}`);
      }

      const count = rows?.length ?? 0;

      // ── ADDITION 1: Safety cap per symbol ──
      if (count > SAFETY_CAP_PER_SYMBOL) {
        const msg = `export batch too large for symbol ${sym}: ${count} rows`;
        logger.error(`[lifecycle][${runId}] ${msg}`);
        await updateLog({
          prune_status: 'skipped',
          error_message: msg,
          per_symbol_counts: { ...perSymbolCounts, [sym]: count },
        });
        return withCors({
          success: false,
          run_id: runId,
          error: msg,
        }, 500);
      }

      perSymbolCounts[sym] = count;
      totalExported += count;

      if (rows && rows.length > 0) {
        allRows.push(...rows);
        const first = rows[0].timestamp;
        const last = rows[rows.length - 1].timestamp;
        if (!earliestTs || first < earliestTs) earliestTs = first;
        if (!latestTs || last > latestTs) latestTs = last;
      }

      logger.info(`[lifecycle][${runId}] ${sym}: ${count} rows to archive`);
    }

    if (totalExported === 0) {
      logger.info(`[lifecycle][${runId}] No rows older than cutoff. Nothing to do.`);
      await updateLog({
        file_path: 'none',
        row_count_exported: 0,
        row_count_deleted: 0,
        per_symbol_counts: perSymbolCounts,
        prune_status: 'skipped',
      });
      return withCors({
        success: true,
        run_id: runId,
        message: 'No rows to archive',
        cutoff: cutoffISO,
      });
    }

    // Build CSV
    const headers = Object.keys(allRows[0]);
    const csvLines = [headers.join(',')];
    for (const row of allRows) {
      const line = headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(',');
      csvLines.push(line);
    }
    const csvContent = csvLines.join('\n');
    const csvBytes = new TextEncoder().encode(csvContent);

    // Compute checksum
    const checksum = await computeSHA256(csvBytes);
    logger.info(`[lifecycle][${runId}] CSV: ${totalExported} rows, ${csvBytes.length} bytes, SHA-256: ${checksum}`);

    // Upload to Storage
    const filePath = `${archiveDate}/${runId}.csv`;

    const { error: uploadError } = await supabase.storage
      .from('price-data-archives')
      .upload(filePath, csvBytes, {
        contentType: 'text/csv',
        upsert: false,
      });

    if (uploadError) {
      logger.error(`[lifecycle][${runId}] Upload failed: ${uploadError.message}`);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }
    logger.info(`[lifecycle][${runId}] Uploaded to price-data-archives/${filePath}`);

    // ── STEP 2: VALIDATE ──
    logger.info(`[lifecycle][${runId}] Step 2: Validate`);

    // Verify file exists in storage
    const { data: fileCheck } = await supabase.storage
      .from('price-data-archives')
      .list(archiveDate);

    const fileExists = fileCheck?.some(f => f.name === `${runId}.csv`);
    if (!fileExists) {
      throw new Error('Validation failed: file not found in storage after upload');
    }

    // ── ADDITION 2: Independent DB count validation ──
    for (const sym of SYMBOLS) {
      const csvSymbolCount = allRows.filter(r => r.symbol === sym).length;
      if (csvSymbolCount === 0) continue;

      const { count: dbCount, error: countErr } = await supabase
        .from('price_data')
        .select('*', { count: 'exact', head: true })
        .eq('symbol', sym)
        .lt('timestamp', cutoffISO);

      if (countErr) {
        throw new Error(`Validation count query failed for ${sym}: ${countErr.message}`);
      }

      if (dbCount !== csvSymbolCount) {
        throw new Error(
          `Validation failed: ${sym} count mismatch (db=${dbCount}, csv=${csvSymbolCount}). ` +
          `New rows may have aged past cutoff during run. Aborting to prevent data loss.`
        );
      }
    }

    logger.info(`[lifecycle][${runId}] Validation passed: file exists, independent DB counts match, checksum=${checksum}`);

    // Update log with export results before pruning
    await updateLog({
      file_path: filePath,
      row_count_exported: totalExported,
      per_symbol_counts: perSymbolCounts,
      earliest_timestamp: earliestTs,
      latest_timestamp: latestTs,
      file_checksum: checksum,
    });

    // ── STEP 3: PRUNE (per-symbol batched via RPC) ──
    logger.info(`[lifecycle][${runId}] Step 3: Prune`);
    let totalDeleted = 0;
    const completedSymbols: string[] = [];
    let timedOut = false;

    for (const sym of SYMBOLS) {
      if ((perSymbolCounts[sym] ?? 0) === 0) {
        completedSymbols.push(sym);
        continue;
      }

      // ── ADDITION 4: Timeout guard ──
      if (elapsed() > TIMEOUT_MS) {
        timedOut = true;
        logger.warn(`[lifecycle][${runId}] Timeout guard hit at ${(elapsed() / 1000).toFixed(1)}s before starting ${sym}`);
        break;
      }

      let symDeleted = 0;
      let batchNum = 0;

      while (true) {
        // Check timeout before each batch
        if (elapsed() > TIMEOUT_MS) {
          timedOut = true;
          logger.warn(`[lifecycle][${runId}] Timeout guard hit at ${(elapsed() / 1000).toFixed(1)}s during ${sym} batch ${batchNum}`);
          break;
        }

        batchNum++;
        const { data: deleted, error: pruneError } = await supabase.rpc(
          'prune_price_data_batch',
          {
            p_symbol: sym,
            p_cutoff: cutoffISO,
            p_batch_size: PRUNE_BATCH_SIZE,
          }
        );

        if (pruneError) {
          logger.error(`[lifecycle][${runId}] Prune error ${sym} batch ${batchNum}: ${pruneError.message}`);
          await updateLog({
            row_count_deleted: totalDeleted,
            prune_status: 'partial',
            error_message: `Prune failed at ${sym} batch ${batchNum}: ${pruneError.message}`,
          });
          return withCors({
            success: false,
            run_id: runId,
            error: `Prune failed at ${sym}`,
            exported: totalExported,
            deleted: totalDeleted,
            completed_symbols: completedSymbols,
          }, 500);
        }

        const batchDeleted = deleted ?? 0;
        symDeleted += batchDeleted;
        totalDeleted += batchDeleted;

        if (batchDeleted < PRUNE_BATCH_SIZE) break;
        await sleep(PRUNE_SLEEP_MS);
      }

      if (timedOut) {
        // Partial symbol — don't add to completed
        logger.info(`[lifecycle][${runId}] ${sym}: partially pruned ${symDeleted} rows (timed out)`);
        break;
      }

      completedSymbols.push(sym);
      logger.info(`[lifecycle][${runId}] ${sym}: pruned ${symDeleted} rows`);
    }

    // ── STEP 4: PRUNE 5m OHLCV + FEATURES (45-day retention) ──
    logger.info(`[lifecycle][${runId}] Step 4: Prune 5m market data`);
    const cutoff5m = new Date();
    cutoff5m.setDate(cutoff5m.getDate() - HOT_WINDOW_DAYS);
    const cutoff5mISO = cutoff5m.toISOString();
    let total5mDeleted = 0;

    for (const table of ['market_ohlcv_raw', 'market_features_v0'] as const) {
      if (elapsed() > TIMEOUT_MS) {
        logger.warn(`[lifecycle][${runId}] Timeout before 5m prune of ${table}`);
        break;
      }

      let batchNum = 0;
      while (true) {
        if (elapsed() > TIMEOUT_MS) break;
        batchNum++;

        const { data: deleted, error: delErr } = await supabase.rpc(
          'prune_5m_market_data_batch',
          {
            p_table: table,
            p_cutoff: cutoff5mISO,
            p_batch_size: PRUNE_BATCH_SIZE,
          }
        );

        if (delErr) {
          logger.error(`[lifecycle][${runId}] 5m prune error ${table} batch ${batchNum}: ${delErr.message}`);
          break;
        }

        const batchDeleted = deleted ?? 0;
        total5mDeleted += batchDeleted;
        if (batchDeleted < PRUNE_BATCH_SIZE) break;
        await sleep(PRUNE_SLEEP_MS);
      }

      logger.info(`[lifecycle][${runId}] ${table} 5m: pruned rows in ${batchNum} batches`);
    }

    logger.info(`[lifecycle][${runId}] Total 5m rows pruned: ${total5mDeleted}`);

    // ── STEP 5: FINAL LOG UPDATE ──
    const finalStatus = timedOut ? 'partial' : 'success';
    const elapsedSec = (elapsed() / 1000).toFixed(1);

    await updateLog({
      row_count_deleted: totalDeleted,
      prune_status: finalStatus,
      error_message: timedOut
        ? `Timeout at ${elapsedSec}s. Completed symbols: [${completedSymbols.join(', ')}]. Deleted: ${totalDeleted}/${totalExported}. 5m pruned: ${total5mDeleted}.`
        : null,
    });

    logger.info(`[lifecycle][${runId}] === Lifecycle complete in ${elapsedSec}s: status=${finalStatus}, exported=${totalExported}, deleted=${totalDeleted}, 5m_pruned=${total5mDeleted} ===`);

    return withCors({
      success: true,
      run_id: runId,
      cutoff: cutoffISO,
      status: finalStatus,
      exported: totalExported,
      deleted: totalDeleted,
      pruned_5m: total5mDeleted,
      per_symbol_counts: perSymbolCounts,
      completed_symbols: completedSymbols,
      file_path: filePath,
      checksum,
      elapsed_seconds: parseFloat(elapsedSec),
    });

  } catch (error) {
    const elapsedSec = (elapsed() / 1000).toFixed(1);
    logger.error(`[lifecycle][${runId}] Fatal error at ${elapsedSec}s: ${error.message}`);
    await updateLog({
      prune_status: 'failed',
      error_message: error.message,
    });
    return withCors({
      success: false,
      run_id: runId,
      error: error.message,
      elapsed_seconds: parseFloat(elapsedSec),
    }, 500);
  }
});
