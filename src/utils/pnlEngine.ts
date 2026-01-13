/**
 * pnlEngine.ts — CANONICAL P&L COMPUTATION
 * 
 * This is the SINGLE SOURCE OF TRUTH for all P&L calculations.
 * All UI components, portfolio aggregation, and backend RPCs must use these functions.
 * 
 * INVARIANTS:
 * - UI never computes authoritative P&L (receives computed values)
 * - All P&L traces back to these functions
 * - If price unavailable → P&L = null, not 0
 */

export interface PnlInputs {
  /** Quantity of asset held */
  amount: number;
  /** Total cost including fees (amount × entryPrice + fees) */
  costBasis: number;
  /** Current market price from canonical source (price_snapshots) */
  currentPrice: number | null;
}

export interface PnlResult {
  /** Current market value = amount × currentPrice */
  currentValue: number | null;
  /** Unrealized P&L in EUR = currentValue - costBasis */
  pnlEur: number | null;
  /** Unrealized P&L percentage = (pnlEur / costBasis) × 100 */
  pnlPct: number | null;
  /** Whether price was available for computation */
  hasPriceData: boolean;
}

/**
 * Compute unrealized P&L for a single position.
 * 
 * FORMULA (non-negotiable):
 *   currentValue = amount × currentPrice
 *   pnlEur = currentValue - costBasis
 *   pnlPct = (pnlEur / costBasis) × 100
 * 
 * @param inputs - Amount, cost basis, and current price
 * @returns Computed P&L or nulls if price unavailable
 */
export function computeUnrealizedPnl(inputs: PnlInputs): PnlResult {
  const { amount, costBasis, currentPrice } = inputs;

  // INVARIANT: If price unavailable → return nulls, not zeros
  if (currentPrice === null || currentPrice === undefined || currentPrice <= 0) {
    return {
      currentValue: null,
      pnlEur: null,
      pnlPct: null,
      hasPriceData: false,
    };
  }

  // INVARIANT: If amount or costBasis invalid → return nulls
  if (amount <= 0 || costBasis <= 0) {
    return {
      currentValue: null,
      pnlEur: null,
      pnlPct: null,
      hasPriceData: false,
    };
  }

  // CANONICAL FORMULA
  const currentValue = amount * currentPrice;
  const pnlEur = currentValue - costBasis;
  const pnlPct = (pnlEur / costBasis) * 100;

  return {
    currentValue: Math.round(currentValue * 100) / 100,
    pnlEur: Math.round(pnlEur * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100,
    hasPriceData: true,
  };
}

/**
 * Compute cost basis from trade data.
 * 
 * FORMULA: costBasis = (amount × entryPrice) + fees
 * 
 * @param amount - Quantity purchased
 * @param entryPrice - Price per unit at purchase
 * @param fees - Transaction fees (default 0)
 * @returns Total cost basis
 */
export function computeCostBasis(amount: number, entryPrice: number, fees: number = 0): number {
  return Math.round((amount * entryPrice + fees) * 100) / 100;
}

/**
 * Aggregate P&L across multiple positions.
 * 
 * @param positions - Array of individual P&L results
 * @returns Aggregated totals
 */
export function aggregatePnl(positions: PnlResult[]): {
  totalCurrentValue: number;
  totalPnlEur: number;
  pricedCostBasis: number;
  hasMissingPrices: boolean;
  missingCount: number;
} {
  let totalCurrentValue = 0;
  let totalPnlEur = 0;
  let pricedCostBasis = 0;
  let missingCount = 0;

  for (const pos of positions) {
    if (pos.hasPriceData && pos.currentValue !== null && pos.pnlEur !== null) {
      totalCurrentValue += pos.currentValue;
      totalPnlEur += pos.pnlEur;
      // Derive cost basis from currentValue - pnlEur
      pricedCostBasis += (pos.currentValue - pos.pnlEur);
    } else {
      missingCount++;
    }
  }

  return {
    totalCurrentValue: Math.round(totalCurrentValue * 100) / 100,
    totalPnlEur: Math.round(totalPnlEur * 100) / 100,
    pricedCostBasis: Math.round(pricedCostBasis * 100) / 100,
    hasMissingPrices: missingCount > 0,
    missingCount,
  };
}

/**
 * Compute total portfolio P&L (realized + unrealized).
 * 
 * @param totalPortfolioValue - Cash + open positions value
 * @param startingCapital - Initial capital
 * @returns Total P&L in EUR and percentage
 */
export function computeTotalPortfolioPnl(
  totalPortfolioValue: number,
  startingCapital: number
): { pnlEur: number; pnlPct: number } {
  const pnlEur = totalPortfolioValue - startingCapital;
  const pnlPct = startingCapital > 0 ? (pnlEur / startingCapital) * 100 : 0;
  
  return {
    pnlEur: Math.round(pnlEur * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100,
  };
}
