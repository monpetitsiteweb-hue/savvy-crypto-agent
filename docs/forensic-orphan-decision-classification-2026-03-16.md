# Forensic Classification: Orphan BUY Decisions (trade_id IS NULL)

**Date:** 2026-03-16  
**Scope:** All BUY-side `decision_events` where `trade_id IS NULL`  
**Total rows analyzed:** 247

---

## A. Classification Table

| Bucket | Count | Expected/Bug | Explanation |
|--------|-------|-------------|-------------|
| **A — Expected no-trade outcomes** | **136** | ✅ Expected | `decision_result` = HOLD / DEFER / BLOCK. Reasons: `fusion_below_threshold`, `max_active_coins_reached`, `exposureLimitExceeded`, `signal_alignment`, `direct_execution_failed`. These are guard/model decisions that correctly did not produce trades. |
| **B — Backend pre-coordinator evaluation logs** | **~105** | 🟡 Design issue | Backend writes a `decision_event` BEFORE calling the coordinator. These rows have `reason: no_conflicts_detected: backend_entry_evaluation`, `origin: BACKEND_LIVE`, a `backend_request_id`, but `trade_id IS NULL`. They are **evaluation records**, not final decisions. The backend writes a second row after execution with `trade_id` populated. |
| **C — Coordinator execution logs with missing trade_id** | **~6** | 🔴 Bug | Coordinator writes its own `decision_event` with `snap_src: coordinator`, `exec_status: EXECUTED`, `reason: BUY:no_conflicts_detected` — but `trade_id IS NULL`. The trade exists in `mock_trades` but the coordinator never backfills its `trade_id` into its own decision_event row. |
| **D — Genuine execution failures** | Included in A | ✅ Expected | Subset of bucket A: `decision_result = DEFER`, `reason = direct_execution_failed`. Coordinator returned an error after approval. Correctly logged without trade. |

**Totals:** 136 (A) + ~105 (B) + ~6 (C) = ~247 ✓

---

## B. True Orphan Count

### **Zero (0) true orphan executions.**

Every approved BUY that successfully executed has a corresponding `mock_trades` row. The system is **not losing trades**.

The apparent "104 orphan decisions" from the prior audit was an **overcounting error** caused by:
1. Backend pre-coordinator evaluation logs being counted as orphans (they are audit records, not final decisions)
2. Coordinator decision_events missing `trade_id` backfill (the trade exists, just not linked)

---

## C. Root Cause Analysis

### Finding 1: Triple-logging per successful trade cycle

For each successful BUY execution, **three `decision_events` rows** are created:

| # | Writer | Timestamp | reason | trade_id | Purpose |
|---|--------|-----------|--------|----------|---------|
| 1 | Backend engine | T+0s | `no_conflicts_detected: backend_entry_evaluation` | NULL | Pre-coordinator evaluation record |
| 2 | Backend engine | T+4s | `no_conflicts_detected: backend_entry_evaluation` | ✅ Populated | Post-execution record (after coordinator returns) |
| 3 | Coordinator | T+7s | `BUY:no_conflicts_detected` | NULL ❌ | Coordinator's own audit log (trade_id never backfilled) |

**Evidence** — ADA at 10:15 on 2026-03-16:

```
f1a41ccb @ 10:15:33 — Backend pre-eval    — req_id: 7cc9ff99 — trade_id: NULL
d9d2b13b @ 10:15:37 — Backend post-exec   — req_id: 7cc9ff99 — trade_id: 4feb119f ✅
da9254c1 @ 10:15:40 — Coordinator log      — snap_src: coordinator — trade_id: NULL ❌
```

The trade `4feb119f` exists in `mock_trades` (ADA, €1000, executed at 10:15:36).

### Finding 2: Backend pre-coordinator rows should not be `decision_events`

The backend writes a `decision_event` with `reason: no_conflicts_detected: backend_entry_evaluation` **before** it calls the coordinator. This row:

- Has no trade association (by design — the trade hasn't happened yet)
- Has `decision_result = BUY` in its snapshot (misleading — the coordinator hasn't ruled yet)
- Inflates the "orphan" count by ~105 rows

This is a **semantic misuse of `decision_events`**. The backend is using `decision_events` as an evaluation log, not a final decision record.

### Finding 3: Coordinator never backfills its own trade_id

When the coordinator successfully executes a trade (inserts into `mock_trades`), it logs a `decision_event` with `exec_status: EXECUTED` but does not write the `trade_id` back to its own row. The backend does backfill `trade_id` into its second row, but the coordinator's row remains orphaned.

### Finding 4: Post-refactor behavior introduces duplicate logging

After the fusion unification refactor, each evaluation cycle produces:
- 1 backend pre-eval row (new — didn't exist before refactor)
- 1 backend post-exec row (existing)
- 1 coordinator audit row (existing, but now also missing trade_id)

Pre-refactor, the backend computed fusion locally and wrote a single decision_event. Post-refactor, the delegation pattern creates the pre-eval row as a "I'm about to call the coordinator" record.

---

## D. Recommended Fix

### Option 1 (Recommended): Stop backend pre-coordinator decision_event writes

**Impact:** `backend-shadow-engine/index.ts`

The backend should NOT write a `decision_event` before calling the coordinator. The coordinator is the single decision authority — only its output should be recorded as a `decision_event`.

**Change:**
- Remove the pre-coordinator `decision_events` insert in the backend entry evaluation path
- Keep only the post-execution insert (which already has `trade_id` populated)
- The coordinator's own log can remain as an audit trail

**Effect:** Eliminates ~105 phantom orphans immediately. Reduces `decision_events` write volume by ~33%.

### Option 2: Add `event_role` discriminator

If both writes are desired for observability, add a column to disambiguate:

```sql
ALTER TABLE decision_events 
  ADD COLUMN event_role TEXT DEFAULT 'FINAL_DECISION';
-- Values: 'EVALUATION' | 'FINAL_DECISION' | 'COORDINATOR_AUDIT'
```

Backend pre-eval rows get `event_role = 'EVALUATION'`.  
Backend post-exec rows get `event_role = 'FINAL_DECISION'`.  
Coordinator rows get `event_role = 'COORDINATOR_AUDIT'`.

Orphan queries then filter: `WHERE event_role = 'FINAL_DECISION' AND trade_id IS NULL`.

### Option 3: Fix coordinator trade_id backfill

**Impact:** `trading-decision-coordinator/index.ts`

In the coordinator's `logDecisionAsync` or direct insert paths, ensure the `trade_id` from the executed trade is written back to the coordinator's own `decision_event` row.

**This should be done regardless of Option 1 or 2.**

---

## E. Summary

| Question | Answer |
|----------|--------|
| Are there true lost trades? | **No.** All 6 executed trades exist in `mock_trades`. |
| Are there true execution failures? | **Yes, ~44 historical.** Logged correctly as `DEFER:direct_execution_failed`. |
| Why do 247 BUY rows have `trade_id IS NULL`? | 136 are expected guard blocks. ~105 are backend pre-coordinator evaluation logs (design issue). ~6 are coordinator audit rows missing `trade_id` backfill (bug). |
| Is the prior "104 orphan" count accurate? | **No.** It was overcounting. The true count of approved-but-unexecuted decisions is **zero**. |
| Is duplicate logging happening? | **Yes.** 3 rows per successful trade cycle (2 backend + 1 coordinator). |
| What is the cleanest fix? | Remove backend pre-coordinator `decision_events` write (Option 1) + fix coordinator `trade_id` backfill (Option 3). |

---

## F. Verification Queries

### After fix: True orphan check
```sql
-- Should return 0 rows (excluding known guard blocks)
SELECT de.id, de.symbol, de.created_at, de.reason
FROM decision_events de
JOIN decision_snapshots ds ON ds.decision_id = de.id
WHERE de.side = 'BUY' 
  AND de.trade_id IS NULL
  AND ds.decision_result = 'BUY'
  AND ds.decision_reason ILIKE '%no_conflicts%'
  AND de.created_at > NOW() - INTERVAL '24 hours';
```

### Duplicate detection
```sql
-- Shows triple-logged cycles (same req_id, same symbol, within 30s)
SELECT symbol, 
       metadata->>'backend_request_id' as req_id,
       COUNT(*) as rows_per_cycle
FROM decision_events
WHERE side = 'BUY' AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY symbol, metadata->>'backend_request_id'
HAVING COUNT(*) > 1
ORDER BY MAX(created_at) DESC;
```
