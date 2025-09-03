import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { toPairSymbol, BaseSymbol } from '@/utils/symbols';
import { getAllSymbols, getAllTradingPairs } from '@/data/coinbaseCoins';
import { filterSupportedSymbols } from '@/utils/marketAvailability';
import { getPrices, getCached } from '@/services/CoinbasePriceBus';

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

  const getCurrentData = useCallback(async (symbols: BaseSymbol[]): Promise<Record<string, MarketData>> => {
    try {
      // Convert base symbols to pairs using the central util
      const pairSymbols = symbols.map(base => toPairSymbol(base));
      
      // Silent log for symbol conversion
      window.NotificationSink?.log({ message: 'SYMBOLS: base→pair conversion', data: symbols.map((base, i) => `${base}→${pairSymbols[i]}`) });

      // Use market availability registry to filter out unsupported EUR pairs
      const validSymbols = filterSupportedSymbols(pairSymbols);

      if (validSymbols.length === 0) {
        console.warn('No valid symbols to fetch');
        return {};
      }

      // Silent log for market data fetch
      window.NotificationSink?.log({ message: 'SINGLETON: Fetching market data for valid symbols', symbols: validSymbols });
      
      // Check cache first - if fresh enough, don't hit network
      const cachedData: Record<string, MarketData> = {};
      const symbolsToFetch: string[] = [];
      
      validSymbols.forEach(symbol => {
        const cached = getCached(symbol);
        if (cached) {
          cachedData[symbol] = {
            symbol,
            price: cached.price,
            bid: cached.price, // Use price as bid/ask for now
            ask: cached.price,
            volume: 0,
            change_24h: '0',
            change_percentage_24h: '0',
            high_24h: cached.price.toString(),
            low_24h: cached.price.toString(),
            timestamp: cached.ts,
            source: 'coinbase_bus_cached'
          };
        } else {
          symbolsToFetch.push(symbol);
        }
      });

      // Fetch missing symbols via CoinbasePriceBus
      let freshData: Record<string, MarketData> = {};
      if (symbolsToFetch.length > 0) {
        const busResults = await getPrices(symbolsToFetch);
        
        freshData = Object.entries(busResults).reduce((acc, [symbol, data]) => {
          acc[symbol] = {
            symbol,
            price: data.price,
            bid: data.price, // Use price as bid/ask for now
            ask: data.price,
            volume: 0,
            change_24h: '0',
            change_percentage_24h: '0',
            high_24h: data.price.toString(),
            low_24h: data.price.toString(),
            timestamp: data.ts,
            source: 'coinbase_bus_fresh'
          };
          return acc;
        }, {} as Record<string, MarketData>);
      }

      const marketDataMap = { ...cachedData, ...freshData };

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
    } catch (err) {
      console.error('Error in getCurrentData:', err);
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