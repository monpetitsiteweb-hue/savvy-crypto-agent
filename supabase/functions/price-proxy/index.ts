import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// In-memory cache with TTL
interface CacheEntry {
  price: number;
  ts: string;
  cachedAt: number;
}

const priceCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15_000; // 15 seconds

// Timeout for Coinbase requests
const FETCH_TIMEOUT_MS = 5_000; // 5 seconds

interface PriceProxyRequest {
  baseSymbols: string[];
  quote?: string; // Default: "EUR"
}

interface PriceResult {
  price: number;
  ts: string;
  source: string;
}

interface FailedSymbol {
  symbol: string;
  pair: string;
  reason: 'pair_not_found' | 'rate_limited' | 'connection_reset' | 'network_error' | 'timeout' | 'unexpected';
}

interface PriceProxyResponse {
  quote: string;
  prices: Record<string, PriceResult>;
  failed: FailedSymbol[];
  cached: number; // Count of cached results
}

/**
 * Fetch price from Coinbase with timeout and error classification
 */
async function fetchCoinbasePrice(
  pair: string
): Promise<{ success: true; price: number; ts: string } | { success: false; reason: FailedSymbol['reason'] }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const url = `https://api.exchange.coinbase.com/products/${pair}/ticker`;
    console.log(`[price-proxy] Fetching ${url}`);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Lovable-PriceProxy/1.0',
      },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const price = parseFloat(data.price);
      if (isNaN(price) || price <= 0) {
        console.warn(`[price-proxy] Invalid price for ${pair}: ${data.price}`);
        return { success: false, reason: 'unexpected' };
      }
      return {
        success: true,
        price,
        ts: new Date().toISOString(),
      };
    }

    // Classify HTTP errors
    if (response.status === 404) {
      console.warn(`[price-proxy] Pair not found: ${pair}`);
      return { success: false, reason: 'pair_not_found' };
    }
    if (response.status === 429) {
      console.warn(`[price-proxy] Rate limited for ${pair}`);
      return { success: false, reason: 'rate_limited' };
    }

    console.error(`[price-proxy] Unexpected status ${response.status} for ${pair}`);
    return { success: false, reason: 'unexpected' };

  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.error(`[price-proxy] Timeout for ${pair}`);
        return { success: false, reason: 'timeout' };
      }
      // Connection reset / network errors
      if (
        error.message.includes('ConnectionReset') ||
        error.message.includes('connection reset') ||
        error.message.includes('ECONNRESET')
      ) {
        console.error(`[price-proxy] Connection reset for ${pair}: ${error.message}`);
        return { success: false, reason: 'connection_reset' };
      }
    }

    console.error(`[price-proxy] Network error for ${pair}:`, error);
    return { success: false, reason: 'network_error' };
  }
}

/**
 * Get price for a pair, using cache if valid
 */
async function getPriceWithCache(
  baseSymbol: string,
  quote: string
): Promise<{ cached: boolean; result: PriceResult | null; failed: FailedSymbol | null }> {
  const pair = `${baseSymbol.toUpperCase()}-${quote.toUpperCase()}`;
  const now = Date.now();

  // Check cache
  const cached = priceCache.get(pair);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    console.log(`[price-proxy] Cache hit for ${pair}`);
    return {
      cached: true,
      result: { price: cached.price, ts: cached.ts, source: 'coinbase_cached' },
      failed: null,
    };
  }

  // Fetch from Coinbase
  const fetchResult = await fetchCoinbasePrice(pair);

  if (fetchResult.success) {
    // Update cache
    priceCache.set(pair, {
      price: fetchResult.price,
      ts: fetchResult.ts,
      cachedAt: now,
    });

    return {
      cached: false,
      result: { price: fetchResult.price, ts: fetchResult.ts, source: 'coinbase' },
      failed: null,
    };
  }

  // Failed - return error info
  return {
    cached: false,
    result: null,
    failed: { symbol: baseSymbol, pair, reason: fetchResult.reason },
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body: PriceProxyRequest = await req.json();
    const { baseSymbols, quote = 'EUR' } = body;

    if (!Array.isArray(baseSymbols) || baseSymbols.length === 0) {
      return new Response(
        JSON.stringify({ error: 'baseSymbols must be a non-empty array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Limit to prevent abuse
    const MAX_SYMBOLS = 50;
    if (baseSymbols.length > MAX_SYMBOLS) {
      return new Response(
        JSON.stringify({ error: `Maximum ${MAX_SYMBOLS} symbols per request` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[price-proxy] Request for ${baseSymbols.length} symbols: ${baseSymbols.join(', ')}, quote: ${quote}`);

    const prices: Record<string, PriceResult> = {};
    const failed: FailedSymbol[] = [];
    let cachedCount = 0;

    // Fetch all prices in parallel
    const results = await Promise.all(
      baseSymbols.map((symbol) => getPriceWithCache(symbol, quote))
    );

    // Process results
    for (let i = 0; i < baseSymbols.length; i++) {
      const symbol = baseSymbols[i];
      const pair = `${symbol.toUpperCase()}-${quote.toUpperCase()}`;
      const result = results[i];

      if (result.result) {
        prices[pair] = result.result;
        if (result.cached) cachedCount++;
      } else if (result.failed) {
        failed.push(result.failed);
      }
    }

    const response: PriceProxyResponse = {
      quote: quote.toUpperCase(),
      prices,
      failed,
      cached: cachedCount,
    };

    console.log(`[price-proxy] Response: ${Object.keys(prices).length} prices, ${failed.length} failed, ${cachedCount} cached`);

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[price-proxy] Error processing request:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
