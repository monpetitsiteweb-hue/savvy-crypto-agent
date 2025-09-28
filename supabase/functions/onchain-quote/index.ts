import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { TOKENS, WETH, toAtomic, type Token } from './tokens.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ZEROEX_API_KEY = Deno.env.get('ZEROEX_API_KEY');
const ONEINCH_API_KEY = Deno.env.get('ONEINCH_API_KEY');
const UNISWAP_API_KEY = Deno.env.get('UNISWAP_API_KEY');
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
    const { chainId, base, quote, side, amount, slippageBps, provider = '0x' } = await req.json();

    console.log('Received quote request:', { chainId, base, quote, side, amount, slippageBps, provider });

    // Validate provider and chainId support
    if (!['0x', '1inch', 'cow', 'uniswap'].includes(provider)) {
      return new Response(JSON.stringify({ error: `Unsupported provider: ${provider}` }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = CHAIN_BASE_URLS[chainId as keyof typeof CHAIN_BASE_URLS];
    if (!baseUrl && provider === '0x') {
      return new Response(JSON.stringify({ error: `Unsupported chainId: ${chainId}`, provider: '0x' }), {
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
      return await handleCoWQuote(chainId, sellToken, buyToken, sellAmountAtomic, slippageBps, side, amount, baseToken, quoteToken);
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
  const baseUrl = CHAIN_BASE_URLS[chainId as keyof typeof CHAIN_BASE_URLS];
  if (!baseUrl) {
    return new Response(JSON.stringify({ error: `Unsupported chainId: ${chainId}`, provider: '0x' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

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
  const px0x = Number(zeroXData.price);
  if (!px0x || px0x <= 0) {
    return new Response(JSON.stringify({ error: 'Invalid or missing price from 0x', provider: '0x' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const price = side === 'BUY' ? 1 / px0x : px0x;

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
    const DEN = 10n ** 18n;
    const whole = gasCostWei / DEN;
    const frac  = gasCostWei % DEN;
    const gasCostNative = Number(whole) + Number(frac) / 1e18;
    const nativeToQuotePrice = await getNativeToQuotePrice(chainId, quoteToken.address);
    if (nativeToQuotePrice) {
      gasCostQuote = gasCostNative * nativeToQuotePrice;
    }
  }

  // Calculate minOut in atomic units using guaranteedPrice with BigInt math
  let minOut: string | undefined;
  const guaranteedPrice = zeroXData.guaranteedPrice ? Number(zeroXData.guaranteedPrice) : null;
  if (guaranteedPrice) {
    const SCALE = 1_000_000n;
    const gpScaled = BigInt(Math.floor(guaranteedPrice * Number(SCALE)));
    const qPow = BigInt(10) ** BigInt(quoteToken.decimals);
    const bPow = BigInt(10) ** BigInt(baseToken.decimals);
    
    let minOutAtomic: bigint;
    if (side === 'BUY') {
      minOutAtomic = (sellAmountAtomic * gpScaled * bPow) / (SCALE * qPow);
    } else {
      minOutAtomic = (sellAmountAtomic * gpScaled * qPow) / (SCALE * bPow);
    }
    minOut = minOutAtomic.toString();
  }

  // Calculate effective BPS cost
  const notionalQuote = side === 'BUY' ? amount : amount * price;
  const priceImpactBps = zeroXData.estimatedPriceImpact ? Math.round(parseFloat(zeroXData.estimatedPriceImpact) * 10000) : 0;
  const feeBps = 0;
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

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

async function handleCoWQuote(chainId: number, sellToken: Token, buyToken: Token, sellAmountAtomic: bigint, slippageBps: number | undefined, side: string, amount: number, baseToken: Token, quoteToken: Token) {
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

  // Parse CoW response
  const buyAmount = parseQty(cowData.buyAmount);
  const sellAmount = parseQty(cowData.sellAmount);
  const feeAmount = parseQty(cowData.feeAmount);
  
  if (!buyAmount || buyAmount <= 0n || !sellAmount || sellAmount <= 0n) {
    return new Response(JSON.stringify({ error: 'Invalid amounts from CoW', provider: 'cow' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Calculate price as quote/base
  const sellAmountFloat = Number(sellAmount) / (10 ** sellToken.decimals);
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
  const notionalQuote = side === 'BUY' ? amount : amount * price;
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