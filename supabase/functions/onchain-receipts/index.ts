import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ========================================================================
// Notification Helper
// ========================================================================
async function sendNotification(payload: {
  event: string;
  tradeId: string;
  chainId: number;
  txHash?: string | null;
  provider?: string;
  symbol?: string;
  side?: string;
  explorerUrl?: string;
  error?: string;
  gasUsed?: string;
  blockNumber?: string;
}) {
  const webhookUrl = Deno.env.get('NOTIFICATION_WEBHOOK_URL');
  if (!webhookUrl) return;

  const webhookType = Deno.env.get('NOTIFICATION_WEBHOOK_TYPE') || 'slack';

  try {
    let body: any;

    if (webhookType === 'discord') {
      const emoji = payload.event === 'mined' ? '✅' : '❌';
      const fields = [
        { name: 'Trade ID', value: `\`${payload.tradeId}\``, inline: true },
        { name: 'Chain', value: `Base (${payload.chainId})`, inline: true },
        { name: 'Provider', value: payload.provider || 'N/A', inline: true },
        { name: 'Symbol', value: payload.symbol || 'N/A', inline: true },
        { name: 'Side', value: payload.side?.toUpperCase() || 'N/A', inline: true },
      ];

      if (payload.txHash) {
        fields.push({ name: 'TX Hash', value: `\`${payload.txHash}\``, inline: false });
      }
      if (payload.explorerUrl) {
        fields.push({ name: 'Explorer', value: `[View on BaseScan](${payload.explorerUrl})`, inline: false });
      }
      if (payload.gasUsed) {
        fields.push({ name: 'Gas Used', value: payload.gasUsed, inline: true });
      }
      if (payload.blockNumber) {
        fields.push({ name: 'Block', value: payload.blockNumber, inline: true });
      }
      if (payload.error) {
        fields.push({ name: 'Error', value: `\`\`\`${payload.error}\`\`\``, inline: false });
      }

      body = {
        embeds: [{
          title: `${emoji} ${payload.event.toUpperCase()}`,
          color: payload.event === 'mined' ? 0x00ff00 : 0xff0000,
          fields,
          timestamp: new Date().toISOString(),
        }],
      };
    } else {
      const emoji = payload.event === 'mined' ? ':white_check_mark:' : ':x:';
      const fields = [
        { title: 'Trade ID', value: payload.tradeId, short: true },
        { title: 'Chain', value: `Base (${payload.chainId})`, short: true },
        { title: 'Provider', value: payload.provider || 'N/A', short: true },
        { title: 'Symbol', value: payload.symbol || 'N/A', short: true },
        { title: 'Side', value: payload.side?.toUpperCase() || 'N/A', short: true },
      ];

      if (payload.txHash) {
        fields.push({ title: 'TX Hash', value: `\`${payload.txHash}\``, short: false });
      }
      if (payload.explorerUrl) {
        fields.push({ title: 'Explorer', value: `<${payload.explorerUrl}|View on BaseScan>`, short: false });
      }
      if (payload.gasUsed) {
        fields.push({ title: 'Gas Used', value: payload.gasUsed, short: true });
      }
      if (payload.blockNumber) {
        fields.push({ title: 'Block', value: payload.blockNumber, short: true });
      }
      if (payload.error) {
        fields.push({ title: 'Error', value: `\`\`\`${payload.error}\`\`\``, short: false });
      }

      body = {
        attachments: [{
          color: payload.event === 'mined' ? 'good' : 'danger',
          title: `${emoji} ${payload.event.toUpperCase()}`,
          fields,
          footer: 'Onchain Execution',
          ts: Math.floor(Date.now() / 1000),
        }],
      };
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.warn(`⚠️  Notification failed: ${response.status}`);
    }
  } catch (err) {
    console.warn('⚠️  Notification error:', err.message);
  }
}

const PROJECT_URL = Deno.env.get('SB_URL')!;
const SERVICE_ROLE = Deno.env.get('SB_SERVICE_ROLE')!;

const supabase = createClient(PROJECT_URL, SERVICE_ROLE);

const RPC_URLS: Record<number, string> = {
  1: Deno.env.get('RPC_URL_1') || 'https://eth.llamarpc.com',
  8453: Deno.env.get('RPC_URL_8453') || 'https://base.llamarpc.com',
  42161: Deno.env.get('RPC_URL_42161') || 'https://arbitrum.llamarpc.com',
};

// ============================================================================
// RECEIPT LOG DECODER: Extract filled amounts and prices from on-chain events
// This is the ONLY source of truth for real trade economics
// ============================================================================
//
// SUPPORTED SWAP PATTERNS & ROUTERS:
// -----------------------------------
// This decoder is router-agnostic. It works by analyzing ERC-20 Transfer events
// emitted during swap execution, which means it supports ANY router that results
// in standard ERC-20 transfers, including:
//   - Uniswap V2/V3 (direct and via UniversalRouter)
//   - 1inch Aggregation Protocol (all versions)
//   - 0x API (ExchangeProxy, Settler)
//   - CoW Protocol (GPv2Settlement)
//   - Paraswap, Odos, KyberSwap, etc.
//
// ASSUMPTIONS:
// -----------------------------------
// 1. SINGLE-HOP PREFERRED: The decoder identifies the final token transfer pair
//    (token <-> stablecoin). Multi-hop swaps (e.g., WETH->USDC->DAI) will decode
//    correctly as long as the final pair includes a known stablecoin.
//
// 2. ERC-20 ONLY: Only standard ERC-20 Transfer events are parsed. Native ETH
//    transfers are NOT captured (must be wrapped to WETH first via permit2/WETH).
//
// 3. FEE-ON-TRANSFER TOKENS: Tokens with transfer fees will show the RECEIVED
//    amount (post-fee), which is the correct economic value for accounting.
//    The decoder does not attempt to infer or add back fees.
//
// 4. STABLECOIN DETECTION: Price is derived from transfers involving known
//    stablecoins (USDC, DAI, USDbC on Base). Swaps without stablecoin legs
//    (e.g., WETH->cbETH) will use a two-transfer fallback with lower confidence.
//
// 5. TOKEN DECIMALS: Unknown tokens default to 18 decimals. For precise accounting
//    of non-standard tokens, add them to KNOWN_TOKENS map.
//
// FAIL-CLOSED BEHAVIOR:
// -----------------------------------
// If the decoder CANNOT extract a valid (filledAmount, executedPrice, totalValue)
// tuple from the receipt logs, it returns { success: false } with an error reason.
// The caller MUST refuse ledger insertion when success=false.
// This ensures NO real trade is ever recorded with estimated/quoted values.
//
// UNRECOGNIZED PATTERNS:
// -----------------------------------
// The following will cause decoding to fail (success=false):
//   - Transactions with no logs (internal calls only)
//   - Transactions with no ERC-20 Transfer events
//   - Swaps that don't involve any known stablecoins AND have <2 transfers
//   - Failed/reverted transactions (no Transfer events emitted)
//
// When a new router pattern is encountered that fails decoding:
//   1. The trade will NOT be recorded in the ledger (fail-closed)
//   2. An error event is logged with decoded transfer details for debugging
//   3. Extension requires adding pattern recognition here, not in caller
//
// ============================================================================

// ERC-20 Transfer event topic: Transfer(address,address,uint256)
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Known stablecoin addresses on Base (for price derivation)
const STABLECOINS: Record<string, { decimals: number; symbol: string }> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { decimals: 6, symbol: 'USDC' },  // USDC on Base
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { decimals: 18, symbol: 'DAI' },   // DAI on Base
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { decimals: 6, symbol: 'USDbC' },  // USDbC on Base
};

// Known token addresses on Base (for amount parsing)
// Add new tokens here to ensure correct decimal handling
const KNOWN_TOKENS: Record<string, { decimals: number; symbol: string }> = {
  '0x4200000000000000000000000000000000000006': { decimals: 18, symbol: 'WETH' },
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': { decimals: 18, symbol: 'cbETH' },
  ...STABLECOINS,
};

interface DecodeResult {
  success: boolean;
  filledAmount: number;
  executedPrice: number;
  totalValue: number;
  decodeMethod: string;   // 'erc20_transfer_pair' | 'two_transfer_fallback' | 'none' | 'incomplete'
  decodedLogs: any[];     // All parsed transfers for debugging
  error?: string;         // Reason if success=false
}

function decodeSwapFromReceipt(receipt: any, symbol: string, side: string): DecodeResult {
  const logs = receipt.logs || [];
  
  if (logs.length === 0) {
    return {
      success: false,
      filledAmount: 0,
      executedPrice: 0,
      totalValue: 0,
      decodeMethod: 'none',
      decodedLogs: [],
      error: 'No logs in receipt',
    };
  }
  
  // Find all ERC-20 Transfer events
  const transferLogs = logs.filter((log: any) => 
    log.topics && log.topics[0] === ERC20_TRANSFER_TOPIC
  );
  
  if (transferLogs.length === 0) {
    return {
      success: false,
      filledAmount: 0,
      executedPrice: 0,
      totalValue: 0,
      decodeMethod: 'none',
      decodedLogs: [],
      error: 'No ERC-20 Transfer events found',
    };
  }
  
  // Parse transfer events
  const decodedTransfers = transferLogs.map((log: any) => {
    const tokenAddress = log.address?.toLowerCase();
    const tokenInfo = KNOWN_TOKENS[tokenAddress] || { decimals: 18, symbol: 'UNKNOWN' };
    
    // Transfer event: topics[1] = from, topics[2] = to, data = amount
    const from = log.topics[1] ? '0x' + log.topics[1].slice(26) : null;
    const to = log.topics[2] ? '0x' + log.topics[2].slice(26) : null;
    const rawAmount = log.data ? BigInt(log.data) : BigInt(0);
    const amount = Number(rawAmount) / Math.pow(10, tokenInfo.decimals);
    
    return {
      tokenAddress,
      tokenSymbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      from,
      to,
      rawAmount: rawAmount.toString(),
      amount,
      isStablecoin: !!STABLECOINS[tokenAddress],
    };
  });
  
  // ---- Bot wallet (custodial single-EOA model) ----
  const bot = receipt.from?.toLowerCase();
  if (!bot) {
    return {
      success: false,
      filledAmount: 0,
      executedPrice: 0,
      totalValue: 0,
      decodeMethod: 'unknown',
      decodedLogs: decodedTransfers,
      error: 'no_bot_address_in_receipt',
    };
  }

  // ---- Symbol normalization (strategy symbol → on-chain ERC-20 symbol) ----
  // Bot trades wrapped tokens on-chain (WETH, WBTC) but strategies are
  // named after the native asset (ETH, BTC). Other symbols match by themselves.
  const SYMBOL_ALIASES: Record<string, string> = {
    ETH: 'WETH',
    BTC: 'WBTC',
  };
  const expectedOnChainSymbol = SYMBOL_ALIASES[symbol] ?? symbol;

  // ---- Stablecoin transfer (USD value) ----
  // BUY: stable sortant du bot. SELL: stable entrant au bot.
  const stableCandidates = decodedTransfers.filter(t => t.isStablecoin);
  const stablecoinTransfer = side === 'BUY'
    ? (stableCandidates.find(t => t.from?.toLowerCase() === bot) ?? stableCandidates[0])
    : (stableCandidates.findLast(t => t.to?.toLowerCase() === bot) ?? stableCandidates[stableCandidates.length - 1]);

  // ---- Token transfer (filledAmount) ----
  // BUY: dernier non-stable livré au bot. SELL: premier non-stable sortant du bot.
  const nonStable = decodedTransfers.filter(t => !t.isStablecoin);
  const tokenTransfer = side === 'BUY'
    ? (nonStable.findLast(t => t.to?.toLowerCase() === bot) ?? nonStable[nonStable.length - 1])
    : (nonStable.find(t => t.from?.toLowerCase() === bot) ?? nonStable[0]);

  // ---- Coherence guard: tokenSymbol must match strategy symbol ----
  // UNKNOWN toléré (KNOWN_TOKENS incomplet) — sinon fail-closed.
  if (
    tokenTransfer &&
    tokenTransfer.tokenSymbol !== 'UNKNOWN' &&
    tokenTransfer.tokenSymbol !== expectedOnChainSymbol
  ) {
    return {
      success: false,
      filledAmount: 0,
      executedPrice: 0,
      totalValue: 0,
      decodeMethod: 'mismatch_reject',
      decodedLogs: decodedTransfers,
      error: `token_symbol_mismatch: expected ${expectedOnChainSymbol} (from ${symbol}), got ${tokenTransfer.tokenSymbol}`,
    };
  }

  if (!stablecoinTransfer || !tokenTransfer) {
    // Fallback durci : bot-match si possible, sinon fail-closed
    if (decodedTransfers.length >= 2) {
      const tokenFallback = side === 'BUY'
        ? decodedTransfers.findLast(t => t.to?.toLowerCase() === bot)
        : decodedTransfers.find(t => t.from?.toLowerCase() === bot);
      const stableFallback = side === 'BUY'
        ? decodedTransfers.find(t => t.from?.toLowerCase() === bot)
        : decodedTransfers.findLast(t => t.to?.toLowerCase() === bot);

      if (tokenFallback && stableFallback) {
        const filledAmount = tokenFallback.amount;
        const totalValue = stableFallback.amount;
        const executedPrice = filledAmount > 0 ? totalValue / filledAmount : 0;
        return {
          success: true,
          filledAmount,
          executedPrice,
          totalValue,
          decodeMethod: 'bot_match_fallback',
          decodedLogs: decodedTransfers,
        };
      }
    }

    return {
      success: false,
      filledAmount: 0,
      executedPrice: 0,
      totalValue: 0,
      decodeMethod: 'unknown',
      decodedLogs: decodedTransfers,
      error: 'no_valid_transfer_pair',
    };
  }

  const filledAmount = tokenTransfer.amount;
  const totalValue = stablecoinTransfer.amount;
  const executedPrice = filledAmount > 0 ? totalValue / filledAmount : 0;

  return {
    success: true,
    filledAmount,
    executedPrice,
    totalValue,
    decodeMethod: 'erc20_transfer_pair',
    decodedLogs: decodedTransfers,
  };
}

async function getReceipt(chainId: number, txHash: string) {
  const rpcUrl = RPC_URLS[chainId];
  if (!rpcUrl) {
    return { error: `No RPC URL for chainId ${chainId}` };
  }

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [txHash],
        id: 1,
      }),
    });

    const json = await response.json();
    
    if (json.error) {
      return { error: json.error.message || JSON.stringify(json.error) };
    }

    return { receipt: json.result };
  } catch (error) {
    return { error: String(error) };
  }
}

/**
 * Resolve block timestamp with strict fallback chain:
 *   1. receipt.blockTimestamp (if Provider returned it)
 *   2. eth_getBlockByNumber(receipt.blockNumber).timestamp
 *   3. realTrade.created_at (broadcast time, immutable)
 *   4. new Date() — exhausted fallback (logged as critical)
 *
 * Returns { iso, source } so caller can backfill real_trades.block_timestamp
 * only when sourced from on-chain (paths 1 or 2).
 */
async function resolveBlockTimestamp(
  chainId: number,
  receipt: any,
  realTrade: any
): Promise<{ iso: string; source: 'receipt' | 'eth_getBlockByNumber' | 'real_trades.created_at' | 'exhausted' }> {
  // Path 1: receipt already has it
  if (receipt?.blockTimestamp) {
    return {
      iso: new Date(parseInt(receipt.blockTimestamp, 16) * 1000).toISOString(),
      source: 'receipt',
    };
  }

  // Path 2: eth_getBlockByNumber
  const blockNumberHex: string | null = receipt?.blockNumber ?? null;
  if (blockNumberHex) {
    try {
      const rpcUrl = RPC_URLS[chainId];
      if (rpcUrl) {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getBlockByNumber',
            params: [blockNumberHex, false],
            id: 1,
          }),
        });
        const json = await res.json();
        if (json?.result?.timestamp) {
          return {
            iso: new Date(parseInt(json.result.timestamp, 16) * 1000).toISOString(),
            source: 'eth_getBlockByNumber',
          };
        }
      }
    } catch (err) {
      console.error('BLOCK_TIMESTAMP_RPC_EXCEPTION', {
        chainId,
        blockNumber: blockNumberHex,
        error: String(err),
      });
    }
  }

  // Path 3: realTrade.created_at (broadcast time, immutable)
  if (realTrade?.created_at) {
    console.warn('BLOCK_TIMESTAMP_FALLBACK_CREATED_AT', {
      tradeId: realTrade.trade_id ?? realTrade.id,
      blockNumber: blockNumberHex,
    });
    return { iso: new Date(realTrade.created_at).toISOString(), source: 'real_trades.created_at' };
  }

  // Path 4: exhausted (should never happen)
  console.error('BLOCK_TIMESTAMP_FALLBACK_EXHAUSTED', {
    tradeId: realTrade?.trade_id ?? realTrade?.id,
    chainId,
    blockNumber: blockNumberHex,
  });
  return { iso: new Date().toISOString(), source: 'exhausted' };
}

// ============================================================================
// PHASE 3: STATE MACHINE POLLER
// Polls real_trades WHERE execution_status = 'SUBMITTED'
// This is the CANONICAL receipt polling loop
// ============================================================================

/**
 * Canonical receipt polling + finalization for a single SUBMITTED real_trades row.
 *
 * Required invariants:
 * - Lookup is done ONLY by real_trades.trade_id (done in the handler)
 * - RPC polling happens ONLY if tx_hash is present
 * - Writes happen ONLY to real_trades
 */
// ============================================================================
// FX helper: USD→EUR historical rate via frankfurter.app (ECB reference rates)
// Uses the daily close on or before blockTimestamp. In-memory daily cache.
// Fail-soft: returns null on any error so the caller can fall back to USD.
// ============================================================================
const _fxCache = new Map<string, number>();
async function getUsdEurRate(blockTimestamp: string): Promise<number | null> {
  try {
    const day = new Date(blockTimestamp).toISOString().slice(0, 10); // YYYY-MM-DD
    if (_fxCache.has(day)) return _fxCache.get(day)!;
    // Frankfurter returns the latest available rate on/before the requested date.
    const url = `https://api.frankfurter.app/${day}?from=USD&to=EUR`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('FX_FETCH_FAILED', { day, status: res.status });
      return null;
    }
    const json = await res.json();
    const rate = Number(json?.rates?.EUR);
    if (!rate || !isFinite(rate) || rate <= 0) {
      console.error('FX_FETCH_INVALID', { day, json });
      return null;
    }
    _fxCache.set(day, rate);
    return rate;
  } catch (err) {
    console.error('FX_FETCH_EXCEPTION', { error: (err as Error).message });
    return null;
  }
}

// ============================================================================
// T1bis: Finalize the mock_trades placeholder + trigger settlement
// Called after a real_trades row transitions SUBMITTED → CONFIRMED.
// Idempotent: skips if mock_trade is already confirmed AND settled.
// ============================================================================
async function finalizeMockTradeAndSettle(params: {
  mockTradeId: string;
  realTrade: any;
  receipt: any;
  blockTimestamp: string;
}): Promise<{ ok: boolean; reason?: string; error?: string }> {
  const { mockTradeId, realTrade, receipt, blockTimestamp } = params;
  const txHash: string = realTrade.tx_hash;
  const symbol: string = realTrade.cryptocurrency || '';
  const side: string = (realTrade.side || 'BUY').toUpperCase();
  const userId: string = realTrade.user_id;
  let strategyId: string | null = realTrade.strategy_id ?? null;
  const chainId: number = realTrade.chain_id;
  const provider: string | null = realTrade.provider ?? null;
  const isSystemOperator: boolean = realTrade.is_system_operator === true;

  // ── Idempotence applicative : skip si déjà finalisé ───────────────────
  const { data: existingMock } = await supabase
    .from('mock_trades')
    .select('execution_confirmed, settlement_status, original_trade_id, realized_pnl, tx_hash, created_at')
    .eq('id', mockTradeId)
    .maybeSingle();

  if (
    existingMock?.execution_confirmed === true &&
    existingMock?.settlement_status === 'SETTLED'
  ) {
    console.log('MOCK_TRADE_FINALIZE_SKIPPED', {
      mockTradeId,
      reason: 'already_finalized',
      txHash,
    });
    return { ok: true, reason: 'already_finalized' };
  }

  // ── B-fix idempotence guard: protect forensic FIFO corrections ────────
  // If the row already has a complete FIFO stamp + tx_hash + execution_confirmed,
  // do NOT re-finalize — re-polling on-chain receipts would silently overwrite
  // any forensic corrections (e.g. amount split, parent re-mapping).
  if (
    existingMock?.original_trade_id != null &&
    existingMock?.realized_pnl != null &&
    existingMock?.execution_confirmed === true &&
    existingMock?.tx_hash != null
  ) {
    console.log('[onchain-receipts] SKIP idempotent finalize', {
      mock_trade_id: mockTradeId,
      tx_hash: txHash,
      reason: 'already_finalized_with_fifo',
    });
    return { ok: true, reason: 'already_finalized_with_fifo' };
  }

  // ── F2 defensive guard: abandon stale orphans (> 6h post-creation) ────
  // Settlement is best-effort (`never fail the caller`), so a row that never
  // settles can loop forever. Cap retry window to 6h regardless of state.
  // Deployed 2026-05-25 (F2). Complements F1 is_archived filter.
  if (existingMock?.created_at) {
    const ageMs = Date.now() - new Date(existingMock.created_at).getTime();
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    if (ageMs > SIX_HOURS_MS) {
      console.log('ORPHAN_SKIP_STALE', {
        mockTradeId,
        tx_hash: txHash,
        created_at: existingMock.created_at,
        age_hours: (ageMs / 3600000).toFixed(2),
      });
      return { ok: true, reason: 'stale_orphan_skipped' };
    }
  }


  // ── Strategy ID fallback : recover from mock_trades if missing on real_trades ──
  if (!strategyId) {
    const { data: mockRow } = await supabase
      .from('mock_trades')
      .select('strategy_id')
      .eq('id', mockTradeId)
      .maybeSingle();
    if (mockRow?.strategy_id) {
      strategyId = mockRow.strategy_id as string;
      console.log('STRATEGY_ID_FALLBACK_RESOLVED', { mockTradeId, strategyId });
    } else {
      console.error('STRATEGY_ID_FALLBACK_FAILED', { mockTradeId });
    }
  }


  let decoded: DecodeResult;
  try {
    decoded = decodeSwapFromReceipt(receipt, symbol, side);
  } catch (decodeErr) {
    console.error('MOCK_TRADE_DECODE_FAILED', {
      mockTradeId,
      txHash,
      error: (decodeErr as Error).message,
    });
    return { ok: false, error: 'decode_exception' };
  }

  if (!decoded.success) {
    console.error('MOCK_TRADE_DECODE_FAILED', {
      mockTradeId,
      txHash,
      error: decoded.error,
      decode_method: decoded.decodeMethod,
    });
    return { ok: false, error: decoded.error || 'decode_failed' };
  }

  const filledAmount = decoded.filledAmount;
  const executedPriceUsd = decoded.executedPrice;
  const totalValueUsd = decoded.totalValue;

  // ── EUR conversion (Option B: USDC leg × historical USD→EUR FX rate) ──
  // Convention: totalValueEur = usdc_spent × FX(USD/EUR) at blockTimestamp.
  // This represents the actual EUR cost of the USDC leg, eliminating the
  // ~7-8% under-tracking vs the prior asset×ETH-EUR convention.
  let fxUsdEur: number | null = null;
  try {
    fxUsdEur = await getUsdEurRate(blockTimestamp);
  } catch (fxErr) {
    console.error('FX_LOOKUP_FAILED', {
      mockTradeId,
      blockTimestamp,
      error: (fxErr as Error).message,
    });
  }

  let executedPrice = executedPriceUsd;
  let totalValue = totalValueUsd;
  let conversionApplied = false;
  if (fxUsdEur && fxUsdEur > 0 && totalValueUsd > 0 && filledAmount > 0) {
    totalValue = totalValueUsd * fxUsdEur;
    executedPrice = totalValue / filledAmount;
    conversionApplied = true;
  } else {
    console.error('EUR_CONVERSION_FALLBACK_USD', {
      mockTradeId,
      blockTimestamp,
      reason: fxUsdEur ? 'invalid_inputs' : 'no_fx_rate',
    });
  }

  const gasUsedDec = receipt.gasUsed ? parseInt(receipt.gasUsed, 16) : 0;
  const effectiveGasPrice = receipt.effectiveGasPrice
    ? parseInt(receipt.effectiveGasPrice, 16)
    : 0;
  const gasCostEth =
    Number(BigInt(gasUsedDec) * BigInt(effectiveGasPrice)) / 1e18;

  const traceabilityNote = conversionApplied
    ? ` | convention=usdc_fx_eur, fx_usd_eur=${fxUsdEur!.toFixed(4)}, usdc_spent=${totalValueUsd.toFixed(2)}, eur_spent=${totalValue.toFixed(2)}`
    : ` | convention=usd_fallback, usdc_spent=${totalValueUsd.toFixed(2)}`;

  // ── Update the mock_trades placeholder → CONFIRMED ────────────────────
  // NOTE: `purchase_price` does NOT exist on mock_trades — canonical column is `price`.
  const { error: updateError } = await supabase
    .from('mock_trades')
    .update({
      amount: filledAmount,
      price: executedPrice,
      total_value: totalValue,
      execution_confirmed: true,
      execution_source: 'onchain_confirmed',
      execution_ts: blockTimestamp,
      executed_at: blockTimestamp,
      tx_hash: txHash,
      chain_id: chainId,
      gas_cost_eth: gasCostEth,
      notes: `On-chain execution confirmed | tx:${txHash?.substring(0, 10)}... | provider:${provider || 'unknown'} | decoded:${decoded.decodeMethod}${traceabilityNote}`,
    })
    .eq('id', mockTradeId)
    .eq('is_archived', false);

  if (updateError) {
    console.error('MOCK_TRADE_FINALIZE_FAILED', {
      mockTradeId,
      txHash,
      error: updateError.message,
    });
    return { ok: false, error: updateError.message };
  }

  console.log('MOCK_TRADE_FINALIZED', {
    mockTradeId,
    txHash: txHash?.substring(0, 16),
    side,
    symbol,
    amount: filledAmount,
    price: executedPrice,
    decode_method: decoded.decodeMethod,
  });

  // ── Trigger settlement (best-effort, never fail the caller) ───────────
  try {
    const settlementUrl = `${PROJECT_URL}/functions/v1/onchain-settlement`;
    const settlementRes = await fetch(settlementUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        mockTradeId,
        side,
        symbol,
        userId,
        strategyId,
        actualAmount: filledAmount,
        actualPrice: executedPrice,
        totalValueEur: totalValue,
        gasCostEur: gasCostEth,
        txHash,
      }),
    });
    const settlementResult = await settlementRes.json();
    if (settlementResult.ok) {
      console.log('MOCK_TRADE_SETTLED', {
        mockTradeId,
        side,
        result: settlementResult,
      });
    } else {
      console.error('MOCK_TRADE_SETTLEMENT_FAILED', {
        mockTradeId,
        side,
        error: settlementResult.error,
        txHash,
      });
    }
  } catch (settlementErr) {
    console.error('MOCK_TRADE_SETTLEMENT_FAILED', {
      mockTradeId,
      side,
      error:
        settlementErr instanceof Error
          ? settlementErr.message
          : String(settlementErr),
      txHash,
    });
  }

  return { ok: true };
}

async function pollAndFinalizeRealTrade(realTrade: any) {
  const tradeId: string = realTrade.trade_id;
  const chainId: number = realTrade.chain_id;
  const txHash: string | null = realTrade.tx_hash;

  // REQUIRED: diagnostic logging before RPC
  console.log('RECEIPT_POLL_LOOKUP_RESULT', {
    tradeId,
    found: true,
    execution_status: realTrade.execution_status,
    tx_hash: txHash,
  });

  // REQUIRED: use tx_hash ONLY after row is found
  if (!txHash) {
    console.error('RECEIPT_POLL_MISSING_TX_HASH', { tradeId });
    return { tradeId, status: 'error', error: 'tx_hash is null on SUBMITTED real_trades row' };
  }

  const { receipt, error } = await getReceipt(chainId, txHash);
  if (error) {
    console.error('RECEIPT_POLL_RPC_ERROR', { tradeId, txHash, error });
    return { tradeId, tx_hash: txHash, status: 'error', error };
  }

  if (!receipt) {
    return { tradeId, tx_hash: txHash, status: 'pending' };
  }

  const txSuccess = receipt.status === '0x1' || receipt.status === 1;
  const nextExecutionStatus = txSuccess ? 'CONFIRMED' : 'REVERTED';

  // REQUIRED: update state atomically in real_trades ONLY
  const { error: updateError } = await supabase
    .from('real_trades')
    .update({
      execution_status: nextExecutionStatus,
      receipt_status: txSuccess,
      raw_receipt: receipt,
      block_number: receipt.blockNumber ? parseInt(receipt.blockNumber, 16) : null,
      gas_used: receipt.gasUsed ? parseInt(receipt.gasUsed, 16) : null,
    })
    .eq('trade_id', tradeId)
    .eq('execution_status', 'SUBMITTED');

  if (updateError) {
    console.error('REAL_TRADES_STATE_UPDATE_FAILED', {
      tradeId,
      nextExecutionStatus,
      error: updateError.message,
    });
    return { tradeId, tx_hash: txHash, status: 'error', error: updateError.message };
  }

  console.log('REAL_TRADES_FINALIZED', {
    tradeId,
    tx_hash: txHash,
    execution_status: nextExecutionStatus,
    chain_id: chainId,
  });

  // ── T1bis: extend pipeline ─────────────────────────────────────────
  // 3a. Resolve blockTimestamp from receipt
  const { iso: blockTimestamp, source: blockTimestampSource } =
    await resolveBlockTimestamp(chainId, receipt, realTrade);

  // Backfill real_trades.block_timestamp if sourced on-chain and currently NULL
  if (
    (blockTimestampSource === 'receipt' || blockTimestampSource === 'eth_getBlockByNumber') &&
    !realTrade.block_timestamp
  ) {
    await supabase
      .from('real_trades')
      .update({ block_timestamp: blockTimestamp })
      .eq('trade_id', tradeId)
      .is('block_timestamp', null);
  }

  if (txSuccess) {
    // 3b. Lookup the linked mock_trades placeholder via real_trades.trade_id
    //     The coordinator stores the mock_trades.id into real_trades.trade_id
    //     (placeholder pattern). If absent, fall back to idempotency_key match.
    let mockTradeId: string | null = null;

    const { data: mockById } = await supabase
      .from('mock_trades')
      .select('id')
      .eq('id', tradeId)
      .maybeSingle();

    if (mockById?.id) {
      mockTradeId = mockById.id;
    } else {
      const { data: mockByKey } = await supabase
        .from('mock_trades')
        .select('id')
        .eq('idempotency_key', `pending_${tradeId}`)
        .maybeSingle();
      mockTradeId = mockByKey?.id ?? null;
    }

    if (!mockTradeId) {
      console.error('MOCK_TRADE_PLACEHOLDER_NOT_FOUND', {
        tradeId,
        tx_hash: txHash,
      });
    } else {
      // 3c + 3d. Finalize placeholder and trigger settlement
      await finalizeMockTradeAndSettle({
        mockTradeId,
        realTrade,
        receipt,
        blockTimestamp,
      });
    }
  } else {
    // T1bis: log reverted txs explicitly (no settlement, no mock finalize)
    console.log('MOCK_TRADE_REVERTED', {
      tradeId,
      tx_hash: txHash,
      block_number: receipt.blockNumber,
      gas_used: receipt.gasUsed,
    });
  }

  return {
    tradeId,
    tx_hash: txHash,
    status: nextExecutionStatus,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));

    const isScheduled = body?.scheduled === true;
    if (isScheduled) {
      const cronSecret = Deno.env.get('CRON_SECRET');
      const headerSecret = req.headers.get('x-cron-secret');
      if (!cronSecret || headerSecret !== cronSecret) {
        console.error('❌ ONCHAIN_RECEIPTS: CRON_SECRET mismatch or not set');
        return new Response(
          JSON.stringify({ success: false, error: 'forbidden' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log('✅ ONCHAIN_RECEIPTS: CRON_SECRET validated for scheduled call');
    }

    const { tradeId } = body;

    // =========================================================================
    // RECEIPT_POLL_START: Log every polling invocation
    // =========================================================================
    console.log("RECEIPT_POLL_START", {
      mode: tradeId ? 'single' : 'batch',
      tradeId: tradeId || null,
    });

    // REQUIRED: real_trades.trade_id is the ONLY lookup key.
    // REQUIRED: remove legacy fallback logic (no trades/mock_trades polling here).
    let realTradesToPoll: any[] = [];

    if (tradeId) {
      const { data: row, error: dbError } = await supabase
        .from('real_trades')
        .select('*')
        .eq('trade_id', tradeId)
        .eq('execution_status', 'SUBMITTED')
        .limit(1)
        .maybeSingle();

      if (dbError) {
        console.error('RECEIPT_POLL_DB_ERROR', { tradeId, error: dbError.message });
        return new Response(
          JSON.stringify({ error: 'DB error fetching real_trades row', tradeId }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('RECEIPT_POLL_LOOKUP_RESULT', {
        tradeId,
        found: !!row,
        execution_status: row?.execution_status,
        tx_hash: row?.tx_hash,
      });

      // REQUIRED: zero rows is a BUG, not an “empty” poll
      if (!row) {
        console.error('RECEIPT_POLL_HARD_ERROR', {
          tradeId,
          message: 'No SUBMITTED real_trades row found for trade_id',
        });
        return new Response(
          JSON.stringify({ error: 'No SUBMITTED real_trades row found for trade_id', tradeId }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      realTradesToPoll = [row];
    } else {
      const { data: rows, error: realError } = await supabase
        .from('real_trades')
        .select('*')
        .eq('execution_status', 'SUBMITTED')
        .order('created_at', { ascending: true })
        .limit(20);

      if (realError) {
        console.error('RECEIPT_POLL_DB_ERROR', { error: realError.message });
        return new Response(
          JSON.stringify({ error: 'DB error fetching SUBMITTED real_trades rows' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      realTradesToPoll = rows || [];
    }

    // ── Pass A: standard SUBMITTED → CONFIRMED/REVERTED ────────────────
    const results = await Promise.all(realTradesToPoll.map(pollAndFinalizeRealTrade));

    // ── Pass B (batch only): orphan scan ───────────────────────────────
    // Find real_trades already CONFIRMED whose linked mock_trades placeholder
    // is still NOT finalized (execution_confirmed = false). This recovers the
    // ghost trades caused by the previous bug where pollAndFinalizeRealTrade
    // never finalized the mock_trades row.
    const orphanResults: any[] = [];
    if (!tradeId) {
      const { data: confirmedReals, error: orphanErr } = await supabase
        .from('real_trades')
        .select('*')
        .eq('execution_status', 'CONFIRMED')
        .eq('receipt_status', true)
        .gte('created_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      if (orphanErr) {
        console.error('ORPHAN_SCAN_DB_ERROR', { error: orphanErr.message });
      } else if (confirmedReals && confirmedReals.length > 0) {
        for (const rt of confirmedReals) {
          const linkedMockId: string | null = rt.trade_id ?? null;
          if (!linkedMockId) continue;

          const { data: mockRow } = await supabase
            .from('mock_trades')
            .select('id, execution_confirmed, settlement_status, is_archived')
            .eq('id', linkedMockId)
            .maybeSingle();

          if (!mockRow) continue;
          if (mockRow.is_archived === true) {
            console.log('ORPHAN_SKIP_ARCHIVED', {
              mockTradeId: linkedMockId,
              tx_hash: rt.tx_hash,
            });
            continue;
          }
          if (
            mockRow.execution_confirmed === true &&
            mockRow.settlement_status === 'SETTLED'
          ) {
            continue;
          }

          // Re-fetch receipt to get fresh logs for decoding
          const { receipt: orphanReceipt, error: orphanRpcErr } = await getReceipt(
            rt.chain_id,
            rt.tx_hash,
          );
          if (orphanRpcErr || !orphanReceipt) {
            console.error('ORPHAN_RECEIPT_FETCH_FAILED', {
              tradeId: rt.trade_id,
              tx_hash: rt.tx_hash,
              error: orphanRpcErr,
            });
            continue;
          }

          const { iso: blockTimestamp, source: blockTimestampSource } =
            await resolveBlockTimestamp(rt.chain_id, orphanReceipt, rt);

          if (
            (blockTimestampSource === 'receipt' || blockTimestampSource === 'eth_getBlockByNumber') &&
            !rt.block_timestamp
          ) {
            await supabase
              .from('real_trades')
              .update({ block_timestamp: blockTimestamp })
              .eq('trade_id', rt.trade_id)
              .is('block_timestamp', null);
          }

          console.log('ORPHAN_RECOVERY_ATTEMPT', {
            mockTradeId: linkedMockId,
            tx_hash: rt.tx_hash,
            execution_confirmed: mockRow.execution_confirmed,
            settlement_status: mockRow.settlement_status,
          });

          const r = await finalizeMockTradeAndSettle({
            mockTradeId: linkedMockId,
            realTrade: rt,
            receipt: orphanReceipt,
            blockTimestamp,
          });
          orphanResults.push({ mockTradeId: linkedMockId, tx_hash: rt.tx_hash, ...r });
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        polled: results.length,
        results,
        orphan_recovered: orphanResults.length,
        orphan_results: orphanResults,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('RECEIPT_RPC_ERROR', { error: String(error) });
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
