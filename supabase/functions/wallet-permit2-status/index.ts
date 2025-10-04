import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { BASE_CHAIN_ID, BASE_TOKENS, BASE_0X, BASE_DECIMALS, formatTokenAmount } from '../_shared/addresses.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RPC_URL = Deno.env.get('RPC_URL_8453') || 'https://base.llamarpc.com';

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PERMIT2_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
};

function buildTypedData(chainId: number, tokenAddress: string, spender: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    domain: {
      name: 'Permit2',
      chainId,
      verifyingContract: PERMIT2,
    },
    types: PERMIT2_TYPES,
    primaryType: 'PermitSingle' as const,
    message: {
      details: {
        token: tokenAddress,
        amount: '1461501637330902918203684832716283019655932542975', // uint160 max
        expiration: String(now + 365 * 24 * 60 * 60),
        nonce: '0',
      },
      spender,
      sigDeadline: String(now + 60 * 60),
    },
  };
}

/**
 * Check Permit2 allowance and return EIP-712 typed data if approval needed
 * Does NOT execute any transactions - returns typed data for client to sign
 * Ref: https://docs.0x.org/0x-swap-api/advanced-topics/erc20-transformation#permit2
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return new Response(JSON.stringify({ ok: true, service: 'wallet-permit2-status' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  if (url.searchParams.has('diag')) {
    return new Response(JSON.stringify({
      ok: true,
      service: 'wallet-permit2-status',
      rpc: RPC_URL,
      permit2: PERMIT2,
      spender: BASE_0X.SPENDER,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { address, token, minAllowance } = await req.json();

    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return new Response(
        JSON.stringify({ error: 'Invalid address format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!token || typeof token !== 'string') {
      return new Response(
        JSON.stringify({ error: 'token (symbol or address) is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!minAllowance || typeof minAllowance !== 'string') {
      return new Response(
        JSON.stringify({ error: 'minAllowance must be a wei string' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine token address: prefer symbol mapping, else treat as address
    let tokenAddress: string;
    let decimals: number;
    if (token.startsWith('0x')) {
      tokenAddress = token;
      decimals = 18; // default
    } else {
      const upperToken = token.toUpperCase();
      if (BASE_TOKENS[upperToken as keyof typeof BASE_TOKENS]) {
        tokenAddress = BASE_TOKENS[upperToken as keyof typeof BASE_TOKENS];
        decimals = BASE_DECIMALS[upperToken as keyof typeof BASE_DECIMALS];
      } else {
        return new Response(
          JSON.stringify({ error: `Unknown token symbol: ${token}. Provide address instead.` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

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
          allowanceHuman: formatTokenAmount(currentAmount, decimals),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Need to sign Permit2 approval
    const typedData = buildTypedData(BASE_CHAIN_ID, tokenAddress, BASE_0X.SPENDER);

    return new Response(
      JSON.stringify({
        ok: true,
        action: 'permit2-sign',
        allowance: currentAmount.toString(),
        allowanceHuman: formatTokenAmount(currentAmount, decimals),
        typedData,
        permit2Contract: PERMIT2,
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
