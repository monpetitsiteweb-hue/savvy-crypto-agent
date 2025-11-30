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

if (!preservedAuth) {
  // Only clear storage if no auth session exists
  checkAndClearLegacyStorage();
}

if ('serviceWorker' in navigator && location.hostname === 'localhost') {
  navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
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

// Expose utility functions globally (silent)
if (typeof window !== 'undefined') {
  (window as any).toBaseSymbol = toBaseSymbol;
  (window as any).toPairSymbol = toPairSymbol;
  (window as any).sharedPriceCache = sharedPriceCache;
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
