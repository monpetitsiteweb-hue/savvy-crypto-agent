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

/**
 * Check WETH balance and execute wrap if needed
 * - autoWrap=false: returns plan only (backwards compatible)
 * - autoWrap=true: executes WETH.deposit() transaction via server signer
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { address, minWethNeeded, autoWrap } = await req.json();

    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return new Response(
        JSON.stringify({ error: 'Invalid address format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!minWethNeeded || typeof minWethNeeded !== 'string') {
      return new Response(
        JSON.stringify({ error: 'minWethNeeded must be a wei string' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
      return new Response(
        JSON.stringify({ error: 'Failed to read WETH balance', detail: wethBalanceResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const currentWethBalance = BigInt(wethBalanceResult.result || '0x0');
    const needed = BigInt(minWethNeeded);

    if (currentWethBalance >= needed) {
      console.log(`WETH balance sufficient, no wrap needed: ${formatTokenAmount(currentWethBalance, 18)} WETH`);
      return new Response(
        JSON.stringify({
          ok: true,
          action: 'none',
          balance: currentWethBalance.toString(),
          balanceHuman: formatTokenAmount(currentWethBalance, 18),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Need to wrap ETH → WETH
    const wrapAmount = needed - currentWethBalance;
    const valueHuman = formatTokenAmount(wrapAmount, 18);

    // If autoWrap is false, return plan only (backwards compatible)
    if (autoWrap !== true) {
      return new Response(
        JSON.stringify({
          ok: true,
          action: 'wrap',
          balance: currentWethBalance.toString(),
          balanceHuman: formatTokenAmount(currentWethBalance, 18),
          wrapPlan: {
            chainId: BASE_CHAIN_ID,
            wethAddress: BASE_TOKENS.WETH,
            method: 'deposit()',
            calldata: '0xd0e30db0',
            value: wrapAmount.toString(),
            valueHuman,
            note: `Wrap ${valueHuman} ETH to WETH. Send this value to WETH.deposit()`,
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // autoWrap=true: Execute the wrap transaction
    console.log(`Auto-wrapping ${valueHuman} ETH to WETH...`);

    // Check ETH balance (using the server signer address)
    if (!BOT_ADDRESS) {
      return new Response(
        JSON.stringify({ ok: false, error: 'BOT_ADDRESS not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to read ETH balance', detail: ethBalanceResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ethBalance = BigInt(ethBalanceResult.result || '0x0');
    const gasBuffer = BigInt('100000000000000'); // ~0.0001 ETH buffer for gas

    if (ethBalance < wrapAmount + gasBuffer) {
      const ethNeeded = formatTokenAmount(wrapAmount + gasBuffer, 18);
      const ethAvailable = formatTokenAmount(ethBalance, 18);
      console.error(`Insufficient ETH: need ${ethNeeded} ETH, have ${ethAvailable} ETH`);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: 'Insufficient ETH balance for wrap',
          details: {
            ethNeeded,
            ethAvailable,
            wrapAmount: valueHuman,
          }
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build transaction
    const txPayload = {
      to: BASE_TOKENS.WETH,
      data: '0xd0e30db0', // deposit()
      value: wrapAmount.toString(),
      gas: '30000', // WETH deposit is simple, ~27k gas
      from: BOT_ADDRESS,
    };

    // Sign transaction
    const signer = getSigner();
    console.log(`Signing WETH wrap transaction with ${signer.type} signer...`);
    const signedTx = await signer.sign(txPayload, BASE_CHAIN_ID);

    // Broadcast transaction
    const sendResult = await sendRawTransaction(BASE_CHAIN_ID, signedTx);
    if (!sendResult.success || !sendResult.txHash) {
      console.error('Failed to broadcast wrap transaction:', sendResult.error);
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to broadcast transaction', detail: sendResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const txHash = sendResult.txHash;
    console.log(`WETH wrap transaction broadcasted: ${txHash}`);

    // Wait for receipt
    const receiptResult = await waitForReceipt(BASE_CHAIN_ID, txHash, 30, 2000);
    if (!receiptResult.success || !receiptResult.receipt) {
      console.error('Failed to get receipt:', receiptResult.error);
      return new Response(
        JSON.stringify({ ok: false, error: 'Transaction failed or timed out', detail: receiptResult.error, txHash }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const gasUsed = parseInt(receiptResult.receipt.gasUsed, 16);
    console.log(`WETH wrap successful: ${txHash} (gas: ${gasUsed})`);

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

    return new Response(
      JSON.stringify({
        ok: true,
        action: 'wrapped',
        txHash,
        gasUsed,
        balance: newBalance.toString(),
        balanceHuman: formatTokenAmount(newBalance, 18),
        wrapAmount: wrapAmount.toString(),
        wrapAmountHuman: valueHuman,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('wallet-ensure-weth error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
