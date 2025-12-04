/**
 * LOT ENGINE - Canonical lot management for mock_trades
 * 
 * DEFINITIONS:
 * - A "lot" is a single BUY row in mock_trades
 * - A lot is "open" if Σ(SELL amounts with original_trade_id = lot.id) < lot.amount
 * - A lot is "closed" when Σ(SELL amounts with original_trade_id = lot.id) >= lot.amount
 * 
 * This module provides:
 * 1. reconstructOpenLots() - Get all open lots for a user/strategy/symbol
 * 2. reconstructClosedLots() - Get all closed lots with P&L
 * 3. calculateNetPositionFromLots() - Net position from lots
 * 4. buildSellOrdersForLots() - Generate per-lot SELL orders for closing position
 */

import { toBaseSymbol } from './symbols';

// Types
export interface TradeRow {
  id: string;
  user_id: string;
  strategy_id: string;
  trade_type: 'buy' | 'sell';
  cryptocurrency: string;
  amount: number;
  price: number;
  total_value: number;
  executed_at: string;
  original_trade_id?: string | null;
  is_test_mode?: boolean;
}

export interface OpenLot {
  lotId: string;           // BUY trade id
  symbol: string;
  entryPrice: number;
  entryDate: string;
  originalAmount: number;
  remainingAmount: number;
  soldAmount: number;
  entryValue: number;      // originalAmount * entryPrice
  remainingValue: number;  // remainingAmount * entryPrice
  // Per-lot unrealized P&L (computed with current price)
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
  ageMs?: number;          // milliseconds since entry
}

export interface ClosedLot {
  lotId: string;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  entryDate: string;
  exitDate: string;
  amount: number;
  realizedPnl: number;
  realizedPnlPct: number;
  sellTradeId: string;
}

// Close modes for SELL intents
export type CloseMode = 
  | 'TP_SELECTIVE'    // Only close profitable lots meeting criteria
  | 'SL_FULL_FLUSH'   // Close all lots (stop loss hit)
  | 'AUTO_CLOSE_ALL'  // Time-based close all
  | 'MANUAL_LOT'      // Manual close of specific lot
  | 'MANUAL_SYMBOL';  // Manual close of symbol (FIFO)

export interface SellOrder {
  lotId: string;           // ID of the BUY lot being closed
  cryptocurrency: string;
  amount: number;          // Amount to sell from this lot
  entryPrice: number;      // Original purchase price
  entryValue: number;      // Original purchase value (amount * entryPrice)
}

/**
 * Reconstruct open lots from trade history
 * An open lot is a BUY trade that hasn't been fully sold
 * 
 * @param trades - All trades for a user/strategy/symbol (unsorted is fine)
 * @param symbolFilter - Optional symbol to filter by (normalized to base)
 * @returns Array of open lots sorted by entry date (FIFO order)
 */
export function reconstructOpenLots(trades: TradeRow[], symbolFilter?: string): OpenLot[] {
  const normalizedFilter = symbolFilter ? toBaseSymbol(symbolFilter) : null;
  
  // Group trades by normalized symbol
  const buysBySymbol = new Map<string, TradeRow[]>();
  const sellsByLotId = new Map<string, number>(); // lotId -> total sold amount
  
  for (const trade of trades) {
    const normalizedSymbol = toBaseSymbol(trade.cryptocurrency);
    
    // Apply symbol filter if provided
    if (normalizedFilter && normalizedSymbol !== normalizedFilter) {
      continue;
    }
    
    if (trade.trade_type === 'buy') {
      if (!buysBySymbol.has(normalizedSymbol)) {
        buysBySymbol.set(normalizedSymbol, []);
      }
      buysBySymbol.get(normalizedSymbol)!.push(trade);
    } else if (trade.trade_type === 'sell' && trade.original_trade_id) {
      // Track sold amount per lot (via original_trade_id)
      const currentSold = sellsByLotId.get(trade.original_trade_id) || 0;
      sellsByLotId.set(trade.original_trade_id, currentSold + trade.amount);
    }
  }
  
  // For sells WITHOUT original_trade_id, use FIFO to deduct from lots
  const sellsWithoutLotId: TradeRow[] = trades.filter(t => 
    t.trade_type === 'sell' && 
    !t.original_trade_id &&
    (!normalizedFilter || toBaseSymbol(t.cryptocurrency) === normalizedFilter)
  );
  
  // Sort sells by date for FIFO deduction
  sellsWithoutLotId.sort((a, b) => 
    new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime()
  );
  
  // Build open lots
  const openLots: OpenLot[] = [];
  
  buysBySymbol.forEach((buys, symbol) => {
    // Sort buys by date (FIFO)
    buys.sort((a, b) => 
      new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime()
    );
    
    // Calculate sold amount per lot (from sells with original_trade_id)
    const lotSoldAmounts = new Map<string, number>();
    buys.forEach(buy => {
      lotSoldAmounts.set(buy.id, sellsByLotId.get(buy.id) || 0);
    });
    
    // Apply FIFO for sells without original_trade_id
    const symbolSellsNoLotId = sellsWithoutLotId.filter(
      s => toBaseSymbol(s.cryptocurrency) === symbol
    );
    
    for (const sell of symbolSellsNoLotId) {
      let remainingToDeduct = sell.amount;
      
      for (const buy of buys) {
        if (remainingToDeduct <= 0) break;
        
        const currentSold = lotSoldAmounts.get(buy.id) || 0;
        const availableInLot = buy.amount - currentSold;
        
        if (availableInLot > 0) {
          const deductAmount = Math.min(remainingToDeduct, availableInLot);
          lotSoldAmounts.set(buy.id, currentSold + deductAmount);
          remainingToDeduct -= deductAmount;
        }
      }
    }
    
    // Create open lot entries for lots with remaining amount
    for (const buy of buys) {
      const soldAmount = lotSoldAmounts.get(buy.id) || 0;
      const remainingAmount = buy.amount - soldAmount;
      
      if (remainingAmount > 0.00000001) { // Small epsilon for float comparison
        openLots.push({
          lotId: buy.id,
          symbol: symbol,
          originalAmount: buy.amount,
          soldAmount,
          remainingAmount,
          entryPrice: buy.price,
          entryValue: buy.total_value,
          remainingValue: remainingAmount * buy.price,
          entryDate: buy.executed_at,
        });
      }
    }
  });
  
  // Sort by entry date (oldest first - FIFO order)
  openLots.sort((a, b) => 
    new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
  );
  
  return openLots;
}

/**
 * Calculate net position from all trades (Σ BUYs - Σ SELLs)
 * This is used for quick position existence checks
 */
export function calculateNetPositionFromTrades(trades: TradeRow[], symbol: string): number {
  const normalizedSymbol = toBaseSymbol(symbol);
  let sumBuys = 0;
  let sumSells = 0;
  
  for (const trade of trades) {
    if (toBaseSymbol(trade.cryptocurrency) !== normalizedSymbol) continue;
    
    if (trade.trade_type === 'buy') {
      sumBuys += trade.amount;
    } else if (trade.trade_type === 'sell') {
      sumSells += trade.amount;
    }
  }
  
  return sumBuys - sumSells;
}

/**
 * Build SELL orders for closing open lots (FIFO order)
 * 
 * @param openLots - Open lots to close
 * @param amountToSell - Total amount to sell (will be distributed across lots FIFO)
 * @param currentPrice - Current market price (for reference, not stored)
 * @returns Array of SellOrder objects, one per lot being closed
 */
export function buildSellOrdersForLots(
  openLots: OpenLot[], 
  amountToSell: number,
  currentPrice: number
): SellOrder[] {
  const orders: SellOrder[] = [];
  let remaining = amountToSell;
  
  // Process lots in FIFO order (openLots should already be sorted)
  for (const lot of openLots) {
    if (remaining <= 0.00000001) break;
    
    // Take from this lot (up to its remaining amount)
    const takeAmount = Math.min(remaining, lot.remainingAmount);
    
    if (takeAmount > 0.00000001) {
      orders.push({
        lotId: lot.lotId,
        cryptocurrency: lot.symbol,
        amount: takeAmount,
        entryPrice: lot.entryPrice,
        entryValue: takeAmount * lot.entryPrice, // Pro-rata entry value
      });
      
      remaining -= takeAmount;
    }
  }
  
  return orders;
}

/**
 * Calculate P&L for a sell order against its lot
 */
export function calculateLotPnl(
  sellAmount: number,
  entryPrice: number,
  exitPrice: number
): { realizedPnl: number; realizedPnlPct: number } {
  const entryValue = sellAmount * entryPrice;
  const exitValue = sellAmount * exitPrice;
  const realizedPnl = exitValue - entryValue;
  const realizedPnlPct = entryValue > 0 ? (realizedPnl / entryValue) * 100 : 0;
  
  return {
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    realizedPnlPct: Math.round(realizedPnlPct * 100) / 100,
  };
}

/**
 * Debug helper: Log lot state
 */
export function logLotState(openLots: OpenLot[], context: string): void {
  console.log(`[LOT_ENGINE][${context}] Open lots:`, openLots.length);
  openLots.forEach((lot, i) => {
    console.log(`  [${i}] ${lot.symbol} lotId=${lot.lotId.substring(0, 8)}... remaining=${lot.remainingAmount.toFixed(8)} entry=€${lot.entryPrice.toFixed(2)}`);
  });
}

/**
 * Calculate pooled position summary from open lots
 * This aggregates lot-level data into symbol-level metrics for strategy decisions
 */
export interface PooledPositionSummary {
  symbol: string;
  totalRemainingAmount: number;
  totalEntryValue: number;
  averageEntryPrice: number;
  lotCount: number;
  oldestEntryDate: string;
  newestEntryDate: string;
}

export function calculatePooledSummary(openLots: OpenLot[]): Map<string, PooledPositionSummary> {
  const summaryBySymbol = new Map<string, PooledPositionSummary>();
  
  for (const lot of openLots) {
    const existing = summaryBySymbol.get(lot.symbol);
    
    if (existing) {
      existing.totalRemainingAmount += lot.remainingAmount;
      existing.totalEntryValue += lot.remainingAmount * lot.entryPrice;
      existing.lotCount += 1;
      if (lot.entryDate < existing.oldestEntryDate) {
        existing.oldestEntryDate = lot.entryDate;
      }
      if (lot.entryDate > existing.newestEntryDate) {
        existing.newestEntryDate = lot.entryDate;
      }
    } else {
      summaryBySymbol.set(lot.symbol, {
        symbol: lot.symbol,
        totalRemainingAmount: lot.remainingAmount,
        totalEntryValue: lot.remainingAmount * lot.entryPrice,
        averageEntryPrice: lot.entryPrice,
        lotCount: 1,
        oldestEntryDate: lot.entryDate,
        newestEntryDate: lot.entryDate,
      });
    }
  }
  
  // Calculate average entry prices
  summaryBySymbol.forEach((summary) => {
    summary.averageEntryPrice = summary.totalRemainingAmount > 0 
      ? summary.totalEntryValue / summary.totalRemainingAmount 
      : 0;
  });
  
  return summaryBySymbol;
}

/**
 * Log pooled position summary for debugging
 */
export function logPooledSummary(summaryBySymbol: Map<string, PooledPositionSummary>, context: string): void {
  console.log(`[LOT_ENGINE][POOLED][${context}] Pooled positions:`, summaryBySymbol.size);
  summaryBySymbol.forEach((summary, symbol) => {
    console.log(`  ${symbol}: ${summary.lotCount} lots, remaining=${summary.totalRemainingAmount.toFixed(8)}, avgPrice=€${summary.averageEntryPrice.toFixed(2)}, value=€${summary.totalEntryValue.toFixed(2)}`);
  });
}

/**
 * Enrich open lots with unrealized P&L and age
 * Used by engine to make per-lot decisions
 */
export function enrichLotsWithUnrealizedPnl(
  openLots: OpenLot[], 
  currentPrice: number,
  nowMs: number = Date.now()
): OpenLot[] {
  return openLots.map(lot => {
    const currentValue = lot.remainingAmount * currentPrice;
    const entryValue = lot.remainingAmount * lot.entryPrice;
    const unrealizedPnl = currentValue - entryValue;
    const unrealizedPnlPct = entryValue > 0 ? (unrealizedPnl / entryValue) * 100 : 0;
    const ageMs = nowMs - new Date(lot.entryDate).getTime();
    
    return {
      ...lot,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      unrealizedPnlPct: Math.round(unrealizedPnlPct * 100) / 100,
      ageMs,
    };
  });
}

/**
 * Build SELL orders for TP_SELECTIVE mode
 * Only closes lots that are:
 * - Individually profitable (P&L >= tpThresholdPct)
 * - Old enough (age >= minHoldMs)
 * - Uses FIFO order among qualifying lots
 * 
 * @param enrichedLots - Lots with unrealizedPnlPct and ageMs populated
 * @param tpThresholdPct - TP threshold in percent (e.g. 5 for 5%)
 * @param minHoldMs - Minimum hold period in milliseconds
 * @param maxAmount - Maximum total amount to sell (optional, defaults to all qualifying lots)
 */
export function buildSelectiveTpSellOrders(
  enrichedLots: OpenLot[],
  tpThresholdPct: number,
  minHoldMs: number,
  maxAmount?: number
): SellOrder[] {
  // Filter to only profitable lots meeting criteria
  const qualifyingLots = enrichedLots.filter(lot => {
    const meetsProfit = (lot.unrealizedPnlPct ?? 0) >= tpThresholdPct;
    const meetsAge = (lot.ageMs ?? 0) >= minHoldMs;
    return meetsProfit && meetsAge;
  });
  
  // Sort by entry date (FIFO - oldest profitable first)
  qualifyingLots.sort((a, b) => 
    new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
  );
  
  console.log(`[LOT_ENGINE][TP_SELECTIVE] Qualifying lots: ${qualifyingLots.length} of ${enrichedLots.length} (threshold=${tpThresholdPct}%, minHold=${minHoldMs}ms)`);
  
  const orders: SellOrder[] = [];
  let remaining = maxAmount ?? Infinity;
  
  for (const lot of qualifyingLots) {
    if (remaining <= 0.00000001) break;
    
    const takeAmount = Math.min(remaining, lot.remainingAmount);
    
    if (takeAmount > 0.00000001) {
      orders.push({
        lotId: lot.lotId,
        cryptocurrency: lot.symbol,
        amount: takeAmount,
        entryPrice: lot.entryPrice,
        entryValue: takeAmount * lot.entryPrice,
      });
      
      remaining -= takeAmount;
      
      console.log(`  [TP_SELECTIVE] Close lot ${lot.lotId.substring(0, 8)}... amount=${takeAmount.toFixed(8)} pnl=${lot.unrealizedPnlPct?.toFixed(2)}%`);
    }
  }
  
  return orders;
}

/**
 * Build SELL orders for SL_FULL_FLUSH mode
 * Closes ALL lots for a symbol (stop loss triggered)
 * Uses FIFO order
 */
export function buildFullFlushSellOrders(openLots: OpenLot[]): SellOrder[] {
  // Sort by entry date (FIFO)
  const sortedLots = [...openLots].sort((a, b) => 
    new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
  );
  
  console.log(`[LOT_ENGINE][SL_FULL_FLUSH] Flushing all ${sortedLots.length} lots`);
  
  return sortedLots.map(lot => ({
    lotId: lot.lotId,
    cryptocurrency: lot.symbol,
    amount: lot.remainingAmount,
    entryPrice: lot.entryPrice,
    entryValue: lot.remainingAmount * lot.entryPrice,
  }));
}

/**
 * Calculate pooled unrealized P&L for a symbol
 * Used to check pooled TP/SL thresholds
 */
export function calculatePooledUnrealizedPnl(
  openLots: OpenLot[], 
  currentPrice: number
): { unrealizedPnl: number; unrealizedPnlPct: number; totalEntryValue: number; totalCurrentValue: number } {
  let totalEntryValue = 0;
  let totalCurrentValue = 0;
  
  for (const lot of openLots) {
    totalEntryValue += lot.remainingAmount * lot.entryPrice;
    totalCurrentValue += lot.remainingAmount * currentPrice;
  }
  
  const unrealizedPnl = totalCurrentValue - totalEntryValue;
  const unrealizedPnlPct = totalEntryValue > 0 ? (unrealizedPnl / totalEntryValue) * 100 : 0;
  
  return {
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    unrealizedPnlPct: Math.round(unrealizedPnlPct * 100) / 100,
    totalEntryValue: Math.round(totalEntryValue * 100) / 100,
    totalCurrentValue: Math.round(totalCurrentValue * 100) / 100,
  };
}
