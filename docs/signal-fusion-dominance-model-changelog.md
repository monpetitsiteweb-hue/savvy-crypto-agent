# Signal Fusion: Directional Dominance Model — Implementation Changelog

## Date: 2026-03-15

## Summary

Replaced the simple summation-based signal fusion model with a **directional dominance model** across all three fusion implementations in the codebase. The goal is to prevent trades with weak or contradictory conviction by measuring how strongly signals agree on a direction, rather than summing their raw contributions.

---

## Problem (Before)

The fusion logic computed a final score by summing all signal contributions:

```
final_score = Σ(signal_strength × weight × direction_multiplier)
```

This allowed a strong bearish signal to be **diluted** by multiple weak bullish signals:

| Signal                  | Contribution |
|-------------------------|-------------|
| rsi_overbought_bearish  | -0.55       |
| momentum_neutral        | +0.15       |
| momentum_neutral        | +0.15       |
| ma_cross_bullish        | +0.14       |
| ma_cross_bullish        | +0.12       |
| **Sum**                 | **+0.01**   |

Result: BUY executed with near-zero conviction despite the strongest signal being bearish.

---

## Solution (After)

The new model splits contributions by direction and computes a **dominance ratio**:

```
1. contribution = normalizedStrength × weight × directionMultiplier  (unchanged)
2. bullishTotal = sum of all positive contributions
3. bearishTotal = sum of abs(all negative contributions)
4. totalMass = bullishTotal + bearishTotal
5. dominance = max(bullishTotal, bearishTotal) / totalMass
6. direction = +1 if bullishTotal >= bearishTotal, else -1
7. convictionScore = direction × dominance                           // [-1, +1]
8. fusedScore = clamp(convictionScore × 100, -100, +100)             // [-100, +100]
```

The same example now produces:

| Metric       | Value |
|--------------|-------|
| bullishTotal | 0.56  |
| bearishTotal | 0.55  |
| totalMass    | 1.11  |
| dominance    | 0.505 |
| direction    | +1    |
| fusedScore   | **+50.5** |

The score is no longer near-zero — it correctly reflects that signals are nearly evenly split (dominance ≈ 0.5). A meaningful entry threshold (e.g., 60+) would now correctly block this conflicted entry.

---

## Files Changed

### 1. `src/engine/signalFusion.ts`

**Location:** Lines 320–344 (old) → Lines 320–358 (new)

**What was removed:**

```typescript
// Compute fused score and source contributions
let totalContribution = 0;
const sourceContributions: Record<string, number> = {};

if (useSourceAggregation && processedSignals.length > 0) {
  // v2: aggregate per source, then sum
  const { aggregatedContributions } = aggregateBySource(processedSignals);
  for (const [source, agg] of aggregatedContributions) {
    totalContribution += agg.contribution;
    sourceContributions[source] = Number(agg.contribution.toFixed(4));
  }
} else {
  // v1 legacy: sum all raw contributions
  for (const ps of processedSignals) {
    totalContribution += ps.contribution;
    const src = ps.signal.source;
    sourceContributions[src] = (sourceContributions[src] || 0) + ps.contribution;
  }
  // Round
  for (const key of Object.keys(sourceContributions)) {
    sourceContributions[key] = Number(sourceContributions[key].toFixed(4));
  }
}

const fusedScore = Math.max(-100, Math.min(100, totalContribution * 20));
```

**What was added:**

```typescript
// Compute fused score using directional dominance model (v3)
// Instead of simple summation, we split contributions by direction
// and compute a dominance-based conviction score.
const sourceContributions: Record<string, number> = {};
const allContributions: number[] = [];

if (useSourceAggregation && processedSignals.length > 0) {
  // v2: aggregate per source first, then collect contributions
  const { aggregatedContributions } = aggregateBySource(processedSignals);
  for (const [source, agg] of aggregatedContributions) {
    allContributions.push(agg.contribution);
    sourceContributions[source] = Number(agg.contribution.toFixed(4));
  }
} else {
  // Legacy: collect raw contributions
  for (const ps of processedSignals) {
    allContributions.push(ps.contribution);
    const src = ps.signal.source;
    sourceContributions[src] = (sourceContributions[src] || 0) + ps.contribution;
  }
  for (const key of Object.keys(sourceContributions)) {
    sourceContributions[key] = Number(sourceContributions[key].toFixed(4));
  }
}

// Directional dominance computation
let bullishTotal = 0;
let bearishTotal = 0;
for (const c of allContributions) {
  if (c > 0) bullishTotal += c;
  else bearishTotal += Math.abs(c);
}

const totalMass = bullishTotal + bearishTotal;
const dominance = totalMass === 0 ? 0 : Math.max(bullishTotal, bearishTotal) / totalMass;
const direction = bullishTotal >= bearishTotal ? 1 : -1;
const convictionScore = direction * dominance; // [-1, +1]

const fusedScore = Math.max(-100, Math.min(100, convictionScore * 100));
```

**Key changes:**
- Replaced `totalContribution` accumulator with `allContributions` array
- Added directional split into `bullishTotal` and `bearishTotal`
- Replaced `totalContribution * 20` scaling with `convictionScore * 100` (dominance-based)
- Source aggregation logic (v2) is preserved — contributions are still collected per source before the dominance split

---

### 2. `supabase/functions/trading-decision-coordinator/index.ts`

**Location:** Lines 270–291 (old) → Lines 270–304 (new)

**What was removed:**

```typescript
// Compute fused score with or without source aggregation
let totalContribution = 0;
const sourceContributions: Record<string, number> = {};

if (useSourceAggregation && processedSignals.length > 0) {
  const aggregated = aggregateBySource(processedSignals);
  for (const [source, agg] of aggregated) {
    totalContribution += agg.contribution;
    sourceContributions[source] = Number(agg.contribution.toFixed(4));
  }
} else {
  for (const ps of processedSignals) {
    totalContribution += ps.contribution;
    const src = ps.signal.source;
    sourceContributions[src] = (sourceContributions[src] || 0) + ps.contribution;
  }
  for (const key of Object.keys(sourceContributions)) {
    sourceContributions[key] = Number(sourceContributions[key].toFixed(4));
  }
}

const fusedScore = Math.max(-100, Math.min(100, totalContribution * 20));
```

**What was added:**

Identical dominance logic as `signalFusion.ts` (see above). The coordinator's copy mirrors the main module exactly — contributions are collected into `allContributions`, split by direction, and scored via `direction × dominance × 100`.

**Key difference from `signalFusion.ts`:** None — the logic is identical. Both files contain independent copies of the fusion function because the coordinator is an edge function that cannot import from `src/`.

---

### 3. `supabase/functions/backend-shadow-engine/index.ts`

**Location:** Lines 512–529 (old) → Lines 512–553 (new)

**What was removed:**

```typescript
/**
 * Compute fusion score from signal scores
 */
function computeFusionScore(scores: SignalScores, config: any): number {
  const fusionWeights = {
    trend: config.trendWeight || 0.35,
    momentum: config.momentumWeight || 0.25,
    volatility: config.volatilityWeight || 0.15,
    whale: config.whaleWeight || 0.15,
    sentiment: config.sentimentWeight || 0.10,
  };
  
  return scores.trend * fusionWeights.trend +
         scores.momentum * fusionWeights.momentum +
         scores.volatility * fusionWeights.volatility +
         scores.whale * fusionWeights.whale +
         scores.sentiment * fusionWeights.sentiment;
}
```

**What was added:**

```typescript
/**
 * Compute fusion score from signal scores using directional dominance model (v3)
 * 
 * Instead of simple weighted summation, we:
 * 1. Compute weighted category contributions
 * 2. Split by direction (bullish vs bearish)
 * 3. Return a conviction score based on directional dominance
 * 
 * Output range: [-1, +1] where magnitude = dominance ratio
 */
function computeFusionScore(scores: SignalScores, config: any): number {
  const fusionWeights = {
    trend: config.trendWeight || 0.35,
    momentum: config.momentumWeight || 0.25,
    volatility: config.volatilityWeight || 0.15,
    whale: config.whaleWeight || 0.15,
    sentiment: config.sentimentWeight || 0.10,
  };

  const weightedScores = [
    scores.trend * fusionWeights.trend,
    scores.momentum * fusionWeights.momentum,
    scores.volatility * fusionWeights.volatility,
    scores.whale * fusionWeights.whale,
    scores.sentiment * fusionWeights.sentiment,
  ];

  let bullish = 0;
  let bearish = 0;
  for (const ws of weightedScores) {
    if (ws > 0) bullish += ws;
    else bearish += Math.abs(ws);
  }

  const total = bullish + bearish;
  if (total === 0) return 0;

  const dominance = Math.max(bullish, bearish) / total;
  const direction = bullish >= bearish ? 1 : -1;

  return direction * dominance; // [-1, +1]
}
```

**Key difference from the other two files:**

This function operates on **pre-aggregated category scores** (`trend`, `momentum`, `volatility`, `whale`, `sentiment`) rather than raw signal contributions. Each category score is already in the range `[-1, +1]`. The adaptation:

1. Computes weighted contributions per category (same as before)
2. Collects them into an array instead of summing directly
3. Splits by sign into `bullish` / `bearish` buckets
4. Computes dominance ratio
5. Returns `direction × dominance` in `[-1, +1]`

The output range remains `[-1, +1]` as before — downstream consumers in the shadow engine (entry threshold checks at ~line 1018, age penalty at ~line 996) are unchanged.

---

### 4. `tests/signal-fusion.test.ts`

**Location:** Lines 163–178 (old) → Lines 163–183 (new)

**What was removed:**

```typescript
expect(result.enabledSignals).toBe(2);
expect(result.details).toHaveLength(2);

// Score should reflect the net of both signals
const bullishContribution = result.details.find(d => d.signalType === 'ma_cross_bullish')?.contribution || 0;
const bearishContribution = result.details.find(d => d.signalType === 'rsi_overbought_bearish')?.contribution || 0;
expect(bullishContribution).toBeGreaterThan(0);
expect(bearishContribution).toBeLessThan(0);

// Cleanup
if (signals) {
  for (const signal of signals) {
    await supabase.from('live_signals').delete().eq('id', signal.id);
  }
}
```

**What was added:**

```typescript
expect(result.enabledSignals).toBe(2);
expect(result.details).toHaveLength(2);

// Individual contributions should still have correct direction
const bullishContribution = result.details.find(d => d.signalType === 'ma_cross_bullish')?.contribution || 0;
const bearishContribution = result.details.find(d => d.signalType === 'rsi_overbought_bearish')?.contribution || 0;
expect(bullishContribution).toBeGreaterThan(0);
expect(bearishContribution).toBeLessThan(0);

// With directional dominance model, mixed signals should produce a score
// closer to zero than either direction alone (conflicted market)
// The score magnitude reflects dominance, not raw sum
expect(Math.abs(result.fusedScore)).toBeLessThan(100);

// Cleanup
if (signals) {
  for (const signal of signals) {
    await supabase.from('live_signals').delete().eq('id', signal.id);
  }
}
```

**Key changes:**

- Removed comment "Score should reflect the net of both signals" (no longer accurate)
- Added comment explaining that mixed signals reflect dominance, not raw sum
- Added assertion: `Math.abs(result.fusedScore) < 100` — mixed signals should never produce a fully dominant score
- All other tests (single bullish, single bearish, disabled signals, weight overrides, error handling) remain unchanged because their expectations (`> 0`, `< 0`, `=== 0`) are still valid under the dominance model

---

## What Was NOT Changed

The following were explicitly preserved:

| Component | Reason |
|-----------|--------|
| Signal generation (`live_signals` ingestion) | Not part of fusion |
| Signal normalization (`normalizeSignalStrength`) | Still used to normalize raw strength to [0,1] before contribution calc |
| Contribution calculation (`strength × weight × direction`) | Individual contributions are computed identically |
| Source aggregation (v2 `aggregateBySource`) | Still runs before dominance split |
| `SignalDetail` / `SignalUsed` / lineage tracking | Details still record per-signal contributions |
| Decision snapshots (`decision_snapshots` table) | Snapshots record the final `fusedScore` — format unchanged |
| Entry threshold logic | Thresholds still compare against `fusedScore` — to be tuned separately |
| Portfolio accounting / trade execution | Downstream of fusion, unaffected |
| Output scale `[-100, +100]` | Preserved via `convictionScore × 100` |

---

## Deployment

Both edge functions were redeployed after the changes:

```
supabase functions deploy trading-decision-coordinator
supabase functions deploy backend-shadow-engine
```

Deployment confirmed successful.

---

## Behavioral Impact

### Score interpretation change

| Scenario | Old Score | New Score | Explanation |
|----------|-----------|-----------|-------------|
| All bullish signals | +high | +high (up to +100) | Dominance = 1.0, direction = +1 |
| All bearish signals | -high | -high (down to -100) | Dominance = 1.0, direction = -1 |
| Mixed, bullish slight edge | +small (e.g., +0.2) | +50 to +60 | Dominance ≈ 0.5–0.6 |
| Mixed, perfectly balanced | ≈0 | +50 or -50 | Dominance = 0.5, direction by tiny margin |
| Single strong bearish + many weak bullish | +small (diluted) | +50 to +55 | Dominance reflects near-balance |

### Key behavioral difference

Under the old model, the **magnitude** of `fusedScore` was proportional to the **net sum** of contributions. A conflicted market produced a near-zero score that could still pass a threshold of 0.

Under the new model, the **magnitude** reflects **how strongly signals agree**. A dominance of 0.5 means 50/50 split — the score will be ±50. This makes the entry threshold meaningful: setting it to 60+ blocks all trades where signals are conflicted.

---

## Related Documents

- `docs/signal-fusion-conviction-audit.md` — Original audit identifying the problem (status updated to ✅ Fixed)
