import { useEffect, useRef } from 'react';

// Step 12: Render counter for key components (debug-only)
// Counts renders/sec when traceRenders=1

interface RenderStats {
  [componentName: string]: {
    count: number;
    lastResetTime: number;
  };
}

const globalRenderStats: RenderStats = {};
let logInterval: NodeJS.Timeout | null = null;

const shouldTrace = (() => {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('debug') === 'history' && url.searchParams.get('traceRenders') === '1';
  } catch {
    return false;
  }
})();

const startLogging = () => {
  if (logInterval) return;
  
  logInterval = setInterval(() => {
    const now = performance.now();
    const rates: string[] = [];
    
    for (const [componentName, stats] of Object.entries(globalRenderStats)) {
      const timeDelta = (now - stats.lastResetTime) / 1000;
      const rate = timeDelta > 0 ? (stats.count / timeDelta).toFixed(1) : '0.0';
      rates.push(`${componentName}=${rate}`);
      
      // Reset counters
      stats.count = 0;
      stats.lastResetTime = now;
    }
    
    if (rates.length > 0) {
      console.info(`[HistoryBlink] renders/sec: ${rates.join(', ')}`);
    }
  }, 1000);
};

const stopLogging = () => {
  if (logInterval) {
    clearInterval(logInterval);
    logInterval = null;
  }
};

export const useRenderCounter = (componentName: string) => {
  const renderCountRef = useRef(0);
  
  useEffect(() => {
    if (!shouldTrace) return;
    
    // Initialize stats for this component
    if (!globalRenderStats[componentName]) {
      globalRenderStats[componentName] = {
        count: 0,
        lastResetTime: performance.now()
      };
    }
    
    // Start global logging if not already started
    startLogging();
    
    return () => {
      // Clean up this component's stats when unmounting
      delete globalRenderStats[componentName];
      
      // Stop logging if no components are being tracked
      if (Object.keys(globalRenderStats).length === 0) {
        stopLogging();
      }
    };
  }, [componentName]);
  
  // Count this render
  if (shouldTrace) {
    renderCountRef.current++;
    if (globalRenderStats[componentName]) {
      globalRenderStats[componentName].count++;
    }
  }
};