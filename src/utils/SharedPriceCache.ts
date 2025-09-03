// Shared price cache - single source of truth for market data
// Updates every 30s, provides stable data to prevent UI blinking

import { getAllTradingPairs } from '@/data/coinbaseCoins';

interface PriceData {
  symbol: string;
  price: number;
  timestamp: string;
}

interface CacheConfig {
  intervalMs: number;
  symbols: string[];
}

class SharedPriceCache {
  private cache = new Map<string, PriceData>();
  private intervalId: NodeJS.Timeout | null = null;
  private config: CacheConfig = { intervalMs: 30000, symbols: [] };
  private isInitialized = false;

  initialize(symbols: string[]) {
    if (this.isInitialized) return;

    // Check for debug overrides
    const urlParams = new URLSearchParams(window.location.search);
    const debugMode = urlParams.get('debug') === 'history';
    const priceTickOverride = urlParams.get('priceTickMs');
    
    if (debugMode && priceTickOverride) {
      const overrideMs = parseInt(priceTickOverride, 10);
      if (overrideMs > 0) {
        this.config.intervalMs = overrideMs;
      }
    }

    this.config.symbols = symbols;
    this.isInitialized = true;

    // Log startup
    if (debugMode || import.meta.env.DEV) {
      console.log(`[HistoryPerf] priceCache=on intervalMs=${this.config.intervalMs}`);
    }

    // Fetch initial data
    this.fetchPrices();

    // Set up interval
    this.intervalId = setInterval(() => {
      this.fetchPrices();
    }, this.config.intervalMs);
  }

  private async fetchPrices() {
    const startTime = performance.now();
    let fetchedCount = 0;

    try {
      // Filter to valid Coinbase symbols
      const validSymbols = this.config.symbols.filter(symbol => {
        return getAllTradingPairs().includes(symbol);
      });

      // Use CoinbasePriceBus instead of direct fetching
      try {
        const { getPrices } = await import('@/services/CoinbasePriceBus');
        const busResults = await getPrices(validSymbols);
        
        validSymbols.forEach((symbol) => {
          const priceData = busResults[symbol];
          if (priceData && priceData.price > 0) {
            const cacheData: PriceData = {
              symbol,
              price: priceData.price,
              timestamp: priceData.ts
            };
            
            this.cache.set(symbol, cacheData);
            fetchedCount++;
          }
        });

      } catch (busError) {
        // Silent error handling - log to background only
        this.logToBackground('CoinbasePriceBus fetch error', busError);
      }

      // Log performance (rate limited)
      const duration = Math.round(performance.now() - startTime);
      const urlParams = new URLSearchParams(window.location.search);
      const debugMode = urlParams.get('debug') === 'history';
      
      if (debugMode || import.meta.env.DEV) {
        console.log(`[HistoryPerf] tick loaded ${fetchedCount} symbols in ${duration}ms`);
      }

    } catch (error) {
      // Silent error handling - log to background only
      this.logToBackground('SharedPriceCache fetch error', error);
    }
  }

  private logToBackground(message: string, error?: any) {
    // Silent background logging - no console spam
    if (window.NotificationSink) {
      window.NotificationSink.log({ message, error });
    }
  }

  getPrice(symbol: string): number | null {
    const data = this.cache.get(symbol);
    return data?.price || null;
  }

  getAllPrices(): Map<string, PriceData> {
    return new Map(this.cache);
  }

  updateSymbols(newSymbols: string[]) {
    const uniqueSymbols = [...new Set(newSymbols)];
    if (JSON.stringify(uniqueSymbols.sort()) !== JSON.stringify(this.config.symbols.sort())) {
      this.config.symbols = uniqueSymbols;
      // Immediate fetch for new symbols
      this.fetchPrices();
    }
  }

  cleanup() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isInitialized = false;
  }
}

// Singleton instance
export const sharedPriceCache = new SharedPriceCache();

// Background notification sink
declare global {
  interface Window {
    NotificationSink: {
      log: (data: any) => void;
    };
  }
}

// Initialize silent notification sink
if (!window.NotificationSink) {
  window.NotificationSink = {
    log: (data: any) => {
      // Silent background logging - no console output
      // Could be enhanced to send to analytics/monitoring service
    }
  };
}