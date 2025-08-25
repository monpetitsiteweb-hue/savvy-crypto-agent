import { useCallback } from 'react';

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
  const { marketData, isConnected, error, getCurrentData } = useMarketData();
  
  const subscribe = useCallback((symbols: string[]) => {
    console.log('⚠️ Subscribe functionality disabled, using context provider');
  }, []);

  return {
    marketData,
    isConnected,
    error,
    subscribe,
    getCurrentData
  };
};