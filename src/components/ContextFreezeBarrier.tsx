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
    
    // Log freeze mapping in the requested format
    const freezeMap = [
      `price:${freezeFlags.price || freezeFlags.contexts || freezeFlags.historyDecoupled ? 'ON' : 'OFF'}`,
      `indicators:${freezeFlags.indicators || freezeFlags.contexts || freezeFlags.historyDecoupled ? 'ON' : 'OFF'}`,
      `strategy:${freezeFlags.strategy || freezeFlags.contexts ? 'ON' : 'OFF'}`,
      `auth:${freezeFlags.auth || freezeFlags.contexts ? 'ON' : 'OFF'}`,
      `flags:${freezeFlags.flags || freezeFlags.contexts ? 'ON' : 'OFF'}`,
      `notifs:${freezeFlags.notifs || freezeFlags.contexts ? 'ON' : 'OFF'}`
    ].join(' ');
    
    console.log(`[HistoryBlink] FreezeMap -> ${freezeMap}`);
  }

  // If no freezing is active, just return children as-is
  if (!freezeFlags || (!Object.values(freezeFlags).some(Boolean))) {
    return <>{children}</>;
  }

  // Build nested providers based on active freeze flags
  let wrappedChildren = children;
  
  // Only freeze specific contexts based on their individual flags
  if (freezeFlags.notifs) {
    wrappedChildren = (
      <FrozenNotifsContext.Provider value={frozenValues.current?.notifs}>
        {wrappedChildren}
      </FrozenNotifsContext.Provider>
    );
  }
  
  if (freezeFlags.flags) {
    wrappedChildren = (
      <FrozenFlagsContext.Provider value={frozenValues.current?.flags}>
        {wrappedChildren}
      </FrozenFlagsContext.Provider>
    );
  }
  
  if (freezeFlags.strategy) {
    wrappedChildren = (
      <FrozenStrategyContext.Provider value={frozenValues.current?.strategy}>
        {wrappedChildren}
      </FrozenStrategyContext.Provider>
    );
  }
  
  if (freezeFlags.auth) {
    wrappedChildren = (
      <FrozenAuthContext.Provider value={frozenValues.current?.auth}>
        {wrappedChildren}
      </FrozenAuthContext.Provider>
    );
  }
  
  // Only freeze market data when explicitly requested or for legacy modes
  if (freezeFlags.price || freezeFlags.indicators || freezeFlags.contexts || freezeFlags.historyDecoupled) {
    wrappedChildren = (
      <FrozenMarketContext.Provider value={frozenValues.current?.marketData}>
        {wrappedChildren}
      </FrozenMarketContext.Provider>
    );
  }
  
  // Legacy contexts mode - freeze all contexts
  if (freezeFlags.contexts) {
    // Apply all context freezes for legacy mode
    wrappedChildren = (
      <FrozenNotifsContext.Provider value={frozenValues.current?.notifs}>
        <FrozenFlagsContext.Provider value={frozenValues.current?.flags}>
          <FrozenStrategyContext.Provider value={frozenValues.current?.strategy}>
            <FrozenAuthContext.Provider value={frozenValues.current?.auth}>
              <FrozenTestModeContext.Provider value={frozenValues.current?.testMode}>
                {wrappedChildren}
              </FrozenTestModeContext.Provider>
            </FrozenAuthContext.Provider>
          </FrozenStrategyContext.Provider>
        </FrozenFlagsContext.Provider>
      </FrozenNotifsContext.Provider>
    );
  }

  return <>{wrappedChildren}</>;
};