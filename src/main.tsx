import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import './index.css'
import { Toaster } from "@/components/ui/sonner";
import { TestModeProvider } from "@/hooks/useTestMode";
import { MockWalletProvider } from "@/hooks/useMockWallet";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TestModeProvider>
      <MockWalletProvider>
        <QueryClientProvider client={queryClient}>
          <App />
          <Toaster />
        </QueryClientProvider>
      </MockWalletProvider>
    </TestModeProvider>
  </React.StrictMode>
);