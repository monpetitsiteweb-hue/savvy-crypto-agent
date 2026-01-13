/**
 * price-snapshot-refresh — CANONICAL PRICE WRITER
 * 
 * This Edge Function is the ONLY writer to the price_snapshots table.
 * It runs every 5 minutes (via GitHub Action or pg_cron) and fetches
 * current prices from Coinbase for all active trading symbols.
 * 
 * INVARIANTS:
 * - Single authoritative writer to price_snapshots
 * - Max staleness: 5 minutes
 * - All other components READ from price_snapshots
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Active trading symbols (EUR pairs)
const ACTIVE_SYMBOLS = [
  'BTC', 'ETH', 'SOL', 'XRP', 'AVAX', 'ADA',
  'DOGE', 'DOT', 'LINK', 'MATIC', 'UNI', 'AAVE'
];

const COINBASE_API_BASE = 'https://api.exchange.coinbase.com';
const FETCH_TIMEOUT_MS = 5000;

interface PriceResult {
  symbol: string;
  price: number;
  ts: string;
  source: 'coinbase';
}

interface FailedSymbol {
  symbol: string;
  reason: string;
}

/**
 * Fetch price from Coinbase with timeout
 */
async function fetchCoinbasePrice(symbol: string): Promise<PriceResult | FailedSymbol> {
  const pair = `${symbol}-EUR`;
  const url = `${COINBASE_API_BASE}/products/${pair}/ticker`;
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 404) {
        return { symbol, reason: 'pair_not_found' };
      }
      if (response.status === 429) {
        return { symbol, reason: 'rate_limited' };
      }
      return { symbol, reason: `http_${response.status}` };
    }

    const data = await response.json();
    const price = parseFloat(data.price);

    if (isNaN(price) || price <= 0) {
      return { symbol, reason: 'invalid_price' };
    }

    return {
      symbol,
      price,
      ts: new Date().toISOString(),
      source: 'coinbase',
    };
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      return { symbol, reason: 'timeout' };
    }
    return { symbol, reason: 'network_error' };
  }
}

/**
 * Get symbols with open positions (optional optimization)
 */
async function getActiveSymbols(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('mock_trades')
      .select('cryptocurrency')
      .eq('trade_type', 'buy')
      .eq('is_corrupted', false);

    if (error || !data) {
      console.log('[price-snapshot-refresh] Could not fetch active positions, using default symbols');
      return ACTIVE_SYMBOLS;
    }

    // Extract unique base symbols
    const symbols = new Set<string>();
    for (const trade of data) {
      const base = trade.cryptocurrency?.replace('-EUR', '').replace('-USD', '').toUpperCase();
      if (base) symbols.add(base);
    }

    // Merge with defaults to ensure coverage
    ACTIVE_SYMBOLS.forEach(s => symbols.add(s));
    
    return Array.from(symbols);
  } catch (err) {
    console.error('[price-snapshot-refresh] Error fetching active symbols:', err);
    return ACTIVE_SYMBOLS;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('[price-snapshot-refresh] Starting canonical price refresh...');

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get symbols to refresh (active positions + defaults)
    const symbols = await getActiveSymbols(supabase);
    console.log(`[price-snapshot-refresh] Refreshing ${symbols.length} symbols:`, symbols);

    // Fetch all prices in parallel (with rate limit consideration)
    const results = await Promise.all(symbols.map(fetchCoinbasePrice));

    // Separate successes and failures
    const prices: PriceResult[] = [];
    const failed: FailedSymbol[] = [];

    for (const result of results) {
      if ('price' in result) {
        prices.push(result);
      } else {
        failed.push(result);
      }
    }

    console.log(`[price-snapshot-refresh] Fetched ${prices.length} prices, ${failed.length} failed`);

    // Upsert successful prices into price_snapshots
    if (prices.length > 0) {
      // Insert with multiple key formats for compatibility
      const snapshots = prices.flatMap(p => [
        // Base symbol format (e.g., "BTC")
        { symbol: p.symbol, price: p.price, ts: p.ts },
        // Pair format (e.g., "BTC-EUR")
        { symbol: `${p.symbol}-EUR`, price: p.price, ts: p.ts },
      ]);

      const { error: upsertError } = await supabase
        .from('price_snapshots')
        .upsert(snapshots, { 
          onConflict: 'symbol,ts',
          ignoreDuplicates: false 
        });

      if (upsertError) {
        console.error('[price-snapshot-refresh] Upsert error:', upsertError);
      } else {
        console.log(`[price-snapshot-refresh] Upserted ${snapshots.length} snapshot rows`);
      }
    }

    // Log failures for monitoring
    if (failed.length > 0) {
      console.warn('[price-snapshot-refresh] Failed symbols:', failed);
    }

    const elapsed = Date.now() - startTime;
    const response = {
      success: true,
      refreshed: prices.length,
      failed: failed.length,
      symbols_refreshed: prices.map(p => p.symbol),
      symbols_failed: failed,
      elapsed_ms: elapsed,
      timestamp: new Date().toISOString(),
    };

    console.log(`[price-snapshot-refresh] Completed in ${elapsed}ms`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[price-snapshot-refresh] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
