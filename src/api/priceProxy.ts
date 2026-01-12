/**
 * Price Proxy API Client
 * 
 * Fetches prices from backend Edge Function instead of direct Coinbase calls.
 * This avoids ERR_CONNECTION_RESET issues in the browser.
 */

import { supabase } from '@/integrations/supabase/client';

export interface PriceResult {
  price: number;
  ts: string;
  source: string;
}

export interface FailedSymbol {
  symbol: string;
  pair: string;
  reason: 'pair_not_found' | 'rate_limited' | 'connection_reset' | 'network_error' | 'timeout' | 'unexpected';
}

export interface PriceProxyResponse {
  quote: string;
  prices: Record<string, PriceResult>;
  failed: FailedSymbol[];
  cached: number;
}

/**
 * Fetch prices for holdings via the price-proxy Edge Function
 * 
 * @param baseSymbols Array of base symbols (e.g., ["BTC", "ETH", "SOL"])
 * @param quote Quote currency (default: "EUR")
 * @returns Prices and failed symbols
 */
export async function fetchPricesForHoldings(
  baseSymbols: string[],
  quote: string = 'EUR'
): Promise<{ prices: Record<string, PriceResult>; failed: FailedSymbol[] }> {
  if (baseSymbols.length === 0) {
    return { prices: {}, failed: [] };
  }

  try {
    const { data, error } = await supabase.functions.invoke<PriceProxyResponse>('price-proxy', {
      body: { baseSymbols, quote },
    });

    if (error) {
      console.error('[priceProxy] Edge function error:', error);
      // Return all symbols as failed with network_error
      return {
        prices: {},
        failed: baseSymbols.map((symbol) => ({
          symbol,
          pair: `${symbol.toUpperCase()}-${quote.toUpperCase()}`,
          reason: 'network_error' as const,
        })),
      };
    }

    if (!data) {
      console.error('[priceProxy] No data returned from edge function');
      return {
        prices: {},
        failed: baseSymbols.map((symbol) => ({
          symbol,
          pair: `${symbol.toUpperCase()}-${quote.toUpperCase()}`,
          reason: 'unexpected' as const,
        })),
      };
    }

    if (import.meta.env.DEV) {
      console.log(`[priceProxy] Received ${Object.keys(data.prices).length} prices, ${data.failed.length} failed, ${data.cached} cached`);
    }

    return {
      prices: data.prices,
      failed: data.failed,
    };

  } catch (err) {
    console.error('[priceProxy] Unexpected error:', err);
    return {
      prices: {},
      failed: baseSymbols.map((symbol) => ({
        symbol,
        pair: `${symbol.toUpperCase()}-${quote.toUpperCase()}`,
        reason: 'network_error' as const,
      })),
    };
  }
}

/**
 * Convert PriceProxyResponse prices to MarketPrices format for portfolioMath
 * 
 * @param prices Record from price-proxy response
 * @returns MarketPrices format { [pair]: { price: number } }
 */
export function toMarketPrices(prices: Record<string, PriceResult>): Record<string, { price: number }> {
  const result: Record<string, { price: number }> = {};
  for (const [pair, data] of Object.entries(prices)) {
    result[pair] = { price: data.price };
  }
  return result;
}
