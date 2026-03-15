# Signal Fusion Conviction & Threshold Audit

## Date: 2026-03-15

## Status: ✅ Fixed — Directional dominance model implemented (2026-03-15)

---

## 1. Problem Statement

After the database reset, the first executed trades show **immediate slightly negative P&L**. Inspection of decision snapshots reveals the engine is entering trades with **very weak or contradictory directional conviction**.

### Example: BTC BUY Snapshot

| Signal | Type | Contribution |
|--------|------|-------------|
| rsi_overbought_bearish | bearish | **-0.55** |
| momentum_neutral | neutral | +0.15 |
| momentum_neutral | neutral | +0.15 |
| ma_cross_bullish | bullish | +0.14 |
| ma_cross_bullish | bullish | +0.12 |

**Result:** `-0.55 + 0.15 + 0.15 + 0.14 + 0.12 = +0.01` → **BUY executed**

Despite the strongest signal being **bearish**, the engine executed a BUY because the sum of weak bullish signals barely exceeded zero.

---

## 2. Root Cause Analysis

### 2.1 Fusion Uses Simple Summation

Both fusion implementations use linear weighted summation without directional grouping:

**`src/engine/signalFusion.ts` (line 288):**
```typescript
const contribution = normalizedStrength * effectiveWeight * directionMultiplier;
```

**`supabase/functions/backend-shadow-engine/index.ts` (~line 515):**
```typescript
function computeFusionScore(signals) {
  let total = 0;
  for (const s of signals) {
    total += s.normalizedStrength * s.weight * s.directionMultiplier;
  }
  return Math.max(-1, Math.min(1, total));
}
```

There is **no directional split** — all contributions feed into a single accumulator.

### 2.2 No Directional Dominance Check

The system never computes:
```
bullish_total = sum of all positive contributions
bearish_total = sum of all negative contributions
```

And never enforces:
```
BUY only if bullish_total > |bearish_total| by margin X
```

A single strong bearish signal can be **diluted** by multiple weak bullish signals.

### 2.3 Entry Thresholds Are Near Zero

| Location | Default | Scale | Effect |
|----------|---------|-------|--------|
| `src/utils/configDefaults.ts` | `ENTER_THRESHOLD: 0.0` | 0–1 | Any non-negative score triggers entry |
| `backend-shadow-engine` | `0.15` | -1 to +1 | Very low bar for BUY |

**`configDefaults.ts` (line 10-11):**
```typescript
ENTER_THRESHOLD: 0.0,
EXIT_THRESHOLD: 0.0,
```

**`backend-shadow-engine` (~line 1014-1021):**
```typescript
if (fusionScore > entryThreshold) {
  // → triggers BUY
}
```

With a threshold of 0.0 or 0.15, even a fusion score of +0.01 triggers a trade.

### 2.4 v2 Source Aggregation Helps But Doesn't Solve It

Signal Fusion v2 introduced per-source aggregation (average, max, latest strategies) which reduces frequency bias. However, the **post-aggregation step still uses simple summation** of per-source contributions, so the directional dilution problem persists at the source level.

---

## 3. Signal Flow & Decision Path

```
live_signals (DB)
    │
    ▼
computeFusedSignalScore()          ← src/engine/signalFusion.ts
    │
    ├── normalize strength (0-1)
    ├── apply weight from registry/strategy override
    ├── apply direction multiplier (+1/-1)
    ├── [v2] aggregate by source
    ├── sum all contributions          ← ⚠️ simple summation
    ├── fusedScore = total × 20        ← scale to [-100, +100]
    │
    ▼
Decision Coordinator                ← supabase/functions/trading-decision-coordinator/
    │
    ├── check fusedScore > threshold   ← ⚠️ threshold ≈ 0
    ├── detectConflicts()
    ├── create decision_event
    ├── create decision_snapshot
    │
    ▼
Backend Shadow Engine               ← supabase/functions/backend-shadow-engine/
    │
    ├── computeSignalScores()          ← independent signal computation
    ├── computeFusionScore()           ← ⚠️ same simple summation
    ├── if fusionScore > 0.15 → BUY   ← ⚠️ low threshold
    │
    ▼
Trade Execution
    │
    ├── mock_trades (insert)
    ├── portfolio_capital (update)
    │
    ▼
Decision Outcomes (later evaluation)
```

---

## 4. Files Involved

| File | Role | Lines of Interest |
|------|------|-------------------|
| `src/engine/signalFusion.ts` | Fusion computation (coordinator path) | L288 (contribution calc), L320-344 (summation), L344 (score scaling) |
| `supabase/functions/backend-shadow-engine/index.ts` | Fusion computation (engine path) | ~L326 (signal scores), ~L515 (fusion score), ~L1014 (entry decision) |
| `src/utils/configDefaults.ts` | Default thresholds | L10-11 (`ENTER_THRESHOLD: 0.0`) |
| `src/hooks/useIntelligentTradingEngine.tsx` | Frontend decision threshold | Passes threshold to engine |
| `supabase/functions/trading-decision-coordinator/index.ts` | Coordinator decision logic | Calls fusion, applies threshold |

---

## 5. The Dilution Problem — Formal Description

### Current behavior:

```
score = Σ (strength_i × weight_i × direction_i)
```

### Problem scenario:

| Signal | Strength | Weight | Direction | Contribution |
|--------|----------|--------|-----------|-------------|
| RSI Overbought | 0.70 | 1.0 | -1 (bearish) | **-0.70** |
| MA Cross | 0.30 | 1.0 | +1 (bullish) | +0.30 |
| Momentum | 0.20 | 1.0 | +1 (bullish) | +0.20 |
| Momentum | 0.20 | 1.0 | +1 (bullish) | +0.20 |
| **Total** | | | | **+0.00** |

Result: Score ≈ 0, which still passes a threshold of 0.0 → **BUY triggered in a conflicted market**.

### What should happen:

The engine should recognize that:
- Bearish contribution magnitude: 0.70
- Bullish contribution magnitude: 0.70
- **Net conviction: ~0** → **NO TRADE** (conflicted signals)

---

## 6. Potential Fixes (Not Yet Implemented)

### Fix 1: Directional Dominance Filter

Before executing, split contributions by direction and require dominance:

```typescript
const bullishTotal = contributions.filter(c => c > 0).reduce((a, b) => a + b, 0);
const bearishTotal = Math.abs(contributions.filter(c => c < 0).reduce((a, b) => a + b, 0));

const dominanceRatio = Math.max(bullishTotal, bearishTotal) / (bullishTotal + bearishTotal);
const MIN_DOMINANCE = 0.6; // 60% of signal mass must agree

if (dominanceRatio < MIN_DOMINANCE) {
  return 'HOLD'; // conflicted signals
}
```

### Fix 2: Minimum Conviction Threshold

Raise the entry threshold significantly:

```typescript
// configDefaults.ts
ENTER_THRESHOLD: 0.35,  // was 0.0
```

### Fix 3: Strongest Signal Veto

If the single strongest signal contradicts the aggregated direction, require a higher threshold:

```typescript
const strongestSignal = signals.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0];
const aggregatedDirection = Math.sign(fusedScore);
const strongestDirection = Math.sign(strongestSignal.contribution);

if (strongestDirection !== aggregatedDirection) {
  requiredThreshold *= 2; // double the bar when strongest disagrees
}
```

### Fix 4: Conflict Detection Gate

Add a pre-trade "signal conflict" check:

```typescript
const hasConflict = bullishTotal > 0.1 && bearishTotal > 0.1;
const conflictSeverity = Math.min(bullishTotal, bearishTotal) / Math.max(bullishTotal, bearishTotal);

if (hasConflict && conflictSeverity > 0.5) {
  return 'HOLD'; // signals too conflicted
}
```

---

## 7. Recommendation

**Severity: Medium-High**

The engine is currently capable of executing trades in **any market condition** as long as noise signals slightly outweigh a strong opposing signal. This leads to:

- Trades with near-zero conviction
- Immediate negative P&L from spread/fees
- Poor signal-to-noise ratio in the trade dataset (bad for ML training)

### Suggested priority:

1. **Raise `ENTER_THRESHOLD`** to 0.30–0.40 (quick win, low risk)
2. **Add directional dominance filter** (medium effort, high impact)
3. **Add strongest-signal veto** (medium effort, prevents worst cases)
4. **Add conflict detection gate** (comprehensive solution)

### Implementation order:

Fix 1 + Fix 2 can be applied together as a first iteration. Fix 3 and Fix 4 are refinements for a second pass.

---

## 8. Affected Decision Count (Post-Reset)

Based on the audit:

- **Total decisions:** 10
- **BUY decisions executed:** 4
- **BUY decisions with weak/conflicted signals:** ≥2 (BTC, ETH confirmed)
- **Estimated false-positive rate:** ~50% of BUY decisions

This confirms the problem is **active and affecting live trading behavior**.
