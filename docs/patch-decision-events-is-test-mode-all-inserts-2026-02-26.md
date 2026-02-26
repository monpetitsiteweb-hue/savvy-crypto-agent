# PATCH: decision_events metadata.is_test_mode — ALL insertion points

**Date:** 2026-02-26  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Status:** ✅ APPLIED  
**Type:** Logging-only — NO execution logic changed

---

## Problem

`decision_events.metadata.is_test_mode` was `NULL` for some rows. Previous patches only fixed the `logDecisionAsync` fallback chain, but **11 other direct `.insert()` calls** bypass `logDecisionAsync` entirely and never set `is_test_mode`.

## Root Cause

The coordinator has **12 total `decision_events` insertion points**:
- 1 centralized via `logDecisionAsync` (line ~5082) — already fixed
- **11 direct `.from("decision_events").insert()` calls** — ALL missing `is_test_mode`

## Audit: All 12 insertion points

| # | Line | Reason | Path | is_test_mode source |
|---|------|--------|------|---------------------|
| 1 | ~644 | `cash_ledger_settle_failed` | BUY cash drift | `meta?.isTestMode ?? false` |
| 2 | ~792 | `cash_ledger_settle_failed` | SELL cash drift | `meta?.isTestMode ?? false` |
| 3 | ~2347 | `system_operator_execution_failed` | System operator error | `false` (always real) |
| 4 | ~2389 | `system_operator_execution_submitted` | System operator success | `false` (always real) |
| 5 | ~2616 | `cash_ledger_settle_failed` | Manual SELL cash | `true` (mock manual path) |
| 6 | ~3241 | `manual_execution_failed` | Manual real exec error | `false` (always real) |
| 7 | ~3284 | `manual_execution_submitted` | Manual real exec success | `false` (always real) |
| 8 | ~3402 | `real_execution_job_queued` | Real job queue | `false` (always real) |
| 9 | ~4592 | `cash_ledger_settle_failed` | Direct UD-off cash | `sc?.canonicalIsTestMode ?? false` |
| 10 | ~7531 | `cash_ledger_settle_failed` | Per-lot SELL cash | `strategyConfig?.canonicalIsTestMode ?? false` |
| 11 | ~7690 | `cash_ledger_settle_failed` | Standard cash | `strategyConfig?.canonicalIsTestMode ?? false` |
| 12 | ~5082 | ALL logDecisionAsync reasons | Centralized | Full fallback chain (already fixed) |

## Fix

Added `is_test_mode` to the `metadata` object of all 11 direct inserts, using the most accurate source available in each scope:
- Cash ledger paths: `meta?.isTestMode ?? false` or `canonicalIsTestMode ?? false`
- System operator / manual real: hardcoded `false` (these are always real execution)
- Manual mock SELL: hardcoded `true` (gated by mock path)

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

- ✅ Every `decision_events` insert in the file now includes `metadata.is_test_mode`
- ✅ `logDecisionAsync` (centralized path) has full fallback chain with default `false`
- ✅ All 11 direct inserts have explicit `is_test_mode` in metadata
- ✅ Total coverage: 12/12 insertion points
