# Lot and Pooling Model Documentation

## Overview

The trading system uses a **dual-view architecture**:
- **Lot-level**: Each BUY is an independent lot; each SELL closes specific lots
- **Pooled-level**: Aggregated positions per symbol for strategy decisions

This document defines the canonical contracts between the Engine, Coordinator, and UI.

---

## Definitions

### Lot
A **lot** is a single BUY row in `mock_trades`:
- Has a unique `id` (UUID)
- Contains `cryptocurrency`, `amount`, `price`, `total_value`, `executed_at`
- A lot is **open** if `Σ(SELL amounts with original_trade_id = lot.id) < lot.amount`
- A lot is **closed** when `Σ(SELL amounts with original_trade_id = lot.id) >= lot.amount`

### Pooled Position
A **pooled position** is the aggregation of all lots for a given symbol:
```
PooledPosition(user, strategy, symbol) = Σ(open lots) = Σ(BUYs) - Σ(SELLs)
```

---

## System Components

### 1. Engine (`useIntelligentTradingEngine.tsx`)
**Role**: Pooled-level reasoning and decision making

**Responsibilities**:
- Calculate `PooledPosition` per symbol via `calculateOpenPositions()`
- Make BUY/SELL decisions based on:
  - Pooled exposure
  - Pooled P&L
  - Technical signals
  - Risk management (max coins, max exposure)
- Emit trade intents to the Coordinator

**Key Behavior**:
- Engine **never** performs lot-level math
- Engine **always** works with pooled positions
- When triggering a SELL (AUTO_CLOSE, TP, SL), emits `Contract 2` (symbol-level close)

### 2. Coordinator (`trading-decision-coordinator/index.ts`)
**Role**: Per-lot execution and database writes

**Responsibilities**:
- Receive trade intents from Engine
- For SELLs: Resolve pooled intent into per-lot operations
- Apply guards (hold period, cooldown, spread, liquidity)
- Insert `mock_trades` rows with proper linking

**Key Behavior**:
- Implements both `Contract 1` and `Contract 2`
- Uses FIFO ordering for lot selection
- Every SELL row includes `original_trade_id`
- Computes per-lot P&L

### 3. UI (`TradingHistory.tsx`)
**Role**: Display lots and pooled summaries

**Responsibilities**:
- **Open Positions**: Show individual open lots
- **Past Positions**: Show individual closed lots (SELL trades)
- **Portfolio Summary**: Show pooled metrics

---

## SELL Contracts

### Contract 1: Lot-Level SELL
**Use Case**: Manual close of a specific lot (UI-initiated)

**Intent Fields**:
```typescript
{
  userId: string,
  strategyId: string,
  symbol: string,              // e.g., "BTC-EUR"
  side: "SELL",
  source: "manual",
  qtySuggested: number,        // Amount to sell from this lot
  metadata: {
    originalTradeId: string,   // REQUIRED: ID of the BUY lot
    context: "MANUAL",
    // ... other metadata
  }
}
```

**Coordinator Behavior**:
1. Locate the BUY trade by `originalTradeId`
2. Validate: position is open, `qty <= remaining`
3. Insert ONE SELL row with:
   - `original_trade_id = originalTradeId`
   - Per-lot P&L fields

### Contract 2: Symbol-Level CLOSE (Pooling)
**Use Case**: Engine-triggered close (AUTO_CLOSE, TP, SL, TECHNICAL_SIGNAL)

**Intent Fields**:
```typescript
{
  userId: string,
  strategyId: string,
  symbol: string,              // e.g., "BTC-EUR"
  side: "SELL",
  source: "intelligent",
  qtySuggested: number,        // Total amount to close across all lots
  reason: string,              // "AUTO_CLOSE_TIME" | "TAKE_PROFIT" | etc.
  metadata: {
    // NO originalTradeId - this is symbol-level
    // ... other metadata
  }
}
```

**Coordinator Behavior**:
1. Fetch all BUY trades for (user, strategy, symbol)
2. Calculate sold amounts per lot (via `original_trade_id` links)
3. Reconstruct open lots with remaining amounts
4. Apply FIFO: Build per-lot sell orders until `qtySuggested` is satisfied
5. Insert **N SELL rows** (one per lot being closed):
   - Each row has `original_trade_id = lotId`
   - Each row has per-lot P&L fields

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         ENGINE                                   │
│  calculateOpenPositions() → Pooled positions per symbol         │
│  getSellDecision() → Decides if SELL needed                     │
│  executeSellOrder() → Emits Contract 2 intent                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       COORDINATOR                                │
│  Receives intent → Applies guards → Resolves to per-lot         │
│  Branch D: reconstructs open lots → FIFO split                  │
│  Inserts N SELL rows with original_trade_id                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      mock_trades TABLE                           │
│  BUY rows (lots)                                                │
│  SELL rows (each linked to a lot via original_trade_id)         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                          UI                                      │
│  Open Positions: buildFifoLots() → shows open lots              │
│  Past Positions: SELL trades → shows closed lots                │
│  Portfolio Summary: aggregated metrics                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Lot Reconstruction Algorithm (FIFO)

Used by both Coordinator and UI:

```typescript
function reconstructOpenLots(trades: TradeRow[], symbol: string): OpenLot[] {
  // 1. Get all BUYs for symbol, sorted by executed_at (oldest first)
  const buys = trades
    .filter(t => t.trade_type === 'buy' && normalize(t.cryptocurrency) === symbol)
    .sort((a, b) => new Date(a.executed_at) - new Date(b.executed_at));

  // 2. Calculate sold amount per lot (from SELLs with original_trade_id)
  const soldByLotId = new Map<string, number>();
  trades
    .filter(t => t.trade_type === 'sell' && t.original_trade_id)
    .forEach(sell => {
      const current = soldByLotId.get(sell.original_trade_id) || 0;
      soldByLotId.set(sell.original_trade_id, current + sell.amount);
    });

  // 3. Handle legacy SELLs (without original_trade_id) via FIFO deduction
  const legacySells = trades.filter(t => t.trade_type === 'sell' && !t.original_trade_id);
  let legacyRemaining = legacySells.reduce((sum, s) => sum + s.amount, 0);

  // 4. Build open lots
  const openLots: OpenLot[] = [];
  for (const buy of buys) {
    let soldFromLot = soldByLotId.get(buy.id) || 0;

    // Deduct legacy sells (FIFO)
    if (legacyRemaining > 0) {
      const deduct = Math.min(legacyRemaining, buy.amount - soldFromLot);
      soldFromLot += deduct;
      legacyRemaining -= deduct;
    }

    const remaining = buy.amount - soldFromLot;
    if (remaining > 0.00000001) {
      openLots.push({
        lotId: buy.id,
        cryptocurrency: symbol,
        originalAmount: buy.amount,
        soldAmount: soldFromLot,
        remainingAmount: remaining,
        entryPrice: buy.price,
        entryValue: buy.total_value,
        entryDate: buy.executed_at,
      });
    }
  }

  return openLots;
}
```

---

## P&L Calculation

### Per-Lot P&L (on SELL)
```typescript
const entryValue = sellAmount * entryPrice;
const exitValue = sellAmount * exitPrice;
const realizedPnl = exitValue - entryValue;
const realizedPnlPct = (realizedPnl / entryValue) * 100;
```

### Pooled P&L (for display)
```typescript
const pooledUnrealizedPnl = openLots.reduce((sum, lot) => {
  const currentValue = lot.remainingAmount * currentPrice;
  const entryValue = lot.remainingAmount * lot.entryPrice;
  return sum + (currentValue - entryValue);
}, 0);

const pooledRealizedPnl = sellTrades.reduce((sum, sell) => 
  sum + (sell.realized_pnl || 0), 0);
```

---

## Database Schema (mock_trades)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (lot ID for BUYs) |
| `user_id` | UUID | Owner |
| `strategy_id` | UUID | Associated strategy |
| `trade_type` | TEXT | 'buy' or 'sell' |
| `cryptocurrency` | TEXT | Base symbol (BTC, ETH, etc.) |
| `amount` | NUMERIC | Quantity |
| `price` | NUMERIC | Execution price |
| `total_value` | NUMERIC | amount × price |
| `executed_at` | TIMESTAMPTZ | Execution timestamp |
| `is_test_mode` | BOOLEAN | Test vs live mode |
| `original_trade_id` | UUID | **Links SELL to BUY lot** |
| `original_purchase_amount` | NUMERIC | Amount from original BUY |
| `original_purchase_price` | NUMERIC | Price from original BUY |
| `original_purchase_value` | NUMERIC | Value from original BUY |
| `exit_value` | NUMERIC | SELL value |
| `realized_pnl` | NUMERIC | Profit/Loss for this lot |
| `realized_pnl_pct` | NUMERIC | P&L percentage |

---

## Invariants (MUST be maintained)

1. **Every SELL after this commit has `original_trade_id`**
   - Legacy SELLs without it are handled via FIFO fallback

2. **Engine never sets `originalTradeId` in metadata** (except manual close)
   - Engine emits Contract 2 for automated closes

3. **Coordinator always resolves to per-lot SELLs**
   - Even symbol-level intents produce N SELL rows

4. **UI derives everything from mock_trades**
   - No secondary position tables
   - Consistent with Engine and Coordinator views

5. **Pooled metrics = Σ(lot metrics)**
   - Zero drift guaranteed by single source of truth

---

## Test Scenarios

### 1. Multiple Lot AUTO_CLOSE
- Setup: 4 BUYs for BTC at different times/prices
- Action: Engine triggers AUTO_CLOSE_TIME
- Expected: 4 SELL rows, each with `original_trade_id`, individual P&L

### 2. Partial Pooled CLOSE
- Setup: 3 lots totaling 0.015 BTC
- Action: Emit SELL with `qtySuggested = 0.010`
- Expected: FIFO - closes oldest lots first, may partially close one lot

### 3. Manual Lot-Level Close
- Setup: Multiple lots
- Action: UI SELL button with `originalTradeId`
- Expected: Single SELL row closing exactly that lot

### 4. Hold Period Failure
- Setup: Fresh BUY (under minHoldPeriod)
- Action: SELL intent
- Expected: Blocked with reason `hold_min_period_not_met`

### 5. No Position Failure
- Setup: No BUYs or fully sold
- Action: SELL intent
- Expected: Blocked with reason `no_position_found`

### 6. Legacy SELL Isolation
- Setup: Old SELLs without `original_trade_id`
- Action: Fetch open positions
- Expected: FIFO correctly deducts legacy sells from oldest lots
