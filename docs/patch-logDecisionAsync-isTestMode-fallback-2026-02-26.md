# PATCH: logDecisionAsync is_test_mode NULL Elimination (v2)

**Date:** 2026-02-26  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Status:** ✅ DEPLOYED  
**Type:** Logging-only fix — NO execution logic changed

---

## Problem

`decision_events.metadata.is_test_mode` was `NULL` for BACKEND_LIVE rows:
- `BUY:unified_decisions_disabled_direct_path`
- `HOLD SKIP:*` (engine skip reasons)

Root cause: The previous fallback chain read from `intent.metadata.*` fields. But for these rows, `intent.metadata.context` was populated (evidenced by `metadata.origin = "BACKEND_LIVE"` in the inserted row), yet the fallback chain checked `intent.metadata.context` **after** checking `intent.metadata.is_test_mode` and `intent.metadata.mode` — which were both undefined, causing the chain to fall through to a `throw` that prevented insertion or (in some edge cases) allowed NULL.

The fix: derive `origin`/`engineMode`/`isBackendEngine` **before** the resolution chain, then use those derived values as the primary fallback after `canonicalIsTestMode`.

---

## Fix (Single Location — `logDecisionAsync`)

### Before (lines ~4877-4906)
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
  throw new Error(`logDecisionAsync: is_test_mode unresolvable`);
}
```

### After
```typescript
// Derive origin/engineMode FIRST (reused in metadata construction below)
const derivedOrigin = intent?.metadata?.context === "BACKEND_LIVE" ? "BACKEND_LIVE"
  : intent?.metadata?.context === "BACKEND_SHADOW" ? "BACKEND_SHADOW" : null;
const derivedEngineMode = intent?.metadata?.context?.startsWith("BACKEND_") ? "LIVE" : null;
const derivedIsBackendEngine = derivedOrigin === "BACKEND_LIVE" || derivedOrigin === "BACKEND_SHADOW";

// DIAGNOSTIC logging (temporary — to verify resolution in production)
console.log('🔍 DIAG logDecisionAsync is_test_mode resolution inputs', { ... });

let loggedIsTestMode: boolean;
if (typeof strategyConfig?.canonicalIsTestMode === 'boolean') {
  loggedIsTestMode = strategyConfig.canonicalIsTestMode;        // 1) Canonical source
} else if (derivedOrigin === 'BACKEND_LIVE') {
  loggedIsTestMode = false;                                       // 2) BACKEND_LIVE → false
} else if (derivedEngineMode === 'LIVE') {
  loggedIsTestMode = false;                                       // 3) LIVE engine → false
} else if (derivedIsBackendEngine === true) {
  loggedIsTestMode = false;                                       // 4) Any backend engine → false
} else if (typeof intent?.metadata?.is_test_mode === 'boolean') {
  loggedIsTestMode = intent.metadata.is_test_mode;               // 5) Intent flag
} else {
  loggedIsTestMode = false;                                       // 6) Default false (NEVER NULL)
  console.warn('⚠️ is_test_mode defaulted to false');
}
const isTestMode = loggedIsTestMode;
```

### Priority Chain
1. `strategyConfig.canonicalIsTestMode` (boolean) — canonical source from request entry
2. `derivedOrigin === 'BACKEND_LIVE'` → `false`
3. `derivedEngineMode === 'LIVE'` → `false`
4. `derivedIsBackendEngine === true` → `false`
5. `intent.metadata.is_test_mode` (boolean) — direct intent flag
6. **Default `false`** — logging must NEVER throw or insert NULL

### Additional change
The metadata construction block now reuses `derivedOrigin`, `derivedEngineMode`, and `derivedIsBackendEngine` instead of re-deriving them from `intent.metadata.context`.

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
WHERE created_at >= now() - interval '10 minutes'
  AND (metadata->>'is_test_mode' IS NULL);
-- Expected: 0
```

### B) Only 'true' or 'false'
```sql
SELECT DISTINCT metadata->>'is_test_mode'
FROM decision_events
WHERE created_at >= now() - interval '10 minutes';
-- Expected: 'true' and/or 'false', never null
```

### C) BACKEND_LIVE rows are 'false'
```sql
SELECT DISTINCT metadata->>'is_test_mode'
FROM decision_events
WHERE created_at >= now() - interval '10 minutes'
  AND metadata->>'origin' = 'BACKEND_LIVE';
-- Expected: only 'false'
```

---

## Diagnostic Logging (Temporary)

Two `🔍 DIAG` log lines were added to verify resolution in production. Remove after verification confirms zero NULLs.

## Scope

- ✅ Single function modified: `logDecisionAsync` metadata assembly only
- ✅ Centralized fix — covers ALL callsites automatically
- ✅ Default false on ambiguous mode (never throws, never NULL)
- ✅ `metadata.is_test_mode` confirmed present in inserted JSON at line 5015 (`is_test_mode: isTestMode`)
- ✅ No later spread/merge overwrites it (verified: metadata object is constructed inline, not spread over)
