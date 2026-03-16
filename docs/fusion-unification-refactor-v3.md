# Fusion Unification Refactor v3 — Changelog

**Date:** 2026-03-16  
**Scope:** Remove dual fusion model; single entry authority via coordinator  
**Breaking changes:** Backend engine no longer computes entry fusion scores

---

## Problem Statement

Two independent fusion models were running in production:

| | Model A (Coordinator) | Model B (Backend Engine) |
|---|---|---|
| **Location** | `trading-decision-coordinator/index.ts` | `backend-shadow-engine/index.ts` |
| **Function** | `computeFusedSignalScore()` | `computeSignalScores()` + `computeFusionScore()` |
| **Logic** | Per-signal registry weights + source aggregation | 5 fixed categories (trend/momentum/volatility/whale/sentiment) |
| **Scale** | `[-100, +100]` | `[-1, +1]` |
| **Output** | `top_signals`, `signals_used`, `source_contributions` | `scores: {trend, momentum, ...}`, `entry_quality` |

**244 of 254 trades** came from the backend engine (Model B), making the coordinator's fusion (Model A) almost unused for entry decisions.

Both could produce rows labeled `fusion_version = 'v2_aggregated'` with different underlying algorithms.

---

## Target Architecture (After Refactor)

```
live_signals
      ↓
fusion engine (coordinator only)
      ↓
decision intent (BUY/HOLD/BLOCK)
      ↓
execution engine (backend)
      ↓
trade lifecycle (TP/SL/runner)
```

- **Coordinator** = market intelligence (single fusion authority)
- **Backend engine** = execution + exit management only

---

## Files Changed

| File | Change Type |
|------|-------------|
| `supabase/functions/backend-shadow-engine/index.ts` | **Major rewrite** of entry path |
| `supabase/functions/trading-decision-coordinator/index.ts` | **Added** Fusion Gate |
| `supabase/migrations/20260316090135_*.sql` | **New migration** — `snapshot_type` column |

---

## 1. Backend Engine: `backend-shadow-engine/index.ts`

### DELETED — Entry fusion computation

The following code was **removed** from the entry evaluation path (previously ~lines 1060–1069):

```typescript
// DELETED: Backend no longer computes its own fusion for entries
const signalScores = await computeSignalScores(supabaseClient, userId, baseSymbol, liveSignals);
const fusionResult = computeFusionScore(signalScores);
const shouldBuy = fusionResult.score >= entryThreshold;
```

Functions `computeSignalScores()` and `computeFusionScore()` are **retained** in the codebase but only used for exit/runner logic (`shouldLetWinnersRun()` bull override).

### ADDED — Coordinator delegation (lines ~984–1101)

Entry evaluation now delegates entirely to the coordinator:

```typescript
// ============= ENTRY EVALUATION: DELEGATE TO COORDINATOR =============
// Backend does NOT compute fusion. Coordinator is the single decision authority.
// computeSignalScores() and computeFusionScore() are NOT called here.

const intent = {
  userId,
  strategyId: strategy.id,
  symbol: baseSymbol,
  side: 'BUY' as const,
  source: 'intelligent' as const,
  confidence: null as number | null, // Coordinator derives confidence from its own fusion
  reason: 'backend_entry_evaluation',
  qtySuggested,
  metadata: {
    mode: 'mock',
    engine: 'intelligent',
    is_test_mode: true,
    context: effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE',
    backend_ts: new Date().toISOString(),
    currentPrice,
    backend_request_id: backendRequestId,
    origin: effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE',
    eurAmount: tradeAllocation,
    horizon: config.decisionCadence || '1h',
  },
  ts: new Date().toISOString(),
  idempotencyKey,
};

const { data: coordinatorResponse, error: coordError } = await supabaseClient.functions.invoke(
  'trading-decision-coordinator',
  { body: { intent } }
);
```

### CHANGED — Confidence derivation

```typescript
// BEFORE: confidence from backend's own fusion
const computedConfidence = fusionResult.score;

// AFTER: confidence from coordinator fusion output
const computedConfidence = coordinatorFusion?.score != null 
  ? Math.abs(coordinatorFusion.score) / 100 
  : 0;
```

### CHANGED — Decision snapshot writes (lines ~1189–1200)

```typescript
// ENTRY snapshots: use coordinator fusion data exclusively
// EXIT snapshots: use category scores for runner/bull_override logic
signal_breakdown_json: dec.metadata.snapshot_type === 'ENTRY' && dec.metadata.coordinatorFusion ? {
  total_signals: dec.metadata.coordinatorFusion.totalSignals,
  enabled_signals: dec.metadata.coordinatorFusion.enabledSignals,
  top_signals: dec.metadata.coordinatorFusion.topSignals,
  signals_used: dec.metadata.coordinatorFusion.signals_used,
  source_contributions: dec.metadata.coordinatorFusion.source_contributions,
  fusion_version: dec.metadata.coordinatorFusion.fusion_version,
} : dec.metadata.signalScores ? {
  scores: dec.metadata.signalScores,
  entry_quality: dec.metadata.entry_quality ?? null,
  fusion_version: 'v2_aggregated',
} : null,
```

### ADDED — `snapshot_type` field on all decisions

Every decision now carries `snapshot_type: 'ENTRY'` or `snapshot_type: 'EXIT'` in metadata, written to `decision_snapshots.snapshot_type`.

```typescript
// Entry decisions
metadata: {
  ...
  snapshot_type: 'ENTRY',
  snapshot_source: 'coordinator',
}

// Exit decisions (TP/SL/runner)
metadata: {
  ...
  snapshot_type: 'EXIT',
}
```

---

## 2. Coordinator: `trading-decision-coordinator/index.ts`

### ADDED — Fusion Gate (lines ~3724–3787)

New pre-execution fusion computation block for all BUY intents:

```typescript
// ============= FUSION GATE: Compute fusion for BUY intents BEFORE execution =============
// This is the SINGLE authoritative fusion computation. Backend engine delegates here.
let precomputedFusionData: any = null;
if (intent.side === 'BUY') {
  const fusionResult = await computeFusedSignalScore({
    supabaseClient,
    userId: intent.userId,
    strategyId: intent.strategyId,
    symbol: baseSymbolForFusion,
    side: 'BUY',
    horizon,
    useSourceAggregation: true,
  });

  precomputedFusionData = {
    score: fusionResult.fusedScore,
    totalSignals: fusionResult.totalSignals,
    enabledSignals: fusionResult.enabledSignals,
    topSignals: fusionResult.details
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 5)
      .map((d) => ({ type: d.signalType, contribution: Number(d.contribution.toFixed(4)) })),
    signals_used: fusionResult.signals_used,
    source_contributions: fusionResult.source_contributions,
    fusion_version: fusionResult.fusion_version,
  };
```

### ADDED — Threshold governance inside Fusion Gate

```typescript
  // THRESHOLD GOVERNANCE: Check if fusion meets entry threshold
  const rawEnterThreshold = strategy.configuration?.signalFusion?.enterThreshold;
  if (rawEnterThreshold !== undefined && rawEnterThreshold !== null) {
    const threshold100 = rawEnterThreshold <= 1 ? rawEnterThreshold * 100 : rawEnterThreshold;
    if (fusionResult.fusedScore < threshold100) {
      // BLOCKED: return HOLD with fusion data for audit
      return respond('HOLD', 'fusion_below_threshold', requestId, 0, {}, precomputedFusionData);
    }
  }
```

### ADDED — Confidence derivation from fusion

```typescript
  // Derive confidence from fusion score if intent has no confidence
  if (intent.confidence == null || intent.confidence === 0) {
    const derivedConfidence = Math.abs(fusionResult.fusedScore) / 100;
    intent.confidence = derivedConfidence;
  }
```

### CHANGED — `respond()` function signature

`respond()` now accepts an optional `fusion` parameter and includes it in the response body:

```typescript
// BEFORE:
function respond(action, reason, requestId, confidence, metadata) { ... }

// AFTER:
function respond(action, reason, requestId, confidence, metadata, fusion?) {
  return new Response(JSON.stringify({
    decision: { action, reason, requestId, confidence, metadata },
    fusion: fusion || null,  // NEW: coordinator fusion data for backend consumption
  }), ...);
}
```

### CHANGED — `logDecisionAsync()` signature

Added `precomputedFusionData` parameter to persist coordinator fusion in snapshots:

```typescript
// logDecisionAsync now receives precomputedFusionData and writes it to signal_breakdown_json
```

---

## 3. Database Migration

**File:** `supabase/migrations/20260316090135_06bad5bf-30ff-433c-8474-40c02128b1ec.sql`

```sql
ALTER TABLE public.decision_snapshots 
  ADD COLUMN IF NOT EXISTS snapshot_type TEXT DEFAULT NULL;

COMMENT ON COLUMN public.decision_snapshots.snapshot_type IS 
  'ENTRY or EXIT — distinguishes entry decisions (coordinator fusion) from exit decisions (category scoring for runner logic)';
```

---

## Entry Flow After Refactor

```
Backend Engine (cron/scheduler)
  │
  ├─ For each symbol:
  │    │
  │    ├─ Fetch price
  │    ├─ Build intent { side: 'BUY', confidence: null }
  │    ├─ Call coordinator via supabase.functions.invoke()
  │    │        │
  │    │        ▼
  │    │   Coordinator Fusion Gate:
  │    │     1. computeFusedSignalScore() → [-100, +100]
  │    │     2. Check threshold → BLOCK or PASS
  │    │     3. Derive confidence = abs(score) / 100
  │    │     4. Return { decision: {action, reason}, fusion: {...} }
  │    │        │
  │    │        ▼
  │    ├─ Receive coordinator response
  │    ├─ Extract action (BUY/HOLD/BLOCK) + fusion data
  │    ├─ Build decision with snapshot_type = 'ENTRY'
  │    ├─ Write decision_event + decision_snapshot
  │    └─ fusion_score comes ONLY from coordinator output
  │
  ├─ Exit path (unchanged):
  │    ├─ computeSignalScores() still used for bull_override/runner
  │    ├─ TP/SL/trailing_stop bypass fusion entirely
  │    └─ snapshot_type = 'EXIT'
```

---

## What Was NOT Changed

| Component | Status |
|-----------|--------|
| `computeSignalScores()` function definition | **Retained** — used for exit/runner logic |
| `computeFusionScore()` function definition | **Retained** — used for exit/runner logic |
| TP/SL/trailing stop logic | **Unchanged** |
| Runner mode (`shouldLetWinnersRun()`) | **Unchanged** |
| `fetchOpenPositions()` | **Unchanged** |
| Coin pool state management | **Unchanged** |
| Scheduler/cron invocation | **Unchanged** |
| `computeFusedSignalScore()` in coordinator | **Unchanged** (now the sole entry authority) |

---

## Verification Queries

### 1. Confirm entry snapshots use coordinator fusion only

```sql
SELECT 
  snapshot_type,
  signal_breakdown_json->>'fusion_version' AS fusion_version,
  signal_breakdown_json ? 'source_contributions' AS has_coordinator_structure,
  signal_breakdown_json ? 'scores' AS has_legacy_category_structure,
  COUNT(*)
FROM decision_snapshots
WHERE timestamp_utc > NOW() - INTERVAL '24 hours'
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2;
```

**Expected:** ENTRY rows have `has_coordinator_structure = true`, `has_legacy_category_structure = false`.

### 2. Confirm fusion_score comes only from coordinator

```sql
SELECT 
  snapshot_type,
  fusion_score,
  signal_breakdown_json->>'fusion_version' AS fusion_version,
  decision_reason
FROM decision_snapshots
WHERE snapshot_type = 'ENTRY'
  AND timestamp_utc > NOW() - INTERVAL '24 hours'
ORDER BY timestamp_utc DESC
LIMIT 20;
```

### 3. Confirm no dual-algorithm rows

```sql
-- Should return 0 rows after refactor
SELECT id, snapshot_type, signal_breakdown_json
FROM decision_snapshots
WHERE snapshot_type = 'ENTRY'
  AND signal_breakdown_json ? 'scores'
  AND timestamp_utc > NOW() - INTERVAL '24 hours';
```

### 4. Confirm exit snapshots still have category scores

```sql
SELECT 
  snapshot_type,
  signal_breakdown_json->>'fusion_version' AS fusion_version,
  signal_breakdown_json ? 'scores' AS has_category_scores,
  COUNT(*)
FROM decision_snapshots
WHERE snapshot_type = 'EXIT'
  AND timestamp_utc > NOW() - INTERVAL '24 hours'
GROUP BY 1, 2, 3;
```

---

## Guarantees

1. **`computeSignalScores()` and `computeFusionScore()` never run in the entry path.** Entry decisions rely exclusively on coordinator fusion.
2. **`decision_snapshots.fusion_score` comes only from coordinator output.** The backend does not recompute or adjust the score.
3. **One fusion algorithm in production for entries.** Scale: `[-100, +100]`, version: `v2_aggregated`.
4. **Exit logic is preserved.** TP/SL/runner/trailing stop are unchanged.
5. **No scheduler/cron changes.** The backend engine is still invoked the same way; it just delegates entry decisions.
