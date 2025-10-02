import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { BASE_CHAIN_ID, BASE_TOKENS, BASE_0X, PERMIT2_DOMAIN, PERMIT2_TYPES } from '../_shared/addresses.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RPC_URL = Deno.env.get('RPC_URL_8453') || 'https://base.llamarpc.com';

/**
 * Check Permit2 allowance and return EIP-712 typed data if approval needed
 * Does NOT execute any transactions - returns typed data for client to sign
 * Ref: https://docs.0x.org/0x-swap-api/advanced-topics/erc20-transformation#permit2
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { address, token, minAllowance } = await req.json();

    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return new Response(
        JSON.stringify({ error: 'Invalid address format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!token || !['WETH', 'USDC'].includes(token)) {
      return new Response(
        JSON.stringify({ error: 'token must be WETH or USDC' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!minAllowance || typeof minAllowance !== 'string') {
      return new Response(
        JSON.stringify({ error: 'minAllowance must be a wei string' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokenAddress = BASE_TOKENS[token as keyof typeof BASE_TOKENS];

    // Call Permit2.allowance(owner, token, spender)
    // function allowance(address owner, address token, address spender) returns ((uint160 amount, uint48 expiration, uint48 nonce))
    const allowanceData = `0x927da105${
      address.slice(2).padStart(64, '0')}${
      tokenAddress.slice(2).padStart(64, '0')}${
      BASE_0X.SPENDER.slice(2).padStart(64, '0')}`;

    const allowanceResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          { to: BASE_0X.PERMIT2, data: allowanceData },
          'latest'
        ]
      })
    });

    const allowanceResult = await allowanceResponse.json();
    if (allowanceResult.error) {
      return new Response(
        JSON.stringify({ error: 'Failed to read Permit2 allowance', detail: allowanceResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the tuple: (uint160 amount, uint48 expiration, uint48 nonce)
    const resultData = allowanceResult.result || '0x';
    const currentAmount = resultData.length >= 66 
      ? BigInt('0x' + resultData.slice(2, 66))
      : 0n;
    
    const needed = BigInt(minAllowance);

    if (currentAmount >= needed) {
      return new Response(
        JSON.stringify({
          ok: true,
          action: 'none',
          allowance: currentAmount.toString(),
          allowanceHuman: (Number(currentAmount) / 1e18).toFixed(6),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Need to sign Permit2 approval
    // Use 2^160-1 for unlimited approval, or needed amount
    const approvalAmount = '1461501637330902918203684832716283019655932542975'; // 2^160-1
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const expiration = Math.floor(Date.now() / 1000) + 31536000; // 1 year

    // EIP-712 typed data for Permit2
    const typedData = {
      domain: PERMIT2_DOMAIN,
      types: PERMIT2_TYPES,
      primaryType: 'PermitSingle' as const,
      message: {
        details: {
          token: tokenAddress,
          amount: approvalAmount,
          expiration: expiration.toString(),
          nonce: '0', // First permit - client should read actual nonce if needed
        },
        spender: BASE_0X.SPENDER,
        sigDeadline: deadline.toString(),
      }
    };

    return new Response(
      JSON.stringify({
        ok: true,
        action: 'permit2-sign',
        allowance: currentAmount.toString(),
        allowanceHuman: (Number(currentAmount) / 1e18).toFixed(6),
        typedData,
        permit2Contract: BASE_0X.PERMIT2,
        spender: BASE_0X.SPENDER,
        note: 'Sign this EIP-712 data with your wallet, then call Permit2.permit() with signature',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('wallet-permit2-status error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
