# Threshold Config Path Fix

**Date:** 2026-03-15  
**Scope:** System-wide alignment of AI Fusion threshold configuration paths

---

## Problem

A configuration mismatch existed between the UI, the database, and the trading engines regarding AI Fusion thresholds (`enterThreshold`, `exitThreshold`).

- **UI sliders** displayed thresholds like Enter = 65, Exit = 50 (0–100 scale)
- **UI save path** correctly wrote to `configuration.signalFusion.enterThreshold`
- **Database** contained legacy values at the wrong path (`0.15` / `0.10`)
- **Shadow engine** read from `config.enterThreshold` (root level) — **wrong path**
- **Shadow engine** read fusion weights from `config.trendWeight` — **wrong path**
- **Frontend helper** (`getFusionConfig`) prioritized the legacy `aiIntelligenceConfig.features.fusion` path over the canonical `signalFusion` path

This caused the shadow engine to log:
```
missing enterThreshold in config. Fail-closed.
```

---

## Changes

### 1. Shadow Engine — Threshold Read Path

**File:** `supabase/functions/backend-shadow-engine/index.ts`  
**Lines:** ~1034–1036

**Before:**
```typescript
const rawEnterThreshold = config.enterThreshold;
```

**After:**
```typescript
// Canonical path: configuration.signalFusion.enterThreshold
const rawEnterThreshold = config.signalFusion?.enterThreshold;
```

The fail-closed behavior is preserved: if `signalFusion.enterThreshold` is missing, the engine returns `HOLD` with reason `blocked_missing_config:enterThreshold`.

---

### 2. Shadow Engine — Fusion Weights Read Path

**File:** `supabase/functions/backend-shadow-engine/index.ts`  
**Lines:** ~522–529 (inside `computeFusionScore()`)

**Before:**
```typescript
function computeFusionScore(scores: SignalScores, config: any): number {
  const fusionWeights = {
    trend: config.trendWeight || 0.35,
    momentum: config.momentumWeight || 0.25,
    volatility: config.volatilityWeight || 0.15,
    whale: config.whaleWeight || 0.15,
    sentiment: config.sentimentWeight || 0.10,
  };
```

**After:**
```typescript
function computeFusionScore(scores: SignalScores, config: any): number {
  // Read weights from canonical path: configuration.signalFusion.weights
  const sfWeights = config.signalFusion?.weights;
  const fusionWeights = {
    trend: sfWeights?.trend ?? 0.35,
    momentum: sfWeights?.momentum ?? 0.25,
    volatility: sfWeights?.volatility ?? 0.15,
    whale: sfWeights?.whale ?? 0.15,
    sentiment: sfWeights?.sentiment ?? 0.10,
  };
```

This ensures the engine uses the same weights the user configured in the UI, with safe defaults if missing.

---

### 3. Frontend Helper — Config Resolution Priority

**File:** `src/utils/aiConfigHelpers.ts`  
**Lines:** ~137–140

**Before:**
```typescript
export function getFusionConfig(strategyConfig: any) {
  // New path first, fallback to old
  return strategyConfig.aiIntelligenceConfig?.features?.fusion || strategyConfig.signalFusion;
}
```

**After:**
```typescript
export function getFusionConfig(strategyConfig: any) {
  // Canonical path: configuration.signalFusion (what UI saves to)
  // Fallback: aiIntelligenceConfig.features.fusion (legacy AI settings panel)
  return strategyConfig.signalFusion || strategyConfig.aiIntelligenceConfig?.features?.fusion;
}
```

The canonical path (`signalFusion`) is now checked first. The legacy path remains as a fallback for backward compatibility.

---

### 4. Database Migration — Path Consolidation

**File:** `supabase/migrations/` (two migrations)

#### Migration A — Consolidate threshold paths

Migrated any thresholds stored at legacy paths into the canonical `configuration.signalFusion`:

- `configuration.enterThreshold` (root level) → `configuration.signalFusion.enterThreshold`
- `configuration.exitThreshold` (root level) → `configuration.signalFusion.exitThreshold`
- `aiIntelligenceConfig.features.fusion.*` → `configuration.signalFusion.*`
- Ensured `signalFusion.weights` exist with defaults if missing

#### Migration B — Correct legacy threshold values

The old values (`0.15` / `0.10`) were incorrect — far too permissive (equivalent to 15% / 10% thresholds). Updated all strategies with suspiciously low thresholds (`< 0.30`) to the intended values:

```
enterThreshold: 0.15 → 0.65
exitThreshold:  0.10 → 0.50
```

---

## Files Not Changed

| Component | Path | Reason |
|---|---|---|
| **UI sliders** | `src/components/strategy/ComprehensiveStrategyConfig.tsx` | Already saves to `configuration.signalFusion` correctly |
| **Coordinator** | `supabase/functions/trading-decision-coordinator/index.ts` | Uses `aiConfidenceThreshold` (separate system, not fusion thresholds) |
| **Frontend engine** | `src/hooks/useIntelligentTradingEngine.tsx` | Uses `getFusionConfig()` helper which was fixed upstream |

---

## Verified DB State After Fix

```json
{
  "signalFusion": {
    "enabled": true,
    "enterThreshold": 0.65,
    "exitThreshold": 0.50,
    "conflictPenalty": 0.3,
    "weights": {
      "trend": 0.25,
      "volatility": 0.20,
      "momentum": 0.25,
      "whale": 0.15,
      "sentiment": 0.15
    }
  }
}
```

---

## Single Source of Truth

After this fix, all engines read thresholds and weights from one canonical location:

```
trading_strategies.configuration.signalFusion.*
```

No other threshold location (`configuration.enterThreshold`, `aiIntelligenceConfig.features.fusion.*`, `unified_config.*`) is authoritative.
