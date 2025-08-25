import React, { createContext, useContext, useMemo, useRef } from 'react';
import { useMarketData } from '@/contexts/MarketDataContext';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';

// Debug-only component to freeze context values for diagnosis
// Only active when ?debug=history with freeze* flags

interface FrozenContexts {
  marketData: any;
  auth: any;
  testMode: any;
  strategy: any;
  flags: any;
  notifs: any;
}

const FrozenMarketContext = createContext<any>(null);
const FrozenAuthContext = createContext<any>(null);
const FrozenTestModeContext = createContext<any>(null);
const FrozenStrategyContext = createContext<any>(null);
const FrozenFlagsContext = createContext<any>(null);
const FrozenNotifsContext = createContext<any>(null);

export const useFrozenMarketData = () => useContext(FrozenMarketContext);
export const useFrozenAuth = () => useContext(FrozenAuthContext);
export const useFrozenTestMode = () => useContext(FrozenTestModeContext);
export const useFrozenStrategy = () => useContext(FrozenStrategyContext);
export const useFrozenFlags = () => useContext(FrozenFlagsContext);
export const useFrozenNotifs = () => useContext(FrozenNotifsContext);

interface ContextFreezeBarrierProps {
  children: React.ReactNode;
}

export const ContextFreezeBarrier: React.FC<ContextFreezeBarrierProps> = ({ children }) => {
  // Parse individual freeze flags
  const freezeFlags = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      const isDebugHistory = url.searchParams.get('debug') === 'history';
      
      if (!isDebugHistory) return null;
      
      return {
        price: url.searchParams.get('freezePrice') === '1',
        indicators: url.searchParams.get('freezeIndicators') === '1', 
        auth: url.searchParams.get('freezeAuth') === '1',
        strategy: url.searchParams.get('freezeStrategy') === '1',
        flags: url.searchParams.get('freezeFlags') === '1',
        notifs: url.searchParams.get('freezeNotifsCtx') === '1',
        // Legacy support
        contexts: url.searchParams.get('freezeContexts') === '1',
        historyDecoupled: url.searchParams.get('historyDecoupled') === '1'
      };
    } catch {
      return null;
    }
  }, []);

  // Get current context values only once
  const marketData = useMarketData();
  const auth = useAuth();
  const testMode = useTestMode();
  
  // TODO: Add strategy, flags, notifs contexts when available
  const strategy = {}; // Placeholder for actual strategy context
  const flags = {}; // Placeholder for actual flags context  
  const notifs = {}; // Placeholder for actual notifs context

  // Freeze the values on first render
  const frozenValues = useRef<FrozenContexts | null>(null);
  
  if (!frozenValues.current && freezeFlags) {
    frozenValues.current = {
      marketData: { ...marketData },
      auth: { ...auth },
      testMode: { ...testMode },
      strategy: { ...strategy },
      flags: { ...flags },
      notifs: { ...notifs }
    };
    
    // Log active freeze flags
    const activeFlags = Object.entries(freezeFlags)
      .filter(([key, value]) => value && !['contexts', 'historyDecoupled'].includes(key))
      .map(([key]) => `${key}=ON`)
      .join(', ');
    
    if (activeFlags) {
      console.log(`[HistoryBlink] ContextFreeze: ${activeFlags}`);
    }
    
    // Legacy logging
    if (freezeFlags.historyDecoupled) {
      console.log('[HistoryBlink] ContextFreezeBarrier active for: price, indicators (strategy/positions/auth unaffected)');
    } else if (freezeFlags.contexts) {
      console.log('[HistoryBlink] ContextFreezeBarrier active for: price, auth, testMode');
    }
  }

  // If no freezing is active, just return children as-is
  if (!freezeFlags || (!Object.values(freezeFlags).some(Boolean))) {
    return <>{children}</>;
  }

  // Build nested providers based on active freeze flags
  let wrappedChildren = children;
  
  if (freezeFlags.notifs || freezeFlags.contexts) {
    wrappedChildren = (
      <FrozenNotifsContext.Provider value={frozenValues.current?.notifs}>
        {wrappedChildren}
      </FrozenNotifsContext.Provider>
    );
  }
  
  if (freezeFlags.flags || freezeFlags.contexts) {
    wrappedChildren = (
      <FrozenFlagsContext.Provider value={frozenValues.current?.flags}>
        {wrappedChildren}
      </FrozenFlagsContext.Provider>
    );
  }
  
  if (freezeFlags.strategy || freezeFlags.contexts) {
    wrappedChildren = (
      <FrozenStrategyContext.Provider value={frozenValues.current?.strategy}>
        {wrappedChildren}
      </FrozenStrategyContext.Provider>
    );
  }
  
  if (freezeFlags.auth || freezeFlags.contexts) {
    wrappedChildren = (
      <FrozenAuthContext.Provider value={frozenValues.current?.auth}>
        {wrappedChildren}
      </FrozenAuthContext.Provider>
    );
  }
  
  if (freezeFlags.price || freezeFlags.indicators || freezeFlags.contexts || freezeFlags.historyDecoupled) {
    wrappedChildren = (
      <FrozenMarketContext.Provider value={frozenValues.current?.marketData}>
        {wrappedChildren}
      </FrozenMarketContext.Provider>
    );
  }
  
  // Legacy testMode context
  if (freezeFlags.contexts) {
    wrappedChildren = (
      <FrozenTestModeContext.Provider value={frozenValues.current?.testMode}>
        {wrappedChildren}
      </FrozenTestModeContext.Provider>
    );
  }

  return <>{wrappedChildren}</>;
};