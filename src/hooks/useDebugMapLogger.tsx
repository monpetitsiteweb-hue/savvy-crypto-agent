import { useEffect, useRef } from 'react';

// Authoritative debug state logger - logs effective toggles once on first render
export const useDebugMapLogger = () => {
  const hasLoggedRef = useRef(false);
  const priceTickCountRef = useRef(0);
  const sanityCheckRef = useRef<NodeJS.Timeout | null>(null);
  
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
    
    // Log effective debug map exactly once on first render
    if (!hasLoggedRef.current) {
      try {
        const url = new URL(window.location.href);
        
        // Check all possible debug flags
        const effectiveDebugMap = {
          freezePrice: url.searchParams.get('freezePrice') === '1',
          freezeIndicators: url.searchParams.get('freezeIndicators') === '1',
          freezeStrategy: url.searchParams.get('freezeStrategy') === '1',
          freezeAuth: url.searchParams.get('freezeAuth') === '1',
          freezeFlags: url.searchParams.get('freezeFlags') === '1',
          freezeNotifsCtx: url.searchParams.get('freezeNotifsCtx') === '1',
          bypassMarketHook: url.searchParams.get('bypassMarketHook') === '1',
          historyDecoupled: url.searchParams.get('historyDecoupled') === '1',
          freezeContexts: url.searchParams.get('freezeContexts') === '1',
          freezeIndex: url.searchParams.get('freezeIndex') === '1',
          freezeLayout: url.searchParams.get('freezeLayout') === '1',
          traceRenders: url.searchParams.get('traceRenders') === '1',
          traceNetwork: url.searchParams.get('traceNetwork') === '1',
          traceTimers: url.searchParams.get('traceTimers') === '1'
        };
        
        // Detect any unexpected behavior (sanity check)
        const anyFreezeActive = Object.values(effectiveDebugMap).some(Boolean);
        
        // Only with ?debug=history alone, all should be false
        if (!anyFreezeActive) {
          console.info('[HistoryBlink] EffectiveDebugMap = {\n  freezePrice:false, freezeIndicators:false, freezeStrategy:false,\n  freezeAuth:false, freezeFlags:false, freezeNotifsCtx:false,\n  bypassMarketHook:false, historyDecoupled:false,\n  freezeContexts:false, freezeIndex:false, freezeLayout:false,\n  traceRenders:false, traceNetwork:false, traceTimers:false\n}');
        } else {
          const debugMapString = JSON.stringify(effectiveDebugMap, null, 2)
            .replace(/\n/g, '\n  ')
            .replace(/^{/, '{\n ')
            .replace(/}$/, '\n}');
          
          console.info(`[HistoryBlink] EffectiveDebugMap = ${debugMapString}`);
        }
        
        hasLoggedRef.current = true;
        
        // Start sanity check: price flow should be alive within 5 seconds
        sanityCheckRef.current = setTimeout(() => {
          if (priceTickCountRef.current === 0) {
            console.warn('[HistoryBlink] SANITY VIOLATION: price/indicators frozen in baseline');
            // TODO: Add auto-unfreeze logic here
          }
        }, 5000);
        
      } catch (error) {
        console.warn('[HistoryBlink] EffectiveDebugMap: failed to generate', error);
      }
    }
    
    // Track price ticks for sanity check
    priceTickCountRef.current += 1;
    
    return () => {
      if (sanityCheckRef.current) {
        clearTimeout(sanityCheckRef.current);
      }
    };
  });
};