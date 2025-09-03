import { supabase } from '@/integrations/supabase/client';

interface PriceData {
  price: number;
  ts: string;
}

interface CachedPrice extends PriceData {
  cachedAt: number;
}

interface PendingRequest {
  resolve: (data: PriceData) => void;
  reject: (error: Error) => void;
}

class CoinbasePriceBus {
  private cache = new Map<string, CachedPrice>();
  private pendingRequests = new Map<string, PendingRequest[]>();
  private lastRequestTime = new Map<string, number>();
  private concurrentRequests = 0;
  private readonly MAX_CONCURRENT = 2;
  private readonly MIN_INTERVAL = 1200; // 1.2s between requests for same symbol
  private readonly CACHE_DURATION = 10000; // 10s cache
  private readonly MAX_RETRY_DELAY = 10000; // 10s max backoff

  async getPrices(symbols: string[]): Promise<Record<string, PriceData>> {
    const results: Record<string, PriceData> = {};
    const promises = symbols.map(symbol => this.getPrice(symbol));
    
    const settled = await Promise.allSettled(promises);
    
    settled.forEach((result, index) => {
      const symbol = symbols[index];
      if (result.status === 'fulfilled') {
        results[symbol] = result.value;
      } else {
        console.warn(`Failed to get price for ${symbol}:`, result.reason);
        // Try fallback to price_snapshots table
        this.getFallbackPrice(symbol).then(fallback => {
          if (fallback) {
            results[symbol] = fallback;
          }
        }).catch(() => {
          // Silent fallback failure
        });
      }
    });

    return results;
  }

  private async getPrice(symbol: string): Promise<PriceData> {
    // Check cache first
    const cached = this.getCached(symbol);
    if (cached) {
      return { price: cached.price, ts: cached.ts };
    }

    // Check if there's already a pending request for this symbol (single-flight)
    if (this.pendingRequests.has(symbol)) {
      return new Promise((resolve, reject) => {
        this.pendingRequests.get(symbol)!.push({ resolve, reject });
      });
    }

    // Create new request
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(symbol, [{ resolve, reject }]);
      this.executeRequest(symbol);
    });
  }

  private async executeRequest(symbol: string, retryCount = 0): Promise<void> {
    const pendingList = this.pendingRequests.get(symbol);
    if (!pendingList) return;

    try {
      // Rate limiting: wait for available slot
      await this.waitForSlot();
      
      // Rate limiting: ensure minimum interval between requests for same symbol
      await this.waitForSymbolInterval(symbol);

      this.concurrentRequests++;
      const response = await fetch(`https://api.exchange.coinbase.com/products/${symbol}/ticker`);
      
      if (response.status === 429) {
        // Handle rate limiting with exponential backoff
        if (retryCount < 3) {
          const delay = Math.min(2000 * Math.pow(2, retryCount), this.MAX_RETRY_DELAY);
          console.warn(`Rate limited for ${symbol}, retrying in ${delay}ms (attempt ${retryCount + 1})`);
          
          setTimeout(() => {
            this.executeRequest(symbol, retryCount + 1);
          }, delay);
          return;
        } else {
          throw new Error(`Rate limited after ${retryCount} retries`);
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const price = this.parsePrice(data);
      const result = { price, ts: new Date().toISOString() };

      // Cache the result
      this.cache.set(symbol, {
        ...result,
        cachedAt: Date.now()
      });

      this.lastRequestTime.set(symbol, Date.now());

      // Resolve all pending requests for this symbol
      pendingList.forEach(({ resolve }) => resolve(result));
      
    } catch (error) {
      // Try fallback before failing
      try {
        const fallback = await this.getFallbackPrice(symbol);
        if (fallback) {
          pendingList.forEach(({ resolve }) => resolve(fallback));
        } else {
          throw error;
        }
      } catch (fallbackError) {
        pendingList.forEach(({ reject }) => reject(error instanceof Error ? error : new Error(String(error))));
      }
    } finally {
      this.concurrentRequests--;
      this.pendingRequests.delete(symbol);
    }
  }

  private parsePrice(data: any): number {
    // Try direct price first
    if (data.price && !isNaN(parseFloat(data.price))) {
      return parseFloat(data.price);
    }
    
    // Try midpoint of bid/ask
    const bid = parseFloat(data.bid || '0');
    const ask = parseFloat(data.ask || '0');
    if (bid > 0 && ask > 0) {
      return (bid + ask) / 2;
    }
    
    throw new Error('Unable to parse price from response');
  }

  private async getFallbackPrice(symbol: string): Promise<PriceData | null> {
    try {
      const { data } = await supabase
        .from('price_snapshots')
        .select('price, ts')
        .eq('symbol', symbol)
        .order('ts', { ascending: false })
        .limit(1)
        .single();
        
      if (data) {
        return {
          price: parseFloat(data.price.toString()),
          ts: data.ts
        };
      }
    } catch (error) {
      console.warn(`Fallback price lookup failed for ${symbol}:`, error);
    }
    return null;
  }

  private async waitForSlot(): Promise<void> {
    while (this.concurrentRequests >= this.MAX_CONCURRENT) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async waitForSymbolInterval(symbol: string): Promise<void> {
    const lastRequest = this.lastRequestTime.get(symbol);
    if (lastRequest) {
      const elapsed = Date.now() - lastRequest;
      if (elapsed < this.MIN_INTERVAL) {
        const waitTime = this.MIN_INTERVAL - elapsed;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  getCached(symbol: string): PriceData | null {
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_DURATION) {
      return { price: cached.price, ts: cached.ts };
    }
    return null;
  }

  flush(): void {
    this.cache.clear();
    this.lastRequestTime.clear();
    this.pendingRequests.clear();
  }

  // Debug methods
  getCacheSize(): number {
    return this.cache.size;
  }

  getCacheContents(): Record<string, CachedPrice> {
    return Object.fromEntries(this.cache.entries());
  }
}

// Singleton instance
const coinbasePriceBus = new CoinbasePriceBus();

export const getPrices = (symbols: string[]) => coinbasePriceBus.getPrices(symbols);
export const getCached = (symbol: string) => coinbasePriceBus.getCached(symbol);
export const flush = () => coinbasePriceBus.flush();

// Debug exports
export const getDebugInfo = () => ({
  cacheSize: coinbasePriceBus.getCacheSize(),
  cacheContents: coinbasePriceBus.getCacheContents()
});