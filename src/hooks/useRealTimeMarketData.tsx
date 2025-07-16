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
      const { data, error } = await supabase.functions.invoke('real-time-market-data', {
        body: {
          symbols,
          action: 'get_current'
        }
      });

      if (error) {
        console.error('Error fetching current market data:', error);
        setError(error.message);
        return {};
      }

      if (data?.success && data?.data) {
        // Update local state with current data
        setMarketData(prev => ({ ...prev, ...data.data }));
        return data.data;
      }

      return {};
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

  // Get initial data on mount
  useEffect(() => {
    getCurrentData(['BTC-USD', 'ETH-USD', 'XRP-USD']);
  }, [getCurrentData]);

  return {
    marketData,
    isConnected,
    error,
    subscribe,
    getCurrentData
  };
};