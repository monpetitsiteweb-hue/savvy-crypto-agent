import { getPrices } from '@/services/CoinbasePriceBus';

// Track if shim is already installed to prevent double-patching
let shimInstalled = false;

// Intercept any remaining direct Coinbase API calls and route them through the bus
export const installCoinbaseFetchShim = () => {
  if (shimInstalled) {
    console.error('[CoinbaseShim] already installed');
    return;
  }
  
  const originalFetch = window.fetch;
  
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    
    // Intercept Coinbase ticker requests
    const coinbaseTickerMatch = url.match(/https:\/\/api\.exchange\.coinbase\.com\/products\/([^\/]+)\/ticker/);
    if (coinbaseTickerMatch) {
      const symbol = coinbaseTickerMatch[1];
      console.error(`[CoinbaseShim] Intercepted ticker request for ${symbol}, routing to bus`);
      
      try {
        const busResults = await getPrices([symbol]);
        const priceData = busResults[symbol];
        
        if (priceData) {
          // Mock Coinbase response format
          const mockResponse = {
            price: priceData.price.toString(),
            bid: priceData.price.toString(),
            ask: priceData.price.toString(),
            volume: "0",
            trade_id: "1",
            time: priceData.ts,
            size: "0"
          };
          
          return new Response(JSON.stringify(mockResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        console.error(`[CoinbaseShim] Failed for ${symbol}, falling back:`, error);
      }
    }
    
    // Intercept Coinbase book requests (level 2)
    const coinbaseBookMatch = url.match(/https:\/\/api\.exchange\.coinbase\.com\/products\/([^\/]+)\/book/);
    if (coinbaseBookMatch) {
      const symbol = coinbaseBookMatch[1];
      console.error(`[CoinbaseShim] Intercepted book request for ${symbol}, routing to bus`);
      
      try {
        const busResults = await getPrices([symbol]);
        const priceData = busResults[symbol];
        
        if (priceData) {
          // Mock book response with mid-price as bid/ask
          const price = priceData.price.toString();
          const mockResponse = {
            bids: [[price, "1"]],
            asks: [[price, "1"]],
            sequence: 1,
            auction_mode: false,
            auction: null,
            time: priceData.ts
          };
          
          return new Response(JSON.stringify(mockResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        console.error(`[CoinbaseShim] Book failed for ${symbol}, falling back:`, error);
      }
    }
    
    // Fall back to original fetch for all other requests
    return originalFetch(input, init);
  };
  
  shimInstalled = true;
  console.error('[CoinbaseShim] installed and active');
};

export const uninstallCoinbaseFetchShim = () => {
  // Restore original fetch if needed (for tests)
  const originalFetch = (window as any).__originalFetch;
  if (originalFetch) {
    window.fetch = originalFetch;
    console.log('🔧 Coinbase fetch shim uninstalled');
  }
};