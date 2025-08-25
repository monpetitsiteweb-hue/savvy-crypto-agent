import { useEffect, useRef } from 'react';

// Step 13: Render-cause tracer to identify what dependencies changed between renders

interface DependencyCounters {
  priceTick: number;
  positions: number;
  strategy: number;
  auth: number;
  notifs: number;
  filters: number;
  loading: number;
}

interface RenderCauseStats {
  [componentName: string]: {
    lastCounters: DependencyCounters;
    lastLogTime: number;
  };
}

const globalRenderCauseStats: RenderCauseStats = {};

const shouldTrace = (() => {
  try {
    const url = new URL(window.location.href);
    // Enable with just ?debug=history (no traceRenders=1 required)
    return url.searchParams.get('debug') === 'history';
  } catch {
    return false;
  }
})();

export const useRenderCauseTracer = (
  componentName: string,
  dependencies: {
    marketData?: any;
    trades?: any[];
    auth?: any;
    loading?: boolean;
    filters?: any;
    strategy?: any;
  }
) => {
  const lastDepsRef = useRef<any>({});
  
  useEffect(() => {
    if (!shouldTrace) return;
    
    // Initialize stats for this component
    if (!globalRenderCauseStats[componentName]) {
      globalRenderCauseStats[componentName] = {
        lastCounters: {
          priceTick: 0,
          positions: 0,
          strategy: 0,
          auth: 0,
          notifs: 0,
          filters: 0,
          loading: 0
        },
        lastLogTime: 0
      };
    }
    
    const stats = globalRenderCauseStats[componentName];
    const now = performance.now();
    
    // Calculate what changed since last render
    const currentCounters = {
      priceTick: dependencies.marketData ? Object.keys(dependencies.marketData).length : 0,
      positions: dependencies.trades ? dependencies.trades.length : 0,
      strategy: dependencies.strategy ? 1 : 0,
      auth: dependencies.auth?.user ? 1 : 0,
      notifs: 0, // Placeholder for notifications context
      filters: dependencies.filters ? Object.keys(dependencies.filters).length : 0,
      loading: dependencies.loading ? 1 : 0
    };
    
    // Rate-limited logging (once per second)
    if (now - stats.lastLogTime >= 1000) {
      const deltas = {
        priceTickΔ: Math.abs(currentCounters.priceTick - stats.lastCounters.priceTick),
        positionsΔ: Math.abs(currentCounters.positions - stats.lastCounters.positions),
        strategyΔ: Math.abs(currentCounters.strategy - stats.lastCounters.strategy),
        authΔ: Math.abs(currentCounters.auth - stats.lastCounters.auth),
        notifsΔ: Math.abs(currentCounters.notifs - stats.lastCounters.notifs),
        filtersΔ: Math.abs(currentCounters.filters - stats.lastCounters.filters),
        loadingΔ: Math.abs(currentCounters.loading - stats.lastCounters.loading)
      };
      
      const deltaString = Object.entries(deltas)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
      
      console.info(`[HistoryBlink] render-cause ${componentName}: ${deltaString}`);
      
      stats.lastCounters = currentCounters;
      stats.lastLogTime = now;
    }
    
    lastDepsRef.current = dependencies;
  });
};