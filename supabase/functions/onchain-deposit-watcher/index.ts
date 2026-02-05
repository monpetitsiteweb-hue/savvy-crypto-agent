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
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, withCors } from "../_shared/cors.ts";
import { logger } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BASE_RPC_URL = Deno.env.get("BASE_RPC_URL") || "https://mainnet.base.org";
const BOT_ADDRESS = Deno.env.get("BOT_ADDRESS"); // System wallet address

const BASE_CHAIN_ID = 8453;
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ERC20 Transfer event signature
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

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

    // Create Supabase clients
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request body for optional parameters
    let lookbackBlocks = 100; // Default: ~3 minutes of blocks on Base
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
      lookback_blocks: lookbackBlocks 
    });

    // Get current block number
    const blockNumResponse = await fetch(BASE_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: 1
      })
    });

    const blockNumResult = await blockNumResponse.json();
    const currentBlock = parseInt(blockNumResult.result, 16);
    const fromBlock = currentBlock - lookbackBlocks;

    logger.info("[deposit-watcher] Block range", { 
      from: fromBlock, 
      to: currentBlock 
    });

    // Collect transfers to process
    const transfers: TransferEvent[] = [];

    // 1. Scan for native ETH transfers by iterating blocks
    // We check each block's transactions for transfers TO the bot address
    logger.info("[deposit-watcher] Scanning for native ETH transfers...");
    
    // To avoid too many RPC calls, sample blocks or use a reasonable range
    // For each block, get transactions and filter for to === BOT_ADDRESS
    const blocksToCheck = Math.min(lookbackBlocks, 200); // Limit to avoid timeout
    const blockStep = Math.max(1, Math.floor(lookbackBlocks / blocksToCheck));
    
    for (let blockNum = fromBlock; blockNum <= currentBlock; blockNum += blockStep) {
      try {
        const blockResponse = await fetch(BASE_RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBlockByNumber",
            params: ["0x" + blockNum.toString(16), true], // true = include full tx objects
            id: 10
          })
        });
        
        const blockResult = await blockResponse.json();
        if (!blockResult.result || !blockResult.result.transactions) continue;
        
        const blockTimestamp = new Date(parseInt(blockResult.result.timestamp, 16) * 1000).toISOString();
        
        for (const tx of blockResult.result.transactions) {
          // Check if this is a native ETH transfer TO the bot address
          if (tx.to && tx.to.toLowerCase() === botAddressLower && tx.value && tx.value !== "0x0") {
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
                assetAddress: null // Native ETH has no contract address
              });
              
              logger.info("[deposit-watcher] Found native ETH transfer", {
                tx_hash: tx.hash.slice(0, 10),
                from: tx.from.slice(0, 10),
                amount_eth: Number(valueWei) / 1e18
              });
            }
          }
        }
      } catch (blockErr) {
        // Skip failed blocks
        logger.warn("[deposit-watcher] Block fetch failed", { block: blockNum });
      }
    }

    // 2. Scan for ERC20 transfers (WETH, USDC) to BOT_ADDRESS
    const erc20Logs = await fetch(BASE_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [{
          fromBlock: "0x" + fromBlock.toString(16),
          toBlock: "0x" + currentBlock.toString(16),
          address: [WETH_ADDRESS, USDC_ADDRESS],
          topics: [
            TRANSFER_TOPIC,
            null, // from (any)
            "0x" + "0".repeat(24) + botAddressLower.slice(2) // to = BOT_ADDRESS (padded)
          ]
        }],
        id: 2
      })
    });

    const erc20Result = await erc20Logs.json();
    
    if (erc20Result.result && Array.isArray(erc20Result.result)) {
      for (const log of erc20Result.result) {
        const fromAddress = "0x" + log.topics[1].slice(26).toLowerCase();
        const amount = BigInt(log.data);
        const tokenAddress = log.address.toLowerCase();
        
        // Determine asset and decimals
        let asset = "UNKNOWN";
        let decimals = 18;
        if (tokenAddress === WETH_ADDRESS.toLowerCase()) {
          asset = "WETH";
          decimals = 18;
        } else if (tokenAddress === USDC_ADDRESS.toLowerCase()) {
          asset = "USDC";
          decimals = 6;
        }

        // Get block timestamp
        const blockResponse = await fetch(BASE_RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBlockByNumber",
            params: [log.blockNumber, false],
            id: 3
          })
        });
        const blockResult = await blockResponse.json();
        const blockTimestamp = new Date(parseInt(blockResult.result.timestamp, 16) * 1000).toISOString();

        transfers.push({
          txHash: log.transactionHash,
          blockNumber: parseInt(log.blockNumber, 16),
          blockTimestamp,
          fromAddress,
          toAddress: botAddressLower,
          amount: Number(amount) / Math.pow(10, decimals),
          amountRaw: amount.toString(),
          asset,
          assetAddress: tokenAddress
        });
      }
    }

    logger.info("[deposit-watcher] Found transfers", { count: transfers.length });

    // Process each transfer
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
          logger.info("[deposit-watcher] Already processed", { tx_hash: transfer.txHash.slice(0, 10) });
          alreadyProcessed++;
          continue;
        }

        // Lookup user by external address
        const { data: lookupResult, error: lookupError } = await supabaseAdmin.rpc(
          "lookup_user_by_external_address",
          {
            p_chain_id: BASE_CHAIN_ID,
            p_address: transfer.fromAddress
          }
        );

        if (lookupError) {
          logger.error("[deposit-watcher] Lookup error", { error: lookupError.message });
          continue;
        }

        const matchCount = lookupResult?.match_count ?? 0;
        const userId = lookupResult?.user_id;

        if (matchCount === 0) {
          // No match - insert into unattributed_deposits
          logger.info("[deposit-watcher] No match", { 
            from: transfer.fromAddress.slice(0, 10),
            tx: transfer.txHash.slice(0, 10)
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
            reason: "NO_MATCHING_ADDRESS"
          });

          unmatched++;
        } else if (matchCount > 1) {
          // Ambiguous - multiple users claim this address (should not happen with unique constraint)
          logger.warn("[deposit-watcher] Ambiguous match", { 
            from: transfer.fromAddress.slice(0, 10),
            match_count: matchCount
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
            reason: "AMBIGUOUS_ADDRESS"
          });

          ambiguous++;
        } else {
          // Exact match (match_count = 1) - settle the deposit
          logger.info("[deposit-watcher] Match found", { 
            user_id: userId?.slice(0, 8),
            amount: transfer.amount,
            asset: transfer.asset
          });

          // Fetch EUR rate for the asset
          // For now, use price_snapshots if available, otherwise estimate
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
              // Fallback: rough estimate (should not happen in production)
              if (transfer.asset === "WETH") {
                eurRate = 2000; // Fallback ETH price
                eurAmount = transfer.amount * eurRate;
              } else if (transfer.asset === "USDC") {
                eurRate = 0.92; // Fallback EUR/USD
                eurAmount = transfer.amount * eurRate;
              }
            }
          } catch (priceErr) {
            logger.warn("[deposit-watcher] Price fetch failed", { error: priceErr });
            // Use fallback values
            if (transfer.asset === "WETH") {
              eurRate = 2000;
              eurAmount = transfer.amount * eurRate;
            } else if (transfer.asset === "USDC") {
              eurRate = 0.92;
              eurAmount = transfer.amount * eurRate;
            }
          }

          // Call settle_deposit_attribution RPC
          const { data: settleResult, error: settleError } = await supabaseAdmin.rpc(
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
              p_eur_amount: eurAmount
            }
          );

          if (settleError) {
            logger.error("[deposit-watcher] Settlement error", { 
              error: settleError.message,
              tx: transfer.txHash.slice(0, 10)
            });
          } else if (settleResult?.already_processed) {
            logger.info("[deposit-watcher] Settlement idempotent hit", { 
              tx: transfer.txHash.slice(0, 10)
            });
            alreadyProcessed++;
          } else {
            logger.info("[deposit-watcher] Settlement success", { 
              tx: transfer.txHash.slice(0, 10),
              eur_amount: eurAmount
            });
            matched++;
          }
        }
      } catch (transferErr) {
        logger.error("[deposit-watcher] Transfer processing error", { 
          error: transferErr instanceof Error ? transferErr.message : String(transferErr),
          tx: transfer.txHash.slice(0, 10)
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
      duration_ms: durationMs
    });

    return withCors({
      success: true,
      summary: {
        transfers_scanned: transfers.length,
        matched,
        unmatched,
        ambiguous,
        already_processed: alreadyProcessed,
        block_range: { from: fromBlock, to: currentBlock }
      },
      duration_ms: durationMs
    });

  } catch (err) {
    logger.error("[deposit-watcher] Fatal error", { 
      error: err instanceof Error ? err.message : String(err)
    });
    return withCors({ 
      error: err instanceof Error ? err.message : "Unknown error" 
    }, 500);
  }
});
