import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import App from './App.tsx'
import './index.css'
import { Toaster } from "@/components/ui/sonner";
import { checkAndClearLegacyStorage } from './utils/clearLocalSession';

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>
);