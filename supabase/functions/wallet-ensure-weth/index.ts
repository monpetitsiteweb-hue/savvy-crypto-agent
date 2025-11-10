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

// Safety controls
const EXECUTION_DRY_RUN = Deno.env.get('EXECUTION_DRY_RUN') !== 'false'; // default: true
const MAX_WRAP_WEI = BigInt(Deno.env.get('MAX_WRAP_WEI') || '10000000000000000'); // 0.01 ETH default

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
    // Read body exactly once with robust error handling
    let body: any;
    try {
      const rawBody = await req.text();
      body = JSON.parse(rawBody);
    } catch (error) {
      console.error('ensure_weth.error.bad_json:', error);
      return new Response(
        JSON.stringify({ ok: false, code: 'bad_json', message: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Flexible input source merging with aliases
    let owner = body.owner || body.address;
    let minWethNeededWei = body.minWethNeededWei || body.amountWei || body.minWethNeeded;
    let action = body.action;
    const maxWaitMs = body.maxWaitMs || 8000;
    
    // Log alias usage for observability
    if (!body.owner && body.address) {
      console.log('input.alias_used', { field: 'address', normalizedTo: 'owner' });
    }
    if (!body.minWethNeededWei && body.amountWei) {
      console.log('input.alias_used', { field: 'amountWei', normalizedTo: 'minWethNeededWei' });
    } else if (!body.minWethNeededWei && body.minWethNeeded) {
      console.log('input.alias_used', { field: 'minWethNeeded', normalizedTo: 'minWethNeededWei' });
    }
    
    // Backward compatibility: infer action from autoWrap if not specified
    if (!action && body.autoWrap !== undefined) {
      action = body.autoWrap === true ? 'submit' : 'plan';
      console.log('input.alias_used', { field: 'autoWrap', normalizedTo: 'action', value: action });
    }

    // Validate and normalize owner address
    if (!owner || typeof owner !== 'string') {
      console.error('exec.error', { code: 'bad_request', message: 'owner is required', field: 'owner' });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'bad_request', 
          field: 'owner',
          message: 'owner is required' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Strict hex address validation with normalization
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) {
      console.error('exec.error', { 
        code: 'bad_request', 
        message: 'owner must be 0x-prefixed 20-byte hex', 
        field: 'owner',
        value: owner 
      });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'bad_request', 
          field: 'owner',
          message: 'owner must be 0x-prefixed 20-byte hex' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Normalize to lowercase for consistency
    owner = owner.toLowerCase();

    // Validate minWethNeededWei presence and type
    if (!minWethNeededWei || typeof minWethNeededWei !== 'string') {
      console.error('exec.error', { 
        code: 'bad_request', 
        message: 'minWethNeededWei must be a decimal string', 
        field: 'minWethNeededWei',
        value: minWethNeededWei,
        type: typeof minWethNeededWei
      });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'bad_request', 
          field: 'minWethNeededWei',
          message: 'minWethNeededWei must be a decimal string' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Strict decimal string validation
    if (!/^[0-9]+$/.test(minWethNeededWei)) {
      console.error('exec.error', { 
        code: 'bad_request', 
        message: 'minWethNeededWei must match ^[0-9]+$', 
        field: 'minWethNeededWei', 
        value: minWethNeededWei 
      });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'bad_request', 
          field: 'minWethNeededWei',
          message: 'minWethNeededWei must be a decimal string matching ^[0-9]+$' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate BigInt conversion
    let needed: bigint;
    try {
      needed = BigInt(minWethNeededWei);
    } catch (error) {
      console.error('exec.error', { 
        code: 'bad_request', 
        message: 'minWethNeededWei not parseable as BigInt', 
        field: 'minWethNeededWei', 
        value: minWethNeededWei, 
        error: String(error) 
      });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'bad_request', 
          field: 'minWethNeededWei',
          message: 'minWethNeededWei must be a valid decimal string parseable as BigInt' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate action
    if (!action || !['plan', 'submit'].includes(action)) {
      console.error('exec.error', { 
        code: 'bad_request', 
        message: 'action must be "plan" or "submit"', 
        field: 'action', 
        value: action 
      });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'bad_request', 
          field: 'action',
          message: 'action must be "plan" or "submit"' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate BOT_ADDRESS if action=submit
    if (action === 'submit') {
      if (!BOT_ADDRESS) {
        console.error('ensure_weth.error.missing_env: BOT_ADDRESS not configured');
        return new Response(
          JSON.stringify({ ok: false, code: 'missing_env', message: 'BOT_ADDRESS not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (owner.toLowerCase() !== BOT_ADDRESS.toLowerCase()) {
        console.error('ensure_weth.error.owner_mismatch:', { owner, BOT_ADDRESS });
        return new Response(
          JSON.stringify({ 
            ok: false, 
            code: 'owner_mismatch', 
            message: 'Only BOT_ADDRESS can use action=submit',
            details: { owner, expected: BOT_ADDRESS }
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate signer environment
      if (!SERVER_SIGNER_MODE || !['local', 'webhook'].includes(SERVER_SIGNER_MODE)) {
        console.error('ensure_weth.error.signer_unavailable: Invalid or missing SERVER_SIGNER_MODE');
        return new Response(
          JSON.stringify({ ok: false, code: 'signer_unavailable', message: 'SERVER_SIGNER_MODE must be "local" or "webhook"' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (SERVER_SIGNER_MODE === 'local' && !BOT_PRIVATE_KEY) {
        console.error('ensure_weth.error.signer_unavailable: BOT_PRIVATE_KEY not configured for local signer');
        return new Response(
          JSON.stringify({ ok: false, code: 'signer_unavailable', message: 'BOT_PRIVATE_KEY not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (SERVER_SIGNER_MODE === 'webhook' && (!SIGNER_WEBHOOK_URL || !SIGNER_WEBHOOK_AUTH)) {
        console.error('ensure_weth.error.signer_unavailable: Webhook signer not configured');
        return new Response(
          JSON.stringify({ ok: false, code: 'signer_unavailable', message: 'SIGNER_WEBHOOK_URL or SIGNER_WEBHOOK_AUTH not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log('ensure_weth.check.start', { owner, minWethNeededWei, action });

    // Get WETH balance
    const balanceOfData = `0x70a08231${owner.slice(2).padStart(64, '0')}`;
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
        JSON.stringify({ ok: false, code: 'unexpected', message: 'Failed to read WETH balance', detail: wethBalanceResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const currentWethBalance = BigInt(wethBalanceResult.result || '0x0');

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
          mode: action,
          minWethNeededWei,
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

    // If action is plan, return plan only
    if (action === 'plan') {
      return new Response(
        JSON.stringify({
          ok: true,
          mode: 'plan',
          minWethNeededWei,
          action: 'wrap',
          wethBalanceWei: currentWethBalance.toString(),
          balanceHuman: formatTokenAmount(currentWethBalance, 18),
          plan: {
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

    // === action=submit: Execute the wrap ===

    // Validate wrap amount against MAX_WRAP_WEI
    if (deficitWei > MAX_WRAP_WEI) {
      console.error('ensure_weth.wrap.error: Amount exceeds MAX_WRAP_WEI', { 
        deficitWei: deficitWei.toString(), 
        MAX_WRAP_WEI: MAX_WRAP_WEI.toString() 
      });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'amount_exceeds_limit',
          message: `Wrap amount ${valueHuman} exceeds limit ${formatTokenAmount(MAX_WRAP_WEI, 18)}`,
          details: {
            requested: deficitWei.toString(),
            limit: MAX_WRAP_WEI.toString(),
          }
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check dry-run mode
    if (EXECUTION_DRY_RUN) {
      console.log('ensure_weth.wrap.dry_run: Would wrap', { deficitWei: deficitWei.toString(), valueHuman });
      return new Response(
        JSON.stringify({
          ok: true,
          mode: 'submit',
          action: 'wrap',
          dryRun: true,
          txHash: '0xDRY_RUN_NO_TX_SENT',
          wethBalanceWei: currentWethBalance.toString(),
          balanceHuman: formatTokenAmount(currentWethBalance, 18),
          note: 'Dry-run mode enabled - no transaction sent',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check idempotency
    const idempotencyKey = `${owner.toLowerCase()}|${deficitWei.toString()}`;
    const pending = pendingWraps.get(idempotencyKey);
    if (pending) {
      console.log('ensure_weth.wrap.pending: Idempotent request detected', { txHash: pending.txHash });
      return new Response(
        JSON.stringify({
          ok: true,
          mode: 'submit',
          action: 'pending',
          dryRun: false,
          txHash: pending.txHash,
          note: 'Transaction already in progress',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Execute the wrap transaction
    console.log('wrap.submit.start', { 
      deficitWei: deficitWei.toString(), 
      valueHuman, 
      signerMode: SERVER_SIGNER_MODE 
    });

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
        JSON.stringify({ ok: false, code: 'unexpected', message: 'Failed to read ETH balance', detail: ethBalanceResult.error }),
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
          message: 'Insufficient ETH balance for wrap',
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
    let signedTx: string;
    try {
      const signer = getSigner();
      console.log(`wrap.submit.sign: Signing with ${signer.type} signer`);
      signedTx = await signer.sign(txPayload, BASE_CHAIN_ID);
    } catch (signError: any) {
      console.error('signer.error', { code: 'signing_failed', message: signError.message });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'signer_unavailable', 
          message: 'Failed to sign transaction',
          detail: signError.message 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Broadcast transaction
    console.log('tx.broadcast: Sending to Base RPC');
    const sendResult = await sendRawTransaction(BASE_CHAIN_ID, signedTx);
    if (!sendResult.success || !sendResult.txHash) {
      console.error('error', { code: 'tx_failed', message: sendResult.error });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'tx_failed', 
          message: 'Failed to broadcast transaction', 
          detail: sendResult.error 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const txHash = sendResult.txHash;
    console.log('tx.broadcast', { hash: txHash });

    // Track pending transaction for idempotency
    pendingWraps.set(idempotencyKey, { txHash, timestamp: Date.now() });

    // Wait for receipt with timeout
    const maxAttempts = Math.ceil(maxWaitMs / 2000);
    const receiptResult = await waitForReceipt(BASE_CHAIN_ID, txHash, maxAttempts, 2000);
    
    if (!receiptResult.success || !receiptResult.receipt) {
      console.error('error', { code: 'timeout', message: receiptResult.error, txHash });
      // Keep in pending map so subsequent calls return 'pending'
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: 'timeout', 
          message: 'Transaction timeout or failed', 
          detail: receiptResult.error, 
          txHash 
        }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Remove from pending map on success
    pendingWraps.delete(idempotencyKey);

    const gasUsed = parseInt(receiptResult.receipt.gasUsed, 16);
    console.log('wrap.submit.done', { txHash, gasUsed, dryRun: false });

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
        mode: 'submit',
        action: 'wrap',
        dryRun: false,
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
    console.error('error', { code: 'unexpected', message: String(error) });
    return new Response(
      JSON.stringify({ ok: false, code: 'unexpected', message: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
