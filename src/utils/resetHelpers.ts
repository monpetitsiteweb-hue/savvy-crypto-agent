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
  refreshOpenLots?: () => Promise<void>;
}

/**
 * Call this after resetPortfolio() completes.
 * All refreshes are awaited in parallel - no timeouts.
 */
export async function afterReset(callbacks: AfterResetCallbacks): Promise<void> {
  const promises: Promise<void>[] = [];
  
  promises.push(callbacks.refreshPortfolioMetrics());
  
  if (callbacks.refreshTradingHistory) {
    promises.push(callbacks.refreshTradingHistory());
  }
  
  if (callbacks.refreshOpenLots) {
    promises.push(callbacks.refreshOpenLots());
  }
  
  await Promise.all(promises);
}
