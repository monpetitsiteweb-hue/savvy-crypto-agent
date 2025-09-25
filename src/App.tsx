import { logger } from "@/utils/logger";
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
import { DevLearningPage } from "./pages/DevLearningPage";
import Calibration from "./pages/Calibration";
import NotFound from "./pages/NotFound";

// Step 5: Parent key scanner (prod-safe, default OFF)
const RUNTIME_DEBUG =
  (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('debug') === 'history' || u.hash.includes('debug=history') || sessionStorage.getItem('DEBUG_HISTORY_BLINK') === 'true';
    } catch { return false; }
  })();

const DEBUG_HISTORY_BLINK =
  (import.meta.env.DEV && (import.meta.env.VITE_DEBUG_HISTORY_BLINK === 'true')) || RUNTIME_DEBUG;

// Step 8: Hard-freeze switch for layout
const FORCE_FREEZE_LAYOUT = (() => {
  try {
    const u = new URL(window.location.href);
    return RUNTIME_DEBUG && u.searchParams.get('forceFreezeLayout') === '1';
  } catch { return false; }
})();

function AppInternal() {
  // Silent mode - no debug logging
  
  return (
    <TooltipProvider>
      <AuthProvider>
        <TestModeProvider>
          <MarketDataProvider>
            <MockWalletProvider>
              <ErrorBoundary>
                <BrowserRouter>
                  <Routes>
                    <Route path="/" element={<Index />} />
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/validation" element={<ValidationPage />} />
                    <Route path="/calibration" element={<Calibration />} />
                    <Route path="/dev/learning" element={<DevLearningPage />} />
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
}

// Step 8: Hard-freeze wrapper for layout
let frozenLayoutRenderRef: React.ReactElement | null = null;
let layoutFreezeLoggedRef = false;

const App = () => {
  if (FORCE_FREEZE_LAYOUT) {
    if (frozenLayoutRenderRef === null) {
      frozenLayoutRenderRef = <AppInternal />;
      if (!layoutFreezeLoggedRef) {
        logger.info('[HistoryBlink] forceFreezeLayout active');
        layoutFreezeLoggedRef = true;
      }
    }
    return frozenLayoutRenderRef;
  }
  
  return <AppInternal />;
};

export default App;