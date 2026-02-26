# PATCH: logDecisionAsync is_test_mode NULL Elimination

**Date:** 2026-02-26  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Status:** ✅ DEPLOYED  
**Type:** Logging-only fix — NO execution logic changed

---

## Problem

`decision_events.metadata.is_test_mode` was `NULL` for certain rows, specifically:
- `BUY:unified_decisions_disabled_direct_path`
- `HOLD SKIP:*` (engine skip reasons)

These paths had `raw_intent = {}` (empty object), so `raw_intent->metadata->is_test_mode` was always missing. The root cause was that `logDecisionAsync` derived `isTestMode` via:

```typescript
const isTestMode = strategyConfig?.canonicalIsTestMode === true;
```

When `strategyConfig` was `undefined` or lacked `canonicalIsTestMode`, this silently evaluated to `false` — but the real issue was that for BACKEND_LIVE engine logs, no `strategyConfig` was passed at all, yielding `undefined === true → false` (or in some paths, the config simply wasn't augmented).

---

## Fix (Single Location)

**Line ~4879** in `logDecisionAsync` — replaced the single-source derivation with a cascading fallback chain:

### Before
```typescript
const isTestMode = strategyConfig?.canonicalIsTestMode === true;
```

### After
```typescript
let loggedIsTestMode: boolean;
if (typeof strategyConfig?.canonicalIsTestMode === 'boolean') {
  loggedIsTestMode = strategyConfig.canonicalIsTestMode;
} else if (typeof intent?.metadata?.is_test_mode === 'boolean') {
  loggedIsTestMode = intent.metadata.is_test_mode;
} else if (intent?.metadata?.mode === 'mock') {
  loggedIsTestMode = true;
} else if (intent?.metadata?.mode === 'real') {
  loggedIsTestMode = false;
} else if (intent?.metadata?.context === 'BACKEND_LIVE') {
  loggedIsTestMode = false;
} else {
  // FAIL-CLOSED: throw to prevent NULL insertion
  throw new Error(`logDecisionAsync: is_test_mode unresolvable`);
}
const isTestMode = loggedIsTestMode;
```

### Priority Chain
1. `strategyConfig.canonicalIsTestMode` (boolean) — canonical source from request entry
2. `intent.metadata.is_test_mode` (boolean) — direct intent flag
3. `intent.metadata.mode === 'mock'` → `true`; `'real'` → `false`
4. `intent.metadata.context === 'BACKEND_LIVE'` → `false`
5. **FAIL-CLOSED**: throws with diagnostic context (prevents silent NULL)

---

## What Was NOT Changed

- ❌ No execution routing logic
- ❌ No gating logic
- ❌ No position queries
- ❌ No trade insert logic
- ❌ No UD (unified decisions) logic
- ❌ No idempotency logic
- ❌ No `deriveExecutionClass` changes
- ❌ No `raw_intent` storage behavior changes
- ❌ No new tables or columns

---

## Verification SQL

### A) No NULLs
```sql
SELECT COUNT(*) AS null_count
FROM decision_events
WHERE created_at >= now() - interval '30 minutes'
  AND (metadata->>'is_test_mode' IS NULL);
-- Expected: 0
```

### B) Only 'true' or 'false'
```sql
SELECT DISTINCT metadata->>'is_test_mode'
FROM decision_events
WHERE created_at >= now() - interval '30 minutes';
-- Expected: 'true' and/or 'false', never null
```

### C) BACKEND_LIVE rows are 'false'
```sql
SELECT DISTINCT metadata->>'is_test_mode'
FROM decision_events
WHERE created_at >= now() - interval '30 minutes'
  AND reason LIKE '%unified_decisions_disabled_direct_path%';
-- Expected: only 'false'
```

---

## Scope

- ✅ Single function modified: `logDecisionAsync` metadata assembly only
- ✅ Centralized fix — covers ALL callsites automatically
- ✅ Fail-closed on ambiguous mode (throws instead of inserting NULL)
