/**
 * useHoldingsPrices - Fetch prices ONLY for currently held positions
 * 
 * FIXED: Uses returned data from fetch, not state after await (avoids race condition)
 * FIXED: TTL cache to prevent refetch spam
 * FIXED: Proper error categorization (429/404/other)
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import type { OpenTrade } from '@/hooks/useOpenTrades';
import type { MarketPrices } from '@/utils/portfolioMath';

export interface FailedSymbol {
  symbol: string;
  reason: 'rate_limited' | 'pair_not_found' | 'network_error' | 'unexpected';
}

interface UseHoldingsPricesResult {
  /** Market prices keyed by pair symbol (e.g., "SOL-EUR") */
  holdingsPrices: MarketPrices;
  /** Whether initial fetch is still in progress */
  isLoadingPrices: boolean;
  /** Symbols that failed to fetch with reasons */
  failedSymbols: FailedSymbol[];
  /** Force refresh prices for holdings */
  refreshPrices: () => Promise<void>;
  /** Debug info for troubleshooting */
  debugInfo: { holdingsPairs: string[]; fetchedCount: number; lastFetchTs: number };
}

// MODULE-LEVEL SINGLETON CACHE (shared across all hook instances)
// Prevents duplicate fetches and ensures consistency across components
interface PriceCacheEntry {
  prices: MarketPrices;
  timestamp: number;
  failed: FailedSymbol[];
}

const CACHE_TTL_MS = 15000; // 15 seconds TTL
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

// Singleton cache by holdingsKey (shared across all components)
const globalPriceCache = new Map<string, PriceCacheEntry>();
const globalFetchInProgress = new Map<string, boolean>();

export function useHoldingsPrices(openTrades: OpenTrade[]): UseHoldingsPricesResult {
  const [isLoadingPrices, setIsLoadingPrices] = useState(true);
  const [holdingsPrices, setHoldingsPrices] = useState<MarketPrices>({});
  const [failedSymbols, setFailedSymbols] = useState<FailedSymbol[]>([]);
  const [debugInfo, setDebugInfo] = useState({ holdingsPairs: [] as string[], fetchedCount: 0, lastFetchTs: 0 });

  // Extract unique base symbols from open trades
  const holdingsSymbols = useMemo(() => {
    const symbols = new Set<string>();
    for (const trade of openTrades) {
      const base = toBaseSymbol(trade.cryptocurrency);
      symbols.add(base);
    }
    return Array.from(symbols);
  }, [openTrades]);

  // Create a stable key for holdings to detect changes
  const holdingsKey = useMemo(() => holdingsSymbols.sort().join(','), [holdingsSymbols]);

  // Fetch prices with proper error handling and retry logic
  const fetchPricesForHoldings = useCallback(async (symbols: string[]): Promise<{ prices: MarketPrices; failed: FailedSymbol[] }> => {
    if (symbols.length === 0) {
      return { prices: {}, failed: [] };
    }

    const pairs = symbols.map(s => toPairSymbol(s));
    const prices: MarketPrices = {};
    const failed: FailedSymbol[] = [];

    // DEV LOG (only in development)
    if (import.meta.env.DEV) {
      console.log('[useHoldingsPrices] fetching pairs:', pairs);
    }

    // Fetch each pair individually to get proper error categorization
    for (const pair of pairs) {
      const base = toBaseSymbol(pair.replace('-EUR', ''));
      let success = false;
      let retryCount = 0;
      let lastError: FailedSymbol['reason'] = 'unexpected';

      while (!success && retryCount < MAX_RETRIES) {
        try {
          const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/ticker`);
          
          if (response.ok) {
            const data = await response.json();
            const price = parseFloat(data.price || '0');
            if (price > 0) {
              prices[pair] = { price };
              success = true;
            } else {
              lastError = 'unexpected';
            }
          } else if (response.status === 429) {
            lastError = 'rate_limited';
            // Exponential backoff
            const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
            console.log(`[useHoldingsPrices] 429 for ${pair}, retry ${retryCount + 1} after ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
            retryCount++;
          } else if (response.status === 404) {
            lastError = 'pair_not_found';
            break; // No point retrying 404
          } else {
            lastError = 'unexpected';
            break;
          }
        } catch (err) {
          lastError = 'network_error';
          retryCount++;
          if (retryCount < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, INITIAL_RETRY_DELAY_MS * retryCount));
          }
        }
      }

      if (!success) {
        failed.push({ symbol: base, reason: lastError });
      }
    }

    // DEV LOG (only in development)
    if (import.meta.env.DEV) {
      console.log('[useHoldingsPrices] fetchedKeys:', Object.keys(prices).length);
      console.log('[useHoldingsPrices] failedSymbols:', failed);
    }

    return { prices, failed };
  }, []);

  // Main refresh function - uses global singleton cache for consistency
  const refreshPrices = useCallback(async () => {
    if (holdingsSymbols.length === 0) {
      setIsLoadingPrices(false);
      setHoldingsPrices({});
      setFailedSymbols([]);
      return;
    }

    const now = Date.now();
    
    // Check GLOBAL cache validity (shared across all components)
    const cachedEntry = globalPriceCache.get(holdingsKey);
    if (cachedEntry && (now - cachedEntry.timestamp) < CACHE_TTL_MS) {
      // Cache still valid - use shared data
      setHoldingsPrices(cachedEntry.prices);
      setFailedSymbols(cachedEntry.failed);
      setIsLoadingPrices(false);
      setDebugInfo({
        holdingsPairs: holdingsSymbols.map(s => toPairSymbol(s)),
        fetchedCount: Object.keys(cachedEntry.prices).length,
        lastFetchTs: cachedEntry.timestamp
      });
      return;
    }

    // Prevent concurrent fetches for same holdingsKey (global lock)
    if (globalFetchInProgress.get(holdingsKey)) {
      // Another component is fetching - wait briefly and re-check cache
      setTimeout(() => refreshPrices(), 100);
      return;
    }

    globalFetchInProgress.set(holdingsKey, true);
    setIsLoadingPrices(true);

    try {
      const { prices, failed } = await fetchPricesForHoldings(holdingsSymbols);
      
      // Update GLOBAL cache (shared across all components)
      globalPriceCache.set(holdingsKey, { prices, failed, timestamp: now });
      
      // Update local state from fetched result
      setHoldingsPrices(prices);
      setFailedSymbols(failed);
      setDebugInfo({
        holdingsPairs: holdingsSymbols.map(s => toPairSymbol(s)),
        fetchedCount: Object.keys(prices).length,
        lastFetchTs: now
      });
    } catch (error) {
      console.error('[useHoldingsPrices] fetch error:', error);
      setFailedSymbols(holdingsSymbols.map(s => ({ symbol: s, reason: 'network_error' as const })));
    } finally {
      setIsLoadingPrices(false);
      globalFetchInProgress.delete(holdingsKey);
    }
  }, [holdingsSymbols, holdingsKey, fetchPricesForHoldings]);

  // Trigger fetch when holdings change (with cache check)
  useEffect(() => {
    refreshPrices();
  }, [refreshPrices]);

  return {
    holdingsPrices,
    isLoadingPrices,
    failedSymbols,
    refreshPrices,
    debugInfo
  };
}
