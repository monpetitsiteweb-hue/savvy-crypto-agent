import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { toPairSymbol, BaseSymbol } from '@/utils/symbols';
import { getAllSymbols, getAllTradingPairs } from '@/data/coinbaseCoins';
import { filterSupportedSymbols } from '@/utils/marketAvailability';
import { sharedPriceCache } from '@/utils/SharedPriceCache';

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

interface MarketDataContextType {
  marketData: Record<string, MarketData>;
  isConnected: boolean;
  error: string | null;
  getCurrentData: (symbols: string[]) => Promise<Record<string, MarketData>>;
  version?: number;
}

const MarketDataContext = createContext<MarketDataContextType | undefined>(undefined);

export const useMarketData = () => {
  const context = useContext(MarketDataContext);
  if (!context) {
    throw new Error('useMarketData must be used within a MarketDataProvider');
  }
  return context;
};

export const MarketDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextVersion, setContextVersion] = useState(0);
  const backoffUntilRef = useRef<number>(0); // Track 429 backoff

  const getCurrentData = useCallback(async (symbols: BaseSymbol[]): Promise<Record<string, MarketData>> => {
    // Check if we're in 429 backoff period
    const now = Date.now();
    if (backoffUntilRef.current > now) {
      // Silently skip during backoff
      return {};
    }

    try {
      // Convert base symbols to pairs using the central util
      const pairSymbols = symbols.map(base => toPairSymbol(base));
      
      // Silent log for symbol conversion
      (window as any).NotificationSink?.log({ message: 'SYMBOLS: base→pair conversion', data: symbols.map((base, i) => `${base}→${pairSymbols[i]}`) });

      // Use market availability registry to filter out unsupported EUR pairs
      const validSymbols = filterSupportedSymbols(pairSymbols);

      if (validSymbols.length === 0) {
        return {};
      }

      // Silent log for market data fetch
      (window as any).NotificationSink?.log({ message: 'SINGLETON: Fetching market data for valid symbols', symbols: validSymbols });
      
      let hit429 = false;
      
      // Add delay between requests to avoid rate limiting
      const promises = validSymbols.map(async (symbol, index) => {
        try {
          // Stagger requests to avoid overwhelming the API
          if (index > 0) {
            await new Promise(resolve => setTimeout(resolve, 300 * index));
          }
          
          const response = await fetch(`https://api.exchange.coinbase.com/products/${symbol}/ticker`);
          if (response.ok) {
            const data = await response.json();
            const price = parseFloat(data.price || '0');
            const bid = parseFloat(data.bid || '0');
            const ask = parseFloat(data.ask || '0');
            
            // Write to shared cache
            sharedPriceCache.set(symbol, price, bid, ask);
            
            return {
              [symbol]: {
                symbol,
                price,
                bid,
                ask,
                volume: parseFloat(data.volume || '0'),
                change_24h: '0',
                change_percentage_24h: '0',
                high_24h: data.high_24h || '0',
                low_24h: data.low_24h || '0',
                timestamp: new Date().toISOString(),
                source: 'coinbase_singleton'
              }
            };
          } else if (response.status === 429) {
            hit429 = true;
            // Only log 429 once, not for every symbol
            return { [symbol]: null };
          }
          // Silently ignore 404/400 for unsupported pairs - don't spam console
          return { [symbol]: null };
        } catch {
          // Silently ignore network errors
          return { [symbol]: null };
        }
      });

      const results = await Promise.all(promises);
      
      // If we hit 429, enter backoff
      if (hit429) {
        backoffUntilRef.current = Date.now() + 30000; // 30 seconds
      }
      
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
          if (hasChanged) {
            setContextVersion(v => v + 1);
            return newData;
          }
          return prev;
        });
        setError(null);
        setIsConnected(true);
      }
      
      return marketDataMap;
    } catch {
      setError('Failed to fetch market data');
      return {};
    }
  }, []);

  // Get initial data on mount and update every 60 seconds (less frequent to avoid rate limiting)
  useEffect(() => {
    const commonSymbols: BaseSymbol[] = getAllSymbols() as BaseSymbol[];
    getCurrentData(commonSymbols);
    
    // Check for debug price polling override
    let pollInterval = 60000; // default 60s
    try {
      if (new URL(window.location.href).searchParams.get('debug') === 'history') {
        const pricePollMs = new URL(window.location.href).searchParams.get('pricePollMs');
        if (pricePollMs !== null) {
          const overrideMs = parseInt(pricePollMs, 10);
          if (overrideMs === 0) {
            console.log('[HistoryBlink] price: polling stopped (pricePollMs=0)');
            return; // No interval
          } else if (overrideMs > 0) {
            pollInterval = overrideMs;
            console.log(`[HistoryBlink] price: polling interval overridden to ${overrideMs} ms`);
          }
        }
      }
    } catch (e) {
      // ignore URL parsing errors
    }
    
    // Update data with potentially overridden interval
    const intervalId = setInterval(() => {
      getCurrentData(commonSymbols);
    }, pollInterval);

    return () => clearInterval(intervalId);
  }, [getCurrentData]);

  return (
    <MarketDataContext.Provider value={{
      marketData,
      isConnected,
      error,
      getCurrentData,
      version: contextVersion // Add version for change tracking
    }}>
      {children}
    </MarketDataContext.Provider>
  );
};