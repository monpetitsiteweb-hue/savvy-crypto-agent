# PATCH: logDecisionAsync Config Plumbing Fix

**Date:** 2026-02-26  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Status:** ✅ DEPLOYED

---

## Problem

`decision_events.metadata.is_test_mode` was logging `false` for successful STOP_LOSS executions (`reason = "no_conflicts_detected"`) while `raw_intent.metadata.is_test_mode` was `true`.

Root cause: three `logDecisionAsync` callsites in the main engine flow passed raw `strategy.configuration` as the `strategyConfig` argument. This object does **not** contain `canonicalIsTestMode`, so `logDecisionAsync` computed `strategyConfig?.canonicalIsTestMode === true` → `undefined === true` → `false`.

---

## Changes

### 1. Line 3758 — Circuit Breaker DEFER

**Before:**
```typescript
strategy.configuration,
```

**After:**
```typescript
{ ...strategy.configuration, canonicalIsTestMode },
```

Context: `logDecisionAsync` call with reason `"blocked_by_circuit_breaker"` in the pre-UD-split main flow.

---

### 2. Line 3824 — Signal Too Weak HOLD

**Before:**
```typescript
strategy.configuration,
```

**After:**
```typescript
{ ...strategy.configuration, canonicalIsTestMode },
```

Context: `logDecisionAsync` call with reason `"signal_too_weak"` in the confidence threshold gate.

---

### 3. Line 3952 — UD=ON Conflict DEFER

**Before:**
```typescript
strategy.configuration,
```

**After:**
```typescript
{ ...strategy.configuration, canonicalIsTestMode },
```

Context: `logDecisionAsync` call with reason from `conflictResult.reason` (e.g., `"no_position_found"`, `"hold_min_period_not_met"`, `"blocked_by_cooldown"`) in the unified-decisions-enabled conflict path.

---

### 4. Line ~1741 — UI TEST BUY Fast Path

**Before:** Inline config object without `canonicalIsTestMode`

**After:** Added `canonicalIsTestMode: true` (gated by `intent.metadata?.is_test_mode === true` at line 1607)

---

### 5. Line ~1806 — Debug/Forced Trade Config

**Before:** `debugStrategyConfig` without `canonicalIsTestMode`

**After:** Added `canonicalIsTestMode: true` (debug trades are always test mode)

---

### 6. Line ~2055 — Intelligent Engine Decision Log

**Before:** Inline config object without `canonicalIsTestMode`

**After:** Added `canonicalIsTestMode: intExecutionTarget === "MOCK"` (derived from `strategyConfig.execution_target` at line 1952)

Context: This is the callsite producing `no_conflicts_detected: STOP_LOSS`, `no_conflicts_detected: TAKE_PROFIT`, `no_conflicts_detected: SELL_TRAILING_RUNNER`, and `no_conflicts_detected: signal_confirmed_*` with `is_test_mode = false`.

---

### 7. Line ~2691 — Manual SELL Fast Path

**Before:** Inline config object without `canonicalIsTestMode`

**After:** Added `canonicalIsTestMode: true` (manual SELL fast path is gated by `mode === "mock"` at line 2435)

---

## Verification

After patch, ALL `logDecisionAsync` callsites include `canonicalIsTestMode` in the config object — either via spread (`{ ...strategy.configuration, canonicalIsTestMode }`) or inline property.

**Expected SQL result (post-deploy, 30 min window):**
```sql
SELECT DISTINCT metadata->>'is_test_mode'
FROM decision_events
WHERE created_at >= now() - interval '30 minutes';
-- Expected: only 'true'
```

---

## Scope

- ✅ Only `logDecisionAsync` argument plumbing changed
- ❌ No execution logic modified
- ❌ No gating logic modified
- ❌ No instrumentation added
- ❌ No other files touched
