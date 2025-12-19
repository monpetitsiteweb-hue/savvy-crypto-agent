/**
 * PORTFOLIO MATH - Single source of truth for all portfolio calculations
 * 
 * Total Portfolio Value = Cash + Open Positions Value - Gas Spent
 * Total P&L = Total Portfolio Value - Starting Capital
 * 
 * This must be used by ALL UI components displaying portfolio totals.
 */

import type { OpenTrade } from '@/hooks/useOpenTrades';
import type { PortfolioMetrics } from '@/hooks/usePortfolioMetrics';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';

// Fixed gas per transaction for mock mode (on-chain Base/EVM reality)
export const MOCK_GAS_PER_TX_EUR = 0.10;

export interface MarketPrices {
  [symbol: string]: { price: number } | undefined;
}

export interface OpenPositionValue {
  symbol: string;
  amount: number;
  costBasis: number;
  livePrice: number | null;
  liveValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
}

export interface PortfolioValuation {
  // Core components
  cashEur: number;
  openPositionsValueEur: number;
  gasSpentEur: number;
  
  // Derived totals
  totalPortfolioValueEur: number;
  totalPnlEur: number;
  totalPnlPct: number;
  
  // Breakdown
  startingCapitalEur: number;
  unrealizedPnlEur: number;
  realizedPnlEur: number;
  
  // Data quality
  hasMissingPrices: boolean;
  missingSymbols: string[];
  
  // Per-position breakdown
  positions: OpenPositionValue[];
  
  // Gas calculation metadata
  txCount: number;
}

/**
 * Compute the EUR value of all open trades using live market prices
 */
export function computeOpenTradesValueEur(
  openTrades: OpenTrade[],
  marketPrices: MarketPrices
): {
  totalValue: number;
  costBasis: number;
  pricedCostBasis: number;
  positions: OpenPositionValue[];
  hasMissingPrices: boolean;
  missingSymbols: string[];
} {
  if (!openTrades || openTrades.length === 0) {
    return {
      totalValue: 0,
      costBasis: 0,
      pricedCostBasis: 0,
      positions: [],
      hasMissingPrices: false,
      missingSymbols: [],
    };
  }

  const missingSymbols: string[] = [];
  const positions: OpenPositionValue[] = [];
  let totalValue = 0;
  let costBasis = 0;
  let pricedCostBasis = 0;

  // Group by base symbol first
  const symbolMap = new Map<string, { amount: number; cost: number }>();

  for (const trade of openTrades) {
    const symbol = toBaseSymbol(trade.cryptocurrency);
    const tradeCost = trade.total_value + (trade.fees || 0);

    const existing = symbolMap.get(symbol);
    if (existing) {
      existing.amount += trade.amount;
      existing.cost += tradeCost;
    } else {
      symbolMap.set(symbol, { amount: trade.amount, cost: tradeCost });
    }
  }

  // Resolve a live price from market data using multiple key schemes.
  // MarketDataContext typically keys by pair symbols (e.g. "SOL-EUR"),
  // but we also try base keys and a case-insensitive lookup.
  const resolveLivePrice = (
    baseSymbol: string
  ): { price: number | null; matchedKey: string | null } => {
    const base = toBaseSymbol(baseSymbol);
    const pair = toPairSymbol(base);

    const candidates = [pair, base];

    for (const key of candidates) {
      const p = marketPrices?.[key]?.price;
      if (typeof p === 'number' && p > 0) {
        return { price: p, matchedKey: key };
      }
    }

    // Case-insensitive fallback (covers any unexpected key casing)
    const keys = Object.keys(marketPrices || {});
    const baseUpper = base.toUpperCase();
    const pairUpper = pair.toUpperCase();
    const foundKey =
      keys.find((k) => k.toUpperCase() === pairUpper) ||
      keys.find((k) => k.toUpperCase() === baseUpper) ||
      null;

    if (foundKey) {
      const p = marketPrices?.[foundKey]?.price;
      if (typeof p === 'number' && p > 0) {
        return { price: p, matchedKey: foundKey };
      }
    }

    return { price: null, matchedKey: null };
  };

  // Compute values with live prices
  for (const [symbol, data] of symbolMap) {
    const { price: livePrice, matchedKey } = resolveLivePrice(symbol);

    costBasis += data.cost;

    let liveValue: number | null = null;
    let unrealizedPnl: number | null = null;
    let unrealizedPnlPct: number | null = null;

    if (livePrice !== null) {
      liveValue = data.amount * livePrice;
      unrealizedPnl = liveValue - data.cost;
      unrealizedPnlPct = data.cost > 0 ? (unrealizedPnl / data.cost) * 100 : 0;
      totalValue += liveValue;
      pricedCostBasis += data.cost;
    } else {
      // IMPORTANT: Never treat missing price as 0 or fallback to cost basis for TV.
      // Exclude from valuation and surface missing symbols for UI warnings.
      if (!missingSymbols.includes(symbol)) {
        missingSymbols.push(symbol);
      }
    }

    positions.push({
      symbol,
      amount: data.amount,
      costBasis: data.cost,
      livePrice,
      liveValue,
      unrealizedPnl,
      unrealizedPnlPct,
      // NOTE: matchedKey is logged by UI debug block; keep model stable here.
    });

    // (matchedKey is intentionally not returned to keep API stable)
    void matchedKey;
  }

  return {
    totalValue,
    costBasis,
    pricedCostBasis,
    positions,
    hasMissingPrices: missingSymbols.length > 0,
    missingSymbols,
  };
}

/**
 * Get cash balance from portfolio_capital (display as "Cash")
 */
export function getCashFromLedger(metrics: PortfolioMetrics): number {
  return metrics.cash_balance_eur || 0;
}

/**
 * Compute estimated gas spent in mock mode using fixed per-transaction cost
 * Formula: txCount * MOCK_GAS_PER_TX_EUR (€0.10 per transaction)
 */
export function computeMockGasSpentEurByTx(txCount: number): number {
  return txCount * MOCK_GAS_PER_TX_EUR;
}

/**
 * Compute total portfolio value
 * Formula: cash + openPositionsValue - gasSpent
 */
export function computeTotalPortfolioValueEur(
  cashEur: number,
  openPositionsValueEur: number,
  gasSpentEur: number
): number {
  return cashEur + openPositionsValueEur - gasSpentEur;
}

/**
 * Compute total P&L
 * Formula: totalPortfolioValue - startingCapital
 */
export function computeTotalPnl(
  totalPortfolioValueEur: number,
  startingCapitalEur: number
): { pnlEur: number; pnlPct: number } {
  const pnlEur = totalPortfolioValueEur - startingCapitalEur;
  const pnlPct = startingCapitalEur > 0 ? (pnlEur / startingCapitalEur) * 100 : 0;
  return { pnlEur, pnlPct };
}

/**
 * MAIN: Compute full portfolio valuation
 * This is the single source of truth for portfolio display
 * 
 * @param metrics Portfolio metrics from DB
 * @param openTrades List of open trades
 * @param marketPrices Live market prices
 * @param txCount Number of executed transactions (for gas calculation in mock mode)
 * @param isTestMode Whether in test/mock mode
 */
export function computeFullPortfolioValuation(
  metrics: PortfolioMetrics,
  openTrades: OpenTrade[],
  marketPrices: MarketPrices,
  txCount: number,
  isTestMode: boolean
): PortfolioValuation {
  // 1. Get cash from ledger
  const cashEur = getCashFromLedger(metrics);
  
  // 2. Compute open positions value with live prices
  const openCalc = computeOpenTradesValueEur(openTrades, marketPrices);
  const openPositionsValueEur = openCalc.totalValue;
  
  // 3. Compute gas (mock mode uses fixed per-tx estimate)
  const gasSpentEur = isTestMode ? computeMockGasSpentEurByTx(txCount) : 0;
  
  // 4. Compute total portfolio value
  const totalPortfolioValueEur = computeTotalPortfolioValueEur(cashEur, openPositionsValueEur, gasSpentEur);
  
  // 5. Compute total P&L
  const startingCapitalEur = metrics.starting_capital_eur || 0;
  const { pnlEur: totalPnlEur, pnlPct: totalPnlPct } = computeTotalPnl(totalPortfolioValueEur, startingCapitalEur);
  
  // 6. P&L breakdown (only on positions with live prices)
  const unrealizedPnlEur = openCalc.totalValue - openCalc.pricedCostBasis;
  const realizedPnlEur = metrics.realized_pnl_eur || 0;
  
  return {
    cashEur,
    openPositionsValueEur,
    gasSpentEur,
    totalPortfolioValueEur,
    totalPnlEur,
    totalPnlPct,
    startingCapitalEur,
    unrealizedPnlEur,
    realizedPnlEur,
    hasMissingPrices: openCalc.hasMissingPrices,
    missingSymbols: openCalc.missingSymbols,
    positions: openCalc.positions,
    txCount,
  };
}

/**
 * Format P&L with explicit sign and profit/loss label
 */
export function formatPnlWithSign(pnlEur: number): { 
  sign: string; 
  value: string; 
  label: 'Profit' | 'Loss' | 'Break-even';
  colorClass: string;
} {
  if (Math.abs(pnlEur) < 0.01) {
    return { sign: '', value: '€0.00', label: 'Break-even', colorClass: 'text-slate-400' };
  }
  
  if (pnlEur > 0) {
    return { 
      sign: '+', 
      value: `€${pnlEur.toFixed(2)}`, 
      label: 'Profit', 
      colorClass: 'text-green-400' 
    };
  }
  
  return { 
    sign: '-', 
    value: `€${Math.abs(pnlEur).toFixed(2)}`, 
    label: 'Loss', 
    colorClass: 'text-red-400' 
  };
}
