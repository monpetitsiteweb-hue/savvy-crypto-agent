import { useEffect, useRef } from 'react';

// Authoritative debug state logger - logs effective toggles on every render
export const useDebugMapLogger = () => {
  const lastLogTimeRef = useRef(0);
  
  useEffect(() => {
    const isDebugHistory = (() => {
      try {
        const url = new URL(window.location.href);
        return url.searchParams.get('debug') === 'history';
      } catch {
        return false;
      }
    })();
    
    if (!isDebugHistory) return;
    
    const now = performance.now();
    
    // Rate-limited logging (once per second)
    if (now - lastLogTimeRef.current < 1000) return;
    
    try {
      const url = new URL(window.location.href);
      
      // Check all possible debug flags
      const effectiveDebugMap = {
        priceFreeze: url.searchParams.get('freezePrice') === '1',
        indicatorsFreeze: url.searchParams.get('freezeIndicators') === '1',
        strategyFreeze: url.searchParams.get('freezeStrategy') === '1',
        authFreeze: url.searchParams.get('freezeAuth') === '1',
        notifsFreeze: url.searchParams.get('freezeNotifsCtx') === '1',
        notifsMuted: url.searchParams.get('muteNotifs') === '1',
        bypassMarketHook: url.searchParams.get('bypassMarketHook') === '1',
        decoupled: url.searchParams.get('historyDecoupled') === '1',
        freezeContexts: url.searchParams.get('freezeContexts') === '1',
        freezeIndex: url.searchParams.get('freezeIndex') === '1',
        freezeLayout: url.searchParams.get('freezeLayout') === '1',
        traceRenders: url.searchParams.get('traceRenders') === '1',
        traceNetwork: url.searchParams.get('traceNetwork') === '1',
        traceTimers: url.searchParams.get('traceTimers') === '1'
      };
      
      // Detect any unexpected behavior (sanity check)
      const anyFreezeActive = Object.values(effectiveDebugMap).some(Boolean);
      const unexpectedBehavior = false; // TODO: Add actual sanity checks if needed
      
      if (unexpectedBehavior) {
        console.warn('[HistoryBlink] SANITY VIOLATION: unexpected freeze/bypass active -> auto-disabling');
      }
      
      // Log the effective debug map
      const debugMapString = JSON.stringify(effectiveDebugMap, null, 2)
        .replace(/\n/g, '\n  ')
        .replace(/^{/, '{\n ')
        .replace(/}$/, '\n}');
      
      console.info(`[HistoryBlink] EffectiveDebugMap = ${debugMapString}`);
      
      lastLogTimeRef.current = now;
    } catch (error) {
      console.warn('[HistoryBlink] EffectiveDebugMap: failed to generate', error);
    }
  });
};