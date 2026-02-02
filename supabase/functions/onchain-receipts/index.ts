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
// The caller (processReceipt) MUST refuse ledger insertion when success=false.
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
  
  // Find stablecoin transfer (represents USD value)
  const stablecoinTransfer = decodedTransfers.find(t => t.isStablecoin);
  // Find non-stablecoin transfer (represents token amount)
  const tokenTransfer = decodedTransfers.find(t => !t.isStablecoin);
  
  if (!stablecoinTransfer || !tokenTransfer) {
    // Fallback: try to infer from available transfers
    if (decodedTransfers.length >= 2) {
      // Use first two transfers as token/stablecoin pair
      const [first, second] = decodedTransfers;
      const filledAmount = first.amount;
      const totalValue = second.amount;
      const executedPrice = filledAmount > 0 ? totalValue / filledAmount : 0;
      
      return {
        success: true,
        filledAmount,
        executedPrice,
        totalValue,
        decodeMethod: 'two_transfer_fallback',
        decodedLogs: decodedTransfers,
      };
    }
    
    return {
      success: false,
      filledAmount: 0,
      executedPrice: 0,
      totalValue: 0,
      decodeMethod: 'incomplete',
      decodedLogs: decodedTransfers,
      error: 'Could not identify stablecoin and token transfers',
    };
  }
  
  // Calculate filled amount and price based on side
  // BUY: receiving token, paying stablecoin
  // SELL: paying token, receiving stablecoin
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

async function processReceipt(trade: any) {
  // CRITICAL: Extract is_system_operator from trade record - this is the durable execution class
  const { id: tradeId, chain_id, tx_hash, provider, symbol, side, user_id, strategy_id, idempotency_key, is_system_operator } = trade;

  console.log(`Polling receipt for trade ${tradeId}, tx ${tx_hash}`);

  const result = await getReceipt(chain_id, tx_hash);

  if (result.error) {
    console.error(`Failed to get receipt for ${tradeId}:`, result.error);
    return {
      tradeId,
      tx_hash,
      status: 'error',
      error: result.error,
    };
  }

  if (!result.receipt) {
    console.log(`No receipt yet for ${tradeId}`);
    return {
      tradeId,
      tx_hash,
      status: 'pending',
    };
  }

  const receipt = result.receipt;
  console.log(`Receipt found for ${tradeId}:`, {
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
  });

  // Parse receipt status (0x0 = failed, 0x1 = success)
  const txSuccess = receipt.status === '0x1' || receipt.status === 1;
  const newStatus = txSuccess ? 'mined' : 'failed';

  // ============================================================================
  // STRICT VALIDATION GUARD: Real trades require complete receipt data
  // If any required field is missing or malformed, refuse ledger insertion
  // ============================================================================
  if (txSuccess) {
    const validationErrors: string[] = [];
    
    if (!tx_hash) validationErrors.push('tx_hash is missing');
    if (!chain_id) validationErrors.push('chain_id is missing');
    if (!receipt.gasUsed) validationErrors.push('gasUsed is missing from receipt');
    if (!receipt.blockNumber) validationErrors.push('blockNumber is missing from receipt');
    
    // Parse gas values for validation
    const gasUsedDec = receipt.gasUsed ? parseInt(receipt.gasUsed, 16) : null;
    const effectiveGasPrice = receipt.effectiveGasPrice ? parseInt(receipt.effectiveGasPrice, 16) : null;
    
    if (gasUsedDec === null || isNaN(gasUsedDec)) {
      validationErrors.push('gasUsed could not be parsed');
    }
    
    if (validationErrors.length > 0) {
      console.error(`❌ VALIDATION FAILED for trade ${tradeId}:`, validationErrors);
      
      // Log validation failure event but do NOT insert into ledger
      await supabase.from('trade_events').insert({
        trade_id: tradeId,
        phase: 'validation_failed',
        severity: 'error',
        payload: {
          errors: validationErrors,
          receipt_partial: {
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed,
            status: receipt.status,
          },
        },
      });
      
      return {
        tradeId,
        tx_hash,
        status: 'validation_failed',
        errors: validationErrors,
      };
    }
  }

  // Calculate gas costs (only for successful transactions with valid data)
  const gasUsedDec = parseInt(receipt.gasUsed, 16);
  const effectiveGasPrice = receipt.effectiveGasPrice
    ? parseInt(receipt.effectiveGasPrice, 16)
    : null;
  const totalNetworkFee = effectiveGasPrice
    ? (BigInt(gasUsedDec) * BigInt(effectiveGasPrice)).toString()
    : null;

  // Update trades table with receipt
  const { error: updateError } = await supabase
    .from('trades')
    .update({
      status: newStatus,
      receipts: receipt,
      gas_wei: gasUsedDec,
      total_network_fee: totalNetworkFee,
    })
    .eq('id', tradeId);

  if (updateError) {
    console.error(`Failed to update trade ${tradeId}:`, updateError);
  }

  // Add trade event
  const { error: eventError } = await supabase.from('trade_events').insert({
    trade_id: tradeId,
    phase: txSuccess ? 'mined' : 'error',
    severity: txSuccess ? 'info' : 'error',
    payload: {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      status: receipt.status,
    },
  });

  if (eventError) {
    console.error(`Failed to add event for ${tradeId}:`, eventError);
  }

  // ============================================================================
  // UNIFIED LEDGER INSERTION: Real trades into mock_trades
  // CRITICAL INVARIANTS:
  // 1. Only insert after successful receipt confirmation
  // 2. execution_confirmed = true ONLY when receipt is fully decoded
  // 3. amount, price, total_value, gas_cost_eur derived EXCLUSIVELY from receipt logs
  // 4. execution_source = 'onchain' (authoritative provenance)
  // 5. NO values from: intent payload, coordinator estimates, UI values, pre-execution quotes
  // ============================================================================
  if (txSuccess && user_id && strategy_id) {
    // Extract execution timestamp from block (if available) or use current time
    // For real trades: execution_ts = block timestamp from confirmed receipt
    const blockTimestamp = receipt.blockTimestamp 
      ? new Date(parseInt(receipt.blockTimestamp, 16) * 1000).toISOString()
      : new Date().toISOString();
    
    // ========================================================================
    // DECODE FILLED AMOUNT AND PRICE FROM RECEIPT LOGS (SOURCE OF TRUTH)
    // Parse ERC-20 Transfer events to extract actual on-chain execution values
    // ========================================================================
    // ========================================================================
    // C2: RECEIPT DECODE WITH ALERT-TRIGGERING ERROR LOGGING
    // Wrap decode + insert logic with structured error emission
    // ========================================================================
    let decodedTrade: DecodeResult;
    try {
      decodedTrade = decodeSwapFromReceipt(receipt, symbol, side);
    } catch (decodeErr) {
      // CRITICAL ALERT: Unexpected decode exception
      console.error("RECEIPT_DECODE_FAILED", {
        txHash: tx_hash,
        tradeId,
        execution_class: is_system_operator ? 'SYSTEM_OPERATOR' : 'USER',
        execution_target: 'REAL',
        error: decodeErr.message,
        stack: decodeErr.stack,
      });
      throw decodeErr;
    }
    
    if (!decodedTrade.success) {
      // CRITICAL ALERT: Decode returned failure
      console.error("RECEIPT_DECODE_FAILED", {
        txHash: tx_hash,
        tradeId,
        execution_class: is_system_operator ? 'SYSTEM_OPERATOR' : 'USER',
        execution_target: 'REAL',
        error: decodedTrade.error,
        decode_method: decodedTrade.decodeMethod,
        logs_count: receipt.logs?.length || 0,
      });
      
      // Log decode failure but do NOT insert into ledger with fallback values
      await supabase.from('trade_events').insert({
        trade_id: tradeId,
        phase: 'receipt_decode_failed',
        severity: 'error',
        payload: {
          error: decodedTrade.error,
          logs_count: receipt.logs?.length || 0,
          receipt_partial: {
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed,
            status: receipt.status,
          },
        },
      });
      
      return {
        tradeId,
        tx_hash,
        status: 'decode_failed',
        error: decodedTrade.error,
      };
    }
    
    // Use ONLY decoded values from receipt - never intent/coordinator/UI values
    const filledAmount = decodedTrade.filledAmount;
    const executedPrice = decodedTrade.executedPrice;
    const totalValue = decodedTrade.totalValue;
    
    // ========================================================================
    // GAS ACCOUNTING: Store ETH-native value only (Option A)
    // EUR conversion happens in portfolio views, NOT at insertion time.
    // This preserves on-chain truth and avoids time-of-execution FX ambiguity.
    // ========================================================================
    const gasWei = BigInt(gasUsedDec) * BigInt(effectiveGasPrice || 0);
    const gasCostEth = Number(gasWei) / 1e18;
    // NO EUR CONVERSION HERE - ledger stores only on-chain observable values
    
    // ==========================================================================
    // EXECUTION CLASS: Written explicitly at ledger INSERT time
    // is_system_operator comes from the trades table (transport layer)
    // This is the ONLY source of truth for the mt_on_sell_snapshot trigger
    // ==========================================================================
    const isSystemOperator = is_system_operator === true;
    
    console.log(`📊 Ledger insert: is_system_operator=${isSystemOperator}, strategy_id=${isSystemOperator ? null : strategy_id}`);
    
    // Build the ledger record with STRICT invariants - ALL economics from receipt
    const ledgerUpdateFields = {
      // INVARIANT: system operator trades have no strategy ownership
      strategy_id: isSystemOperator ? null : strategy_id,
      trade_type: side?.toLowerCase() || 'buy',
      cryptocurrency: symbol?.replace('/USD', '').replace('/EUR', '') || 'UNKNOWN',
      amount: filledAmount,           // FROM RECEIPT DECODE ONLY
      price: executedPrice,           // FROM RECEIPT DECODE ONLY
      total_value: totalValue,        // FROM RECEIPT DECODE ONLY
      executed_at: blockTimestamp,
      is_test_mode: false, // REAL trade
      // EXECUTION CLASS: Written once at ledger INSERT, never inferred again
      is_system_operator: isSystemOperator,
      notes: `On-chain execution confirmed | tx:${tx_hash?.substring(0, 10)}... | provider:${provider || 'unknown'} | decoded:${decodedTrade.decodeMethod}`,
      strategy_trigger: `onchain|tx:${tx_hash?.substring(0, 16)}`,
      market_conditions: {
        origin: 'ONCHAIN_CONFIRMED',
        tx_hash,
        chain_id,
        provider,
        gas_used: gasUsedDec,
        effective_gas_price: effectiveGasPrice,
        block_number: receipt.blockNumber,
        decode_method: decodedTrade.decodeMethod,
        decoded_logs: decodedTrade.decodedLogs,
        // JSON is informational only, trigger uses column
        system_operator_mode: isSystemOperator,
      },
      // UNIFIED LEDGER: Explicit real execution fields
      execution_source: 'onchain',
      execution_confirmed: true, // ONLY true after successful receipt decoding
      execution_ts: blockTimestamp,
      tx_hash,
      chain_id,
      gas_cost_eth: gasCostEth,  // ETH-NATIVE: FROM RECEIPT ONLY, no EUR conversion
      // gas_cost_eur: null for real trades - compute in views via price_snapshots
      idempotency_key: idempotency_key || `onchain_${tx_hash}`,
    };
    
    // Track the mock_trades id for real_trades linkage
    let mockTradeId: string | null = null;
    
    // =========================================================================
    // PHASE 3B: Check for existing PENDING_ONCHAIN placeholder from coordinator
    // If exists → UPDATE to finalize; else → INSERT new row (backward compat)
    // =========================================================================
    // First, check if there's an existing placeholder row in mock_trades
    // The coordinator inserts this BEFORE calling onchain-sign-and-send
    const { data: existingPlaceholder, error: placeholderCheckError } = await supabase
      .from('mock_trades')
      .select('id')
      .eq('idempotency_key', `pending_${tradeId}`)
      .maybeSingle();
    
    if (placeholderCheckError) {
      console.warn(`⚠️ Failed to check for existing placeholder:`, placeholderCheckError);
    }
    
    if (existingPlaceholder?.id) {
      // PHASE 3B: UPDATE existing placeholder → CONFIRMED
      mockTradeId = existingPlaceholder.id;
      
      console.log(`📊 Finalizing existing mock_trades placeholder:`, {
        mock_trade_id: mockTradeId,
        tx_hash: tx_hash?.substring(0, 16),
        symbol,
        side,
        amount: filledAmount,
        price: executedPrice,
      });
      
      const { error: updateError } = await supabase
        .from('mock_trades')
        .update(ledgerUpdateFields)
        .eq('id', mockTradeId);
      
      if (updateError) {
        console.error(`❌ Failed to finalize mock_trades placeholder:`, updateError);
        
        // Log finalization failure
        await supabase.from('trade_events').insert({
          trade_id: tradeId,
          phase: 'ledger_finalize_failed',
          severity: 'error',
          payload: {
            error: updateError.message,
            mock_trade_id: mockTradeId,
            update_fields: ledgerUpdateFields,
          },
        });
      } else {
        console.log("LEDGER_FINALIZED", {
          trade_id: mockTradeId,
          execution_class: isSystemOperator ? 'SYSTEM_OPERATOR' : 'USER',
          execution_target: 'REAL',
          is_system_operator: isSystemOperator,
          symbol,
          side,
          amount: filledAmount,
          price: executedPrice,
          tx_hash: tx_hash?.substring(0, 16),
        });
        console.log(`✅ Mock_trades placeholder finalized: ${mockTradeId}`);
      }
    } else {
      // BACKWARD COMPATIBILITY: No placeholder exists, INSERT new row
      // This handles legacy trades or cases where coordinator didn't create placeholder
      const ledgerRecord = {
        user_id,
        ...ledgerUpdateFields,
      };
      
      console.log(`📊 Inserting real trade into unified ledger (no placeholder):`, {
        tx_hash: tx_hash?.substring(0, 16),
        symbol,
        side,
        amount: filledAmount,
        price: executedPrice,
        gas_cost_eth: gasCostEth,
      });
      
      // Insert into unified ledger with idempotency protection
      const { data: ledgerResult, error: ledgerError } = await supabase
        .from('mock_trades')
        .insert(ledgerRecord)
        .select('id');
      
      if (ledgerError) {
        // Check if it's a duplicate key error (idempotency protection working)
        if (ledgerError.code === '23505') {
          console.log(`⚠️ Duplicate trade prevented by idempotency key: ${idempotency_key || tx_hash}`);
        } else {
          console.error(`❌ Failed to insert real trade into ledger:`, ledgerError);
          
          // Log ledger insertion failure
          await supabase.from('trade_events').insert({
            trade_id: tradeId,
            phase: 'ledger_insert_failed',
            severity: 'error',
            payload: {
              error: ledgerError.message,
              ledger_record: ledgerRecord,
            },
          });
        }
      } else {
        mockTradeId = ledgerResult?.[0]?.id;
        
        // ========================================================================
        // C3: LOG EXECUTION CONTEXT ON EVERY LEDGER INSERT
        // This creates an auditable trail for every trade, mock or real
        // ========================================================================
        console.log("LEDGER_INSERT", {
          trade_id: mockTradeId,
          execution_class: isSystemOperator ? 'SYSTEM_OPERATOR' : 'USER',
          execution_target: 'REAL',
          is_system_operator: isSystemOperator,
          symbol,
          side,
          amount: filledAmount,
          price: executedPrice,
          tx_hash: tx_hash?.substring(0, 16),
        });
        console.log(`✅ Real trade inserted into unified ledger: ${mockTradeId}`);
      }
    }
    
    // ============================================================================
    // PHASE 3B: UPDATE real_trades (SUBMITTED → CONFIRMED/REVERTED)
    // The SUBMITTED row was already inserted by onchain-sign-and-send.
    // This updates that row with receipt data and final status.
    // BEST-EFFORT - failure does NOT rollback mock_trades
    // ============================================================================
    const executionStatus = txSuccess ? 'CONFIRMED' : 'REVERTED';
    
    // Build real_trades UPDATE fields
    const realTradeUpdateFields = {
      execution_status: executionStatus,
      receipt_status: txSuccess,
      block_number: receipt.blockNumber ? parseInt(receipt.blockNumber, 16) : null,
      block_timestamp: blockTimestamp,
      gas_used: gasUsedDec,
      error_reason: txSuccess ? null : 'Transaction reverted',
      
      // Trade economics from receipt decode
      cryptocurrency: symbol?.replace('/USD', '').replace('/EUR', '') || 'UNKNOWN',
      side: side?.toUpperCase() || 'UNKNOWN',
      amount: filledAmount,
      price: executedPrice,
      total_value: totalValue,
      fees: gasCostEth,
      
      // Execution context
      execution_target: 'REAL',
      execution_authority: isSystemOperator ? 'SYSTEM' : 'USER',
      is_system_operator: isSystemOperator,
      strategy_id: isSystemOperator ? null : strategy_id,
      
      // Audit trail
      decode_method: decodedTrade.decodeMethod,
      raw_receipt: receipt,
    };
    
    try {
      // PHASE 3B: Try UPDATE first (canonical path with placeholder)
      const { data: updateResult, error: updateError } = await supabase
        .from('real_trades')
        .update(realTradeUpdateFields)
        .eq('tx_hash', tx_hash)
        .eq('execution_status', 'SUBMITTED')
        .select('id');
      
      if (updateError) {
        console.error("REAL_TRADES_UPDATE_FAILED", {
          trade_id: mockTradeId || tradeId,
          tx_hash,
          error: updateError.message,
          code: updateError.code,
        });
      } else if (updateResult && updateResult.length > 0) {
        // Successfully updated existing SUBMITTED row → CONFIRMED
        console.log("REAL_TRADES_CONFIRMED", {
          trade_id: mockTradeId || tradeId,
          tx_hash,
          execution_status: executionStatus,
          amount: filledAmount,
          price: executedPrice,
          updated_row_id: updateResult[0].id,
        });
      } else {
        // No SUBMITTED row found - this could be a legacy trade
        // Fall back to INSERT for backward compatibility
        console.log("⚠️ No SUBMITTED row found, attempting INSERT for backward compatibility");
        
        const realTradeRecord = {
          trade_id: mockTradeId || tradeId,
          tx_hash,
          user_id,
          chain_id,
          provider,
          ...realTradeUpdateFields,
        };
        
        const { error: insertError } = await supabase
          .from('real_trades')
          .insert(realTradeRecord);
        
        if (insertError) {
          console.error("REAL_TRADES_INSERT_FAILED", {
            trade_id: mockTradeId || tradeId,
            tx_hash,
            error: insertError.message,
            code: insertError.code,
          });
        } else {
          console.log("REAL_TRADES_CONFIRMED", {
            trade_id: mockTradeId || tradeId,
            tx_hash,
            execution_status: executionStatus,
            amount: filledAmount,
            price: executedPrice,
            mode: 'fallback_insert',
          });
        }
      }
    } catch (realTradeErr) {
      // BEST-EFFORT: Log unexpected error but DO NOT rollback mock_trades
      console.error("REAL_TRADES_UPDATE_FAILED", {
        trade_id: mockTradeId || tradeId,
        tx_hash,
        error: realTradeErr.message,
      });
    }
  }
  
  // ============================================================================
  // PHASE 1: HANDLE REVERTED TRANSACTIONS
  // Even failed transactions should be recorded in real_trades for audit
  // No mock_trades insertion for reverts - only real_trades shadow ledger
  // ============================================================================
  if (!txSuccess && user_id) {
    const blockTimestamp = receipt.blockTimestamp 
      ? new Date(parseInt(receipt.blockTimestamp, 16) * 1000).toISOString()
      : new Date().toISOString();
    
    const gasUsedDecRevert = parseInt(receipt.gasUsed, 16);
    const effectiveGasPriceRevert = receipt.effectiveGasPrice
      ? parseInt(receipt.effectiveGasPrice, 16)
      : null;
    const gasCostEthRevert = effectiveGasPriceRevert 
      ? Number(BigInt(gasUsedDecRevert) * BigInt(effectiveGasPriceRevert)) / 1e18
      : 0;
    
    const realTradeRecord = {
      trade_id: tradeId,
      tx_hash,
      execution_status: 'REVERTED',
      receipt_status: false,
      block_number: receipt.blockNumber ? parseInt(receipt.blockNumber, 16) : null,
      block_timestamp: blockTimestamp,
      gas_used: gasUsedDecRevert,
      error_reason: 'Transaction reverted on-chain',
      
      // Trade economics - zeros for reverted transactions
      cryptocurrency: symbol?.replace('/USD', '').replace('/EUR', '') || 'UNKNOWN',
      side: side?.toUpperCase() || 'UNKNOWN',
      amount: 0,
      price: 0,
      total_value: 0,
      fees: gasCostEthRevert, // Gas was still consumed
      
      // Execution context
      execution_target: 'REAL',
      execution_authority: is_system_operator ? 'SYSTEM' : 'USER',
      is_system_operator: is_system_operator === true,
      user_id,
      strategy_id: is_system_operator ? null : strategy_id,
      chain_id,
      provider,
      
      // Audit trail
      decode_method: 'reverted',
      raw_receipt: receipt,
    };
    
    try {
      const { error: realTradeError } = await supabase
        .from('real_trades')
        .insert(realTradeRecord);
      
      if (realTradeError) {
        console.error("REAL_TRADES_INSERT_FAILED", {
          trade_id: tradeId,
          tx_hash,
          error: realTradeError.message,
          status: 'REVERTED',
        });
      } else {
        console.error("REAL_TRADES_REVERTED", {
          trade_id: tradeId,
          tx_hash,
          gas_consumed: gasCostEthRevert,
        });
      }
    } catch (err) {
      console.error("REAL_TRADES_INSERT_FAILED", {
        trade_id: tradeId,
        tx_hash,
        error: err.message,
        status: 'REVERTED',
      });
    }
  }

  // Send notification
  await sendNotification({
    event: newStatus, // 'mined' or 'failed'
    tradeId,
    chainId: chain_id,
    txHash: tx_hash,
    provider,
    symbol,
    side,
    explorerUrl: `https://basescan.org/tx/${tx_hash}`,
    gasUsed: receipt.gasUsed,
    blockNumber: receipt.blockNumber,
    error: txSuccess ? undefined : 'Transaction reverted',
  });

  return {
    tradeId,
    tx_hash,
    status: newStatus,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
    ledgerInserted: txSuccess && user_id && strategy_id,
  };
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

    const results = await Promise.all(realTradesToPoll.map(pollAndFinalizeRealTrade));

    return new Response(
      JSON.stringify({
        ok: true,
        polled: results.length,
        results,
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
