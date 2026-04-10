/**
 * onchain-deposit-watcher
 * 
 * ADDITIVE ONLY - Does not touch execution_wallets or is_funded flag (Flow A)
 * 
 * This edge function implements Flow B (deposit attribution):
 * - Polls Base chain for transactions to the system wallet (BOT_ADDRESS)
 * - For each inbound tx:
 *   - Extracts tx.from, tx.hash, amount, block, etc.
 *   - Calls lookup_user_by_external_address to find matching user
 *   - If match_count = 1: fetches EUR rate and calls settle_deposit_attribution
 *   - If match_count = 0 or > 1: inserts into unattributed_deposits
 * 
 * Idempotency: tx_hash uniqueness is enforced by DB constraints
 * 
 * NOTE: This function is designed to be called by a cron job or manual trigger
 * It does NOT use webhooks - it polls the blockchain via RPC
 * 
 * PERFORMANCE: Uses JSON-RPC batching to scan blocks efficiently.
 * Default lookback is 200 blocks (~6 min on Base). blockStep=1 for <=1000 blocks.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, withCors } from "../_shared/cors.ts";
import { logger } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BASE_RPC_URL = Deno.env.get("BASE_RPC_URL") || "https://mainnet.base.org";
const BOT_ADDRESS = Deno.env.get("BOT_ADDRESS"); // System wallet address

const BASE_CHAIN_ID = 8453;
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ERC20 Transfer event signature
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Batch RPC config
const RPC_BATCH_SIZE = 50; // blocks per batch HTTP call

interface TransferEvent {
  txHash: string;
  blockNumber: number;
  blockTimestamp: string;
  fromAddress: string;
  toAddress: string;
  amount: number;
  amountRaw: string;
  asset: string;
  assetAddress: string | null;
}

/**
 * Send a batch of JSON-RPC calls in a single HTTP request.
 * Returns an array of results in the same order as the calls.
 */
async function batchRpc(
  calls: Array<{ method: string; params: unknown[]; id: number }>
): Promise<any[]> {
  const body = calls.map((c) => ({
    jsonrpc: "2.0",
    method: c.method,
    params: c.params,
    id: c.id,
  }));

  const resp = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`RPC batch failed: ${resp.status} ${resp.statusText}`);
  }

  const results = await resp.json();

  // Sort by id to guarantee order
  if (Array.isArray(results)) {
    results.sort((a: any, b: any) => a.id - b.id);
  }

  return Array.isArray(results) ? results : [results];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTs = Date.now();

  try {
    // Validate BOT_ADDRESS is configured
    if (!BOT_ADDRESS) {
      logger.error("[deposit-watcher] BOT_ADDRESS not configured");
      return withCors({ error: "System wallet not configured" }, 500);
    }

    const botAddressLower = BOT_ADDRESS.toLowerCase();

    // Create Supabase client
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request body for optional parameters
    let lookbackBlocks = 200; // Default: ~6 minutes on Base (reduced from 500)
    try {
      const body = await req.json();
      if (body?.lookback_blocks && typeof body.lookback_blocks === "number") {
        lookbackBlocks = Math.min(body.lookback_blocks, 1000); // Cap at 1000 blocks
      }
    } catch {
      // No body or invalid JSON - use defaults
    }

    logger.info("[deposit-watcher] Starting scan", {
      bot_address: botAddressLower.slice(0, 10) + "...",
      lookback_blocks: lookbackBlocks,
    });

    // Get current block number
    const blockNumResponse = await fetch(BASE_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: 1,
      }),
    });

    const blockNumResult = await blockNumResponse.json();
    const currentBlock = parseInt(blockNumResult.result, 16);
    const fromBlock = currentBlock - lookbackBlocks;

    logger.info("[deposit-watcher] Block range", {
      from: fromBlock,
      to: currentBlock,
    });

    // Collect transfers to process
    const transfers: TransferEvent[] = [];

    // ──────────────────────────────────────────────
    // 1. Scan for native ETH transfers using BATCHED RPC
    // ──────────────────────────────────────────────
    logger.info("[deposit-watcher] Scanning for native ETH transfers (batched)...");

    const blockStep = lookbackBlocks <= 1000 ? 1 : Math.max(1, Math.floor(lookbackBlocks / 200));

    // Build list of block numbers to scan
    const blockNums: number[] = [];
    for (let b = fromBlock; b <= currentBlock; b += blockStep) {
      blockNums.push(b);
    }

    // Process in batches of RPC_BATCH_SIZE
    for (let i = 0; i < blockNums.length; i += RPC_BATCH_SIZE) {
      const batch = blockNums.slice(i, i + RPC_BATCH_SIZE);

      const calls = batch.map((blockNum, idx) => ({
        method: "eth_getBlockByNumber",
        params: ["0x" + blockNum.toString(16), true], // true = full tx objects
        id: i + idx + 100, // unique id
      }));

      try {
        const results = await batchRpc(calls);

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (!result?.result?.transactions) continue;

          const blockNum = batch[j];
          const blockTimestamp = new Date(
            parseInt(result.result.timestamp, 16) * 1000
          ).toISOString();

          for (const tx of result.result.transactions) {
            if (
              tx.to &&
              tx.to.toLowerCase() === botAddressLower &&
              tx.value &&
              tx.value !== "0x0"
            ) {
              const valueWei = BigInt(tx.value);
              if (valueWei > 0n) {
                transfers.push({
                  txHash: tx.hash,
                  blockNumber: blockNum,
                  blockTimestamp,
                  fromAddress: tx.from.toLowerCase(),
                  toAddress: botAddressLower,
                  amount: Number(valueWei) / 1e18,
                  amountRaw: valueWei.toString(),
                  asset: "ETH",
                  assetAddress: null,
                });

                logger.info("[deposit-watcher] Found native ETH transfer", {
                  tx_hash: tx.hash.slice(0, 10),
                  from: tx.from.slice(0, 10),
                  amount_eth: Number(valueWei) / 1e18,
                });
              }
            }
          }
        }
      } catch (batchErr) {
        logger.warn("[deposit-watcher] Batch fetch failed", {
          batch_start: batch[0],
          batch_size: batch.length,
          error: batchErr instanceof Error ? batchErr.message : String(batchErr),
        });
      }
    }

    // ──────────────────────────────────────────────
    // 2. Scan for ERC20 transfers (WETH, USDC) — single eth_getLogs call
    // ──────────────────────────────────────────────
    const erc20Logs = await fetch(BASE_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [
          {
            fromBlock: "0x" + fromBlock.toString(16),
            toBlock: "0x" + currentBlock.toString(16),
            address: [WETH_ADDRESS, USDC_ADDRESS],
            topics: [
              TRANSFER_TOPIC,
              null, // from (any)
              "0x" + "0".repeat(24) + botAddressLower.slice(2), // to = BOT_ADDRESS
            ],
          },
        ],
        id: 2,
      }),
    });

    const erc20Result = await erc20Logs.json();

    if (erc20Result.result && Array.isArray(erc20Result.result)) {
      // Collect unique block numbers for timestamp lookup
      const uniqueBlocks = [
        ...new Set(erc20Result.result.map((l: any) => l.blockNumber as string)),
      ];

      // Batch-fetch block timestamps
      const blockTimestampMap: Record<string, string> = {};
      if (uniqueBlocks.length > 0) {
        const tsCalls = uniqueBlocks.map((bn, idx) => ({
          method: "eth_getBlockByNumber",
          params: [bn, false],
          id: idx + 5000,
        }));

        try {
          const tsResults = await batchRpc(tsCalls);
          for (let k = 0; k < tsResults.length; k++) {
            if (tsResults[k]?.result?.timestamp) {
              blockTimestampMap[uniqueBlocks[k]] = new Date(
                parseInt(tsResults[k].result.timestamp, 16) * 1000
              ).toISOString();
            }
          }
        } catch (tsErr) {
          logger.warn("[deposit-watcher] ERC20 block timestamp batch failed", {
            error: tsErr instanceof Error ? tsErr.message : String(tsErr),
          });
        }
      }

      for (const log of erc20Result.result) {
        const fromAddress = "0x" + log.topics[1].slice(26).toLowerCase();
        const amount = BigInt(log.data);
        const tokenAddress = log.address.toLowerCase();

        let asset = "UNKNOWN";
        let decimals = 18;
        if (tokenAddress === WETH_ADDRESS.toLowerCase()) {
          asset = "WETH";
          decimals = 18;
        } else if (tokenAddress === USDC_ADDRESS.toLowerCase()) {
          asset = "USDC";
          decimals = 6;
        }

        const blockTimestamp =
          blockTimestampMap[log.blockNumber] || new Date().toISOString();

        transfers.push({
          txHash: log.transactionHash,
          blockNumber: parseInt(log.blockNumber, 16),
          blockTimestamp,
          fromAddress,
          toAddress: botAddressLower,
          amount: Number(amount) / Math.pow(10, decimals),
          amountRaw: amount.toString(),
          asset,
          assetAddress: tokenAddress,
        });
      }
    }

    logger.info("[deposit-watcher] Found transfers", { count: transfers.length });

    // ──────────────────────────────────────────────
    // 3. Process each transfer (attribution)
    // ──────────────────────────────────────────────
    let matched = 0;
    let unmatched = 0;
    let ambiguous = 0;
    let alreadyProcessed = 0;

    for (const transfer of transfers) {
      try {
        // Check if already processed (idempotency via tx_hash)
        const { data: existing } = await supabaseAdmin
          .from("deposit_attributions")
          .select("id")
          .eq("tx_hash", transfer.txHash)
          .maybeSingle();

        if (existing) {
          alreadyProcessed++;
          continue;
        }

        // Also check unattributed_deposits
        const { data: existingUnattr } = await supabaseAdmin
          .from("unattributed_deposits")
          .select("id")
          .eq("tx_hash", transfer.txHash)
          .maybeSingle();

        if (existingUnattr) {
          alreadyProcessed++;
          continue;
        }

        // Lookup user by external address
        const lookupResult = await supabaseAdmin.rpc(
          "lookup_user_by_external_address",
          {
            p_chain_id: BASE_CHAIN_ID,
            p_address: transfer.fromAddress,
          }
        );

        if (lookupResult.error) {
          logger.error("[deposit-watcher] Lookup error", {
            error: lookupResult.error.message,
          });
          continue;
        }

        const matchCount = lookupResult.data?.match_count ?? 0;
        const userId = lookupResult.data?.user_id;

        if (matchCount === 0) {
          logger.info("[deposit-watcher] No match", {
            from: transfer.fromAddress.slice(0, 10),
            tx: transfer.txHash.slice(0, 10),
          });

          await supabaseAdmin.from("unattributed_deposits").insert({
            tx_hash: transfer.txHash,
            chain_id: BASE_CHAIN_ID,
            from_address: transfer.fromAddress,
            to_address: transfer.toAddress,
            amount: transfer.amount,
            amount_raw: transfer.amountRaw,
            asset: transfer.asset,
            asset_address: transfer.assetAddress,
            block_number: transfer.blockNumber,
            block_timestamp: transfer.blockTimestamp,
            reason: "NO_MATCHING_ADDRESS",
          });

          unmatched++;
        } else if (matchCount > 1) {
          logger.warn("[deposit-watcher] Ambiguous match", {
            from: transfer.fromAddress.slice(0, 10),
            match_count: matchCount,
          });

          await supabaseAdmin.from("unattributed_deposits").insert({
            tx_hash: transfer.txHash,
            chain_id: BASE_CHAIN_ID,
            from_address: transfer.fromAddress,
            to_address: transfer.toAddress,
            amount: transfer.amount,
            amount_raw: transfer.amountRaw,
            asset: transfer.asset,
            asset_address: transfer.assetAddress,
            block_number: transfer.blockNumber,
            block_timestamp: transfer.blockTimestamp,
            reason: "AMBIGUOUS_ADDRESS",
          });

          ambiguous++;
        } else {
          // Exact match — settle deposit
          logger.info("[deposit-watcher] Match found", {
            user_id: userId?.slice(0, 8),
            amount: transfer.amount,
            asset: transfer.asset,
          });

          // Fetch EUR rate
          let eurAmount = 0;
          let eurRate = 0;

          try {
            const { data: priceData } = await supabaseAdmin
              .from("price_snapshots")
              .select("price_eur")
              .eq("symbol", transfer.asset === "WETH" ? "ETH" : transfer.asset)
              .order("observed_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (priceData?.price_eur) {
              eurRate = priceData.price_eur;
              eurAmount = transfer.amount * eurRate;
            } else {
              if (transfer.asset === "WETH" || transfer.asset === "ETH") {
                eurRate = 2000;
              } else if (transfer.asset === "USDC") {
                eurRate = 0.92;
              }
              eurAmount = transfer.amount * eurRate;
            }
          } catch {
            if (transfer.asset === "WETH" || transfer.asset === "ETH") {
              eurRate = 2000;
            } else if (transfer.asset === "USDC") {
              eurRate = 0.92;
            }
            eurAmount = transfer.amount * eurRate;
          }

          // Settle
          const settleResult = await supabaseAdmin.rpc(
            "settle_deposit_attribution",
            {
              p_user_id: userId,
              p_tx_hash: transfer.txHash,
              p_chain_id: BASE_CHAIN_ID,
              p_from_address: transfer.fromAddress,
              p_amount: transfer.amount,
              p_amount_raw: transfer.amountRaw,
              p_asset: transfer.asset,
              p_asset_address: transfer.assetAddress,
              p_block_number: transfer.blockNumber,
              p_block_timestamp: transfer.blockTimestamp,
              p_eur_rate: eurRate,
              p_eur_amount: eurAmount,
            }
          );

          if (settleResult.error) {
            logger.error("[deposit-watcher] Settlement error", {
              error: settleResult.error.message,
              tx: transfer.txHash.slice(0, 10),
            });
          } else if (settleResult.data?.already_processed) {
            alreadyProcessed++;
          } else {
            logger.info("[deposit-watcher] Settlement success", {
              tx: transfer.txHash.slice(0, 10),
              eur_amount: eurAmount,
            });
            matched++;
          }
        }
      } catch (transferErr) {
        logger.error("[deposit-watcher] Transfer processing error", {
          error:
            transferErr instanceof Error
              ? transferErr.message
              : String(transferErr),
          tx: transfer.txHash.slice(0, 10),
        });
      }
    }

    const durationMs = Date.now() - startTs;

    logger.info("[deposit-watcher] Scan complete", {
      transfers_found: transfers.length,
      matched,
      unmatched,
      ambiguous,
      already_processed: alreadyProcessed,
      duration_ms: durationMs,
    });

    return withCors({
      success: true,
      summary: {
        transfers_scanned: transfers.length,
        matched,
        unmatched,
        ambiguous,
        already_processed: alreadyProcessed,
        block_range: { from: fromBlock, to: currentBlock },
      },
      duration_ms: durationMs,
    });
  } catch (err) {
    logger.error("[deposit-watcher] Fatal error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return withCors(
      {
        error: err instanceof Error ? err.message : "Unknown error",
      },
      500
    );
  }
});
