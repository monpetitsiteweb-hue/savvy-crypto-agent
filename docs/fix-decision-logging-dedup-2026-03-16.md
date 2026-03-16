# Fix: Decision Logging Deduplication

**Date:** 2026-03-16  
**Status:** Deployed  
**Related:** `docs/forensic-orphan-decision-classification-2026-03-16.md`

---

## Problem

Each successful BUY cycle produced **3 `decision_events` rows**:

| # | Writer | trade_id | Purpose |
|---|--------|----------|---------|
| 1 | Coordinator (intelligent fast path, pre-execution) | NULL ❌ | Pre-execution audit log |
| 2 | Coordinator (UD=ON/UD=OFF execution path, post-execution) | ✅ Populated | Authoritative decision record |
| 3 | Backend engine (Step 5 loop) | NULL | Backend post-coordinator ENTRY echo |

Rows #1 and #3 inflated the "orphan decision" count by ~111 rows. Zero actual trades were lost.

---

## Changes Made

### 1. Coordinator: Remove pre-execution `logDecisionAsync` (Bucket C fix)

**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Lines modified:** ~2147–2228

**Before:** The intelligent fast path called `logDecisionAsync()` with `tradeId: undefined` BEFORE falling through to the execution flow. The execution flow (UD=ON at line ~6585, UD=OFF at line ~3828) then called `logDecisionAsync()` AGAIN with the actual `tradeId`.

**After:** Removed the pre-execution `logDecisionAsync()` call. Only the post-execution call remains, which already correctly passes `executionResult.tradeId`.

**Effect:** Eliminates Bucket C orphans (~6 rows). The coordinator now writes exactly **one** `decision_event` per execution, with `trade_id` populated.

### 2. Backend: Skip ENTRY decision_events writes (Bucket B fix)

**File:** `supabase/functions/backend-shadow-engine/index.ts`  
**Lines modified:** ~1140–1249 (Step 5 loop)

**Before:** The backend iterated ALL decisions (ENTRY + EXIT) and wrote each to `decision_events`. For ENTRY decisions, this duplicated what the coordinator already logged.

**After:** The Step 5 loop now skips decisions where `snapshot_type === 'ENTRY'` or `snapshot_source === 'coordinator'`. EXIT/SELL decisions continue to be logged by the backend (unchanged).

**Effect:** Eliminates Bucket B orphans (~105 rows per 24h). Reduces `decision_events` write volume by ~33%.

---

## What Was NOT Changed

- **Backend post-execution EXIT/SELL logging** — preserved for downstream analytics
- **Coordinator UD=ON path** (line ~6585) — already correct, passes `tradeId`
- **Coordinator UD=OFF path** (line ~3828) — already correct, passes `tradeId`
- **`logDecisionAsync` function** — unchanged, still writes decision_events + snapshots
- **`decision_snapshots`** — unchanged, coordinator snapshots remain the authoritative source

---

## Architecture After Fix

```
Backend Engine (5min CRON)
    ↓ builds intent
Coordinator (fusion + guards + execution)
    ↓ executes trade
    ↓ writes SINGLE decision_event (with trade_id) ← authoritative
    ↓ writes decision_snapshot (context + explainability)
    ↓
mock_trades / real_trades
    ↓
Backend logs EXIT decisions only
```

---

## Verification Queries

### True orphan check (expect 0 NEW rows after fix)
```sql
SELECT de.id, de.symbol, de.created_at, de.reason
FROM decision_events de
JOIN decision_snapshots ds ON ds.decision_id = de.id
WHERE de.side = 'BUY'
  AND de.trade_id IS NULL
  AND ds.decision_result = 'BUY'
  AND ds.decision_reason ILIKE '%no_conflicts%'
  AND de.created_at > NOW() - INTERVAL '1 hour';
```

### Triple-logging check (expect no rows with count > 1)
```sql
SELECT symbol,
       metadata->>'backend_request_id' as req_id,
       COUNT(*) as rows_per_cycle
FROM decision_events
WHERE side = 'BUY'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY symbol, metadata->>'backend_request_id'
HAVING COUNT(*) > 1
ORDER BY MAX(created_at) DESC;
```
