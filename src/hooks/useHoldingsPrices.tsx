/**
 * useHoldingsPrices - Fetch prices ONLY for currently held positions
 * 
 * V2: Uses price-proxy Edge Function instead of direct Coinbase calls
 * This avoids ERR_CONNECTION_RESET issues in the browser.
 * 
 * FEATURES:
 * - Fetches via Supabase Edge Function (server-side Coinbase calls)
 * - TTL cache to prevent refetch spam
 * - Proper error categorization (429/404/network_error/timeout)
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import type { OpenTrade } from '@/hooks/useOpenTrades';
import type { MarketPrices } from '@/utils/portfolioMath';
import { fetchPricesForHoldings as fetchPricesViaProxy, toMarketPrices } from '@/api/priceProxy';
import type { FailedSymbol as ProxyFailedSymbol } from '@/api/priceProxy';

export interface FailedSymbol {
  symbol: string;
  pair?: string;
  reason: 'rate_limited' | 'pair_not_found' | 'network_error' | 'connection_reset' | 'timeout' | 'unexpected';
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

// Singleton cache by holdingsKey (shared across all components)
const globalPriceCache = new Map<string, PriceCacheEntry>();
const globalFetchInProgress = new Map<string, boolean>();

/**
 * Convert proxy FailedSymbol to local FailedSymbol format
 */
function mapFailedSymbol(f: ProxyFailedSymbol): FailedSymbol {
  return {
    symbol: f.symbol,
    pair: f.pair,
    reason: f.reason,
  };
}

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
      // V2: Use Edge Function instead of direct Coinbase calls
      if (import.meta.env.DEV) {
        console.log('[useHoldingsPrices] fetching via price-proxy:', holdingsSymbols);
      }

      const { prices: proxyPrices, failed: proxyFailed } = await fetchPricesViaProxy(holdingsSymbols, 'EUR');
      
      // Convert to MarketPrices format
      const prices = toMarketPrices(proxyPrices);
      const failed = proxyFailed.map(mapFailedSymbol);
      
      if (import.meta.env.DEV) {
        console.log('[useHoldingsPrices] fetchedKeys:', Object.keys(prices).length);
        console.log('[useHoldingsPrices] failedSymbols:', failed);
      }
      
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
  }, [holdingsSymbols, holdingsKey]);

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
