import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { BASE_CHAIN_ID, BASE_TOKENS, formatTokenAmount } from '../_shared/addresses.ts';
import { getSigner } from '../_shared/signer.ts';
import { sendRawTransaction, waitForReceipt } from '../_shared/eth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RPC_URL = Deno.env.get('RPC_URL_8453') || 'https://base.llamarpc.com';
const BOT_ADDRESS = Deno.env.get('BOT_ADDRESS');
const SERVER_SIGNER_MODE = Deno.env.get('SERVER_SIGNER_MODE');
const BOT_PRIVATE_KEY = Deno.env.get('BOT_PRIVATE_KEY');
const SIGNER_WEBHOOK_URL = Deno.env.get('SIGNER_WEBHOOK_URL');
const SIGNER_WEBHOOK_AUTH = Deno.env.get('SIGNER_WEBHOOK_AUTH');

// In-memory idempotency tracking for pending transactions
const pendingWraps = new Map<string, { txHash: string; timestamp: number }>();
const IDEMPOTENCY_WINDOW_MS = 30000; // 30 seconds

// Clean up stale idempotency entries
function cleanupStaleEntries() {
  const now = Date.now();
  for (const [key, value] of pendingWraps.entries()) {
    if (now - value.timestamp > IDEMPOTENCY_WINDOW_MS) {
      pendingWraps.delete(key);
    }
  }
}

/**
 * Check WETH balance and execute wrap if needed
 * - autoWrap=false: returns plan only (backwards compatible)
 * - autoWrap=true: executes WETH.deposit() transaction via server signer
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  cleanupStaleEntries();
  
  try {
    // Validate JSON parsing
    let body;
    try {
      body = await req.json();
    } catch (error) {
      console.error('ensure_weth.error.bad_json:', error);
      return new Response(
        JSON.stringify({ ok: false, code: 'bad_json', error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { address, minWethNeeded, minWethNeededWei, autoWrap, maxWaitMs = 8000 } = body;
    const minWeth = minWethNeededWei || minWethNeeded;

    // Validate required fields
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      console.error('ensure_weth.error.bad_request: Invalid address format');
      return new Response(
        JSON.stringify({ ok: false, code: 'bad_request', error: 'Invalid address format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!minWeth || typeof minWeth !== 'string') {
      console.error('ensure_weth.error.bad_request: minWethNeeded must be a wei string');
      return new Response(
        JSON.stringify({ ok: false, code: 'bad_request', error: 'minWethNeeded must be a wei string' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate BOT_ADDRESS if autoWrap=true
    if (autoWrap === true) {
      if (!BOT_ADDRESS) {
        console.error('ensure_weth.error.missing_env: BOT_ADDRESS not configured');
        return new Response(
          JSON.stringify({ ok: false, code: 'missing_env', error: 'BOT_ADDRESS not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (address.toLowerCase() !== BOT_ADDRESS.toLowerCase()) {
        console.error('ensure_weth.error.address_mismatch:', { address, BOT_ADDRESS });
        return new Response(
          JSON.stringify({ 
            ok: false, 
            code: 'address_mismatch', 
            error: 'Only BOT_ADDRESS can use autoWrap=true',
            details: { address, expected: BOT_ADDRESS }
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate signer environment
      if (SERVER_SIGNER_MODE === 'local' && !BOT_PRIVATE_KEY) {
        console.error('ensure_weth.error.missing_env: BOT_PRIVATE_KEY not configured for local signer');
        return new Response(
          JSON.stringify({ ok: false, code: 'missing_env', error: 'BOT_PRIVATE_KEY not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (SERVER_SIGNER_MODE === 'webhook' && (!SIGNER_WEBHOOK_URL || !SIGNER_WEBHOOK_AUTH)) {
        console.error('ensure_weth.error.missing_env: Webhook signer not configured');
        return new Response(
          JSON.stringify({ ok: false, code: 'missing_env', error: 'SIGNER_WEBHOOK_URL or SIGNER_WEBHOOK_AUTH not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log('ensure_weth.check.start', { address, minWeth, autoWrap });

    // Get WETH balance
    const balanceOfData = `0x70a08231${address.slice(2).padStart(64, '0')}`;
    const wethBalanceResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          { to: BASE_TOKENS.WETH, data: balanceOfData },
          'latest'
        ]
      })
    });

    const wethBalanceResult = await wethBalanceResponse.json();
    if (wethBalanceResult.error) {
      console.error('ensure_weth.error.rpc_error:', wethBalanceResult.error);
      return new Response(
        JSON.stringify({ ok: false, code: 'unexpected', error: 'Failed to read WETH balance', detail: wethBalanceResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const currentWethBalance = BigInt(wethBalanceResult.result || '0x0');
    const needed = BigInt(minWeth);

    console.log('ensure_weth.check.done', { 
      currentWethBalance: currentWethBalance.toString(), 
      needed: needed.toString(),
      sufficient: currentWethBalance >= needed 
    });

    if (currentWethBalance >= needed) {
      console.log(`ensure_weth.check.done: WETH balance sufficient, no wrap needed: ${formatTokenAmount(currentWethBalance, 18)} WETH`);
      return new Response(
        JSON.stringify({
          ok: true,
          action: 'none',
          wethBalanceWei: currentWethBalance.toString(),
          balanceHuman: formatTokenAmount(currentWethBalance, 18),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Need to wrap ETH → WETH
    const deficitWei = needed - currentWethBalance;
    const valueHuman = formatTokenAmount(deficitWei, 18);

    // If autoWrap is false, return plan only (backwards compatible)
    if (autoWrap !== true) {
      return new Response(
        JSON.stringify({
          ok: true,
          action: 'wrap',
          wethBalanceWei: currentWethBalance.toString(),
          balanceHuman: formatTokenAmount(currentWethBalance, 18),
          wrapPlan: {
            chainId: BASE_CHAIN_ID,
            wethAddress: BASE_TOKENS.WETH,
            method: 'deposit()',
            calldata: '0xd0e30db0',
            value: deficitWei.toString(),
            valueHuman,
            note: `Wrap ${valueHuman} ETH to WETH. Send this value to WETH.deposit()`,
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // autoWrap=true: Check idempotency
    const idempotencyKey = `${address.toLowerCase()}|${deficitWei.toString()}`;
    const pending = pendingWraps.get(idempotencyKey);
    if (pending) {
      console.log('ensure_weth.wrap.pending: Idempotent request detected', { txHash: pending.txHash });
      return new Response(
        JSON.stringify({
          ok: true,
          action: 'pending',
          txHash: pending.txHash,
          note: 'Transaction already in progress',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Execute the wrap transaction
    console.log('ensure_weth.wrap.start', { deficitWei: deficitWei.toString(), valueHuman });

    // Check ETH balance (using the server signer address)
    const ethBalanceResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBalance',
        params: [BOT_ADDRESS, 'latest']
      })
    });

    const ethBalanceResult = await ethBalanceResponse.json();
    if (ethBalanceResult.error) {
      console.error('ensure_weth.wrap.error: Failed to read ETH balance', ethBalanceResult.error);
      return new Response(
        JSON.stringify({ ok: false, code: 'unexpected', error: 'Failed to read ETH balance', detail: ethBalanceResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ethBalance = BigInt(ethBalanceResult.result || '0x0');
    const gasBuffer = BigInt('300000000000000'); // 0.0003 ETH buffer for gas

    if (ethBalance < deficitWei + gasBuffer) {
      const ethNeeded = formatTokenAmount(deficitWei + gasBuffer, 18);
      const ethAvailable = formatTokenAmount(ethBalance, 18);
      console.error('ensure_weth.wrap.error: insufficient_eth', { ethNeeded, ethAvailable });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'insufficient_eth',
          error: 'Insufficient ETH balance for wrap',
          details: {
            ethNeeded,
            ethAvailable,
            wrapAmount: valueHuman,
          }
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build transaction
    const txPayload = {
      to: BASE_TOKENS.WETH,
      data: '0xd0e30db0', // deposit()
      value: deficitWei.toString(),
      gas: '30000', // WETH deposit is simple, ~27k gas
      from: BOT_ADDRESS,
    };

    // Sign transaction
    const signer = getSigner();
    console.log(`ensure_weth.wrap.sign: Signing with ${signer.type} signer`);
    const signedTx = await signer.sign(txPayload, BASE_CHAIN_ID);

    // Broadcast transaction
    const sendResult = await sendRawTransaction(BASE_CHAIN_ID, signedTx);
    if (!sendResult.success || !sendResult.txHash) {
      console.error('ensure_weth.wrap.error: Failed to broadcast transaction', sendResult.error);
      return new Response(
        JSON.stringify({ ok: false, code: 'tx_failed', error: 'Failed to broadcast transaction', detail: sendResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const txHash = sendResult.txHash;
    console.log('ensure_weth.wrap.sent', { txHash });

    // Track pending transaction for idempotency
    pendingWraps.set(idempotencyKey, { txHash, timestamp: Date.now() });

    // Wait for receipt with timeout
    const maxAttempts = Math.ceil(maxWaitMs / 2000);
    const receiptResult = await waitForReceipt(BASE_CHAIN_ID, txHash, maxAttempts, 2000);
    
    if (!receiptResult.success || !receiptResult.receipt) {
      console.error('ensure_weth.wrap.error: Transaction timeout or failed', receiptResult.error);
      // Keep in pending map so subsequent calls return 'pending'
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'timeout', 
          error: 'Transaction timeout or failed', 
          detail: receiptResult.error, 
          txHash 
        }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Remove from pending map on success
    pendingWraps.delete(idempotencyKey);

    const gasUsed = parseInt(receiptResult.receipt.gasUsed, 16);
    console.log('ensure_weth.wrap.confirmed', { txHash, gasUsed });

    // Verify new WETH balance
    const newWethBalanceResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          { to: BASE_TOKENS.WETH, data: balanceOfData },
          'latest'
        ]
      })
    });

    const newWethBalanceResult = await newWethBalanceResponse.json();
    const newBalance = BigInt(newWethBalanceResult.result || '0x0');

    const executionTime = Date.now() - startTime;
    console.log('WETH wrap successful:', { txHash, gasUsed, executionTime });

    return new Response(
      JSON.stringify({
        ok: true,
        action: 'wrap',
        txHash,
        gasUsed,
        wethBalanceWei: newBalance.toString(),
        balanceHuman: formatTokenAmount(newBalance, 18),
        log: {
          executionTimeMs: executionTime,
          gasUsed,
          deficitWei: deficitWei.toString(),
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('ensure_weth.wrap.error: unexpected', error);
    return new Response(
      JSON.stringify({ ok: false, code: 'unexpected', error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
