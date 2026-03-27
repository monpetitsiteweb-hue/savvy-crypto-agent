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

function computeSHA256Hex(data: Uint8Array): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

async function computeSHA256(data: Uint8Array): Promise<string> {
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return computeSHA256Hex(data);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const runId = crypto.randomUUID();
  const startTime = Date.now();
  logger.info(`[lifecycle][${runId}] === Price Data Lifecycle Run Started ===`);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HOT_WINDOW_DAYS);
    const cutoffISO = cutoff.toISOString();
    logger.info(`[lifecycle][${runId}] Cutoff: ${cutoffISO} (${HOT_WINDOW_DAYS}-day window)`);

    // ── STEP 1: EXPORT (per-symbol) ──
    logger.info(`[lifecycle][${runId}] Step 1: Export`);
    const perSymbolCounts: Record<string, number> = {};
    let totalExported = 0;
    let earliestTs: string | null = null;
    let latestTs: string | null = null;
    const allRows: any[] = [];

    for (const sym of SYMBOLS) {
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

      await supabase.from('price_data_archive_log').insert({
        run_id: runId,
        archive_date: new Date().toISOString().split('T')[0],
        file_path: 'none',
        cutoff_timestamp: cutoffISO,
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
    const archiveDate = new Date().toISOString().split('T')[0];
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

    const { data: fileCheck } = await supabase.storage
      .from('price-data-archives')
      .list(archiveDate);

    const fileExists = fileCheck?.some(f => f.name === `${runId}.csv`);
    if (!fileExists) {
      throw new Error('Validation failed: file not found in storage after upload');
    }

    // Verify row counts per symbol match
    for (const sym of SYMBOLS) {
      const exportedCount = perSymbolCounts[sym] ?? 0;
      const csvSymbolCount = allRows.filter(r => r.symbol === sym).length;
      if (exportedCount !== csvSymbolCount) {
        throw new Error(`Validation failed: ${sym} count mismatch (query=${exportedCount}, csv=${csvSymbolCount})`);
      }
    }

    logger.info(`[lifecycle][${runId}] Validation passed: file exists, counts match, checksum=${checksum}`);

    // ── STEP 3: PRUNE (per-symbol batched via RPC) ──
    logger.info(`[lifecycle][${runId}] Step 3: Prune`);
    let totalDeleted = 0;

    for (const sym of SYMBOLS) {
      if ((perSymbolCounts[sym] ?? 0) === 0) continue;

      let symDeleted = 0;
      let batchNum = 0;

      while (true) {
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
          // Log partial progress and abort
          await supabase.from('price_data_archive_log').insert({
            run_id: runId,
            archive_date: archiveDate,
            file_path: filePath,
            cutoff_timestamp: cutoffISO,
            row_count_exported: totalExported,
            row_count_deleted: totalDeleted,
            per_symbol_counts: perSymbolCounts,
            earliest_timestamp: earliestTs,
            latest_timestamp: latestTs,
            file_checksum: checksum,
            prune_status: 'partial',
            error_message: `Prune failed at ${sym} batch ${batchNum}: ${pruneError.message}`,
          });
          return withCors({
            success: false,
            run_id: runId,
            error: `Prune failed at ${sym}`,
            exported: totalExported,
            deleted: totalDeleted,
          }, 500);
        }

        const batchDeleted = deleted ?? 0;
        symDeleted += batchDeleted;
        totalDeleted += batchDeleted;

        if (batchDeleted < PRUNE_BATCH_SIZE) break;
        await sleep(PRUNE_SLEEP_MS);
      }

      logger.info(`[lifecycle][${runId}] ${sym}: pruned ${symDeleted} rows`);
    }

    // ── STEP 4: LOG ──
    logger.info(`[lifecycle][${runId}] Step 4: Log`);

    await supabase.from('price_data_archive_log').insert({
      run_id: runId,
      archive_date: archiveDate,
      file_path: filePath,
      cutoff_timestamp: cutoffISO,
      row_count_exported: totalExported,
      row_count_deleted: totalDeleted,
      per_symbol_counts: perSymbolCounts,
      earliest_timestamp: earliestTs,
      latest_timestamp: latestTs,
      file_checksum: checksum,
      prune_status: 'success',
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[lifecycle][${runId}] === Lifecycle complete in ${elapsed}s: exported=${totalExported}, deleted=${totalDeleted} ===`);

    return withCors({
      success: true,
      run_id: runId,
      cutoff: cutoffISO,
      exported: totalExported,
      deleted: totalDeleted,
      per_symbol_counts: perSymbolCounts,
      file_path: filePath,
      checksum,
      elapsed_seconds: parseFloat(elapsed),
    });

  } catch (error) {
    logger.error(`[lifecycle][${runId}] Fatal error: ${error.message}`);
    return withCors({
      success: false,
      run_id: runId,
      error: error.message,
    }, 500);
  }
});
