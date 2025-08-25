import React, { createContext, useContext, useMemo, useRef } from 'react';
import { useMarketData } from '@/contexts/MarketDataContext';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';

// Debug-only component to freeze context values for diagnosis
// Only active when ?debug=history&freezeContexts=1

interface FrozenContexts {
  marketData: any;
  auth: any;
  testMode: any;
}

const FrozenMarketContext = createContext<any>(null);
const FrozenAuthContext = createContext<any>(null);
const FrozenTestModeContext = createContext<any>(null);

export const useFrozenMarketData = () => useContext(FrozenMarketContext);
export const useFrozenAuth = () => useContext(FrozenAuthContext);
export const useFrozenTestMode = () => useContext(FrozenTestModeContext);

interface ContextFreezeBarrierProps {
  children: React.ReactNode;
}

export const ContextFreezeBarrier: React.FC<ContextFreezeBarrierProps> = ({ children }) => {
  // Check if freezing is enabled
  const shouldFreeze = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get('debug') === 'history' && url.searchParams.get('freezeContexts') === '1';
    } catch {
      return false;
    }
  }, []);

  // Get current context values only once
  const marketData = useMarketData();
  const auth = useAuth();
  const testMode = useTestMode();

  // Freeze the values on first render
  const frozenValues = useRef<FrozenContexts | null>(null);
  
  if (!frozenValues.current && shouldFreeze) {
    frozenValues.current = {
      marketData: { ...marketData },
      auth: { ...auth },
      testMode: { ...testMode }
    };
    console.log('[HistoryBlink] ContextFreezeBarrier active for: price, auth, testMode');
  }

  // If not freezing, just return children as-is
  if (!shouldFreeze) {
    return <>{children}</>;
  }

  // Return children wrapped with frozen context providers
  return (
    <FrozenMarketContext.Provider value={frozenValues.current?.marketData}>
      <FrozenAuthContext.Provider value={frozenValues.current?.auth}>
        <FrozenTestModeContext.Provider value={frozenValues.current?.testMode}>
          {children}
        </FrozenTestModeContext.Provider>
      </FrozenAuthContext.Provider>
    </FrozenMarketContext.Provider>
  );
};