# Phase 2 Fix: Revert Coordinator Fallback to Conservative Default — Changelog
## 2026-03-19

---

## Summary

Reverted the coordinator's `maxLotsPerSymbol` fallback from `2` back to `1` to prevent implicit pyramiding when strategy config is missing. The frontend default in `configDefaults.ts` remains `2`.

---

## Problem

The initial Phase 2 implementation changed **both**:
1. `configDefaults.ts` → `MAX_LOTS_PER_SYMBOL: 2` ✅ (correct)
2. Coordinator fallback → `cfg.maxLotsPerSymbol ?? 2` ❌ (unsafe)

This meant any strategy **without** an explicit `maxLotsPerSymbol` in its DB config would silently enable pyramiding — violating the fail-closed principle.

---

## Changes Made

### 1. `supabase/functions/trading-decision-coordinator/index.ts` — Gate 5b

**Before (unsafe):**
```typescript
const MAX_LOTS_PER_SYMBOL = cfg.maxLotsPerSymbol ?? 2;
```

**After (fixed):**
```typescript
const MAX_LOTS_PER_SYMBOL = cfg.maxLotsPerSymbol ?? 1;
```

**Why:** The fallback must remain conservative (`1` = single position). Pyramiding is only enabled when `cfg.maxLotsPerSymbol` is explicitly set in the strategy's DB configuration. This ensures fail-closed behavior: missing config = no pyramiding.

---

## What Was NOT Changed

| Component | Status |
|---|---|
| `src/utils/configDefaults.ts` | Untouched — remains `MAX_LOTS_PER_SYMBOL: 2` |
| SELL logic | Untouched |
| lotEngine.ts | Untouched |
| poolManager.ts | Untouched |
| All other gates | Untouched |
| Thresholds | Untouched |

---

## Safety Model After Fix

| Scenario | Coordinator Behavior |
|---|---|
| Strategy has `maxLotsPerSymbol: 2` in DB config | ✅ Allows up to 2 lots |
| Strategy has `maxLotsPerSymbol: 1` in DB config | ✅ Allows 1 lot only |
| Strategy has **no** `maxLotsPerSymbol` in DB config | ✅ Falls back to `1` (conservative) |
| `configDefaults.ts` value | UI/frontend default only — does not affect coordinator fallback |

---

## Architecture Rule

```
Frontend config (configDefaults.ts)  →  UI defaults for display/settings
Coordinator fallback (?? 1)          →  Runtime safety net, always conservative
DB strategy config                   →  Source of truth for live trading
```

Pyramiding is **only** active when the DB config explicitly says so. The coordinator never assumes multi-lot capability.
