import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { TestModeProvider } from "@/hooks/useTestMode";
import { MockWalletProvider } from "@/hooks/useMockWallet";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MarketDataProvider } from "@/contexts/MarketDataContext";
import Index from "./pages/Index";
import AdminPage from "./pages/AdminPage";
import ProfilePage from "./pages/ProfilePage";
import ValidationPage from "./pages/ValidationPage";
import NotFound from "./pages/NotFound";

const App = () => (
  <TooltipProvider>
    <AuthProvider>
      <TestModeProvider>
        <MarketDataProvider>
          <MockWalletProvider>
            <Toaster />
            <Sonner />
            <ErrorBoundary>
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/validation" element={<ValidationPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </ErrorBoundary>
          </MockWalletProvider>
        </MarketDataProvider>
      </TestModeProvider>
    </AuthProvider>
  </TooltipProvider>
);

export default App;