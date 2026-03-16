# Exit Pipeline Forensic Audit — 2026-03-16

## Executive Summary

**The exit logic IS working correctly.** The backend engine detects TP, SL, and trailing stops and generates SELL intents. However, **every single SELL intent fails at the coordinator execution stage** with `direct_execution_failed`. Zero SELL trades have been executed since the initial AVAX close on March 15.

## Evidence

### SELL decisions ARE being generated (24h window)

| Type | Count | Status |
|------|-------|--------|
| `no_conflicts_detected: TAKE_PROFIT` | 6 | Backend approved TP |
| `DEFER:TAKE_PROFIT` | 7 | Coordinator failed execution |
| `no_conflicts_detected: SELL_TRAILING_RUNNER` | 6 | Backend approved trailing |
| `DEFER:SELL_TRAILING_RUNNER` | 6 | Coordinator failed execution |
| `no_conflicts_detected: STOP_LOSS` | 1 (ADA) | Backend approved SL |
| `DEFER:STOP_LOSS` | 1 (ADA) | Coordinator failed execution |
| `HOLD_RUNNER` (bull override) | ~15 | Correct: holding in runner mode |
| `NO_EXIT` (pnl below TP) | ~6 | Correct: not yet at threshold |

**Every approved SELL was DEFERRED by the coordinator.** The coordinator response for all is:
```json
{ "action": "DEFER", "reason": "direct_execution_failed" }
```

### Exit thresholds ARE configured

From `trading_strategies.configuration`:
- `takeProfitPercentage: 0.7` (0.7% TP)
- `stopLossPercentage: 0.7` (0.7% SL)
- `trailingStopLossPercentage: 1` (1% trailing)
- `maxBullOverrideDurationMs: 14400000` (4 hours runner max)
- `minHoldPeriodMs: 120000` (2 min hold)

The backend adds `epsilonPnLBufferPct: 0.03`, so effective thresholds:
- **TP triggers at**: +0.73% PnL
- **SL triggers at**: -0.73% PnL

### Open positions status

| Symbol | Entry | Current | PnL | Exit triggered? |
|--------|-------|---------|-----|-----------------|
| BTC | €62,622 | €63,770 | +1.8% | YES (TP + Runner) |
| ETH | €1,841 | €1,973 | +7.2% | YES (TP + Runner) |
| SOL | €77.09 | €80.91 | +5.0% | YES (TP) |
| XRP | €1.24 | €1.29 | +4.1% | YES (TP + Runner) |
| ADA | €0.251 | €0.247 | -1.6% | YES (SL) |
| AVAX | €8.90 | €8.80 | -1.1% | YES (SL) |

All positions have triggered exit conditions. All were blocked by the coordinator.

## Root Cause Analysis

### Bug #1: `unifiedConfig` Resolution (CRITICAL)

**File**: `supabase/functions/trading-decision-coordinator/index.ts`, line 3684

```javascript
const unifiedConfig: UnifiedConfig = strategy.unified_config || {
    enableUnifiedDecisions: false, // ← ALWAYS USED
    ...
};
```

`strategy.unified_config` reads a non-existent column on the strategy row. The actual config is at `strategy.configuration.unifiedConfig.enableUnifiedDecisions = true`.

**Impact**: The coordinator ALWAYS uses the UD=OFF path (`executeTradeDirectly`), even though the user configured `enableUnifiedDecisions: true`.

This doesn't directly cause SELL failures (BUYs work via the same UD=OFF path), but it means the coordinator bypasses all its sophisticated gating logic (locks, conflict detection, etc.) for every trade.

### Bug #2: Spread Gate Blocks SELLs Only (CRITICAL)

**File**: `supabase/functions/trading-decision-coordinator/index.ts`, lines 4506-4524

In `executeTradeDirectly`, the spread gate is ONLY enforced for SELL operations:

```javascript
// Phase 3: Price freshness and spread gates (for SELL operations)
if (intent.side === "SELL") {
    if (priceData.spreadBps > spreadThresholdBps) {
        return { success: false, error: `spread_too_wide: ...` };
    }
}
```

The strategy has `spreadThresholdBps: 30` (0.30%). Coinbase EUR pairs routinely have spreads > 30 bps, especially for ADA-EUR, AVAX-EUR, and even BTC-EUR during off-hours.

**BUY trades are NOT subject to this check in the UD=OFF path**, which is why BUYs succeed but SELLs fail.

### Bug #3: Cash Ledger Settlement Kills SELL in Mock Mode

**File**: `supabase/functions/trading-decision-coordinator/index.ts`, lines 4718-4722

```javascript
if (!settleRes?.success) {
    if (sc?.canonicalIsTestMode === true) {
        return { success: false, error: "cash_ledger_settlement_failed" };
    }
}
```

Even if the SELL insert succeeds, if `settleCashLedger` fails for any reason, the function returns failure in test mode. The `settle_sell_trade` RPC has a `check_capital_access` function that could fail depending on auth context.

**Note**: This is a secondary cause. The spread gate (Bug #2) likely blocks before reaching this point.

## Answers to Your Questions

### Why are AVAX (-1.1%) and ADA (-1.7%) not sold?
- SL IS triggered (SL threshold = 0.73%)
- ADA had a `STOP_LOSS` decision approved by backend
- Coordinator failed execution with `direct_execution_failed`
- **Root cause**: Spread gate or cash ledger failure in coordinator

### Why are profitable trades not exiting after peak?
- TP IS triggered for ETH (+7.2%), SOL (+5.0%), XRP (+4.1%), BTC (+1.8%)
- Bull override (runner mode) correctly activates for high-signal coins
- When runner trailing stop fires → coordinator fails execution
- When TP fires without bull override → coordinator also fails execution
- **All exits are blocked by the same coordinator execution bug**

### Are TP/SL/trailing stop actually enabled?
**YES.** All three are configured and actively evaluating:
- TP: 0.7% + 0.03% buffer = 0.73%
- SL: 0.7% + 0.03% buffer = 0.73%
- Runner mode: activates when bullScore ≥ 0.4
- Trailing stop: 0.6% trail distance from peak
- Max runner duration: 4 hours

### Are exit decisions being generated but blocked?
**YES.** Every SELL decision is generated correctly by the backend but blocked by the coordinator's `executeTradeDirectly` function.

### Is exit logic working as designed or malfunctioning?
- **Backend exit evaluation**: ✅ Working correctly
- **Coordinator SELL execution**: ❌ Systematically failing

## Recommended Fixes

### Fix 1: Resolve unifiedConfig from correct path
```javascript
// BEFORE (broken):
const unifiedConfig = strategy.unified_config || { enableUnifiedDecisions: false, ... };

// AFTER (correct):
const unifiedConfig = strategy.configuration?.unifiedConfig || { enableUnifiedDecisions: false, ... };
```

### Fix 2: Relax spread gate for SELL or use context-aware thresholds
Option A: Use wider threshold for exits (recommended):
```javascript
const sellSpreadThreshold = spreadThresholdBps * 2; // 60 bps for exits
```

Option B: Use context-aware policy (from contextPolicyConfig.ts):
- TP exits: 25 bps threshold
- SL exits: 30 bps threshold (most relaxed)

Option C: Bypass spread gate for SL exits entirely (SL must execute regardless of spread).

### Fix 3: Don't fail SELL on cash ledger settlement failure
The SELL trade rows are already inserted before cash settlement. Returning failure after successful insert creates an inconsistency. Instead, log the settlement failure but return success.

## Decision Pipeline Status

```
Backend Engine (exit evaluation)     ✅ WORKING
  → Detects TP/SL/trailing stops
  → Generates SELL intents
  → Sends to coordinator

Coordinator (execution)              ❌ BROKEN
  → unifiedConfig misread → always UD=OFF
  → Spread gate blocks all SELLs
  → Cash ledger may also fail

Result: 0/25 SELL decisions executed
```
