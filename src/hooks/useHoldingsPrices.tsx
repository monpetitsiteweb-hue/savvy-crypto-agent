/**
 * useHoldingsPrices - Fetch prices ONLY for currently held positions
 * 
 * This hook solves the "Partial valuation" problem by:
 * 1. Extracting unique symbols from open trades
 * 2. Requesting prices only for those specific symbols
 * 3. Providing loading state so UI can wait before showing "missing" warnings
 * 
 * Separates concerns:
 * - COINBASE_COINS: full universe of tradable coins (strategy configuration)
 * - holdingsSymbols: actual positions the user holds (pricing needs)
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useMarketData } from '@/contexts/MarketDataContext';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import type { OpenTrade } from '@/hooks/useOpenTrades';
import type { MarketPrices } from '@/utils/portfolioMath';

interface UseHoldingsPricesResult {
  /** Market prices keyed by pair symbol (e.g., "SOL-EUR") */
  holdingsPrices: MarketPrices;
  /** Whether initial fetch is still in progress */
  isLoadingPrices: boolean;
  /** Symbols that failed to fetch with reasons */
  failedSymbols: Array<{ symbol: string; reason: string }>;
  /** Force refresh prices for holdings */
  refreshPrices: () => Promise<void>;
}

export function useHoldingsPrices(openTrades: OpenTrade[]): UseHoldingsPricesResult {
  const { marketData, getCurrentData } = useMarketData();
  const [isLoadingPrices, setIsLoadingPrices] = useState(true);
  const [failedSymbols, setFailedSymbols] = useState<Array<{ symbol: string; reason: string }>>([]);
  const fetchedRef = useRef<Set<string>>(new Set());
  const fetchInProgressRef = useRef(false);

  // Extract unique base symbols from open trades
  const holdingsSymbols = useMemo(() => {
    const symbols = new Set<string>();
    for (const trade of openTrades) {
      const base = toBaseSymbol(trade.cryptocurrency);
      symbols.add(base);
    }
    return Array.from(symbols);
  }, [openTrades]);

  // Build MarketPrices from current marketData, filtered to holdings only
  const holdingsPrices = useMemo((): MarketPrices => {
    const prices: MarketPrices = {};
    
    for (const base of holdingsSymbols) {
      const pair = toPairSymbol(base);
      
      // Try pair key first (e.g., "SOL-EUR")
      if (marketData[pair]) {
        prices[pair] = { price: marketData[pair].price };
        continue;
      }
      
      // Try base key fallback (e.g., "SOL")
      if (marketData[base]) {
        prices[pair] = { price: marketData[base].price };
      }
    }
    
    return prices;
  }, [holdingsSymbols, marketData]);

  // Fetch prices specifically for holdings
  const refreshPrices = useCallback(async () => {
    if (holdingsSymbols.length === 0) {
      setIsLoadingPrices(false);
      return;
    }

    // Prevent concurrent fetches
    if (fetchInProgressRef.current) {
      return;
    }

    fetchInProgressRef.current = true;
    setIsLoadingPrices(true);
    setFailedSymbols([]);

    try {
      // getCurrentData accepts base symbols and fetches them
      await getCurrentData(holdingsSymbols);
      
      // After fetch, check which symbols are still missing
      const failed: Array<{ symbol: string; reason: string }> = [];
      
      for (const base of holdingsSymbols) {
        const pair = toPairSymbol(base);
        const hasPrice = marketData[pair]?.price || marketData[base]?.price;
        
        if (!hasPrice) {
          // Check if it was never fetched (might be unsupported)
          failed.push({
            symbol: base,
            reason: 'Price unavailable from Coinbase'
          });
        }
      }
      
      setFailedSymbols(failed);
      fetchedRef.current = new Set(holdingsSymbols);
    } catch (error) {
      // Mark all as failed
      setFailedSymbols(
        holdingsSymbols.map(s => ({ symbol: s, reason: 'Network error' }))
      );
    } finally {
      setIsLoadingPrices(false);
      fetchInProgressRef.current = false;
    }
  }, [holdingsSymbols, getCurrentData, marketData]);

  // Initial fetch when holdings change
  useEffect(() => {
    // Check if we need to fetch new symbols
    const needsFetch = holdingsSymbols.some(s => !fetchedRef.current.has(s));
    
    if (needsFetch || holdingsSymbols.length === 0) {
      refreshPrices();
    } else {
      // All symbols already fetched, just update loading state
      setIsLoadingPrices(false);
    }
  }, [holdingsSymbols, refreshPrices]);

  return {
    holdingsPrices,
    isLoadingPrices,
    failedSymbols,
    refreshPrices
  };
}
