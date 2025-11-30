import { useCallback, useMemo, useRef } from 'react';

interface MarketData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  change_24h: string;
  change_percentage_24h: string;
  high_24h: string;
  low_24h: string;
  timestamp: string;
  source: string;
}

interface UseRealTimeMarketDataReturn {
  marketData: Record<string, MarketData>;
  isConnected: boolean;
  error: string | null;
  subscribe: (symbols: string[]) => void;
  getCurrentData: (symbols: string[]) => Promise<Record<string, MarketData>>;
}

// DEPRECATED: Use MarketDataProvider context instead
// This hook now just redirects to the context to prevent multiple API calls
import { useMarketData } from '@/contexts/MarketDataContext';

export const useRealTimeMarketData = (): UseRealTimeMarketDataReturn => {
  // Check for bypass toggle (debug only)
  const shouldBypass = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get('debug') === 'history' && url.searchParams.get('bypassMarketHook') === '1';
    } catch {
      return false;
    }
  }, []);

  const { marketData, isConnected, error, getCurrentData } = useMarketData();
  
  // Capture stable snapshot on first call for bypass mode
  const bypassSnapshot = useRef<UseRealTimeMarketDataReturn | null>(null);
  
  if (shouldBypass && !bypassSnapshot.current) {
    bypassSnapshot.current = {
      marketData: { ...marketData },
      isConnected,
      error,
      subscribe: () => {},
      getCurrentData: async () => marketData
    };
  }
  
  const subscribe = useCallback((symbols: string[]) => {
    if (shouldBypass) return;
    // Subscribe disabled, using context provider
  }, [shouldBypass]);

  // Return snapshot if bypassing, otherwise return live data
  if (shouldBypass && bypassSnapshot.current) {
    return bypassSnapshot.current;
  }

  return {
    marketData,
    isConnected,
    error,
    subscribe,
    getCurrentData
  };
};