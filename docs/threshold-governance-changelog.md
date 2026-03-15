# Threshold Governance Migration — Changelog

**Date:** 2026-03-15  
**Scope:** Unified 0–100 threshold scale, fail-closed config, backward compatibility  
**Breaking changes:** None — backward compatibility conversion included

---

## Summary

Migrated all fusion entry/exit thresholds from the legacy 0–1 scale to a unified 0–100 scale that matches the directional dominance fusion output (`fusedScore ∈ [-100, +100]`). Removed all hardcoded threshold fallbacks and enforced fail-closed behavior when configuration is missing.

---

## Problem

After the directional dominance model was deployed, thresholds remained on the old 0–1 scale:

- `ENTER_THRESHOLD: 0.0` — any signal triggers entry
- `config.enterThreshold || 0.15` — hardcoded fallback in shadow engine
- AI assistant parameter schema validated `range: [0, 1]`
- UI sliders ranged `0.01–0.20`

The fusion output is now `[-100, +100]` (frontend `signalFusion.ts` / coordinator) or `[-1, +1]` (shadow engine / frontend hook). Thresholds on the 0–1 scale were effectively meaningless for the `[-100, +100]` output and far too permissive for the `[-1, +1]` output.

---

## Solution: Unified 0–100 Scale

All thresholds are now stored as **0–100 integers** representing minimum directional dominance percentage.

Example: `enterThreshold = 65` means "at least 65% of signal mass must agree on direction before entry is allowed."

### Score ranges

| Range | Meaning |
|-------|---------|
| 0–40 | Weak / noise |
| 40–60 | Conflicted signals |
| 60–75 | Moderate conviction |
| 75–90 | Strong conviction |
| 90–100 | Near-unanimous |

### Engine normalization

Engines operating in `[-1, +1]` scale normalize before comparison:

```typescript
const normalizedThreshold = enterThreshold / 100; // 65 → 0.65
const meetsThreshold = Math.abs(score) >= normalizedThreshold;
```

---

## Files Modified

### 1. `src/utils/configDefaults.ts`

**Changed:**
```typescript
// Before:
ENTER_THRESHOLD: 0.0,
EXIT_THRESHOLD: 0.0,

// After:
ENTER_THRESHOLD: 65,
EXIT_THRESHOLD: 50,
```

### 2. `src/utils/aiConfigHelpers.ts`

**Changed (AI feature layer, L60-71):**
- Added backward compat conversion: `if (value <= 1) value = value * 100`
- Applied to both AI feature reads and AI override validation

**Changed (override validation, L113-120):**
```typescript
// Before:
if (value >= 0.1 && value <= 1.0)

// After:
const normalizedValue = value <= 1 ? value * 100 : value;
if (normalizedValue >= 10 && normalizedValue <= 100)
```

### 3. `src/components/strategy/AIIntelligenceSettings.tsx`

**Changed (defaults, L107-108):**
```typescript
// Before:
enterThreshold: 0.02,
exitThreshold: 0.01,

// After:
enterThreshold: 65,
exitThreshold: 50,
```

**Changed (presets):**
- Micro-Scalp: `enterThreshold: 60, exitThreshold: 45`
- Aggressive: `enterThreshold: 55, exitThreshold: 40`

**Changed (sliders, L385-421):**
```typescript
// Before:
min={0.01} max={0.20} step={0.005}
Label: "Enter Threshold: 0.020"

// After:
min={0} max={100} step={1}
Label: "Enter Threshold: 65"
Guidance: "Typical: 60–70 (strong directional agreement required)"
```

### 4. `src/hooks/useIntelligentTradingEngine.tsx`

**Changed (L1507-1558):**
- Loads raw thresholds from config (0–100 scale)
- Applies backward compat conversion: `if (raw <= 1) raw = raw * 100`
- Normalizes to `[-1, +1]` scale: `threshold / 100`
- Logs both raw and normalized values:
  ```
  📊 [FUSION] Threshold governance for BTC-EUR (BUY):
    rawEnterThreshold: 65
    normalizedEnterThreshold: 0.65
  ```
- Decision reasons include both values: `score=0.720 >= threshold=0.650 [raw=65]`
- `effectiveConfig` output stores raw (0–100) values for snapshot compatibility

### 5. `supabase/functions/backend-shadow-engine/index.ts`

**Changed (L1034-1065):**
```typescript
// Before:
const enterThreshold = config.enterThreshold || 0.15;

// After:
const rawEnterThreshold = config.enterThreshold;
if (rawEnterThreshold === undefined || rawEnterThreshold === null) {
  // FAIL CLOSED — block entry, log error
  continue;
}
const enterThreshold100 = rawEnterThreshold <= 1 ? rawEnterThreshold * 100 : rawEnterThreshold;
const enterThreshold = enterThreshold100 / 100;
```

- Added `📊 [THRESHOLD]` structured log with raw, scaled, and normalized values
- Metadata now includes both `enterThreshold` (raw) and `enterThresholdNormalized`
- Fail-closed: missing config produces `blocked_missing_config:enterThreshold`

### 6. `supabase/functions/ai-trading-assistant/index.ts`

**Changed (L981-1000):**
```typescript
// Before:
range: [0, 1],
description: 'Signal fusion enter threshold (0-1)'

// After:
range: [0, 100],
description: 'Signal fusion enter threshold (0-100, directional dominance %)'
```

---

## Backward Compatibility

All threshold read points include automatic conversion:

```typescript
if (threshold <= 1) threshold = threshold * 100;
```

This ensures existing configs with values like `0.15` are automatically converted to `15` at read time.

---

## Unchanged

- `fusedScore` output range: `[-100, +100]` (signalFusion.ts, coordinator)
- Shadow engine internal fusion: `[-1, +1]`
- Decision snapshots schema and fields (`signals_used`, `source_contributions`, `signal_breakdown_json`)
- Signal generation logic
- Portfolio accounting
- ML dataset lineage

---

## Verification Checklist

- [ ] Dominance ~50 → HOLD (threshold 65 not met)
- [ ] Dominance ~72 → BUY (threshold 65 met)
- [ ] Snapshots contain `signals_used`, `source_contributions`, `signal_breakdown_json`
- [ ] No hardcoded threshold fallbacks remain in codebase
- [ ] Old configs with 0–1 values auto-convert correctly
