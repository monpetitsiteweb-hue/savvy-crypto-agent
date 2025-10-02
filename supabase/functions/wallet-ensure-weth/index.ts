import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { BASE_CHAIN_ID, BASE_TOKENS, formatTokenAmount } from '../_shared/addresses.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RPC_URL = Deno.env.get('RPC_URL_8453') || 'https://base.llamarpc.com';

/**
 * Check WETH balance and return wrap plan if insufficient
 * Does NOT execute any transactions - returns a plan for client to execute
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { address, minWethNeeded } = await req.json();

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

    // Call WETH.balanceOf(address)
    const balanceOfData = `0x70a08231${address.slice(2).padStart(64, '0')}`;
    const balanceResponse = await fetch(RPC_URL, {
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

    const balanceResult = await balanceResponse.json();
    if (balanceResult.error) {
      return new Response(
        JSON.stringify({ error: 'Failed to read WETH balance', detail: balanceResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const currentBalance = BigInt(balanceResult.result || '0x0');
    const needed = BigInt(minWethNeeded);

    if (currentBalance >= needed) {
      return new Response(
        JSON.stringify({
          ok: true,
          action: 'none',
          balance: currentBalance.toString(),
          balanceHuman: formatTokenAmount(currentBalance, 18),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Need to wrap ETH → WETH
    const wrapAmount = needed - currentBalance;
    
    const valueHuman = formatTokenAmount(wrapAmount, 18);
    
    return new Response(
      JSON.stringify({
        ok: true,
        action: 'wrap',
        balance: currentBalance.toString(),
        balanceHuman: formatTokenAmount(currentBalance, 18),
        wrapPlan: {
          chainId: BASE_CHAIN_ID,
          wethAddress: BASE_TOKENS.WETH,
          method: 'deposit()',
          calldata: '0xd0e30db0', // deposit() signature
          value: wrapAmount.toString(),
          valueHuman,
          note: `Wrap ${valueHuman} ETH to WETH. Send this value to WETH.deposit()`,
        }
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
