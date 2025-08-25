import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { toPairSymbol, BaseSymbol } from '@/utils/symbols';

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

  const getCurrentData = useCallback(async (symbols: BaseSymbol[]): Promise<Record<string, MarketData>> => {
    try {
      // Convert base symbols to pairs using the central util
      const pairSymbols = symbols.map(base => toPairSymbol(base));
      
      console.log('🔄 SYMBOLS: base→pair conversion:', symbols.map((base, i) => `${base}→${pairSymbols[i]}`));

      // Filter out invalid symbols that cause 404s
      const validSymbols = pairSymbols.filter(pair => {
        const validCoinbaseSymbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'ADA-EUR', 'SOL-EUR', 
                                     'DOT-EUR', 'MATIC-EUR', 'AVAX-EUR', 'LINK-EUR', 'LTC-EUR'];
        return validCoinbaseSymbols.includes(pair);
      });

      if (validSymbols.length === 0) {
        console.warn('No valid symbols to fetch');
        return {};
      }

      console.log('🔍 SINGLETON: Fetching market data for valid symbols:', validSymbols);
      
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
                source: 'coinbase_singleton'
              }
            };
          } else if (response.status === 429) {
            console.warn(`⚠️  Rate limited for ${symbol}, using cached data`);
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
    const commonSymbols: BaseSymbol[] = ['BTC', 'ETH', 'XRP', 'ADA', 'SOL', 'DOT', 'MATIC', 'AVAX', 'LINK', 'LTC'];
    getCurrentData(commonSymbols);
    
    // Update data every 60 seconds to avoid rate limiting (increased from 30s)
    const intervalId = setInterval(() => {
      getCurrentData(commonSymbols);
    }, 60000);

    return () => clearInterval(intervalId);
  }, [getCurrentData]);

  return (
    <MarketDataContext.Provider value={{
      marketData,
      isConnected,
      error,
      getCurrentData
    }}>
      {children}
    </MarketDataContext.Provider>
  );
};