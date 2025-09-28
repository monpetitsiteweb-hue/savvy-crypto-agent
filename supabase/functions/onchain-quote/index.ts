import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { TOKENS, toAtomic, type Token } from './tokens.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ZEROEX_API_KEY = Deno.env.get('ZEROEX_API_KEY');
const RPC_URL_1 = Deno.env.get('RPC_URL_1') || 'https://eth.llamarpc.com';
const RPC_URL_8453 = Deno.env.get('RPC_URL_8453') || 'https://base.llamarpc.com';
const RPC_URL_42161 = Deno.env.get('RPC_URL_42161') || 'https://arbitrum.llamarpc.com';

const RPC_URLS = {
  1: RPC_URL_1,
  8453: RPC_URL_8453,
  42161: RPC_URL_42161,
};

const CHAIN_BASE_URLS = {
  1: 'https://api.0x.org',
  8453: 'https://base.api.0x.org', 
  42161: 'https://arbitrum.api.0x.org',
};

const parseQty = (v: string | number | undefined): bigint | null => {
  if (v == null) return null;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  const s = String(v);
  return s.startsWith('0x') ? BigInt(s) : BigInt(Math.trunc(Number(s)));
};

async function getRpcGasPrice(chainId: number): Promise<bigint | null> {
  try {
    const rpcUrl = RPC_URLS[chainId as keyof typeof RPC_URLS];
    if (!rpcUrl) return null;

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1,
      }),
    });

    const data = await response.json();
    return data.result ? BigInt(data.result) : null;
  } catch (error) {
    console.error('Failed to fetch gas price from RPC:', error);
    return null;
  }
}

// In-memory cache for native-to-quote prices (30s TTL)
const priceCache = new Map<string, { price: number | null; expiry: number }>();

async function getNativeToQuotePrice(chainId: number, quoteTokenAddress: string): Promise<number | null> {
  const cacheKey = `${chainId}:${quoteTokenAddress}`;
  const cached = priceCache.get(cacheKey);
  
  if (cached && Date.now() < cached.expiry) {
    return cached.price;
  }

  try {
    const baseUrl = CHAIN_BASE_URLS[chainId as keyof typeof CHAIN_BASE_URLS];
    if (!baseUrl) return null;

    const nativeAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ZEROEX_API_KEY) {
      headers['0x-api-key'] = ZEROEX_API_KEY;
    }

    const url = `${baseUrl}/swap/v1/quote?sellToken=${nativeAddress}&buyToken=${quoteTokenAddress}&sellAmount=1000000000000000000&skipValidation=true`;
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      priceCache.set(cacheKey, { price: null, expiry: Date.now() + 30_000 });
      return null;
    }
    
    const data = await response.json();
    const price = data.price ? parseFloat(data.price) : null;
    
    // Cache for 30 seconds
    priceCache.set(cacheKey, { price, expiry: Date.now() + 30_000 });
    return price;
  } catch (error) {
    console.error('Failed to get native to quote price:', error);
    priceCache.set(cacheKey, { price: null, expiry: Date.now() + 30_000 });
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { chainId, base, quote, side, amount, slippageBps } = await req.json();

    console.log('Received quote request:', { chainId, base, quote, side, amount, slippageBps });

    const baseUrl = CHAIN_BASE_URLS[chainId as keyof typeof CHAIN_BASE_URLS];
    if (!baseUrl) {
      return new Response(JSON.stringify({ error: `Unsupported chainId: ${chainId}`, provider: '0x' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get token info from registry
    const chainTokens = TOKENS[chainId as keyof typeof TOKENS];
    if (!chainTokens) {
      return new Response(JSON.stringify({ error: `No tokens configured for chainId: ${chainId}`, provider: '0x' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseToken = chainTokens[base as keyof typeof chainTokens];
    const quoteToken = chainTokens[quote as keyof typeof chainTokens];
    
    if (!baseToken || !quoteToken) {
      return new Response(JSON.stringify({ error: `Unsupported token pair: ${base}/${quote} on chain ${chainId}`, provider: '0x' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Convert amount to atomic units
    let sellAmountAtomic: bigint;
    let sellToken: Token;
    let buyToken: Token;

    if (side === 'BUY') {
      // BUY base with quote → sell quote, buy base
      sellAmountAtomic = toAtomic(amount, quoteToken.decimals);
      sellToken = quoteToken;
      buyToken = baseToken;
    } else {
      // SELL base for quote → sell base, buy quote
      sellAmountAtomic = toAtomic(amount, baseToken.decimals);
      sellToken = baseToken;
      buyToken = quoteToken;
    }

    // Build 0x API request
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ZEROEX_API_KEY) {
      headers['0x-api-key'] = ZEROEX_API_KEY;
    }

    const params = new URLSearchParams();
    params.set('sellToken', sellToken.address);
    params.set('buyToken', buyToken.address);
    params.set('sellAmount', sellAmountAtomic.toString());
    
    if (slippageBps) {
      params.set('slippagePercentage', (slippageBps / 10000).toString());
    }
    params.set('skipValidation', 'true');

    const url = `${baseUrl}/swap/v1/quote?${params.toString()}`;
    console.log('Calling 0x API:', url);

    let response = await fetch(url, { headers });
    
    // Retry once for 429/5xx errors with 150ms backoff
    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      console.log('0x API error, retrying after 150ms:', response.status);
      await new Promise(resolve => setTimeout(resolve, 150));
      response = await fetch(url, { headers });
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('0x API error:', errorText);
      return new Response(JSON.stringify({ error: errorText, provider: '0x' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const zeroXData = await response.json();
    console.log('0x API response:', zeroXData);

    // Calculate price as quote/base using 0x price with correct inversion for BUY
    const px0x = Number(zeroXData.price); // buy/sell normalized from 0x
    const price = side === 'BUY' ? 1 / px0x : px0x; // we want quote/base

    // Parse gas quantities robustly
    const estGas = parseQty(zeroXData.estimatedGas);
    let gasPriceWei = parseQty(zeroXData.gasPrice);
    
    if (!gasPriceWei && estGas) {
      gasPriceWei = await getRpcGasPrice(chainId);
    }

    // Calculate gas cost in quote currency
    let gasCostQuote: number | undefined;
    if (estGas && gasPriceWei) {
      const gasCostWei = estGas * gasPriceWei;
      const gasCostNative = Number(gasCostWei) / 1e18; // safe because gas cost is small
      const nativeToQuotePrice = await getNativeToQuotePrice(chainId, quoteToken.address);
      if (nativeToQuotePrice) {
        gasCostQuote = gasCostNative * nativeToQuotePrice;
      }
    }

    // Calculate minOut in atomic units using guaranteedPrice with BigInt math
    let minOut: string | undefined;
    const guaranteedPrice = zeroXData.guaranteedPrice ? Number(zeroXData.guaranteedPrice) : null;
    if (guaranteedPrice) {
      const SCALE = 1_000_000n; // 1e6 for precision
      const gpScaled = BigInt(Math.floor(guaranteedPrice * Number(SCALE)));
      const qPow = BigInt(10) ** BigInt(quoteToken.decimals);
      const bPow = BigInt(10) ** BigInt(baseToken.decimals);
      
      let minOutAtomic: bigint;
      if (side === 'BUY') {
        // sell quote, receive base → gp = base/quote
        // base_out_min = sell_quote_atomic * gp * 10^base_dec / (SCALE * 10^quote_dec)
        minOutAtomic = (sellAmountAtomic * gpScaled * bPow) / (SCALE * qPow);
      } else {
        // sell base, receive quote → gp = quote/base
        // quote_out_min = sell_base_atomic * gp * 10^quote_dec / (SCALE * 10^base_dec)
        minOutAtomic = (sellAmountAtomic * gpScaled * qPow) / (SCALE * bPow);
      }
      minOut = minOutAtomic.toString();
    }

    // Calculate effective BPS cost using corrected notional and gas
    const notionalQuote = side === 'BUY' ? amount : amount * price;
    const priceImpactBps = zeroXData.estimatedPriceImpact ? Math.round(parseFloat(zeroXData.estimatedPriceImpact) * 10000) : 0;
    const feeBps = 0; // 0x doesn't charge protocol fees in most cases
    const gasBps = gasCostQuote ? (gasCostQuote / notionalQuote) * 10000 : 0;
    const effectiveBpsCost = priceImpactBps + feeBps + gasBps;

    const result = {
      provider: '0x' as const,
      price,
      gasCostQuote,
      feePct: undefined,
      minOut,
      priceImpactBps: priceImpactBps > 0 ? priceImpactBps : undefined,
      mevRoute: 'public' as const,
      quoteTs: Date.now(),
      raw: zeroXData,
      effectiveBpsCost,
    };

    console.log('Returning quote result:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in onchain-quote function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({ error: errorMessage, provider: '0x' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});