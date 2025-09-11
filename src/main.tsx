import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import App from './App.tsx'
import './index.css'
import { Toaster } from "@/components/ui/sonner";
import { checkAndClearLegacyStorage } from './utils/clearLocalSession';
import { toBaseSymbol, toPairSymbol } from './utils/symbols';
import { sharedPriceCache } from './utils/SharedPriceCache';

// Check version but DON'T clear storage if user is already logged in
const preservedAuth = localStorage.getItem('supabase.auth.token');
const preservedTestMode = localStorage.getItem('global-test-mode');

if (!preservedAuth) {
  // Only clear storage if no auth session exists
  checkAndClearLegacyStorage();
} else {
  console.log('🔒 PRESERVING: Found existing auth session, skipping storage clear');
}

// Always restore test mode
if (preservedTestMode) {
  localStorage.setItem('global-test-mode', preservedTestMode);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 seconds
      gcTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

// Expose utility functions globally for debugging
if (typeof window !== 'undefined') {
  (window as any).toBaseSymbol = toBaseSymbol;
  (window as any).toPairSymbol = toPairSymbol;
  (window as any).sharedPriceCache = sharedPriceCache;
  
  (window as any).debugManualSell = (symbol: string) => {
    console.log(`[DEBUG] Manual sell triggered for symbol: ${symbol}`);
    console.log(`[DEBUG] toBaseSymbol available: ${typeof toBaseSymbol}`);
    console.log(`[DEBUG] toPairSymbol available: ${typeof toPairSymbol}`);
    console.log(`[DEBUG] sharedPriceCache available: ${typeof sharedPriceCache}`);
    
    const baseSymbol = toBaseSymbol(symbol);
    console.log(`[DEBUG] Base symbol: ${baseSymbol}`);
    
    const pairSymbol = toPairSymbol(baseSymbol);
    console.log(`[DEBUG] Pair symbol: ${pairSymbol}`);
    
    const price = sharedPriceCache.getPrice(pairSymbol);
    console.log(`[DEBUG] Current price: ${price}`);
    
    console.log('[DEBUG] To test manual sell: navigate to Trading History and use the UI button');
  };
  
  console.log('[DEBUG] Trading utilities loaded globally:');
  console.log('- toBaseSymbol("BTC-EUR") // Convert pair to base symbol');
  console.log('- toPairSymbol("BTC") // Convert base to pair symbol'); 
  console.log('- sharedPriceCache.getPrice("BTC-EUR") // Get cached price');
  console.log('- debugManualSell("BTC-EUR") // Test manual sell flow');
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>
);