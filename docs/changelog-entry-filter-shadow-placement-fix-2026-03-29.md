# Changelog: entry_filter_shadow Placement Fix

**Date**: 2026-03-29
**Scope**: Move A3 shadow block before early returns for ~100% snapshot coverage
**Behavior change**: None — logging only

---

## Problem

`entry_filter_shadow` had 0% coverage across 18,000+ ENTRY snapshots.
Root cause: the A3 block was placed **after** the fusion threshold early return (`fusion_below_threshold → HOLD` at ~line 3816), so it was skipped for most decisions.

## Fix

### File modified

`supabase/functions/trading-decision-coordinator/index.ts`

### What was moved

The entire A3 `entry_filter_shadow` block (~55 lines) was relocated:

- **From**: Inside the `if (intent.side === 'BUY' && precomputedFusionData)` block, **after** the fusion threshold check and early return (old line ~3845)
- **To**: Inside the fusion computation `try` block, **right after A1** (`fear_greed_shadow`), at ~line 3039 — **before** any early return path

### What was removed

The original A3 block at old lines 3903–3957 was replaced with a single comment:
```
// A3 moved to early execution (alongside A1) — see ~line 3039
```

### What was NOT changed

- No decision logic modified
- No trade execution changes
- No schema changes
- No new files created
- A1 (fear_greed_shadow) and A2 (confidence_shadow) untouched
- Shadow data format unchanged

---

## Execution order after fix

```
A1: fear_greed_shadow    (~line 2993)  ← before all early returns
A3: entry_filter_shadow  (~line 3039)  ← moved here, before all early returns
    ... early returns (panic, policy, fusion threshold) ...
A2: confidence_shadow    (~line 3885)  ← still after fusion threshold gate
```

Note: A2 (`confidence_shadow`) remains after the fusion threshold gate because it depends on derived confidence values computed there. A2 coverage is intentionally limited to decisions that pass the fusion threshold.

## Verification

```sql
SELECT
  COUNT(*) FILTER (WHERE market_context_json->'entry_filter_shadow' IS NOT NULL) AS with_shadow,
  COUNT(*) AS total
FROM decision_snapshots
WHERE created_at > now() - interval '24 hours'
  AND snapshot_type = 'ENTRY';
```

Expected after 24h: coverage approaching ~100% for validated symbols (BTC-EUR, ETH-EUR, SOL-EUR, LTC-EUR, XRP-EUR).
