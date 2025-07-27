import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

// Singleton pattern to prevent multiple instances from fetching simultaneously
let isCurrentlyFetching = false;
let globalMarketData: Record<string, MarketData> = {};
let marketDataSubscribers: Set<(data: Record<string, MarketData>) => void> = new Set();

export const useRealTimeMarketData = (): UseRealTimeMarketDataReturn => {
  const [marketData, setMarketData] = useState<Record<string, MarketData>>(globalMarketData);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);

  // Subscribe to global market data updates
  useEffect(() => {
    const subscriber = (data: Record<string, MarketData>) => {
      setMarketData(data);
    };
    marketDataSubscribers.add(subscriber);
    
    return () => {
      marketDataSubscribers.delete(subscriber);
    };
  }, []);

  const getCurrentData = useCallback(async (symbols: string[]): Promise<Record<string, MarketData>> => {
    // Prevent multiple simultaneous fetches
    if (isCurrentlyFetching) {
      console.log('📈 Already fetching data, returning cached data');
      return globalMarketData;
    }
    
    isCurrentlyFetching = true;
    
    try {
      console.log('🔍 Fetching current market data for symbols:', symbols);
      
      // Add delay between requests to avoid rate limiting
      const promises = symbols.map(async (symbol, index) => {
        try {
          // Stagger requests to avoid overwhelming the API
          if (index > 0) {
            await new Promise(resolve => setTimeout(resolve, 100 * index));
          }
          
          const response = await fetch(`https://api.exchange.coinbase.com/products/${symbol}/ticker`);
          if (response.ok) {
            const data = await response.json();
            return {
              [symbol]: {
                symbol,
                price: parseFloat(data.price || '0'),
                bid: parseFloat(data.bid || '0'),
                ask: parseFloat(data.ask || '0'),
                volume: parseFloat(data.volume || '0'),
                change_24h: '0',
                change_percentage_24h: '0',
                high_24h: data.high_24h || '0',
                low_24h: data.low_24h || '0',
                timestamp: new Date().toISOString(),
                source: 'coinbase_rest_api'
              }
            };
          } else if (response.status === 429) {
            console.warn(`⚠️  Rate limited for ${symbol}, using cached data`);
            return { [symbol]: null };
          }
          throw new Error(`Failed to fetch ${symbol}`);
        } catch (err) {
          console.error(`Error fetching ${symbol}:`, err);
          return { [symbol]: null };
        }
      });

      const results = await Promise.all(promises);
      const marketDataMap = results.reduce((acc, result) => {
        const [symbol, data] = Object.entries(result)[0];
        if (data) {
          acc[symbol] = data;
        }
        return acc;
      }, {} as Record<string, MarketData>);

      console.log('📈 Fetched market data:', marketDataMap);
      
      // Update global state
      globalMarketData = { ...globalMarketData, ...marketDataMap };
      
      // Notify all subscribers
      marketDataSubscribers.forEach(subscriber => subscriber(globalMarketData));
      
      setError(null);
      return marketDataMap;
    } catch (err) {
      console.error('Error in getCurrentData:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return {};
    } finally {
      isCurrentlyFetching = false;
    }
  }, []);

  const subscribe = useCallback((symbols: string[]) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'subscribe',
        symbols
      }));
    }
  }, [ws]);

  // Disable WebSocket for now due to connection issues
  useEffect(() => {
    console.log('⚠️  WebSocket disabled due to connection issues');
    setIsConnected(false);
    setError('WebSocket temporarily disabled');
    
    // Don't attempt WebSocket connection until properly implemented
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  // Re-enabled with singleton protection to prevent multiple simultaneous fetches
  useEffect(() => {
    // Only the first instance should start the fetching interval
    if (marketDataSubscribers.size === 1) {
      const fetchData = async () => {
        await getCurrentData(['BTC-EUR', 'ETH-EUR', 'XRP-EUR']);
      };
      
      fetchData();
      
      // Update data every 30 seconds to avoid rate limiting
      const intervalId = setInterval(() => {
        fetchData();
      }, 30000); // 30 seconds to avoid rate limiting

      return () => clearInterval(intervalId);
    }
  }, [getCurrentData]);

  return {
    marketData,
    isConnected,
    error,
    subscribe,
    getCurrentData
  };
};