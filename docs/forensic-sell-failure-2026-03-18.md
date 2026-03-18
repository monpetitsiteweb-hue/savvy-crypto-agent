# Forensic: Why SELLs Are Not Executing — 2026-03-18

## Executive Summary

**Every SELL attempt fails with `tp_execution_failed`.** The root cause is a **`ReferenceError: sc is not defined`** inside `executeTradeOrder()` at line 7075. This crashes every SELL execution path in the UD=ON coordinator flow.

## Evidence Chain

### PART 1 — SELL decisions ARE being generated ✅

The backend-shadow-engine correctly detects exit conditions and fires SELL intents:

```
20:32:57 🔥 LIVE: Executing SELL for AVAX via STOP_LOSS  (PnL -4.00%)
20:33:06 🔥 LIVE: Executing SELL for BTC via STOP_LOSS   (PnL -0.81%)
20:33:12 🔥 LIVE: Executing SELL for SOL via TAKE_PROFIT  (PnL +1.70%)
20:33:18 🔥 LIVE: Executing SELL for ADA via STOP_LOSS   (PnL -4.84%)
```

24h decision_events distribution:
| Reason | Count |
|---|---|
| DEFER:TAKE_PROFIT | 35 |
| DEFER:STOP_LOSS | 24 |
| DEFER:SELL_TRAILING_RUNNER | 13 |

**All 72 SELL decisions in 24h were DEFERRED. Zero executed.**

### PART 2 — SELLs are NOT blocked by guards ✅

The coordinator IS processing the SELL — it passes through:
- Phase S3 frontend block (bypassed: origin=BACKEND_LIVE) ✅
- UD mode detection (enableUnifiedDecisions=true → UD=ON path) ✅
- `detectConflicts()` position guard (position exists) ✅
- `evaluatePositionStatus()` (returns shouldSell=true for both TP and SL) ✅

The coordinator routes ALL exits to `executeTPSellWithLock()`.

### PART 3 — SELLs fail at EXECUTION (Root Cause) ❌

The coordinator response stored in decision_events metadata:
```sql
SELECT metadata->'coordinatorResponse'->>'reason' 
FROM decision_events WHERE side = 'SELL' AND created_at > NOW() - INTERVAL '6 hours';
-- ALL rows return: "tp_execution_failed"
```

`executeTPSellWithLock()` calls `executeTradeOrder()`, which fails.

### PART 4 — Root Cause: `ReferenceError: sc is not defined`

**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Line:** 7075  

```javascript
// Inside executeTradeOrder() (starts at line 6853)
const sellExecClass = deriveExecutionClass({
  source: intent.source,
  metadata: intent.metadata,
  strategyExecutionTarget: sc?.canonicalExecutionMode || 'MOCK',  // ← BUG
});
```

The variable `sc` is declared at **line 4419** inside `executeTradeDirectly()`:
```javascript
const sc = strategyConfig || {};  // line 4419 — inside executeTradeDirectly, NOT executeTradeOrder
```

`sc` does NOT exist in `executeTradeOrder()`. JavaScript optional chaining (`?.`) does NOT prevent `ReferenceError` for undeclared variables — it only handles `null`/`undefined` on declared variables.

**This throws `ReferenceError: sc is not defined`**, which is caught by the try/catch at line 6871, returning `{ success: false, error: "sc is not defined" }`. This propagates to `executeTPSellWithLock` line 8410: `{ action: "DEFER", reason: "tp_execution_failed" }`.

### Why BUYs work but SELLs don't

- BUYs go through `executeTradeOrder()` too, BUT the bug is at line 7063: `if (intent.side === "SELL")`. The `sc` reference is ONLY reached for SELL intents. BUY intents take the `if (intent.side === "BUY")` branch at line 6978 and never hit line 7075.

### Why this wasn't caught before

- The `executeTradeDirectly()` function (UD=OFF path, line 4405) has its own `sc = strategyConfig` at line 4419. When UD was OFF (before the `unifiedConfig` fix), SELLs went through `executeTradeDirectly` where `sc` exists.
- After `unifiedConfig` was fixed to read from `strategy.configuration.unifiedConfig`, UD=ON became active, routing SELLs to `executeTradeOrder()` instead — where `sc` was never defined.

## Classification

| # | Root Cause | Classification | Severity |
|---|---|---|---|
| 1 | `sc` undeclared in `executeTradeOrder()` at line 7075 | ❌ Bug | **CRITICAL** — blocks ALL SELLs |

## Open Positions (all stuck)

| Symbol | Entry Price | Current Price | PnL | Exit Triggered | Blocked By |
|---|---|---|---|---|---|
| BTC | €62,622 | €62,154 | -0.8% | SL ✅ | `tp_execution_failed` |
| ETH | €1,841 | €1,906 | +3.6% | Trailing ✅ | `tp_execution_failed` |
| SOL | €77.09 | €78.41 | +1.7% | TP ✅ | `tp_execution_failed` |
| XRP | €1.24 | €1.27 | +2.8% | Runner/Trail ✅ | `tp_execution_failed` |
| ADA | €0.250 | €0.239 | -4.8% | SL ✅ | `tp_execution_failed` |
| AVAX | €8.90 | €8.44 | -4.0% | SL ✅ | `tp_execution_failed` |

**Last successful SELL:** 2026-03-16 17:47 (ADA) — before the unifiedConfig fix activated UD=ON

## Fix (Minimal)

**One-line fix** — add `sc` declaration in `executeTradeOrder()`:

```javascript
// Line ~6876 in executeTradeOrder(), after strategyConfig is available:
const sc = strategyConfig || {};
```

Or replace `sc` with `strategyConfig` directly at line 7075:
```javascript
strategyExecutionTarget: strategyConfig?.canonicalExecutionMode || 'MOCK',
```

**No other changes needed.** The per-lot SELL logic, FIFO accounting, cash ledger, and position cleanup are all correct — they just never execute because the function crashes before reaching them.

## Verification After Fix

```sql
-- 1. SELL trades should appear
SELECT trade_type, COUNT(*) FROM mock_trades 
WHERE executed_at > NOW() - INTERVAL '2 hours' GROUP BY trade_type;

-- 2. tp_execution_failed should stop
SELECT reason, COUNT(*) FROM decision_events 
WHERE side = 'SELL' AND created_at > NOW() - INTERVAL '2 hours' GROUP BY reason;

-- 3. Open positions should decrease
SELECT COUNT(*) FROM mock_trades WHERE is_open_position = true;
```
