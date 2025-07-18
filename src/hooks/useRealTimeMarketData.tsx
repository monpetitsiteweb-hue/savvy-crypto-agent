import { useState, useEffect, useCallback } from 'react';
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
      // Use a direct API call to a reliable crypto price source as fallback
      console.log('🔍 Fetching current market data for symbols:', symbols);
      
      // Try Coinbase Pro API directly first
      const promises = symbols.map(async (symbol) => {
        try {
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
      
      // Update local state with current data
      setMarketData(prev => ({ ...prev, ...marketDataMap }));
      setError(null);
      
      return marketDataMap;
    } catch (err) {
      console.error('Error in getCurrentData:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
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

  useEffect(() => {
    // Create WebSocket connection to our edge function
    const connectWebSocket = () => {
      try {
        const wsUrl = `wss://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/real-time-market-data`;
        const websocket = new WebSocket(wsUrl);

        websocket.onopen = () => {
          console.log('Connected to real-time market data');
          setIsConnected(true);
          setError(null);
        };

        websocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            
            if (message.type === 'market_update' && message.data) {
              const update = message.data;
              const marketUpdate: MarketData = {
                symbol: update.product_id,
                price: parseFloat(update.price || '0'),
                bid: parseFloat(update.best_bid || '0'),
                ask: parseFloat(update.best_ask || '0'),
                volume: parseFloat(update.volume_24h || '0'),
                change_24h: update.price_change_24h || '0',
                change_percentage_24h: update.price_change_percent_24h || '0',
                high_24h: update.high_24h || '0',
                low_24h: update.low_24h || '0',
                timestamp: update.time || new Date().toISOString(),
                source: 'coinbase_websocket'
              };

              setMarketData(prev => ({
                ...prev,
                [update.product_id]: marketUpdate
              }));
            } else if (message.type === 'error') {
              setError(message.message);
            } else if (message.type === 'disconnected') {
              setIsConnected(false);
            }
          } catch (err) {
            console.error('Error parsing WebSocket message:', err);
          }
        };

        websocket.onerror = (event) => {
          console.error('WebSocket error:', event);
          setError('WebSocket connection error');
          setIsConnected(false);
        };

        websocket.onclose = (event) => {
          console.log('WebSocket connection closed:', event.code, event.reason);
          setIsConnected(false);
          
          // Attempt to reconnect after 5 seconds
          setTimeout(() => {
            if (!event.wasClean) {
              connectWebSocket();
            }
          }, 5000);
        };

        setWs(websocket);

      } catch (err) {
        console.error('Error creating WebSocket connection:', err);
        setError(err instanceof Error ? err.message : 'Connection failed');
      }
    };

    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  // Get initial data on mount and update every 10 seconds for variation calculation
  useEffect(() => {
    getCurrentData(['BTC-EUR', 'ETH-EUR', 'XRP-EUR']);
    
    // Update variation data every 10 seconds (not price - just variation)
    const intervalId = setInterval(() => {
      getCurrentData(['BTC-EUR', 'ETH-EUR', 'XRP-EUR']);
    }, 10000); // 10 seconds

    return () => clearInterval(intervalId);
  }, [getCurrentData]);

  return {
    marketData,
    isConnected,
    error,
    subscribe,
    getCurrentData
  };
};