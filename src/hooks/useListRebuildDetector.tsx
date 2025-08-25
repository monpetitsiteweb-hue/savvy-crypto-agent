import { useRef } from 'react';

// Step 13: List rebuild detector to understand why positions arrays are being replaced

export const useListRebuildDetector = (trades: any[], componentName: string) => {
  const lastTradesRef = useRef<any[]>([]);
  const lastLogTimeRef = useRef(0);
  
  const shouldTrace = (() => {
    try {
      const url = new URL(window.location.href);
      // Enable with just ?debug=history (no traceRenders=1 required)
      return url.searchParams.get('debug') === 'history';
    } catch {
      return false;
    }
  })();
  
  if (!shouldTrace) return;
  
  const now = performance.now();
  const lastTrades = lastTradesRef.current;
  
  // Rate-limited logging (once per 500ms)
  if (now - lastLogTimeRef.current < 500) {
    lastTradesRef.current = trades;
    return;
  }
  
  if (lastTrades.length === 0 && trades.length > 0) {
    console.info(`[HistoryBlink] list-replace ${componentName}: replaceReason=initialLoad len=${trades.length}`);
  } else if (trades.length !== lastTrades.length) {
    console.info(`[HistoryBlink] list-replace ${componentName}: replaceReason=positionsChanged len=${trades.length} (was ${lastTrades.length})`);
  } else if (trades.length > 0 && lastTrades.length > 0) {
    // Check if it's the same positions but with different price/P&L data
    const sameIds = trades.every((trade, index) => 
      lastTrades[index] && trade.id === lastTrades[index].id
    );
    
    if (sameIds) {
      // Check if any price-related fields changed
      const priceFieldsChanged = trades.some((trade, index) => {
        const lastTrade = lastTrades[index];
        return lastTrade && (
          trade.price !== lastTrade.price ||
          trade.total_value !== lastTrade.total_value ||
          trade.current_value !== lastTrade.current_value
        );
      });
      
      if (priceFieldsChanged) {
        console.info(`[HistoryBlink] list-replace ${componentName}: replaceReason=priceOnly len=${trades.length}`);
      } else {
        console.info(`[HistoryBlink] list-replace ${componentName}: replaceReason=unknown len=${trades.length}`);
      }
    } else {
      console.info(`[HistoryBlink] list-replace ${componentName}: replaceReason=positionsChanged len=${trades.length}`);
    }
  }
  
  lastTradesRef.current = trades;
  lastLogTimeRef.current = now;
};