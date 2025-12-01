// Simple price cache with TTL for reducing redundant API calls
// Only MarketDataContext writes to this cache, other components read from it

interface CachedPrice {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  timestamp: number;
}

// Global NotificationSink for silent logging
declare global {
  interface Window {
    NotificationSink?: {
      log: (data: any) => void;
    };
  }
}

class SharedPriceCache {
  private cache = new Map<string, CachedPrice>();
  // TTL must be >= polling interval (60s) to prevent price flickering
  private readonly TTL_MS = 120000; // 2 minutes (buffer for polling + network delays)

  set(symbol: string, price: number, bid: number, ask: number): void {
    this.cache.set(symbol, {
      symbol,
      price,
      bid,
      ask,
      timestamp: Date.now()
    });
  }

  get(symbol: string): CachedPrice | null {
    const cached = this.cache.get(symbol);
    if (!cached) return null;
    
    const age = Date.now() - cached.timestamp;
    if (age > this.TTL_MS) {
      this.cache.delete(symbol);
      return null;
    }
    
    return cached;
  }

  getAll(): Map<string, CachedPrice> {
    // Clean expired entries
    const now = Date.now();
    for (const [symbol, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.TTL_MS) {
        this.cache.delete(symbol);
      }
    }
    return new Map(this.cache);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Singleton instance
export const sharedPriceCache = new SharedPriceCache();

// Initialize silent notification sink
if (typeof window !== 'undefined' && !window.NotificationSink) {
  window.NotificationSink = {
    log: (data: any) => {
      // Silent background logging - no console output
      // Could be enhanced to send to analytics/monitoring service
    }
  };
}
