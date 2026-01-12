/**
 * useHoldingsPrices - Fetch prices ONLY for currently held positions
 * 
 * FIXED: Uses returned data from fetch, not state after await (avoids race condition)
 * FIXED: TTL cache to prevent refetch spam
 * FIXED: Proper error categorization (429/404/other)
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useMarketData } from '@/contexts/MarketDataContext';
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

// Cache for fetched prices with TTL
interface PriceCache {
  prices: MarketPrices;
  timestamp: number;
  failed: FailedSymbol[];
}

const CACHE_TTL_MS = 15000; // 15 seconds TTL
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

export function useHoldingsPrices(openTrades: OpenTrade[]): UseHoldingsPricesResult {
  const { getCurrentData } = useMarketData();
  const [isLoadingPrices, setIsLoadingPrices] = useState(true);
  const [holdingsPrices, setHoldingsPrices] = useState<MarketPrices>({});
  const [failedSymbols, setFailedSymbols] = useState<FailedSymbol[]>([]);
  const [debugInfo, setDebugInfo] = useState({ holdingsPairs: [] as string[], fetchedCount: 0, lastFetchTs: 0 });
  
  const cacheRef = useRef<PriceCache | null>(null);
  const fetchInProgressRef = useRef(false);
  const lastHoldingsKeyRef = useRef<string>('');

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

    // DEV LOG
    console.log('[useHoldingsPrices] fetching pairs:', pairs);

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

    // DEV LOG
    console.log('[useHoldingsPrices] fetchedKeys:', Object.keys(prices).length);
    console.log('[useHoldingsPrices] failedSymbols:', failed);

    return { prices, failed };
  }, []);

  // Main refresh function
  const refreshPrices = useCallback(async () => {
    if (holdingsSymbols.length === 0) {
      setIsLoadingPrices(false);
      setHoldingsPrices({});
      setFailedSymbols([]);
      return;
    }

    // Check cache validity
    const now = Date.now();
    const cache = cacheRef.current;
    if (cache && (now - cache.timestamp) < CACHE_TTL_MS && lastHoldingsKeyRef.current === holdingsKey) {
      // Cache still valid and holdings unchanged
      setHoldingsPrices(cache.prices);
      setFailedSymbols(cache.failed);
      setIsLoadingPrices(false);
      return;
    }

    // Prevent concurrent fetches
    if (fetchInProgressRef.current) {
      return;
    }

    fetchInProgressRef.current = true;
    setIsLoadingPrices(true);

    try {
      const { prices, failed } = await fetchPricesForHoldings(holdingsSymbols);
      
      // Update cache
      cacheRef.current = { prices, failed, timestamp: now };
      lastHoldingsKeyRef.current = holdingsKey;
      
      // Update state from fetched result (NOT from marketData state - avoids race)
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
      fetchInProgressRef.current = false;
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
