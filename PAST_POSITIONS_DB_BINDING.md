# Past Positions DB Binding & Safety Guard Implementation

## Changes Made

### Scope A: Past Positions UI (Exact DB Truth)

**Files Modified:**
- `src/components/TradingHistory.tsx` (lines 442-500)

**Binding Changes:**
- **Purchase Price**: For past positions (SELL trades), now binds to `trade.original_purchase_price` instead of `performance.purchasePrice`
- **Exit Price**: For past positions, now binds directly to `trade.price` instead of `performance.currentPrice`
- **Exit Value**: Now binds to `trade.exit_value || trade.total_value` instead of computed performance values
- **Realized P&L**: For past positions, now binds directly to `trade.realized_pnl` from DB instead of client-side calculations

**Test Coverage:**
- `cypress/e2e/past-positions-db-binding.cy.ts` - Tests exact BUY 94,981.81 → SELL 94,899.35 scenario
- Verifies rendered strings differ and P&L equals DB value (-€0.04)

### Scope B: Safety Guard Against Weak Exits

**Files Modified:**
- `src/hooks/useIntelligentTradingEngine.tsx` (lines 335-343 replaced with 335-379)

**Safety Logic:**
```typescript
// Block SELL if:
// - Realized P&L < -€0.05 AND
// - No strong technical sell signals AND
// - Not stop-loss or take-profit trigger
if (realizedPnlEur < -0.05 && !technicalSellSignal) {
  // Log as 'preblocked_negative_pnl' and return null
}
```

**Decision Logging:**
- Blocked exits logged to `trade_decisions_log` with reason `preblocked_negative_pnl`
- Technical overrides logged as `technical_signal_override`

**Test Coverage:**
- `src/hooks/__tests__/useIntelligentTradingEngine.test.ts` - Unit tests for safety guard logic
- Tests low-confidence scenarios, technical overrides, and P&L calculations

## 1:1 DB Mapping Summary

| UI Field | Past Positions (SELL) Binding | Open Positions (BUY) Binding |
|----------|------------------------------|------------------------------|
| Purchase Price | `trade.original_purchase_price` | `trade.price` |
| Exit Price | `trade.price` | `performance.currentPrice` |
| Exit Value | `trade.exit_value \|\| trade.total_value` | `performance.currentValue` |
| P&L (€) | `trade.realized_pnl` | `performance.gainLoss` |

**Key Benefits:**
1. Past positions show exact historical data from database snapshots
2. No client-side P&L recalculation for closed trades
3. Formatting (2 decimals) applied only at render time
4. Safety guard prevents weak bearish exits with minimal confidence

## Next Steps (Milestone 1)
- Implement profit-aware coordinator with strategy threshold enforcement
- Add comprehensive confidence-based blocking with reason codes
- Integrate P&L requirements directly into coordinator decision logic