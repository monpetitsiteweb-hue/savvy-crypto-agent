import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { TOKENS, WETH, toAtomic, type Token } from './tokens.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ZEROEX_API_KEY = Deno.env.get('ZEROEX_API_KEY');
const ONEINCH_API_KEY = Deno.env.get('ONEINCH_API_KEY');
const UNISWAP_API_KEY = Deno.env.get('UNISWAP_API_KEY');
const ZEROX_ROOT = 'https://api.0x.org';
const ZEROX_VERSION = 'v2';
const ETH_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
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

const ONEINCH_BASE_URLS = {
  1: 'https://api.1inch.dev',
  8453: 'https://api.1inch.dev', 
  42161: 'https://api.1inch.dev',
};

const COW_BASE_URLS = {
  1: 'https://api.cow.fi',
  8453: 'https://api.cow.fi', 
  42161: 'https://api.cow.fi',
};

// Map chainId to 1inch chain IDs
const ONEINCH_CHAIN_IDS = {
  1: 1,     // Ethereum
  8453: 8453, // Base
  42161: 42161, // Arbitrum
};

function isClientAuthError(status: number) {
  return status === 401 || status === 403;
}

function to0xTokenParam(t: Token) {
  return t.symbol === 'ETH' ? ETH_SENTINEL : t.address.toLowerCase();
}

function get0xHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    '0x-version': ZEROX_VERSION,
    ...(ZEROEX_API_KEY && {'0x-api-key': ZEROEX_API_KEY})
  };
}

function withParam(params: URLSearchParams, key: string, val: string) {
  const p = new URLSearchParams(params.toString());
  p.set(key, val);
  return p;
}

const parseQty = (v: string | number | undefined): bigint | null => {
  if (v == null) return null;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  const s = String(v).trim();
  if (/^0x/i.test(s)) return BigInt(s);     // hex
  if (/^\d+$/.test(s)) return BigInt(s);    // decimal
  console.error('parseQty: unrecognized quantity', v);
  return null;
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

// In-memory cache for 0x token lists (60s TTL)
const tokenListCache = new Map<number, { tokens: any[]; expiry: number }>();

// Disabled - v1 token list endpoint returns 404
async function fetch0xTokenList(chainId: number): Promise<any[]> {
  return [];
}

function pick0xStableAlias(chainId: number, wanted: Token, tokenList: any[]): string {
  // Only handle USDC tokens
  if (wanted.symbol !== 'USDC') {
    return wanted.address;
  }

  // Find USDC variants in the token list
  const usdcVariants = tokenList.filter(token => {
    const symbol = token.symbol?.toUpperCase() || '';
    const name = token.name?.toLowerCase() || '';
    
    return ['USDC', 'USDC.E', 'USDBC'].includes(symbol) || 
           name.includes('usd coin');
  });

  if (usdcVariants.length === 0) {
    return wanted.address;
  }

  // Prefer exact USDC match, then USDC.e, then USDbC
  const priorityOrder = ['USDC', 'USDC.E', 'USDBC'];
  
  for (const priority of priorityOrder) {
    const match = usdcVariants.find(token => 
      token.symbol?.toUpperCase() === priority
    );
    if (match && match.address) {
      // Log the selection
      if (chainId === 8453 || chainId === 42161) {
        console.log(`USDC alias selected for chain ${chainId}: ${match.address} (${match.symbol})`);
      }
      return match.address;
    }
  }

  // Fallback to first variant found
  const fallback = usdcVariants[0];
  if (fallback?.address) {
    if (chainId === 8453 || chainId === 42161) {
      console.log(`USDC alias fallback for chain ${chainId}: ${fallback.address} (${fallback.symbol})`);
    }
    return fallback.address;
  }

  return wanted.address;
}

async function getNativeToQuotePrice(chainId: number, quoteTokenAddress: string): Promise<number | null> {
  const cacheKey = `${chainId}:${quoteTokenAddress}`;
  const cached = priceCache.get(cacheKey);
  
  if (cached && Date.now() < cached.expiry) {
    return cached.price;
  }

  try {
    const headers = get0xHeaders();

    const url = `${ZEROX_ROOT}/swap/permit2/price?chainId=${chainId}&sellToken=${ETH_SENTINEL}&buyToken=${quoteTokenAddress}&sellAmount=1000000000000000000`;
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      // Retry once using WETH as sellToken for chains where ETH sentinel fails
      const weth = WETH[chainId as keyof typeof WETH];
      if (weth) {
        const url2 = `${ZEROX_ROOT}/swap/permit2/price?chainId=${chainId}&sellToken=${weth.address.toLowerCase()}&buyToken=${quoteTokenAddress}&sellAmount=1000000000000000000`;
        let r2 = await fetch(url2, { headers });
        if (!r2.ok && (r2.status === 429 || r2.status >= 500)) {
          await new Promise(res => setTimeout(res, 150));
          r2 = await fetch(url2, { headers });
        }
        if (r2.ok) {
          const d2 = await r2.json();
          const price = d2.price ? parseFloat(d2.price) : null;
          priceCache.set(cacheKey, { price, expiry: Date.now() + 30_000 });
          return price;
        }
      }
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { chainId, base, quote, side, amount, slippageBps, provider = '0x', from } = await req.json();

    console.log('Received quote request:', { chainId, base, quote, side, amount, slippageBps, provider });

    // Validate provider and chainId support
    if (!['0x', '1inch', 'cow', 'uniswap'].includes(provider)) {
      return new Response(JSON.stringify({ error: `Unsupported provider: ${provider}` }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }


    // Get token info from registry
    const chainTokens = TOKENS[chainId as keyof typeof TOKENS];
    if (!chainTokens) {
      return new Response(JSON.stringify({ error: `No tokens configured for chainId: ${chainId}`, provider }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseToken = chainTokens[base as keyof typeof chainTokens];
    const quoteToken = chainTokens[quote as keyof typeof chainTokens];
    
    if (!baseToken || !quoteToken) {
      return new Response(JSON.stringify({ error: `Unsupported token pair: ${base}/${quote} on chain ${chainId}`, provider }), {
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

    // Branch on provider
    if (provider === '0x') {
      return await handle0xQuote(chainId, sellToken, buyToken, sellAmountAtomic, slippageBps, side, amount, baseToken, quoteToken);
    } else if (provider === '1inch') {
      return await handle1inchQuote(chainId, sellToken, buyToken, sellAmountAtomic, slippageBps, side, amount, baseToken, quoteToken);
    } else if (provider === 'cow') {
      return await handleCoWQuote(chainId, sellToken, buyToken, sellAmountAtomic, slippageBps, side, amount, baseToken, quoteToken, from);
    } else if (provider === 'uniswap') {
      return await handleUniswapQuote(chainId, sellToken, buyToken, sellAmountAtomic, slippageBps, side, amount, baseToken, quoteToken);
    }

    return new Response(JSON.stringify({ error: `Unsupported provider: ${provider}` }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in onchain-quote function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({ error: errorMessage, provider: 'unknown' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Provider-specific handlers
async function handle0xQuote(chainId: number, sellToken: Token, buyToken: Token, sellAmountAtomic: bigint, slippageBps: number | undefined, side: string, amount: number, baseToken: Token, quoteToken: Token) {
  const headers = get0xHeaders();

  const params = new URLSearchParams();
  params.set('chainId', String(chainId));
  params.set('sellToken', to0xTokenParam(sellToken));
  params.set('buyToken', to0xTokenParam(buyToken));
  params.set('sellAmount', sellAmountAtomic.toString());
  if (slippageBps != null) params.set('slippageBps', String(slippageBps));

  const url = `${ZEROX_ROOT}/swap/permit2/price?${params.toString()}`;
  console.log('Calling 0x API (v2):', url);

  // Track attempts for debug info
  const attempts: Array<{url: string, status: number, note: string}> = [];

  let response = await fetch(url, { headers });
  console.log('0x v2 status:', response.status);
  const bodyProbe = await response.clone().text();
  console.log('0x v2 body (first 300):', bodyProbe.slice(0,300));

  // Retry once (150ms) on 429/5xx
  if (!response.ok && (response.status === 429 || response.status >= 500)) {
    attempts.push({url, status: response.status, note: 'initial_failure'});
    await new Promise(r => setTimeout(r, 150));
    response = await fetch(url, { headers });
    console.log('0x v2 retry status:', response.status);
    const retryBodyProbe = await response.clone().text();
    console.log('0x v2 retry body (first 300):', retryBodyProbe.slice(0,300));
  }

  if (!response.ok && !isClientAuthError(response.status)) {
    const txt = await response.text();
    console.error('0x /quote error', response.status, url, txt.slice(0, 200));
    attempts.push({url, status: response.status, note: 'quote_failed'});

    // --- Fallback A: try WETH for native legs then /price again ---
    const weth = WETH[chainId as keyof typeof WETH];

    if (weth) {
      // If sell is native → try WETH instead
      if (sellToken.symbol === 'ETH') {
        const p2 = withParam(params, 'sellToken', weth.address.toLowerCase());
        const url2 = `${ZEROX_ROOT}/swap/permit2/price?${p2.toString()}`;
        attempts.push({url: url2, status: 0, note: 'trying_weth_sell'});
        let r2 = await fetch(url2, { headers });
        console.log('0x v2 WETH sell status:', r2.status);
        const wethSellBodyProbe = await r2.clone().text();
        console.log('0x v2 WETH sell body (first 300):', wethSellBodyProbe.slice(0,300));
        
        if (!r2.ok && (r2.status === 429 || r2.status >= 500)) {
          await new Promise(r => setTimeout(r, 150));
          r2 = await fetch(url2, { headers });
          console.log('0x v2 WETH sell retry status:', r2.status);
          const wethSellRetryBodyProbe = await r2.clone().text();
          console.log('0x v2 WETH sell retry body (first 300):', wethSellRetryBodyProbe.slice(0,300));
        }
        if (r2.ok) {
          const d2 = await r2.json();
          attempts.push({url: url2, status: r2.status, note: 'weth_sell_success'});
          return await build0xPriceResponse(d2, side, amount, baseToken, quoteToken, sellAmountAtomic, chainId, attempts);
        }
        attempts.push({url: url2, status: r2.status, note: 'weth_sell_failed'});
      }

      // If buy is native → try WETH instead
      if (buyToken.symbol === 'ETH') {
        const p3 = withParam(params, 'buyToken', weth.address.toLowerCase());
        const url3 = `${ZEROX_ROOT}/swap/permit2/price?${p3.toString()}`;
        attempts.push({url: url3, status: 0, note: 'trying_weth_buy'});
        let r3 = await fetch(url3, { headers });
        console.log('0x v2 WETH buy status:', r3.status);
        const wethBuyBodyProbe = await r3.clone().text();
        console.log('0x v2 WETH buy body (first 300):', wethBuyBodyProbe.slice(0,300));
        
        if (!r3.ok && (r3.status === 429 || r3.status >= 500)) {
          await new Promise(r => setTimeout(r, 150));
          r3 = await fetch(url3, { headers });
          console.log('0x v2 WETH buy retry status:', r3.status);
          const wethBuyRetryBodyProbe = await r3.clone().text();
          console.log('0x v2 WETH buy retry body (first 300):', wethBuyRetryBodyProbe.slice(0,300));
        }
        if (r3.ok) {
          const d3 = await r3.json();
          attempts.push({url: url3, status: r3.status, note: 'weth_buy_success'});
          return await build0xPriceResponse(d3, side, amount, baseToken, quoteToken, sellAmountAtomic, chainId, attempts);
        }
        attempts.push({url: url3, status: r3.status, note: 'weth_buy_failed'});
      }
    }

    // --- Fallback B: stable alias disabled for v2 ---
    // (tokenList endpoint returns 404 in v2)

    // --- Fallback C: already using /price ---
    // Main endpoint is already /swap/permit2/price so no additional fallback needed

    // If still failing, return original error text
    return new Response(JSON.stringify({ error: txt, provider: '0x', raw: { debug: { attempts } } }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!response.ok) {
    // 401/403 → return as is
    const txt = await response.text();
    attempts.push({url, status: response.status, note: 'auth_error'});
    return new Response(JSON.stringify({ error: txt, provider: '0x', raw: { debug: { attempts } } }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  attempts.push({url, status: response.status, note: 'success'});
  const zeroXData = await response.json();
  
  // If response is OK but has no usable price, try /quote endpoint as fallback
  if (!zeroXData.price || Number(zeroXData.price) <= 0) {
    const quoteUrl = `${ZEROX_ROOT}/swap/permit2/quote?${params.toString()}`;
    console.log('Calling 0x API (v2) quote fallback:', quoteUrl);
    attempts.push({url: quoteUrl, status: 0, note: 'trying_quote_fallback'});
    
    let quoteResponse = await fetch(quoteUrl, { headers });
    console.log('0x v2 quote fallback status:', quoteResponse.status);
    const quoteBodyProbe = await quoteResponse.clone().text();
    console.log('0x v2 quote fallback body (first 300):', quoteBodyProbe.slice(0,300));
    
    if (!quoteResponse.ok && (quoteResponse.status === 429 || quoteResponse.status >= 500)) {
      await new Promise(r => setTimeout(r, 150));
      quoteResponse = await fetch(quoteUrl, { headers });
      console.log('0x v2 quote fallback retry status:', quoteResponse.status);
      const quoteRetryBodyProbe = await quoteResponse.clone().text();
      console.log('0x v2 quote fallback retry body (first 300):', quoteRetryBodyProbe.slice(0,300));
    }
    
    if (quoteResponse.ok) {
      const quoteData = await quoteResponse.json();
      attempts.push({url: quoteUrl, status: quoteResponse.status, note: 'quote_fallback_success'});
      return await build0xPriceResponse(quoteData, side, amount, baseToken, quoteToken, sellAmountAtomic, chainId, attempts);
    }
    attempts.push({url: quoteUrl, status: quoteResponse.status, note: 'quote_fallback_failed'});
  }
  
  return await build0xPriceResponse(zeroXData, side, amount, baseToken, quoteToken, sellAmountAtomic, chainId, attempts);
}

async function build0xSuccessResponse(zeroXData: any, side: string, amount: number, baseToken: Token, quoteToken: Token, sellAmountAtomic: bigint, chainId: number, attempts?: Array<{url: string, status: number, note: string}>, fallbackType?: string) {
  const px0x = Number(zeroXData.price);
  if (!px0x || px0x <= 0) {
    return new Response(JSON.stringify({ error: 'Invalid or missing price from 0x', provider: '0x' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const price = side === 'BUY' ? 1 / px0x : px0x;

  const estGas = parseQty(zeroXData.estimatedGas);
  let gasPriceWei = parseQty(zeroXData.gasPrice) ?? await getRpcGasPrice(chainId);

  let gasCostQuote: number | undefined;
  if (estGas && gasPriceWei) {
    const gasCostWei = estGas * gasPriceWei;
    const DEN = 10n ** 18n;
    const whole = gasCostWei / DEN;
    const frac  = gasCostWei % DEN;
    const gasCostNative = Number(whole) + Number(frac) / 1e18;
    const nativeToQuotePrice = await getNativeToQuotePrice(chainId, quoteToken.address);
    if (nativeToQuotePrice) gasCostQuote = gasCostNative * nativeToQuotePrice;
  }

  // guaranteedPrice → minOut (atomic)
  let minOut: string | undefined;
  const gp = zeroXData.guaranteedPrice ? Number(zeroXData.guaranteedPrice) : null;
  if (gp) {
    const SCALE = 1_000_000n;
    const gpScaled = BigInt(Math.floor(gp * Number(SCALE)));
    const qPow = 10n ** BigInt(quoteToken.decimals);
    const bPow = 10n ** BigInt(baseToken.decimals);
    let minOutAtomic: bigint;
    if (side === 'BUY') {
      minOutAtomic = (sellAmountAtomic * gpScaled * bPow) / (SCALE * qPow);
    } else {
      minOutAtomic = (sellAmountAtomic * gpScaled * qPow) / (SCALE * bPow);
    }
    minOut = minOutAtomic.toString();
  }

  const notionalQuote = side === 'BUY' ? amount : amount * price;
  const priceImpactBps = zeroXData.estimatedPriceImpact ? Math.round(parseFloat(zeroXData.estimatedPriceImpact) * 10000) : 0;
  const gasBps = gasCostQuote ? (gasCostQuote / notionalQuote) * 10000 : 0;

  const raw: any = { ...zeroXData };
  if (attempts && attempts.length > 0) {
    raw.debug = { attempts };
  }
  if (fallbackType) {
    raw.fallback = fallbackType;
  }

  return new Response(JSON.stringify({
    provider: '0x' as const,
    price,
    gasCostQuote,
    feePct: undefined,
    minOut,
    priceImpactBps: priceImpactBps || undefined,
    mevRoute: 'public' as const,
    quoteTs: Date.now(),
    raw,
    effectiveBpsCost: priceImpactBps + gasBps,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
}

async function build0xPriceResponse(priceData: any, side: string, amount: number, baseToken: Token, quoteToken: Token, sellAmountAtomic: bigint, chainId: number, attempts?: Array<{url: string, status: number, note: string}>) {
  let px0x = Number(priceData?.price);
  if (!px0x || px0x <= 0) {
    const sellAmt = parseQty(priceData?.sellAmount);
    const buyAmt  = parseQty(priceData?.buyAmount);
    if (sellAmt && buyAmt) {
      const sell = Number(sellAmt) / 10 ** (side === 'BUY' ? quoteToken.decimals : baseToken.decimals);
      const buy  = Number(buyAmt)  / 10 ** (side === 'BUY' ? baseToken.decimals  : quoteToken.decimals);
      // SELL base→quote: price = buy/sell; BUY base with quote: price = sell/buy
      px0x = (side === 'BUY') ? (sell / buy) : (buy / sell);
    }
  }
  if (!px0x || px0x <= 0) {
    return new Response(JSON.stringify({ error: 'Invalid price from 0x v2', provider: '0x', raw: priceData }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const price = side === 'BUY' ? 1 / px0x : px0x;

  // Use v2 gas fields
  let gasCostQuote: number | undefined;
  const estGas = parseQty(priceData.estimatedGas ?? priceData.gas);
  const gasPriceWei = parseQty(priceData.gasPrice) ?? await getRpcGasPrice(chainId);
  if (estGas && gasPriceWei) {
    const gasCostWei = estGas * gasPriceWei;
    const DEN = 10n ** 18n;
    const whole = gasCostWei / DEN;
    const frac  = gasCostWei % DEN;
    const gasCostNative = Number(whole) + Number(frac) / 1e18;
    const nativeToQuotePrice = await getNativeToQuotePrice(chainId, quoteToken.address);
    if (nativeToQuotePrice) gasCostQuote = gasCostNative * nativeToQuotePrice;
  }

  // Provide minOut when v2 returns minBuyAmount
  let minOut: string | undefined;
  if (priceData.minBuyAmount) {
    minOut = String(priceData.minBuyAmount);
  }

  const notionalQuote = side === 'BUY' ? amount : amount * price;
  const gasBps = gasCostQuote ? (gasCostQuote / notionalQuote) * 10000 : 0;

  const raw: any = { ...priceData, fallback: 'price' };
  if (attempts && attempts.length > 0) {
    raw.debug = { attempts };
  }

  return new Response(JSON.stringify({
    provider: '0x' as const,
    price,
    gasCostQuote,
    feePct: undefined,
    minOut,
    priceImpactBps: priceData.estimatedPriceImpact ? Math.round(parseFloat(priceData.estimatedPriceImpact) * 10000) : undefined,
    mevRoute: 'public' as const,
    quoteTs: Date.now(),
    raw,
    effectiveBpsCost: gasBps,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
}

async function handle1inchQuote(chainId: number, sellToken: Token, buyToken: Token, sellAmountAtomic: bigint, slippageBps: number | undefined, side: string, amount: number, baseToken: Token, quoteToken: Token) {
  const baseUrl = ONEINCH_BASE_URLS[chainId as keyof typeof ONEINCH_BASE_URLS];
  const oneInchChainId = ONEINCH_CHAIN_IDS[chainId as keyof typeof ONEINCH_CHAIN_IDS];
  
  if (!baseUrl || !ONEINCH_API_KEY) {
    return new Response(JSON.stringify({ error: 'Missing 1inch API key or unsupported chain', provider: '1inch' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ONEINCH_API_KEY}`,
  };

  const params = new URLSearchParams();
  params.set('src', sellToken.address);
  params.set('dst', buyToken.address);
  params.set('amount', sellAmountAtomic.toString());
  
  if (slippageBps) {
    params.set('slippage', (slippageBps / 100).toString()); // 1inch uses percentage
  }

  const url = `${baseUrl}/swap/v6.0/${oneInchChainId}/quote?${params.toString()}`;
  console.log('Calling 1inch API:', url);

  let response = await fetch(url, { headers });
  
  // Retry once for 429/5xx errors with 150ms backoff
  if (!response.ok && (response.status === 429 || response.status >= 500)) {
    console.log('1inch API error, retrying after 150ms:', response.status);
    await new Promise(resolve => setTimeout(resolve, 150));
    response = await fetch(url, { headers });
  }
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('1inch API error:', errorText);
    return new Response(JSON.stringify({ error: errorText, provider: '1inch' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const oneInchData = await response.json();
  console.log('1inch API response:', oneInchData);

  // Parse 1inch response
  const buyAmount = parseQty(oneInchData.dstAmount);
  if (!buyAmount || buyAmount <= 0n) {
    return new Response(JSON.stringify({ error: 'Invalid buy amount from 1inch', provider: '1inch' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Calculate price as quote/base
  const sellAmountFloat = Number(sellAmountAtomic) / (10 ** sellToken.decimals);
  const buyAmountFloat = Number(buyAmount) / (10 ** buyToken.decimals);
  let price: number;
  
  if (side === 'BUY') {
    // sell quote, buy base → price = sellAmountFloat / buyAmountFloat (quote/base)
    price = sellAmountFloat / buyAmountFloat;
  } else {
    // sell base, buy quote → price = buyAmountFloat / sellAmountFloat (quote/base)
    price = buyAmountFloat / sellAmountFloat;
  }

  if (!price || price <= 0) {
    return new Response(JSON.stringify({ error: 'Invalid price calculation from 1inch', provider: '1inch' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Parse gas info
  const estGas = parseQty(oneInchData.gas);
  let gasPriceWei = await getRpcGasPrice(chainId);

  // Calculate gas cost in quote currency
  let gasCostQuote: number | undefined;
  if (estGas && gasPriceWei) {
    const gasCostWei = estGas * gasPriceWei;
    const DEN = 10n ** 18n;
    const whole = gasCostWei / DEN;
    const frac  = gasCostWei % DEN;
    const gasCostNative = Number(whole) + Number(frac) / 1e18;
    const nativeToQuotePrice = await getNativeToQuotePrice(chainId, quoteToken.address);
    if (nativeToQuotePrice) {
      gasCostQuote = gasCostNative * nativeToQuotePrice;
    }
  }

  // Calculate minOut = dstAmount minus slippage
  const slippagePct = (slippageBps ?? 50) / 10000; // default 50 bps if undefined
  // minOut = dstAmount * (1 - slippage)
  const SCALE = 1_000_000n;
  const oneMinusSlippageScaled = BigInt(Math.floor((1 - slippagePct) * 1_000_000));
  const minOutAtomic = (buyAmount * oneMinusSlippageScaled) / SCALE;
  const minOut = minOutAtomic.toString();

  // Calculate effective BPS cost
  const notionalQuote = side === 'BUY' ? amount : amount * price;
  const feeBps = 0; // 1inch typically doesn't show explicit fees in quotes
  const gasBps = gasCostQuote ? (gasCostQuote / notionalQuote) * 10000 : 0;
  const effectiveBpsCost = feeBps + gasBps;

  const result = {
    provider: '1inch' as const,
    price,
    gasCostQuote,
    feePct: undefined,
    minOut,
    priceImpactBps: undefined,
    mevRoute: 'public' as const,
    quoteTs: Date.now(),
    raw: oneInchData,
    effectiveBpsCost,
  };

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleCoWQuote(chainId: number, sellToken: Token, buyToken: Token, sellAmountAtomic: bigint, slippageBps: number | undefined, side: string, amount: number, baseToken: Token, quoteToken: Token, from?: string) {
  const baseUrl = COW_BASE_URLS[chainId as keyof typeof COW_BASE_URLS];
  
  if (!baseUrl || chainId !== 1) { // CoW only supports mainnet for now
    return new Response(JSON.stringify({ error: 'CoW Protocol only supports Ethereum mainnet', provider: 'cow' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Temporarily support only SELL orders
  if (side !== 'SELL') {
    return new Response(JSON.stringify({ error: 'CoW BUY quotes not supported yet', provider: 'cow' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Map ETH to WETH for CoW Protocol
  const wethForChain = WETH[chainId as keyof typeof WETH];
  let finalSellToken = sellToken;
  let finalBuyToken = buyToken;
  
  if (sellToken.symbol === 'ETH' && wethForChain) {
    finalSellToken = wethForChain;
  }
  if (buyToken.symbol === 'ETH' && wethForChain) {
    finalBuyToken = wethForChain;
  }

  // Validate and set from address
  let fromAddress: string;
  if (from) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(from)) {
      return new Response(JSON.stringify({ error: 'Invalid from address', provider: 'cow' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    fromAddress = from;
  } else {
    fromAddress = Deno.env.get('COW_DEFAULT_FROM') || '0x0000000000000000000000000000000000000001';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // CoW quote request body
  const cowRequest = {
    sellToken: finalSellToken.address,
    buyToken: finalBuyToken.address,
    sellAmountBeforeFee: sellAmountAtomic.toString(),
    kind: 'sell',
    partiallyFillable: false,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
    from: fromAddress,
  };

  const url = `${baseUrl}/mainnet/api/v1/quote`;
  console.log('Calling CoW API:', url, cowRequest);

  let response = await fetch(url, { 
    method: 'POST',
    headers,
    body: JSON.stringify(cowRequest)
  });
  
  // Retry once for 429/5xx errors with 150ms backoff
  if (!response.ok && (response.status === 429 || response.status >= 500)) {
    console.log('CoW API error, retrying after 150ms:', response.status);
    await new Promise(resolve => setTimeout(resolve, 150));
    response = await fetch(url, { 
      method: 'POST',
      headers,
      body: JSON.stringify(cowRequest)
    });
  }
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('CoW API error:', errorText);
    return new Response(JSON.stringify({ error: errorText, provider: 'cow' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const cowData = await response.json();
  console.log('CoW API response:', cowData);

  // Parse CoW response - handle both direct and nested quote structure
  const q = cowData.quote ?? cowData;
  const buyAmount = parseQty(q?.buyAmount);
  const sellAmount = parseQty(q?.sellAmount);
  const feeAmount = parseQty(q?.feeAmount);
  
  if (!buyAmount || buyAmount <= 0n || !sellAmount || sellAmount <= 0n) {
    return new Response(JSON.stringify({ error: 'Invalid amounts from CoW', provider: 'cow' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Calculate price as quote/base
  const sellAmountFloat = Number(sellAmount) / (10 ** sellToken.decimals);
  const buyAmountFloat = Number(buyAmount) / (10 ** buyToken.decimals);
  
  // Since we only support SELL, price = buyAmountFloat / sellAmountFloat (quote/base)
  const price = buyAmountFloat / sellAmountFloat;

  if (!price || price <= 0) {
    return new Response(JSON.stringify({ error: 'Invalid price calculation from CoW', provider: 'cow' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Calculate fee percentage if available
  let feePct: number | undefined;
  if (feeAmount && sellAmount) {
    feePct = Number(feeAmount) / Number(sellAmount);
  }

  // minOut is the guaranteed buy amount from CoW
  const minOut = buyAmount.toString();

  // Calculate effective BPS cost
  const notionalQuote = amount * price; // CoW only supports SELL
  const feeBps = feePct ? feePct * 10000 : 0;
  const effectiveBpsCost = feeBps; // CoW doesn't charge gas directly

  const result = {
    provider: 'cow' as const,
    price,
    gasCostQuote: undefined, // CoW doesn't expose gas costs
    feePct,
    minOut,
    priceImpactBps: undefined,
    mevRoute: 'cow_intent' as const,
    quoteTs: Date.now(),
    raw: cowData,
    effectiveBpsCost,
  };

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleUniswapQuote(chainId: number, sellToken: Token, buyToken: Token, sellAmountAtomic: bigint, slippageBps: number | undefined, side: string, amount: number, baseToken: Token, quoteToken: Token) {
  return new Response(JSON.stringify({
    error: 'Uniswap direct quoting disabled: no UNISWAP_API_KEY / Routing API not integrated yet',
    provider: 'uniswap'
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
}