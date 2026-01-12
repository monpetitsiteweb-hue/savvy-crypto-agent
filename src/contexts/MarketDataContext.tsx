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
  const backoffUntilRef = useRef<number>(0);

  const getCurrentData = useCallback(async (symbols: BaseSymbol[]): Promise<Record<string, MarketData>> => {
    const now = Date.now();
    if (backoffUntilRef.current > now) {
      return {};
    }

    try {
      const pairSymbols = symbols.map(base => toPairSymbol(base));
      const validSymbols = filterSupportedSymbols(pairSymbols);

      if (validSymbols.length === 0) {
        return {};
      }

      let hit429 = false;
      const marketDataMap: Record<string, MarketData> = {};
      
      // Fetch in batches of 5 with small delays to avoid rate limits
      // Update state incrementally so prices appear as they arrive
      const BATCH_SIZE = 5;
      const BATCH_DELAY = 200;
      
      for (let i = 0; i < validSymbols.length; i += BATCH_SIZE) {
        const batch = validSymbols.slice(i, i + BATCH_SIZE);
        
        const batchPromises = batch.map(async (symbol) => {
          try {
            const response = await fetch(`https://api.exchange.coinbase.com/products/${symbol}/ticker`);
            if (response.ok) {
              const data = await response.json();
              const price = parseFloat(data.price || '0');
              const bid = parseFloat(data.bid || '0');
              const ask = parseFloat(data.ask || '0');
              
              sharedPriceCache.set(symbol, price, bid, ask);
              
              return {
                symbol,
                data: {
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
                } as MarketData
              };
            } else if (response.status === 429) {
              hit429 = true;
              return { symbol, data: null };
            }
            return { symbol, data: null };
          } catch {
            return { symbol, data: null };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        
        // Update state immediately after each batch completes
        const batchData: Record<string, MarketData> = {};
        batchResults.forEach(result => {
          if (result.data) {
            batchData[result.symbol] = result.data;
            marketDataMap[result.symbol] = result.data;
          }
        });
        
        if (Object.keys(batchData).length > 0) {
          setMarketData(prev => {
            const newData = { ...prev, ...batchData };
            setContextVersion(v => v + 1);
            return newData;
          });
          setError(null);
          setIsConnected(true);
        }
        
        // Small delay between batches
        if (i + BATCH_SIZE < validSymbols.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
      }
      
      if (hit429) {
        backoffUntilRef.current = Date.now() + 30000;
      }
      
      return marketDataMap;
    } catch {
      setError('Failed to fetch market data');
      return {};
    }
  }, []);

  useEffect(() => {
    const commonSymbols: BaseSymbol[] = getAllSymbols() as BaseSymbol[];
    getCurrentData(commonSymbols);
    
    let pollInterval = 60000;
    try {
      if (new URL(window.location.href).searchParams.get('debug') === 'history') {
        const pricePollMs = new URL(window.location.href).searchParams.get('pricePollMs');
        if (pricePollMs !== null) {
          const overrideMs = parseInt(pricePollMs, 10);
          if (overrideMs === 0) {
            return;
          } else if (overrideMs > 0) {
            pollInterval = overrideMs;
          }
        }
      }
    } catch {
      // ignore URL parsing errors
    }
    
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
      version: contextVersion
    }}>
      {children}
    </MarketDataContext.Provider>
  );
};
