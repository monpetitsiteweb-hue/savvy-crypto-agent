/**
 * price-proxy — CANONICAL PRICE READER
 * 
 * This Edge Function reads prices from the canonical price_snapshots table.
 * It prioritizes DB snapshots and only falls back to Coinbase API if snapshot is stale (>10 min).
 * 
 * INVARIANTS:
 * - Reads FIRST from price_snapshots (canonical source)
 * - Falls back to Coinbase ONLY if snapshot is stale (>10 min) or missing
 * - Returns staleness info for UI to display appropriately
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cache for this invocation (module-level singleton)
const invocationCache = new Map<string, { price: number; ts: string; cached_at: number }>();
const CACHE_TTL_MS = 15_000; // 15 seconds within same invocation

// Max staleness before fallback to live API
const MAX_STALENESS_MS = 10 * 60 * 1000; // 10 minutes

// Coinbase fallback timeout
const FETCH_TIMEOUT_MS = 5000;

interface PriceProxyRequest {
  baseSymbols: string[];
  quote?: string;
}

interface PriceResult {
  price: number;
  ts: string;
  source: 'snapshot' | 'live_fallback' | 'coinbase_cached';
  staleness_ms?: number;
}

interface FailedSymbol {
  symbol: string;
  pair: string;
  reason: 'pair_not_found' | 'rate_limited' | 'connection_reset' | 'network_error' | 'timeout' | 'stale_and_fallback_failed' | 'unexpected';
}

interface PriceProxyResponse {
  quote: string;
  prices: Record<string, PriceResult>;
  failed: FailedSymbol[];
  cached: number;
  source: 'canonical';
}

/**
 * Fetch price from canonical price_snapshots table
 */
async function getPriceFromSnapshots(
  supabase: ReturnType<typeof createClient>,
  baseSymbol: string,
  quote: string
): Promise<{ price: number; ts: string; staleness_ms: number } | null> {
  // Try multiple key formats for compatibility
  const symbolVariants = [
    `${baseSymbol.toUpperCase()}-${quote.toUpperCase()}`,
    baseSymbol.toUpperCase(),
    baseSymbol,
    `${baseSymbol}-${quote}`,
  ];

  for (const symbol of symbolVariants) {
    const { data, error } = await supabase
      .from('price_snapshots')
      .select('price, ts')
      .eq('symbol', symbol)
      .order('ts', { ascending: false })
      .limit(1)
      .single();

    if (!error && data && data.price > 0) {
      const staleness_ms = Date.now() - new Date(data.ts).getTime();
      return {
        price: data.price,
        ts: data.ts,
        staleness_ms,
      };
    }
  }

  return null;
}

/**
 * Fallback to live Coinbase API (only if snapshot too stale or missing)
 */
async function fetchLiveFallback(
  baseSymbol: string,
  quote: string
): Promise<{ price: number; ts: string } | { reason: FailedSymbol['reason'] }> {
  const pair = `${baseSymbol.toUpperCase()}-${quote.toUpperCase()}`;
  const url = `https://api.exchange.coinbase.com/products/${pair}/ticker`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Lovable-PriceProxy/2.0',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 404) return { reason: 'pair_not_found' };
      if (response.status === 429) return { reason: 'rate_limited' };
      return { reason: 'network_error' };
    }

    const data = await response.json();
    const price = parseFloat(data.price);

    if (isNaN(price) || price <= 0) {
      return { reason: 'unexpected' };
    }

    return { price, ts: new Date().toISOString() };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error) {
      if (error.name === 'AbortError') return { reason: 'timeout' };
      if (error.message.includes('ConnectionReset') || error.message.includes('ECONNRESET')) {
        return { reason: 'connection_reset' };
      }
    }
    return { reason: 'network_error' };
  }
}

/**
 * Get price with caching and canonical source priority
 */
async function getPriceWithCache(
  supabase: ReturnType<typeof createClient>,
  baseSymbol: string,
  quote: string
): Promise<{ cached: boolean; result: PriceResult | null; failed: FailedSymbol | null }> {
  const pair = `${baseSymbol.toUpperCase()}-${quote.toUpperCase()}`;
  const cacheKey = pair;

  // Check invocation cache first
  const cached = invocationCache.get(cacheKey);
  if (cached && (Date.now() - cached.cached_at) < CACHE_TTL_MS) {
    return {
      cached: true,
      result: {
        price: cached.price,
        ts: cached.ts,
        source: 'coinbase_cached',
      },
      failed: null,
    };
  }

  // Try canonical source (price_snapshots)
  const snapshot = await getPriceFromSnapshots(supabase, baseSymbol, quote);

  if (snapshot) {
    // Check staleness
    if (snapshot.staleness_ms <= MAX_STALENESS_MS) {
      // Fresh enough - use canonical source
      invocationCache.set(cacheKey, {
        price: snapshot.price,
        ts: snapshot.ts,
        cached_at: Date.now(),
      });

      return {
        cached: false,
        result: {
          price: snapshot.price,
          ts: snapshot.ts,
          source: 'snapshot',
          staleness_ms: snapshot.staleness_ms,
        },
        failed: null,
      };
    }

    // Snapshot too stale - try live fallback
    console.log(`[price-proxy] Snapshot stale (${Math.round(snapshot.staleness_ms / 1000)}s) for ${pair}, trying live fallback`);
    const live = await fetchLiveFallback(baseSymbol, quote);

    if ('price' in live) {
      invocationCache.set(cacheKey, {
        price: live.price,
        ts: live.ts,
        cached_at: Date.now(),
      });

      return {
        cached: false,
        result: {
          price: live.price,
          ts: live.ts,
          source: 'live_fallback',
        },
        failed: null,
      };
    }

    // Live fallback failed - return stale snapshot with warning (better than nothing)
    console.warn(`[price-proxy] Live fallback failed for ${pair}, using stale snapshot`);
    invocationCache.set(cacheKey, {
      price: snapshot.price,
      ts: snapshot.ts,
      cached_at: Date.now(),
    });

    return {
      cached: false,
      result: {
        price: snapshot.price,
        ts: snapshot.ts,
        source: 'snapshot',
        staleness_ms: snapshot.staleness_ms,
      },
      failed: null,
    };
  }

  // No snapshot at all - must use live fallback
  console.log(`[price-proxy] No snapshot for ${pair}, using live fallback`);
  const live = await fetchLiveFallback(baseSymbol, quote);

  if ('price' in live) {
    invocationCache.set(cacheKey, {
      price: live.price,
      ts: live.ts,
      cached_at: Date.now(),
    });

    return {
      cached: false,
      result: {
        price: live.price,
        ts: live.ts,
        source: 'live_fallback',
      },
      failed: null,
    };
  }

  // Complete failure
  return {
    cached: false,
    result: null,
    failed: {
      symbol: baseSymbol,
      pair,
      reason: live.reason,
    },
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: PriceProxyRequest = await req.json();
    const { baseSymbols, quote = 'EUR' } = body;

    if (!Array.isArray(baseSymbols) || baseSymbols.length === 0) {
      return new Response(JSON.stringify({ error: 'baseSymbols array required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (baseSymbols.length > 50) {
      return new Response(JSON.stringify({ error: 'Max 50 symbols per request' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`[price-proxy] Request for ${baseSymbols.length} symbols: ${baseSymbols.join(', ')}, quote: ${quote}`);

    // Fetch all prices in parallel
    const results = await Promise.all(
      baseSymbols.map(symbol => getPriceWithCache(supabase, symbol, quote))
    );

    // Aggregate results
    const prices: Record<string, PriceResult> = {};
    const failed: FailedSymbol[] = [];
    let cachedCount = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const symbol = baseSymbols[i];
      const pair = `${symbol.toUpperCase()}-${quote.toUpperCase()}`;

      if (result.result) {
        prices[pair] = result.result;
        if (result.cached || result.result.source === 'snapshot') {
          cachedCount++;
        }
      } else if (result.failed) {
        failed.push(result.failed);
      }
    }

    const response: PriceProxyResponse = {
      quote: quote.toUpperCase(),
      prices,
      failed,
      cached: cachedCount,
      source: 'canonical',
    };

    console.log(`[price-proxy] Response: ${Object.keys(prices).length} prices, ${failed.length} failed, ${cachedCount} from cache/snapshots`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[price-proxy] Error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error', 
      message: error instanceof Error ? error.message : 'Unknown' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
