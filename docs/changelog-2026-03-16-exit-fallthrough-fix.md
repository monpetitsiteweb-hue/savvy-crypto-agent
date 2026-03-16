# Changelog — 2026-03-16: Exit Fallthrough Fix & Execution Instrumentation

**Date:** 2026-03-16  
**Scope:** Fix TP/SL SELL fallthrough bug + add structured execution failure logging  
**Status:** Deployed  
**File Modified:** `supabase/functions/trading-decision-coordinator/index.ts`

---

## Problem

After deploying the spread gate relaxation and cash settlement fixes, SELL exits were **still failing** with `DEFER:STOP_LOSS`, `DEFER:TAKE_PROFIT`, `DEFER:SELL_TRAILING_RUNNER`. No SELL trades appeared in `mock_trades`.

### Root Cause

The TP/SL override block at ~line 6374 called `getRecentTrades()` which only looks back **5 minutes**. All open positions were bought **6+ hours ago**, so `lastBuy` was always `null`. When `lastBuy` was null, the code **did not execute the SELL** — it silently fell through to the original BUY intent. The coordinator then tried to BUY (on an already-open position), hit `position_already_open`, and returned `DEFER`.

**Flow before fix:**
```
Backend: SELL intent (TP triggered for ADA)
  → Coordinator: TP override block checks getRecentTrades(5min)
  → lastBuy = null (bought 6h ago, outside window)
  → Falls through to original intent (BUY)
  → BUY hits position_already_open constraint
  → Returns DEFER:TAKE_PROFIT
  → No SELL trade ever inserted
```

---

## Changes Made

### Change 1: Fix `!lastBuy` Fallthrough (CRITICAL — ~line 6395)

**Before:**
```javascript
if (!lastBuy) {
    // No handling — silently fell through to original BUY intent
}
```

**After:**
```javascript
if (!lastBuy) {
    console.log("[EXIT_OVERRIDE] No recent buy found in short recent-trades window; executing TP SELL anyway to avoid BUY fallthrough", {
        symbol: baseSymbol,
        requestId,
        recentTradesWindowMs: 300000,
    });
    // Falls through to executeTPSellWithLock() instead of returning/falling to BUY
} else {
    const holdTime = Date.now() - new Date(lastBuy.executed_at).getTime();
    if (minHoldMs > 0 && holdTime < minHoldMs) {
        // ... existing hold period gate (unchanged)
        return { action: \"DEFER\", reason: \"hold_min_period_not_met\", ... };
    }
    if (cooldownMs > 0 && holdTime < cooldownMs) {
        console.log(`🎯 COORDINATOR: TP SELL bypassing cooldown`);
    }
}

// Now ALWAYS reaches this point when TP is triggered:
return await executeTPSellWithLock(supabaseClient, intent, tpEvaluation, config, requestId, lockKey, strategyConfig);
```

**What changed:** When `lastBuy` is not found in the 5-minute recent-trades window, the code now **logs and continues** to `executeTPSellWithLock()` instead of silently falling through to the original BUY intent. The `return await executeTPSellWithLock(...)` call at line ~6418 is now always reached when TP is triggered.

---

### Change 2: TP Evaluation Context Logging (~line 6381)

**Added:**
```javascript
console.log("[EXIT_OVERRIDE] TP evaluation context", {
    symbol: baseSymbol,
    requestId,
    originalIntentSide: intent.side,
    trigger: tpEvaluation?.metadata?.trigger || intent.metadata?.trigger || null,
    pnlPct: tpEvaluation.pnlPct,
    tpPct: tpEvaluation.tpPct,
    minHoldMs,
    cooldownMs,
    recentTradesCount: recentTrades.length,
    hasRecentBuyInWindow: !!lastBuy,
    recentTradeTypes: recentTrades.map((t) => t.trade_type),
});
```

**Purpose:** Visible in edge function logs. Shows exactly what the coordinator sees when evaluating a TP/SL exit — the symbol, PnL, threshold, whether a recent buy was found, and what intent side was originally sent.

---

### Change 3: Structured `[EXECUTION-FAILURE]` Logging (4 locations)

Added structured error logging at every `return { success: false }` point inside `executeTradeOrder()`:

#### Location A: Per-lot SELL insert failure (~line 7668)
```javascript
console.error("[EXECUTION-FAILURE]", {
    phase: "mock_trades_insert_per_lot",
    error: insertError.message,
    symbol: baseSymbol,
    spreadBps: priceData?.spreadBps ?? null,
    effectiveSpreadThresholdBps: ...,
    price: realMarketPrice,
    balance: null,
    intent: { side, source, reason, trigger, closeMode, qtySuggested },
    orderPayload: { lotCount, sellRowCount, firstLotId },
    exchangeResponse: null,
});
```

#### Location B: Per-lot cash ledger settlement failure (~line 7734)
```javascript
console.error("[EXECUTION-FAILURE]", {
    phase: "cash_ledger_settlement_per_lot",
    error: cashResult.error,
    symbol: baseSymbol,
    spreadBps: ...,
    effectiveSpreadThresholdBps: ...,
    price: realMarketPrice,
    balance: cashResult.cash_before ?? null,
    intent: { side, source, reason, trigger, closeMode, qtySuggested },
    orderPayload: { lotCount, insertedTradeId, totalExitValue },
    exchangeResponse: null,
});
```

#### Location C: Standard insert — `position_already_open` (~line 7860)
```javascript
console.error("[EXECUTION-FAILURE]", {
    phase: "mock_trades_insert_standard",
    error: "position_already_open",
    symbol: baseSymbol,
    spreadBps: ...,
    effectiveSpreadThresholdBps: ...,
    price: realMarketPrice,
    balance: null,
    intent: { side, source, reason, trigger, closeMode, qtySuggested },
    orderPayload: { trade_type, amount, total_value, cryptocurrency },
    exchangeResponse: error,
});
```

#### Location D: Standard insert — generic error (~line 7888)
```javascript
console.error("[EXECUTION-FAILURE]", {
    phase: "mock_trades_insert_standard",
    error: error.message,
    symbol: baseSymbol,
    spreadBps: ...,
    effectiveSpreadThresholdBps: ...,
    price: realMarketPrice,
    balance: null,
    intent: { side, source, reason, trigger, closeMode, qtySuggested },
    orderPayload: { trade_type, amount, total_value, cryptocurrency },
    exchangeResponse: error,
});
```

**All four locations log the same structured fields:**

| Field | Purpose |
|-------|---------|
| `phase` | Which execution step failed |
| `error` | The error message or constraint name |
| `symbol` | Trading pair (base symbol) |
| `spreadBps` | Actual spread at execution time |
| `effectiveSpreadThresholdBps` | Threshold used (or "BYPASS" for SL) |
| `price` | Market price used |
| `balance` | Cash balance if available |
| `intent` | Side, source, reason, trigger, closeMode, qty |
| `orderPayload` | What was sent to the DB |
| `exchangeResponse` | Raw DB/exchange error |

---

## Files NOT Modified

- `supabase/functions/backend-shadow-engine/index.ts` — unchanged
- `executeTradeDirectly()` spread gate logic — unchanged (already fixed in prior deploy)
- `logDecisionAsync` — unchanged
- `settleCashLedger` — unchanged (already non-blocking from prior deploy)
- Database schema — no changes

---

## Architecture After Fix

```
Backend Engine (5min CRON)
    ↓ evaluates exit signals
    ↓ builds SELL intent
    ↓
Coordinator
    ↓ TP/SL override detects exit trigger
    ↓ getRecentTrades(5min) → lastBuy may be null
    ↓ IF lastBuy is null → logs warning, continues to SELL    ← FIX
    ↓ IF lastBuy exists → checks hold period gate
    ↓ executeTPSellWithLock() → executeTradeOrder()
    ↓ spread gate (SL=bypass, TP=2x, other=base)
    ↓ insert mock_trade SELL row
    ↓ settle cash ledger (failure = warning only)
    ↓ [EXECUTION-FAILURE] logs at every failure point         ← INSTRUMENTATION
    ↓
mock_trades: SELL row persisted
```

---

## How To Verify

### 1. Check edge function logs for `[EXIT_OVERRIDE]`
```
[EXIT_OVERRIDE] TP evaluation context { symbol: \"ADA\", hasRecentBuyInWindow: false, ... }
[EXIT_OVERRIDE] No recent buy found in short recent-trades window; executing TP SELL anyway
```

### 2. Check for `[EXECUTION-FAILURE]` (expect none after fix)
Any remaining failures will now show the exact phase and all diagnostic fields.

### 3. SELL trades in mock_trades
```sql
SELECT COUNT(*) AS sell_trades_last_2h
FROM mock_trades
WHERE trade_type = 'sell'
  AND executed_at > NOW() - INTERVAL '2 hours';
```

### 4. DEFER reasons should drop
```sql
SELECT decision_reason, COUNT(*)
FROM decision_events
WHERE side = 'SELL'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY 2 DESC;
```

Expected: `DEFER:TAKE_PROFIT` and `DEFER:STOP_LOSS` counts should stop increasing.
