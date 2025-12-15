/**
 * P2 FIX: Centralized reset helpers
 * 
 * After reset_portfolio_capital (hard reset deletes test trades):
 * - TradingHistory: empty (no past trades, no open lots)
 * - Performance: zeros
 * - Portfolio display: exactly 30,000 (and NOT 30k + invested)
 * 
 * NO setTimeout-based refresh. All refreshes are awaited.
 */

export interface AfterResetCallbacks {
  refreshPortfolioMetrics: () => Promise<void>;
  refreshTradingHistory?: () => Promise<void>;
  refreshOpenTrades?: () => Promise<void>;
  clearLocalState?: () => void;
}

/**
 * Call this after resetPortfolio() completes.
 * All refreshes are awaited in parallel - no timeouts.
 */
export async function afterReset(callbacks: AfterResetCallbacks): Promise<void> {
  const promises: Promise<void>[] = [];
  
  // Refresh portfolio metrics from RPC (single source of truth)
  promises.push(callbacks.refreshPortfolioMetrics());
  
  // Refresh trading history if mounted
  if (callbacks.refreshTradingHistory) {
    promises.push(callbacks.refreshTradingHistory());
  }
  
  // Refresh open trades (trade-based model)
  if (callbacks.refreshOpenTrades) {
    promises.push(callbacks.refreshOpenTrades());
  }
  
  // Clear any local cached state (synchronous)
  if (callbacks.clearLocalState) {
    callbacks.clearLocalState();
  }
  
  // Await all async refreshes in parallel
  await Promise.all(promises);
}
