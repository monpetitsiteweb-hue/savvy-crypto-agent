# Fix: Decision Snapshot Orphans (decision_events without snapshots)

**Date:** 2026-03-27  
**Status:** Deployed  
**Severity:** Critical observability gap

---

## Problem

Some `decision_events` rows were created WITHOUT corresponding `decision_snapshots`. This was still happening in production (not historical-only).

**Recent orphans before fix:**
- `e88f7bc8` (2026-03-27 08:41) — BTC, `fusion_below_threshold`
- `55aa6e86` (2026-03-27 04:10) — AVAX, `fusion_below_threshold`
- 3 more from the same 04:10 cycle (SOL, ETH, BTC)

---

## Root Cause Analysis

Two categories of missing snapshots identified:

### Category A: Fire-and-forget `logDecisionAsync` calls (9 call sites)

`logDecisionAsync` was called WITHOUT `await` in 9 locations. The function returned a response immediately, and the snapshot write raced with the Edge Function lifecycle. If the function shut down before the async write completed, the snapshot was lost.

**Affected paths:**
| Line (original) | Reason | Path |
|---|---|---|
| 3751 | `fusion_below_threshold` | Fusion gate HOLD |
| 3821 | `unified_decisions_disabled_direct_path` | UD=OFF success |
| 3855 | `direct_execution_failed` | UD=OFF failure |
| 3939 | `blocked_by_circuit_breaker` | Circuit breaker (main handler) |
| 4143 | conflict detection reasons | Guard conflicts |
| 6452 | `insufficient_price_freshness` | Price freshness gate (executeTradeOrder) |
| 6472 | `spread_too_wide` | Spread gate |
| 6497 | `blocked_by_circuit_breaker` | Circuit breaker (executeTradeOrder) |
| 2801 | `manual_override_precedence` | Manual force override (comma-operator trick) |

### Category B: Direct `.insert()` to `decision_events` bypassing `logDecisionAsync` (11 call sites)

These inserts NEVER called `logDecisionAsync` at all, so NO snapshot was ever created.

**Affected paths:**
| Line (original) | Reason | Path |
|---|---|---|
| 806 | `cash_ledger_settle_failed` | Cash ledger BUY drift |
| 954 | `cash_ledger_settle_failed` | Cash ledger SELL drift |
| 2401 | `system_operator_execution_failed` | System operator error |
| 2443 | `system_operator_execution_submitted` | System operator success |
| 2670 | `cash_ledger_settle_failed` | Manual SELL cash settlement |
| 3371 | `manual_execution_failed` | Manual REAL execution error |
| 3414 | `manual_execution_submitted` | Manual REAL execution success |
| 3532 | `real_execution_job_queued` | REAL execution job queued |
| 4799 | `cash_ledger_settle_failed` | Direct UD=OFF SELL settlement |
| 7910 | `cash_ledger_settle_failed` | Per-lot SELL settlement |
| 8087 | `cash_ledger_settle_failed` | Standard execution settlement |

---

## Changes Made

### 1. Added `await` to all 9 fire-and-forget `logDecisionAsync` calls

**File:** `supabase/functions/trading-decision-coordinator/index.ts`

Every `logDecisionAsync` call is now `await logDecisionAsync(...)`. The snapshot is guaranteed to be written (or fail with logging) BEFORE the response is returned.

The comma-operator pattern at line 2801 (`(logDecisionAsync(...), respond(...))`) was refactored to a proper `if/else` with `await`.

### 2. Added `writeSnapshotForDirectInsert` helper function

New function added after `buildDecisionMetadata`:

```typescript
async function writeSnapshotForDirectInsert(
  supabaseClient, decisionId, userId, strategyId,
  symbol, side, action, reason, isTestMode
)
```

- Writes a minimal `decision_snapshots` row with `schema_version: 'v1'`
- Includes `snapshot_write_attempt`, `snapshot_write_success`, `snapshot_write_failed` temporary logging
- Called after every direct `.insert()` to `decision_events`

### 3. Added `.select("id")` to all 11 direct inserts

Each direct insert now returns the inserted `id` so it can be passed to `writeSnapshotForDirectInsert`.

### 4. Added temporary logging to `logDecisionAsync`

The snapshot write section now logs:
- `[snapshot_write_attempt] decision_id=...`
- `[snapshot_write_success] decision_id=...`
- `[snapshot_write_failed] decision_id=... error=...`

---

## What Was NOT Changed

- Decision logic (no behavior changes)
- Fusion computation
- Guard conditions
- Trade execution paths
- `logDecisionAsync` internal logic (only callers changed)
- Frontend

---

## Verification

### Immediate (post-deploy)
```sql
-- Should return 0 rows for events after deployment
SELECT de.id, de.symbol, de.reason, de.created_at
FROM decision_events de
LEFT JOIN decision_snapshots ds ON ds.decision_id = de.id
WHERE ds.id IS NULL
  AND de.created_at > '2026-03-27 23:15:00'
ORDER BY de.created_at DESC;
```

**Result:** ✅ Zero orphans after deployment.

### Ongoing monitoring
```sql
-- Run daily: should return 0
SELECT COUNT(*) as orphan_count
FROM decision_events de
LEFT JOIN decision_snapshots ds ON ds.decision_id = de.id
WHERE ds.id IS NULL
  AND de.created_at > NOW() - INTERVAL '24 hours';
```

### Log verification
Search Edge Function logs for:
- `snapshot_write_attempt` — every decision should have one
- `snapshot_write_success` — confirms write completed
- `snapshot_write_failed` — alerts on failures
