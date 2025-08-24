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

export const useRealTimeMarketData = (): UseRealTimeMarketDataReturn => {
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);

  const getCurrentData = useCallback(async (symbols: string[]): Promise<Record<string, MarketData>> => {
    try {
      // Normalize symbols to Coinbase format (add -EUR if missing)
      const normalizedSymbols = symbols.map(symbol => {
        if (symbol.includes('-')) return symbol;
        return `${symbol}-EUR`;
      });

      // Filter out invalid symbols that cause 404s
      const validSymbols = normalizedSymbols.filter(symbol => {
        const validCoinbaseSymbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'ADA-EUR', 'SOL-EUR', 
                                     'DOT-EUR', 'MATIC-EUR', 'AVAX-EUR', 'LINK-EUR', 'LTC-EUR'];
        return validCoinbaseSymbols.includes(symbol);
      });

      if (validSymbols.length === 0) {
        console.warn('No valid symbols to fetch');
        return {};
      }

      console.log('🔍 Fetching market data for valid symbols:', validSymbols);
      
      // Add delay between requests to avoid rate limiting
      const promises = validSymbols.map(async (symbol, index) => {
        try {
          // Stagger requests to avoid overwhelming the API
          if (index > 0) {
            await new Promise(resolve => setTimeout(resolve, 200 * index));
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
            console.warn(`⚠️  Rate limited for ${symbol}, skipping update`);
            return { [symbol]: null };
          }
          console.warn(`API error for ${symbol}: ${response.status}`);
          return { [symbol]: null };
        } catch (err) {
          console.warn(`Network error for ${symbol}:`, err);
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

      // Only update state if we have new data to prevent unnecessary re-renders
      if (Object.keys(marketDataMap).length > 0) {
        setMarketData(prev => {
          // Check if any data actually changed before updating
          let hasChanged = false;
          const newData = { ...prev };
          
          Object.entries(marketDataMap).forEach(([symbol, data]) => {
            if (!prev[symbol] || prev[symbol].price !== data.price || prev[symbol].timestamp !== data.timestamp) {
              hasChanged = true;
              newData[symbol] = data;
            }
          });
          
          // Only return new object if something actually changed
          return hasChanged ? newData : prev;
        });
        setError(null);
      }
      
      return marketDataMap;
    } catch (err) {
      console.error('Error in getCurrentData:', err);
      // Don't update error state too frequently to prevent re-renders
      return {};
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

  // Get initial data on mount and update less frequently to avoid rate limiting
  useEffect(() => {
    // Expand to more coins that are commonly traded
    const commonSymbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'ADA-EUR', 'SOL-EUR', 'DOT-EUR', 'MATIC-EUR', 'AVAX-EUR', 'LINK-EUR', 'LTC-EUR'];
    getCurrentData(commonSymbols);
    
    // Update data every 30 seconds to avoid rate limiting
    const intervalId = setInterval(() => {
      getCurrentData(commonSymbols);
    }, 30000); // 30 seconds to avoid rate limiting

    return () => clearInterval(intervalId);
  }, []); // FIXED: Remove getCurrentData dependency to prevent infinite loop

  return {
    marketData,
    isConnected,
    error,
    subscribe,
    getCurrentData
  };
};