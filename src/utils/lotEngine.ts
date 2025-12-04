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
  strategy_id: string | null;
  trade_type: 'buy' | 'sell';
  cryptocurrency: string;
  amount: number;
  price: number;
  total_value: number;
  executed_at: string;
  is_test_mode?: boolean;
  original_trade_id?: string | null;
  original_purchase_amount?: number | null;
  original_purchase_value?: number | null;
  original_purchase_price?: number | null;
  exit_value?: number | null;
  realized_pnl?: number | null;
  realized_pnl_pct?: number | null;
}

export interface OpenLot {
  lotId: string;           // ID of the original BUY trade
  cryptocurrency: string;  // Base symbol (BTC, ETH, etc.)
  originalAmount: number;  // Amount from original BUY
  soldAmount: number;      // Total amount sold from this lot
  remainingAmount: number; // originalAmount - soldAmount
  entryPrice: number;      // Price from original BUY
  entryValue: number;      // Total value from original BUY
  entryDate: string;       // executed_at from original BUY
}

export interface ClosedLot {
  lotId: string;
  cryptocurrency: string;
  amount: number;
  entryPrice: number;
  entryValue: number;
  entryDate: string;
  exitPrice: number;
  exitValue: number;
  exitDate: string;
  realizedPnl: number;
  realizedPnlPct: number;
  sellTradeId: string;     // ID of the SELL trade that closed this lot
}

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
      let remainingToDeduct = sell.original_purchase_amount || sell.amount;
      
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
          cryptocurrency: symbol,
          originalAmount: buy.amount,
          soldAmount,
          remainingAmount,
          entryPrice: buy.price,
          entryValue: buy.total_value,
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
        cryptocurrency: lot.cryptocurrency,
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
    console.log(`  [${i}] ${lot.cryptocurrency} lotId=${lot.lotId.substring(0, 8)}... remaining=${lot.remainingAmount.toFixed(8)} entry=€${lot.entryPrice.toFixed(2)}`);
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
    const existing = summaryBySymbol.get(lot.cryptocurrency);
    
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
      summaryBySymbol.set(lot.cryptocurrency, {
        symbol: lot.cryptocurrency,
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
