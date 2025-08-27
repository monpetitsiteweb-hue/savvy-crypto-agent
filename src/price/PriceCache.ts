// Single source of truth for cryptocurrency prices
// Fetches all needed symbols in one loop every 30s (configurable)

export type PriceMap = Record<string, { price: number; ts: number }>;

interface PriceCacheOptions {
  intervalMs?: number;
}

class PriceCacheManager {
  private priceMap: PriceMap = {};
  private symbols: Set<string> = new Set();
  private intervalId: NodeJS.Timeout | null = null;
  private intervalMs: number = 30000;
  private isInitialized = false;
  private stableWrapper: PriceMap = {};
  private lastFetchTime = 0;

  init(opts: PriceCacheOptions = {}) {
    if (this.isInitialized) return;
    
    // Runtime override from URL
    const urlOverride = this.getIntervalFromUrl();
    this.intervalMs = urlOverride || opts.intervalMs || 30000;
    
    // Floor at 5 seconds
    this.intervalMs = Math.max(this.intervalMs, 5000);
    
    this.isInitialized = true;
    console.log(`[HistoryPerf] PriceCache initialized: intervalMs=${this.intervalMs}`);
  }

  private getIntervalFromUrl(): number | null {
    try {
      const params = new URLSearchParams(window.location.search);
      const val = params.get('priceIntervalMs');
      if (val) {
        const parsed = parseInt(val, 10);
        return Number.isFinite(parsed) && parsed >= 5000 ? parsed : null;
      }
    } catch {}
    return null;
  }

  setSymbols(symbols: string[]) {
    if (!this.isInitialized) return;
    
    // Deduplicate and filter valid symbols
    const newSymbols = new Set(symbols.filter(s => s && typeof s === 'string'));
    
    // Check if symbols changed
    const changed = newSymbols.size !== this.symbols.size || 
      [...newSymbols].some(s => !this.symbols.has(s));
    
    if (!changed) return;
    
    this.symbols = newSymbols;
    
    // Restart interval with new symbols
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    
    if (this.symbols.size === 0) {
      console.log(`[HistoryPerf] PriceCache: no symbols, stopping fetch loop`);
      return;
    }
    
    console.log(`[HistoryPerf] PriceCache: symbols updated, count=${this.symbols.size}`);
    
    // Immediate fetch then start interval
    this.fetchAllPrices();
    this.intervalId = setInterval(() => this.fetchAllPrices(), this.intervalMs);
  }

  private async fetchAllPrices() {
    if (this.symbols.size === 0) return;
    
    const startTime = performance.now();
    const symbolsArray = Array.from(this.symbols);
    
    try {
      // Batch fetch all symbols (deduped)
      const promises = symbolsArray.map(async (symbol) => {
        try {
          const response = await fetch(`https://api.exchange.coinbase.com/products/${symbol}/ticker`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          
          const data = await response.json();
          const price = parseFloat(data.price);
          const ts = Date.now();
          
          if (Number.isFinite(price) && price > 0) {
            return { symbol, price, ts };
          }
        } catch (error) {
          console.warn(`[HistoryPerf] PriceCache: failed to fetch ${symbol}:`, error);
        }
        return null;
      });
      
      const results = await Promise.all(promises);
      let updateCount = 0;
      
      // Update internal map only when values actually changed
      results.forEach(result => {
        if (!result) return;
        
        const { symbol, price, ts } = result;
        const existing = this.priceMap[symbol];
        
        if (!existing || existing.price !== price || Math.abs(existing.ts - ts) > 1000) {
          this.priceMap[symbol] = { price, ts };
          updateCount++;
        }
      });
      
      // Update stable wrapper only if something changed
      if (updateCount > 0) {
        this.stableWrapper = { ...this.priceMap };
      }
      
      const elapsed = performance.now() - startTime;
      this.lastFetchTime = Date.now();
      
      console.log(`[HistoryPerf] PriceCache: fetched ${symbolsArray.length} symbols, updated ${updateCount}, ${elapsed.toFixed(1)}ms`);
      
    } catch (error) {
      console.error('[HistoryPerf] PriceCache: batch fetch error:', error);
    }
  }

  getPrice(symbolPair: string): { price: number | null; ts: number | null } {
    const entry = this.priceMap[symbolPair];
    return entry ? { price: entry.price, ts: entry.ts } : { price: null, ts: null };
  }

  getPriceMap(): PriceMap {
    return this.stableWrapper; // Shallow stable object
  }

  destroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isInitialized = false;
    this.priceMap = {};
    this.symbols.clear();
    this.stableWrapper = {};
  }
}

// Singleton instance
const priceCache = new PriceCacheManager();

// Public API
export function initPriceCache(opts: PriceCacheOptions = {}): void {
  priceCache.init(opts);
}

export function getPrice(symbolPair: string): { price: number | null; ts: number | null } {
  return priceCache.getPrice(symbolPair);
}

export function getPriceMap(): PriceMap {
  return priceCache.getPriceMap();
}

export function setSymbols(symbols: string[]): void {
  priceCache.setSymbols(symbols);
}

// Cleanup for HMR
if (import.meta.hot) {
  import.meta.hot.dispose(() => priceCache.destroy());
}