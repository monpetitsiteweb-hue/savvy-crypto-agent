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

## Verification

After patch, zero remaining instances of raw `strategy.configuration` passed to `logDecisionAsync`. All callsites now include `canonicalIsTestMode` in the config object.

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
