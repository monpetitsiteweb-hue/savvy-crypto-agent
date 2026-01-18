/**
 * execution-wallet-balance
 * 
 * Returns on-chain balances for a user's execution wallet.
 * Fetches ETH and supported ERC20 token balances via RPC.
 * 
 * Returns:
 * - address: wallet address
 * - chain_id: network chain ID
 * - balances: per-token amounts and fiat values
 * - total_value_fiat: total portfolio value in USD
 * - is_funded: whether wallet has meaningful balance
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Token addresses on Base
const TOKENS: Record<string, { address: string; decimals: number; symbol: string }> = {
  ETH: {
    address: '0x0000000000000000000000000000000000000000', // Native ETH
    decimals: 18,
    symbol: 'ETH',
  },
  WETH: {
    address: '0x4200000000000000000000000000000000000006', // Base WETH
    decimals: 18,
    symbol: 'WETH',
  },
  USDC: {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base USDC
    decimals: 6,
    symbol: 'USDC',
  },
  USDT: {
    address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', // Base USDT (if exists)
    decimals: 6,
    symbol: 'USDT',
  },
};

// ERC20 balanceOf ABI
const ERC20_BALANCE_OF_SELECTOR = '0x70a08231'; // balanceOf(address)

// RPC URLs for different chains
function getRpcUrl(chainId: number): string {
  switch (chainId) {
    case 8453: // Base
      return 'https://mainnet.base.org';
    case 1: // Ethereum
      return 'https://eth.llamarpc.com';
    case 137: // Polygon
      return 'https://polygon-rpc.com';
    case 42161: // Arbitrum
      return 'https://arb1.arbitrum.io/rpc';
    default:
      return 'https://mainnet.base.org';
  }
}

// Fetch ETH balance
async function getEthBalance(rpcUrl: string, address: string): Promise<bigint> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
  });

  const data = await response.json();
  if (data.error) {
    console.error('[execution-wallet-balance] ETH balance error:', data.error);
    return 0n;
  }

  return BigInt(data.result || '0x0');
}

// Fetch ERC20 balance
async function getTokenBalance(
  rpcUrl: string,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  // Encode balanceOf call
  const paddedAddress = walletAddress.slice(2).toLowerCase().padStart(64, '0');
  const callData = ERC20_BALANCE_OF_SELECTOR + paddedAddress;

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [
        {
          to: tokenAddress,
          data: callData,
        },
        'latest',
      ],
    }),
  });

  const data = await response.json();
  if (data.error || !data.result || data.result === '0x') {
    return 0n;
  }

  return BigInt(data.result);
}

// Fetch prices from price_snapshots table (single source of truth)
async function getPricesFromSnapshots(
  supabase: ReturnType<typeof createClient>
): Promise<Record<string, number>> {
  try {
    // Fetch latest prices for ETH, WETH, USDC, USDT from price_snapshots
    const symbols = ['ETH-EUR', 'ETH', 'WETH-EUR', 'WETH', 'USDC-EUR', 'USDC', 'USDT-EUR', 'USDT'];
    
    const { data: snapshots, error } = await supabase
      .from('price_snapshots')
      .select('symbol, price_eur, updated_at')
      .in('symbol', symbols)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[execution-wallet-balance] price_snapshots query error:', error);
      throw error;
    }

    // Build price map from most recent entries per symbol
    const priceMap: Record<string, number> = {};
    const seenSymbols = new Set<string>();

    for (const snap of snapshots || []) {
      const baseSymbol = snap.symbol.replace('-EUR', '').replace('-USD', '');
      if (!seenSymbols.has(baseSymbol) && snap.price_eur && snap.price_eur > 0) {
        priceMap[baseSymbol] = snap.price_eur;
        seenSymbols.add(baseSymbol);
      }
    }

    // Calculate USD prices assuming ~1.08 EUR/USD rate if not available
    // (This is approximate; the main view is EUR-based)
    const eurToUsd = 1.08;

    const result = {
      ETH: (priceMap['ETH'] || 0) * eurToUsd,
      ETH_EUR: priceMap['ETH'] || 0,
      WETH: (priceMap['WETH'] || priceMap['ETH'] || 0) * eurToUsd,
      WETH_EUR: priceMap['WETH'] || priceMap['ETH'] || 0,
      USDC: 1,
      USDC_EUR: priceMap['USDC'] || 0.92,
      USDT: 1,
      USDT_EUR: priceMap['USDT'] || 0.92,
    };

    console.log('[execution-wallet-balance] Prices from price_snapshots:', {
      ETH_EUR: result.ETH_EUR,
      WETH_EUR: result.WETH_EUR,
      USDC_EUR: result.USDC_EUR,
    });

    return result;
  } catch (e) {
    console.error('[execution-wallet-balance] Price fetch error, using fallback:', e);
    // Fallback values - should rarely be needed
    return {
      ETH: 3500,
      ETH_EUR: 3200,
      WETH: 3500,
      WETH_EUR: 3200,
      USDC: 1,
      USDC_EUR: 0.92,
      USDT: 1,
      USDT_EUR: 0.92,
    };
  }
}

// Format token amount
function formatAmount(amount: bigint, decimals: number): number {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const remainder = amount % divisor;
  
  // Convert to number with decimals
  return Number(whole) + Number(remainder) / Number(divisor);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's JWT
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get wallet from view
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallet_info')
      .select('*')
      .single();

    if (walletError || !wallet) {
      return new Response(
        JSON.stringify({ 
          error: walletError?.code === 'PGRST116' ? 'No wallet found' : 'Failed to fetch wallet',
          has_wallet: false,
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const walletAddress = wallet.wallet_address;
    const chainId = wallet.chain_id || 8453;
    const rpcUrl = getRpcUrl(chainId);

    console.log(`[execution-wallet-balance] Fetching balances for ${walletAddress} on chain ${chainId}`);

    // Fetch all balances in parallel (prices now from price_snapshots)
    const [ethBalance, wethBalance, usdcBalance, prices] = await Promise.all([
      getEthBalance(rpcUrl, walletAddress),
      getTokenBalance(rpcUrl, TOKENS.WETH.address, walletAddress),
      getTokenBalance(rpcUrl, TOKENS.USDC.address, walletAddress),
      getPricesFromSnapshots(supabase),
    ]);

    // Format balances
    const ethAmount = formatAmount(ethBalance, 18);
    const wethAmount = formatAmount(wethBalance, 18);
    const usdcAmount = formatAmount(usdcBalance, 6);

    // Calculate fiat values
    const ethValueUsd = ethAmount * prices.ETH;
    const ethValueEur = ethAmount * prices.ETH_EUR;
    const wethValueUsd = wethAmount * prices.WETH;
    const wethValueEur = wethAmount * prices.WETH_EUR;
    const usdcValueUsd = usdcAmount * prices.USDC;
    const usdcValueEur = usdcAmount * prices.USDC_EUR;

    const totalValueUsd = ethValueUsd + wethValueUsd + usdcValueUsd;
    const totalValueEur = ethValueEur + wethValueEur + usdcValueEur;

    // Determine if funded (at least $1 worth)
    const isFunded = totalValueUsd >= 1;

    const response = {
      success: true,
      address: walletAddress,
      chain_id: chainId,
      balances: {
        ETH: {
          symbol: 'ETH',
          amount: ethAmount,
          amount_wei: ethBalance.toString(),
          value_usd: ethValueUsd,
          value_eur: ethValueEur,
          price_usd: prices.ETH,
        },
        WETH: {
          symbol: 'WETH',
          amount: wethAmount,
          amount_wei: wethBalance.toString(),
          value_usd: wethValueUsd,
          value_eur: wethValueEur,
          price_usd: prices.WETH,
        },
        USDC: {
          symbol: 'USDC',
          amount: usdcAmount,
          amount_raw: usdcBalance.toString(),
          value_usd: usdcValueUsd,
          value_eur: usdcValueEur,
          price_usd: prices.USDC,
        },
      },
      total_value_usd: totalValueUsd,
      total_value_eur: totalValueEur,
      is_funded: isFunded,
      fetched_at: new Date().toISOString(),
    };

    console.log(`[execution-wallet-balance] Total value: $${totalValueUsd.toFixed(2)}`);

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[execution-wallet-balance] Error:', error.message);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
