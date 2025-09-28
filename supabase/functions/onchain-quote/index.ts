import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

async function getRpcGasPrice(chainId: number): Promise<number | null> {
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
    return data.result ? parseInt(data.result, 16) : null;
  } catch (error) {
    console.error('Failed to fetch gas price from RPC:', error);
    return null;
  }
}

async function getNativeToQuotePrice(chainId: number, quoteToken: string): Promise<number | null> {
  try {
    const baseUrl = CHAIN_BASE_URLS[chainId as keyof typeof CHAIN_BASE_URLS];
    if (!baseUrl) return null;

    // Get native token symbol for the chain
    const nativeTokens = {
      1: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
      8453: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH on Base
      42161: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH on Arbitrum
    };

    const nativeToken = nativeTokens[chainId as keyof typeof nativeTokens];
    if (!nativeToken) return null;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ZEROEX_API_KEY) {
      headers['0x-api-key'] = ZEROEX_API_KEY;
    }

    const url = `${baseUrl}/swap/v1/quote?sellToken=${nativeToken}&buyToken=${quoteToken}&sellAmount=1000000000000000000&skipValidation=true`;
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    return data.price ? parseFloat(data.price) : null;
  } catch (error) {
    console.error('Failed to get native to quote price:', error);
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

    // Build 0x API request
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ZEROEX_API_KEY) {
      headers['0x-api-key'] = ZEROEX_API_KEY;
    }

    const params = new URLSearchParams();
    
    if (side === 'BUY') {
      params.set('sellToken', quote);
      params.set('buyToken', base);
      params.set('sellAmount', amount.toString());
    } else {
      params.set('sellToken', base);
      params.set('buyToken', quote);
      params.set('sellAmount', amount.toString());
    }
    
    if (slippageBps) {
      params.set('slippagePercentage', (slippageBps / 10000).toString());
    }
    params.set('skipValidation', 'true');

    const url = `${baseUrl}/swap/v1/quote?${params.toString()}`;
    console.log('Calling 0x API:', url);

    const response = await fetch(url, { headers });
    
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

    // Calculate price (quote/base)
    const price = side === 'BUY' 
      ? parseFloat(zeroXData.sellAmount) / amount  // quote spent / base received
      : parseFloat(zeroXData.buyAmount) / amount;   // quote received / base sold

    // Calculate gas cost in quote currency
    let gasCostQuote = 0;
    if (zeroXData.estimatedGas) {
      const gasPrice = zeroXData.gasPrice ? parseInt(zeroXData.gasPrice, 16) : await getRpcGasPrice(chainId);
      if (gasPrice) {
        const gasCostNative = parseInt(zeroXData.estimatedGas, 16) * gasPrice;
        const nativeToQuotePrice = await getNativeToQuotePrice(chainId, side === 'BUY' ? quote : quote);
        if (nativeToQuotePrice) {
          gasCostQuote = (gasCostNative / 1e18) * nativeToQuotePrice;
        }
      }
    }

    // Calculate effective BPS cost
    const notionalQuote = side === 'BUY' ? amount : amount * price;
    const priceImpactBps = zeroXData.estimatedPriceImpact ? Math.round(parseFloat(zeroXData.estimatedPriceImpact) * 100) : 0;
    const feeBps = 0; // 0x doesn't charge protocol fees in most cases
    const gasBps = gasCostQuote > 0 ? (gasCostQuote / notionalQuote) * 10000 : 0;
    const effectiveBpsCost = priceImpactBps + feeBps + gasBps;

    const result = {
      provider: '0x' as const,
      price,
      gasCostQuote: gasCostQuote > 0 ? gasCostQuote : undefined,
      feePct: undefined,
      minOut: zeroXData.guaranteedPrice ? (parseFloat(zeroXData.guaranteedPrice) * amount).toString() : undefined,
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