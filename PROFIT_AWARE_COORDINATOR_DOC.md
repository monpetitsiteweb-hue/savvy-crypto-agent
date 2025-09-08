# Profit-Aware Coordinator - Milestone 1

## Overview
The Profit-Aware Coordinator adds intelligent SELL gating based on profit/loss thresholds, preventing premature exits from potentially profitable positions.

## New Reason Code

### `blocked_by_insufficient_profit`

**When it triggers**: SELL orders that don't meet any of the profit exit conditions:
- Take Profit threshold not reached
- Stop Loss threshold not triggered  
- Combined Edge/EUR/Confidence conditions not satisfied

**Configuration Parameters** (read from strategy config):
- `takeProfitPercentage` (default: 1.5) - Take profit threshold in %
- `stopLossPercentage` (default: 0.8) - Stop loss threshold in %  
- `minEdgeBpsForExit` (default: 8) - Minimum edge in basis points
- `minProfitEurForExit` (default: 0.20) - Minimum profit in EUR
- `confidenceThresholdForExit` (default: 0.60) - Minimum signal confidence

**SELL Gate Logic**:
```
Allow SELL if: (TP hit) OR (SL hit) OR (Edge AND EUR AND Confidence)
Otherwise: Return blocked_by_insufficient_profit
```

**Decision Log Metadata**:
```json
{
  "profitAnalysis": {
    "pnl_eur": 0.15,
    "edge_bps": 12.5,
    "confidence": 0.45,
    "tp_hit": false,
    "sl_hit": false,
    "thresholds": {
      "tp_pct": 1.5,
      "sl_pct": 0.8,
      "min_edge_bps": 8,
      "min_profit_eur": 0.20,
      "min_conf": 0.60
    },
    "conditions": {
      "edge_met": true,
      "eur_met": false,
      "confidence_met": false
    },
    "position": {
      "avg_purchase_price": 90000.00,
      "current_price": 90150.00,
      "pnl_pct": 0.17
    }
  }
}
```

## Impact
- **Prevents emotional trading**: Blocks SELL orders that don't meet objective profit criteria
- **Improves P&L**: Allows positions to run to meaningful profit levels
- **Risk management**: Still allows stop-loss exits to limit downside
- **Confidence-based**: High-confidence signals can override small profit requirements

## Testing
- ✅ Unit tests: TP path, SL path, Edge path, Block path
- ✅ Integration tests: Weak bearish + low confidence scenarios
- ✅ FIFO position calculation with partial sells

## Backward Compatibility
- Zero impact on existing unified decisions logic
- Only affects SELL orders when profit-aware config is present
- Graceful fallback to defaults if config missing