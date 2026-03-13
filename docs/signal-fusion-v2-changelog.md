# Signal Fusion v2 — Changelog & Implementation Reference

**Date:** 2026-03-13
**Scope:** Signal lineage persistence + source aggregation in fusion pipeline
**Breaking changes:** None — all changes are additive

---

## Summary

Two architectural gaps were addressed to make the decision pipeline ML-ready:

1. **Signal lineage** — Every decision now records the exact `live_signals` rows that were used during fusion, enabling `signal → decision → outcome` reconstruction.
2. **Source aggregation** — Signals are now aggregated per source before fusion to prevent high-frequency sources (e.g., `technical_analysis` ~7400 rows) from dominating low-frequency ones (e.g., `fear_greed_index` ~44 rows).

---

## Files Modified

| File | Type | Description |
|------|------|-------------|
| `src/engine/signalFusion.ts` | Frontend module | Full rewrite with v2 types, source aggregation, lineage output |
| `supabase/functions/trading-decision-coordinator/index.ts` | Edge Function | Inlined v2 fusion logic, snapshot wiring |
| `supabase/functions/backend-shadow-engine/index.ts` | Edge Function | Signal query expansion, lineage in metadata + snapshots |

**No SQL migrations.** All new data is stored inside existing JSONB columns (`signal_breakdown_json`).

---

## 1. Frontend Module: `src/engine/signalFusion.ts`

### New types added

```typescript
/** Compact signal reference for lineage persistence */
export interface SignalUsed {
  signal_id: string;
  source: string;
  signal_type: string;
  strength: number;
}

/** Per-source aggregated contribution */
export interface SourceContribution {
  source: string;
  signal_count: number;
  aggregated_strength: number;
  contribution: number;
}
```

### Extended `FusedSignalResult`

```typescript
export interface FusedSignalResult {
  fusedScore: number;           // -100 to +100 (unchanged)
  details: SignalDetail[];      // per-signal breakdown (unchanged)
  totalSignals: number;         // (unchanged)
  enabledSignals: number;       // (unchanged)
  signals_used: SignalUsed[];   // NEW: exact signals for ML lineage
  source_contributions: Record<string, number>; // NEW: per-source contribution
  fusion_version: string;       // NEW: "v2_aggregated" | "v2_raw" | "v2_error"
}
```

### Extended `ComputeFusedSignalParams`

```typescript
export interface ComputeFusedSignalParams {
  // ... existing fields unchanged ...
  useSourceAggregation?: boolean; // NEW: default true
}
```

### New function: `aggregateBySource()`

Aggregates processed signals per source using configurable strategies:

```typescript
const SOURCE_AGGREGATION_STRATEGY: Record<string, AggregationStrategy> = {
  'technical_analysis': 'average',  // continuous signals → average
  'crypto_news': 'average',         // periodic sentiment → average
  'whale_alert_ws': 'max',          // sporadic → strongest alert
  'fear_greed_index': 'latest',     // daily snapshot → most recent
  'eodhd': 'latest',                // daily → most recent
};
```

### Changed fusion logic in `computeFusedSignalScore()`

**Before (v1):** Sum all individual signal contributions directly.

**After (v2, `useSourceAggregation = true`):**
1. Process all signals individually (same as before)
2. Group by `source`
3. Aggregate per source using strategy (average/max/latest)
4. Sum one contribution per source → `fusedScore`

**Fallback (`useSourceAggregation = false`):** Behaves identically to v1.

### Registry + strategy weights queries now parallel

```typescript
// Before: sequential
const { data: registryEntries } = await supabaseClient.from('signal_registry')...
const { data: strategyWeights } = await supabaseClient.from('strategy_signal_weights')...

// After: parallel
const [registryResult, weightsResult] = await Promise.all([
  supabaseClient.from('signal_registry')...,
  supabaseClient.from('strategy_signal_weights')...,
]);
```

---

## 2. Coordinator: `supabase/functions/trading-decision-coordinator/index.ts`

### New types inlined (lines ~58-74)

Same `SignalUsed` interface and extended `FusedSignalResult` as above, inlined for Deno compatibility.

### Extended `ComputeFusedSignalParams` (line ~76)

Added `useSourceAggregation?: boolean`.

### New inlined functions (lines ~122-182)

- `SOURCE_AGGREGATION_STRATEGY` constant
- `ProcessedSignal` interface
- `aggregateBySource()` function

### Replaced `computeFusedSignalScore()` (lines ~184-308)

Full replacement with v2 logic (source aggregation + lineage tracking). Same behavior as frontend module.

### Changed `fusedSignalData` construction (lines ~5079-5094)

```typescript
// Before:
fusedSignalData = {
  score: fusionResult.fusedScore,
  totalSignals: fusionResult.totalSignals,
  enabledSignals: fusionResult.enabledSignals,
  topSignals: [...],
};

// After:
fusedSignalData = {
  score: fusionResult.fusedScore,
  totalSignals: fusionResult.totalSignals,
  enabledSignals: fusionResult.enabledSignals,
  topSignals: [...],
  signals_used: fusionResult.signals_used,              // NEW
  source_contributions: fusionResult.source_contributions, // NEW
  fusion_version: fusionResult.fusion_version,           // NEW
};
```

### Changed snapshot `signal_breakdown_json` write (lines ~5240-5247)

```typescript
// Before:
signal_breakdown_json: fusedSignalData ? {
  total_signals: fusedSignalData.totalSignals,
  enabled_signals: fusedSignalData.enabledSignals,
  top_signals: fusedSignalData.topSignals,
} : null,

// After:
signal_breakdown_json: fusedSignalData ? {
  total_signals: fusedSignalData.totalSignals,
  enabled_signals: fusedSignalData.enabledSignals,
  top_signals: fusedSignalData.topSignals,
  signals_used: fusedSignalData.signals_used,              // NEW
  source_contributions: fusedSignalData.source_contributions, // NEW
  fusion_version: fusedSignalData.fusion_version,           // NEW
} : null,
```

---

## 3. Shadow Engine: `supabase/functions/backend-shadow-engine/index.ts`

### Signal query expansion (two locations)

```typescript
// Before (line ~663 and ~956):
.select('signal_type, signal_strength, data')

// After:
.select('id, signal_type, signal_strength, source, data')
```

This is required to capture `id` and `source` for lineage.

### Entry decision metadata — added `signals_used` (lines ~1223-1243)

```typescript
metadata: {
  // ... existing fields unchanged ...
  // NEW: signal lineage for ML traceability
  signals_used: (liveSignals || []).map((s: any) => ({
    signal_id: s.id,
    source: s.source || 'unknown',
    signal_type: s.signal_type,
    strength: s.signal_strength,
  })),
}
```

### Snapshot `signal_breakdown_json` write — added lineage (lines ~1332-1337)

```typescript
// Before:
signal_breakdown_json: dec.metadata.signalScores ? {
  scores: dec.metadata.signalScores,
  entry_quality: dec.metadata.entry_quality ?? null,
} : null,

// After:
signal_breakdown_json: dec.metadata.signalScores ? {
  scores: dec.metadata.signalScores,
  entry_quality: dec.metadata.entry_quality ?? null,
  signals_used: dec.metadata.signals_used ?? [],     // NEW
  fusion_version: 'v2_shadow',                        // NEW
} : null,
```

---

## Data Schema (no migration needed)

All new data lives inside `decision_snapshots.signal_breakdown_json` (JSONB column).

### Coordinator snapshots — new shape

```json
{
  "total_signals": 42,
  "enabled_signals": 28,
  "top_signals": [
    { "type": "ma_cross_bullish", "contribution": 12.5 }
  ],
  "signals_used": [
    {
      "signal_id": "uuid-1",
      "source": "technical_analysis",
      "signal_type": "ma_cross_bullish",
      "strength": 85
    },
    {
      "signal_id": "uuid-2",
      "source": "whale_alert_ws",
      "signal_type": "whale_large_movement",
      "strength": 72
    }
  ],
  "source_contributions": {
    "technical_analysis": 0.3200,
    "whale_alert_ws": 0.1100,
    "crypto_news": 0.2100,
    "fear_greed_index": 0.0500
  },
  "fusion_version": "v2_aggregated"
}
```

### Shadow engine snapshots — new shape

```json
{
  "scores": { "trend": 0.4, "momentum": 0.2, "whale": 0.0, ... },
  "entry_quality": { ... },
  "signals_used": [
    { "signal_id": "uuid-1", "source": "technical_analysis", ... }
  ],
  "fusion_version": "v2_shadow"
}
```

### `fusion_version` values

| Value | Meaning |
|-------|---------|
| `v2_aggregated` | Source aggregation enabled (default) |
| `v2_raw` | Source aggregation disabled (legacy behavior) |
| `v2_shadow` | Shadow engine snapshot (uses its own scoring) |
| `v2_error` | Fusion failed, returned zero defaults |

---

## Verification Queries

### Check lineage is being persisted

```sql
SELECT
  id,
  decision_id,
  symbol,
  signal_breakdown_json->>'fusion_version' AS fusion_version,
  jsonb_array_length(signal_breakdown_json->'signals_used') AS signal_count,
  signal_breakdown_json->'source_contributions' AS source_contributions,
  timestamp_utc
FROM decision_snapshots
WHERE signal_breakdown_json->>'fusion_version' IS NOT NULL
ORDER BY timestamp_utc DESC
LIMIT 10;
```

### Reconstruct signal → decision → outcome lineage

```sql
WITH decision_signals AS (
  SELECT
    ds.decision_id,
    ds.symbol,
    ds.fusion_score,
    jsonb_array_elements(ds.signal_breakdown_json->'signals_used') AS signal_ref
  FROM decision_snapshots ds
  WHERE ds.signal_breakdown_json->'signals_used' IS NOT NULL
)
SELECT
  de.id AS decision_id,
  de.symbol,
  de.side,
  de.decision_ts,
  dsg.signal_ref->>'signal_id' AS signal_id,
  dsg.signal_ref->>'source' AS signal_source,
  dsg.signal_ref->>'signal_type' AS signal_type,
  dsg.signal_ref->>'strength' AS signal_strength,
  dsg.fusion_score,
  do2.realized_pnl_pct,
  do2.hit_tp,
  do2.hit_sl
FROM decision_events de
JOIN decision_signals dsg ON dsg.decision_id = de.id
LEFT JOIN decision_outcomes do2 ON do2.decision_id = de.id
ORDER BY de.decision_ts DESC
LIMIT 50;
```

### Check source contribution distribution

```sql
SELECT
  symbol,
  signal_breakdown_json->'source_contributions' AS contributions,
  signal_breakdown_json->>'fusion_version' AS version,
  timestamp_utc
FROM decision_snapshots
WHERE signal_breakdown_json->'source_contributions' IS NOT NULL
ORDER BY timestamp_utc DESC
LIMIT 20;
```

---

## Safety Guarantees

- **No schema migrations** — all new data is additive JSONB
- **No decision logic changes** — fusion remains read-only/observability
- **Backward compatible** — old snapshots without `signals_used` still valid
- **Fail-soft preserved** — fusion errors return zero defaults with `fusion_version: \"v2_error\"`
- **`useSourceAggregation` flag** — set to `false` to revert to v1 raw summation behavior
