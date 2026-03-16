# Changelog — 2026-03-16: Position Guard Bypass for Backend-Driven Exits

**Date:** 2026-03-16  
**Scope:** Fix `detectConflicts()` falsely blocking SELL exits with `no_position_found`  
**Status:** Deployed  
**File Modified:** `supabase/functions/trading-decision-coordinator/index.ts`

---

## Problem

After deploying the exit fallthrough fix, SELL exits (TP/SL/TRAILING) were **still failing** with `DEFER`. The `[EXECUTION-FAILURE]` logs were never triggered because the failure occurred **before** execution — inside `detectConflicts()`.

### Root Cause

The `detectConflicts()` guard computes `netPosition` by summing all buy/sell amounts from `mock_trades`. For positions where a prior sell already existed (e.g. ADA had 1 buy + 1 sell from earlier), `netPosition` evaluated to `0.00000000`, causing the guard to return `{ hasConflict: true, reason: "no_position_found" }`.

This happened even though:
- The backend engine's `position_snapshot` showed an open position with `totalAmount > 0`
- The `is_open_position = true` flag was still set on the buy trade
- The backend correctly identified the exit signal (TP/SL)

**Flow before fix:**
```
Backend: SELL intent (SL triggered for ADA)
  → Coordinator: detectConflicts()
  → netPosition = sum(buys) - sum(sells) = 0
  → guardReport.positionNotFound = true
  → Returns { hasConflict: true, reason: "no_position_found" }
  → Coordinator returns DEFER
  → No SELL trade ever reaches executeTradeOrder()
```

---

## Changes Made

### Change 1: Backend Position Snapshot Resolution (lines ~6150–6169)

**Added** extraction of the backend's position snapshot from the intent metadata, plus classification of backend-driven exits:

```javascript
// NEW — Extract backend position snapshot
const intentTrigger = typeof intent.metadata?.trigger === "string" ? intent.metadata.trigger : "";
const exitTrigger = intent.metadata?.exit_trigger || intent.reason || intentTrigger || "UNKNOWN";
const backendPositionSnapshot = intent.metadata?.position_snapshot || null;
const backendSnapshotAmount = Number(
    backendPositionSnapshot?.totalAmount ??
    backendPositionSnapshot?.total_amount ??
    backendPositionSnapshot?.remainingAmount ??
    backendPositionSnapshot?.remaining_amount ??
    backendPositionSnapshot?.amount ??
    0,
);

// NEW — Classify whether this is a backend-driven exit
const isBackendDrivenExit =
    intentContext === "BACKEND_LIVE" ||
    intentContext.startsWith("BACKEND_") ||
    intentContext.startsWith("AUTO_") ||
    intentOrigin === "BACKEND_LIVE" ||
    ["TAKE_PROFIT", "STOP_LOSS", "TRAILING_STOP", "AUTO_CLOSE_TIME", "SELL_TRAILING_RUNNER"].includes(intentTrigger) ||
    ["TAKE_PROFIT", "STOP_LOSS", "TRAILING_STOP", "AUTO_CLOSE_TIME", "SELL_TRAILING_RUNNER"].includes(exitTrigger);

// NEW — Trust backend snapshot when it confirms position exists
const hasTrustedBackendPosition =
    isBackendDrivenExit && Number.isFinite(backendSnapshotAmount) && backendSnapshotAmount > 1e-8;
```

**Purpose:** Provides an alternative source of truth for position existence when the DB-based `netPosition` calculation produces a false negative.

---

### Change 2: Structured Guard Diagnostic Object (lines ~6170–6190)

**Added** a `guardDiagnostic` object logged at every guard decision point:

```javascript
const guardDiagnostic = {
    branch: "detectConflicts.positionNotFound.netPositionPrecheck",
    symbol: baseSymbol,
    requestId: intent.metadata?.backend_request_id || intent.idempotencyKey || "NOT_PROVIDED",
    backendRequestId: intent.metadata?.backend_request_id || "NOT_PROVIDED",
    context: intentContext || "NOT_PROVIDED",
    origin: intentOrigin || "NOT_PROVIDED",
    trigger: intentTrigger || "NOT_PROVIDED",
    exitTrigger,
    netPosition: netPosition.toFixed(8),
    tradesFoundCount: allTrades.length,
    buysFoundCount: allTrades.filter((t) => t.trade_type === "buy").length,
    sellsFoundCount: allTrades.filter((t) => t.trade_type === "sell").length,
    foundSymbolsInDB: [...new Set(allTrades.map((t) => t.cryptocurrency))],
    backendPositionSnapshot,
    backendSnapshotAmount: Number.isFinite(backendSnapshotAmount) ? backendSnapshotAmount.toFixed(8) : "INVALID",
    isBackendDrivenExit,
    hasTrustedBackendPosition,
    isPositionManagement,
    isTestMode,
};
```

**Purpose:** Full diagnostic context logged with every guard decision — equivalent to the `[EXECUTION-FAILURE]` structured logs but for the pre-execution guard stage.

---

### Change 3: Position Existence Guard Bypass (lines ~6194–6204)

**Before:**
```javascript
if (!isPositionManagement) {
    if (netPosition <= 0) {
        guardReport.positionNotFound = true;
        return { hasConflict: true, reason: "no_position_found", guardReport };
    }
}
```

**After:**
```javascript
if (!isPositionManagement) {
    if (netPosition <= 0) {
        if (hasTrustedBackendPosition) {
            // Backend confirms position exists — bypass the false-negative guard
            console.log("[COORD][GUARD][POSITION_NOT_FOUND_BYPASSED]", guardDiagnostic);
        } else {
            // No trusted backend evidence — block as before
            console.log("[COORD][GUARD][POSITION_NOT_FOUND]", guardDiagnostic);
            guardReport.positionNotFound = true;
            return { hasConflict: true, reason: "no_position_found", guardReport };
        }
    }
}
```

**What changed:** When `netPosition <= 0` but `hasTrustedBackendPosition` is `true`, the guard logs a bypass warning and **continues** to execution instead of returning a conflict. Non-backend SELLs (manual, unknown origin) still hit the original block.

---

### Change 4: Validated Position Amount for Downstream Use (line ~6240)

**Added:**
```javascript
const validatedPositionAmount = netPosition > 0
    ? netPosition
    : hasTrustedBackendPosition
        ? backendSnapshotAmount
        : 0;

console.log(
    `✅ COORDINATOR: SELL validated for ${baseSymbol} - position source=${
        hasTrustedBackendPosition && netPosition <= 0 ? "backend_snapshot" : "db_net_position"
    } net=${netPosition.toFixed(6)} effective=${validatedPositionAmount.toFixed(6)} hold period met`,
);
```

**Purpose:** When the guard is bypassed, downstream code uses `backendSnapshotAmount` as the effective position size instead of the incorrect `netPosition = 0`.

---

## Code NOT Changed

- `executeTradeOrder()` — unchanged
- `executeTradeDirectly()` — unchanged (spread gate fixes from prior deploy remain)
- `executeTPSellWithLock()` — unchanged (fallthrough fix from prior deploy remains)
- `settleCashLedger` — unchanged
- Hold period gate (STEP 2 in detectConflicts) — unchanged, still applies to all SELLs
- Cooldown gate — unchanged
- Database schema — no changes
- Backend shadow engine — no changes

---

## Architecture After Fix

```
Backend Engine (5min CRON)
    ↓ evaluates exit signals (TP/SL/trailing)
    ↓ builds SELL intent with position_snapshot
    ↓
Coordinator → detectConflicts()
    ↓ netPosition precheck
    ↓ IF netPosition <= 0 AND hasTrustedBackendPosition → BYPASS    ← FIX
    ↓ IF netPosition <= 0 AND !hasTrustedBackendPosition → BLOCK
    ↓ hold period gate (unchanged)
    ↓ cooldown gate (unchanged)
    ↓
    ↓ executeTradeDirectly() / executeTPSellWithLock()
    ↓ spread gate (SL=bypass, TP=2x)
    ↓ insert mock_trade SELL row
    ↓ settle cash ledger
    ↓
mock_trades: SELL row persisted
```

---

## Log Tags Added

| Tag | When |
|-----|------|
| `[COORD][GUARD][POSITION_NOT_FOUND_BYPASSED]` | Backend-driven exit bypasses netPosition=0 guard |
| `[COORD][GUARD][POSITION_NOT_FOUND]` | Non-backend SELL blocked by netPosition=0 (with full diagnostic) |

---

## Verification Results (Post-Deploy)

### ADA SELL executed successfully
```sql
-- mock_trades showed ADA sell row after deploy
-- open_positions count dropped from 6 to 5
-- DEFER:STOP_LOSS count stopped increasing
```

---

## How To Verify (Ongoing)

### 1. Check for guard bypass logs
```
[COORD][GUARD][POSITION_NOT_FOUND_BYPASSED] { symbol: "ADA", netPosition: "0.00000000", backendSnapshotAmount: "...", ... }
```

### 2. SELL trades appearing
```sql
SELECT cryptocurrency, trade_type, price, amount, executed_at
FROM mock_trades
WHERE trade_type = 'sell'
  AND executed_at > NOW() - INTERVAL '2 hours'
ORDER BY executed_at DESC;
```

### 3. DEFER reasons dropping
```sql
SELECT reason, COUNT(*) AS n
FROM decision_events
WHERE side = 'SELL'
  AND decision_ts > NOW() - INTERVAL '2 hours'
GROUP BY reason ORDER BY n DESC;
```

### 4. Open positions decreasing
```sql
SELECT COUNT(*) AS open_positions
FROM mock_trades
WHERE is_open_position = true;
```
