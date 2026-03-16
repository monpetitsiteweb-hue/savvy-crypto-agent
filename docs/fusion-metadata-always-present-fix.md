# Fix: Fusion Metadata Always Present in ENTRY Snapshots

**Date:** 2026-03-16  
**Scope:** Ensure coordinator always returns fusion data for BUY evaluations  
**Breaking changes:** None

---

## Problem

ENTRY snapshots had `signal_breakdown_json = NULL` when the coordinator blocked a trade before computing fusion. Gates like `panic_active`, `strategy_not_active`, `cooldown`, `circuit_breaker`, `confidence_below_threshold` returned early **before** the Fusion Gate, so `precomputedFusionData` was `null`.

This caused:
- ML datasets could not reconstruct the decision context
- EDA was incomplete for blocked decisions
- `decision_snapshots.fusion_score` was NULL for many ENTRY rows

---

## Root Cause

The Fusion Gate (which computes `computeFusedSignalScore()`) was positioned **after** multiple early-return gates in the coordinator handler. The execution order was:

```
Strategy load → Panic gate → Missing policy → REAL mode checks → 
State gate → SELL policy → [many BLOCK/HOLD returns] → 
Fusion Gate (too late!) → Threshold → Confidence → Execution
```

Any BLOCK/HOLD returned before the Fusion Gate had no fusion data.

---

## Fix

### 1. Moved Fusion Gate to before all gates

Fusion computation now runs **immediately after** `execClass` derivation (line ~2963), before the panic gate. This ensures `precomputedFusionData` is available for ALL subsequent paths.

```typescript
// ============= FUSION GATE: Compute fusion for BUY intents BEFORE any gates =============
let precomputedFusionData: any = null;
if (intent.side === 'BUY') {
  try {
    const fusionResult = await computeFusedSignalScore({ ... });
    precomputedFusionData = { score, totalSignals, enabledSignals, topSignals, signals_used, source_contributions, fusion_version };
  } catch (fusionErr) {
    // Fail-open: proceed without fusion data
  }
}
```

### 2. Added `withFusion()` helper

All raw `new Response(JSON.stringify(...))` blocks now use `withFusion()` to inject fusion data:

```typescript
const withFusion = (body: any): string => JSON.stringify(
  precomputedFusionData ? { ...body, fusion: precomputedFusionData } : body
);
```

### 3. Updated all early-return paths

The following gates now include fusion metadata in their response:

| Gate | Reason | Previously had fusion? |
|------|--------|----------------------|
| Panic gate | `blocked_panic_active` | ❌ → ✅ |
| Missing policy | `blocked_missing_policy` | ❌ → ✅ |
| Strategy not active | `blocked_strategy_not_active` | ❌ → ✅ |
| Prerequisites failed | `blocked_prerequisites_check_failed` | ❌ → ✅ |
| Circuit breaker | `blocked_by_circuit_breaker` | ❌ → ✅ |
| Confidence gate | `confidence_below_threshold` | ❌ → ✅ |
| Manual quarantine | `manualQuarantine` | ❌ → ✅ |
| Queue overload | `queueOverload` | ❌ → ✅ |
| Conflict detection | `Guards tripped: ...` | ❌ → ✅ |
| Execution failed | `direct_execution_failed` | ❌ → ✅ |
| Fusion threshold | `fusion_below_threshold` | ✅ (unchanged) |
| UD=ON final | (execution result) | ❌ → ✅ |

### 4. Updated `logDecisionAsync` calls

Added `precomputedFusionData` parameter to `logDecisionAsync` calls that were missing it:
- Circuit breaker path
- Direct execution failed path
- Conflict detection path
- Confidence gate path

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/trading-decision-coordinator/index.ts` | Moved Fusion Gate, added `withFusion()`, updated all early-return paths |

---

## What Was NOT Changed

- Exit logic (TP/SL/runner/trailing stop) — unchanged
- `snapshot_type` behavior — unchanged
- Backend engine (`backend-shadow-engine/index.ts`) — unchanged (already reads `parsed?.fusion`)
- Fusion computation logic — unchanged (just moved earlier)

---

## Edge Cases Where Fusion Metadata Cannot Be Provided

1. **Before strategy load** — `internal_error` responses at lines ~1660, ~1670, ~2064, ~2915 happen before the user/strategy is resolved. Fusion requires `userId` + `strategyId`, so these cannot include fusion.
2. **Fusion computation failure** — If `computeFusedSignalScore()` throws, `precomputedFusionData` remains `null`. The `withFusion()` helper gracefully returns the body without fusion in this case.
3. **Non-BUY intents** — SELL intents don't compute fusion (by design). EXIT snapshots use category scoring.

---

## Verification Query

After deployment, this query should return zero rows:

```sql
SELECT id
FROM decision_snapshots
WHERE snapshot_type = 'ENTRY'
  AND signal_breakdown_json IS NULL
  AND timestamp_utc > NOW() - INTERVAL '24 hours';
```

### Confirm fusion metadata is present on blocked decisions

```sql
SELECT 
  decision_reason,
  decision_result,
  snapshot_type,
  fusion_score,
  signal_breakdown_json->>'fusion_version' AS fusion_version,
  signal_breakdown_json ? 'source_contributions' AS has_source_contributions
FROM decision_snapshots
WHERE snapshot_type = 'ENTRY'
  AND decision_result IN ('HOLD', 'BLOCK', 'DEFER')
  AND timestamp_utc > NOW() - INTERVAL '24 hours'
ORDER BY timestamp_utc DESC
LIMIT 20;
```

**Expected:** All rows have `fusion_version = 'v2_aggregated'` and `has_source_contributions = true`.
