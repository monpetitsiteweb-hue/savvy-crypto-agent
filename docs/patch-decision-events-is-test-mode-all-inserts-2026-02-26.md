# PATCH: decision_events metadata.is_test_mode — Centralized buildDecisionMetadata helper

**Date:** 2026-02-26  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Status:** ✅ APPLIED  
**Type:** Logging-only — NO execution logic changed

---

## Problem

`decision_events.metadata.is_test_mode` was `NULL` for some rows despite previous patches adding `is_test_mode` to each insertion point individually. The per-site approach was fragile — any new insertion or metadata spread could silently omit the field.

## Solution: Centralized Helper

Created a single `buildDecisionMetadata()` helper function that **guarantees** `is_test_mode` is always a boolean (never NULL/undefined):

```typescript
function buildDecisionMetadata(
  base: Record<string, any>,
  isTestMode: boolean | undefined | null,
): Record<string, any> {
  return {
    ...base,
    // is_test_mode is set LAST so it cannot be overwritten by the spread
    is_test_mode: typeof isTestMode === 'boolean' ? isTestMode : false,
  };
}
```

### Key guarantees:
1. `is_test_mode` is **always** the last property — no spread can overwrite it
2. If `isTestMode` is `undefined` or `null`, defaults to `false` — never NULL in DB
3. ALL 12 insertion points now use this single helper

## All 12 insertion points — now using buildDecisionMetadata

| # | ~Line | Reason | isTestMode source |
|---|-------|--------|-------------------|
| 1 | ~668 | `cash_ledger_settle_failed` (BUY cash drift) | `meta?.isTestMode` |
| 2 | ~806 | `cash_ledger_settle_failed` (SELL cash drift) | `meta?.isTestMode` |
| 3 | ~2358 | `system_operator_execution_failed` | `false` (always real) |
| 4 | ~2403 | `system_operator_execution_submitted` | `false` (always real) |
| 5 | ~2628 | `cash_ledger_settle_failed` (manual SELL) | `true` (mock manual path) |
| 6 | ~3255 | `manual_execution_failed` | `false` (always real) |
| 7 | ~3301 | `manual_execution_submitted` | `false` (always real) |
| 8 | ~3419 | `real_execution_job_queued` | `false` (always real) |
| 9 | ~4608 | `cash_ledger_settle_failed` (direct UD-off) | `sc?.canonicalIsTestMode` |
| 10 | ~7548 | `cash_ledger_settle_failed` (per-lot SELL) | `strategyConfig?.canonicalIsTestMode` |
| 11 | ~7708 | `cash_ledger_settle_failed` (standard) | `strategyConfig?.canonicalIsTestMode` |
| 12 | ~5028 | ALL logDecisionAsync reasons (centralized) | `isTestMode` (resolved via fallback chain) |

## logDecisionAsync fallback chain (insertion #12)

Priority for resolving `isTestMode`:
1. `strategyConfig.canonicalIsTestMode` (boolean) — canonical source
2. `derivedOrigin === 'BACKEND_LIVE'` → `false`
3. `derivedEngineMode === 'LIVE'` → `false`
4. `derivedIsBackendEngine === true` → `false`
5. `intent.metadata.is_test_mode` (boolean) — direct intent flag
6. **Default `false`** — never NULL, never throw

## What Was NOT Changed

- ❌ No execution routing logic
- ❌ No gating logic
- ❌ No position queries
- ❌ No trade insert logic
- ❌ No UD logic
- ❌ No idempotency logic
- ❌ No `deriveExecutionClass` changes
- ❌ No new tables or columns

## Verification SQL

```sql
-- A) No NULLs
SELECT COUNT(*) AS null_count
FROM decision_events
WHERE created_at >= now() - interval '10 minutes'
  AND (metadata->>'is_test_mode' IS NULL);
-- Expected: 0

-- B) Only 'true' or 'false'
SELECT DISTINCT metadata->>'is_test_mode'
FROM decision_events
WHERE created_at >= now() - interval '10 minutes';
-- Expected: 'true' and/or 'false', never null

-- C) BACKEND_LIVE rows are 'false'
SELECT DISTINCT metadata->>'is_test_mode'
FROM decision_events
WHERE created_at >= now() - interval '10 minutes'
  AND metadata->>'origin' = 'BACKEND_LIVE';
-- Expected: only 'false'
```

## Confirmation

- ✅ `buildDecisionMetadata()` helper created — single source of truth
- ✅ `is_test_mode` is always the LAST property (cannot be overwritten by spread)
- ✅ All 12 insertion points use `buildDecisionMetadata()`
- ✅ No raw `metadata: { ... is_test_mode ... }` patterns remain in decision_events inserts
- ✅ Total coverage: 12/12 insertion points
