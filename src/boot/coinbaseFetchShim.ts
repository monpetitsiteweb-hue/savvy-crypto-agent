import { getPrices } from '@/services/CoinbasePriceBus';

// Intercept any remaining direct Coinbase API calls and route them through the bus
export const installCoinbaseFetchShim = () => {
  const originalFetch = window.fetch;
  
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    
    // Intercept Coinbase ticker requests
    const coinbaseTickerMatch = url.match(/https:\/\/api\.exchange\.coinbase\.com\/products\/([^\/]+)\/ticker/);
    if (coinbaseTickerMatch) {
      const symbol = coinbaseTickerMatch[1];
      console.log(`🔄 Fetch shim intercepted Coinbase ticker request for ${symbol}, routing to bus`);
      
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
        console.warn(`Fetch shim failed for ${symbol}, falling back to direct call:`, error);
      }
    }
    
    // Intercept Coinbase book requests (level 2)
    const coinbaseBookMatch = url.match(/https:\/\/api\.exchange\.coinbase\.com\/products\/([^\/]+)\/book/);
    if (coinbaseBookMatch) {
      const symbol = coinbaseBookMatch[1];
      console.log(`🔄 Fetch shim intercepted Coinbase book request for ${symbol}, routing to bus`);
      
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
        console.warn(`Fetch shim failed for ${symbol}, falling back to direct call:`, error);
      }
    }
    
    // Fall back to original fetch for all other requests
    return originalFetch(input, init);
  };
  
  console.log('🔧 Coinbase fetch shim installed');
};

export const uninstallCoinbaseFetchShim = () => {
  // Restore original fetch if needed (for tests)
  const originalFetch = (window as any).__originalFetch;
  if (originalFetch) {
    window.fetch = originalFetch;
    console.log('🔧 Coinbase fetch shim uninstalled');
  }
};