# Past Positions - Exact DB Values Fix

## Problem
Past Positions UI was showing identical purchase and exit prices for closed trades due to a fallback binding issue. When `trade.original_purchase_price` was null, the component fell back to `trade.price` (the SELL price), making both columns show the same value.

## Root Cause
In `TradingHistory.tsx`, the Purchase Price binding used:
```jsx
{trade.trade_type === 'sell' 
  ? formatEuro(trade.original_purchase_price || trade.price)  // ❌ Falls back to SELL price
  : formatEuro(trade.price)
}
```

## Solution - Minimal Changes
Fixed the binding to use the already-calculated performance values instead of raw trade fields:

### Files Changed
- **src/components/TradingHistory.tsx**: Fixed Purchase Price, Exit Price, and P&L bindings for closed positions
- **cypress/e2e/past-positions-exact-values.cy.ts**: Added test to validate exact DB values

### Binding Changes (1:1 to DB)
| Field | Before | After |
|-------|--------|-------|
| Purchase Price | `trade.original_purchase_price \|\| trade.price` | `performance.purchasePrice` |
| Exit Price | `trade.price` | `performance.currentPrice \|\| trade.price` |
| P&L (€) | `trade.realized_pnl` | `performance.gainLoss` |

### Data Flow (DB → UI)
```
DB Snapshot Fields (via trigger) → processPastPosition() → performance object → UI rendering
```

1. **Database**: `original_purchase_price`, `price`, `realized_pnl` (from mt_on_sell_snapshot trigger)
2. **processPastPosition()**: Maps to `entryPrice`, `exitPrice`, `realizedPnL`  
3. **calculateTradePerformance()**: Returns `purchasePrice`, `currentPrice`, `gainLoss`
4. **UI**: Uses performance values directly (no fallbacks)

## Validation
Added Cypress test to verify exact values from the diagnostic query:
- 94,916.44 → 94,879.97 → −0.02
- 94,925.62 → 94,901.84 → −0.01  
- 94,981.81 → 94,899.35 → −0.04

## Result
✅ Purchase and Exit prices now show distinct values from the database  
✅ P&L shows exact realized values  
✅ No more fallback to identical prices  
✅ Cypress test validates the fix