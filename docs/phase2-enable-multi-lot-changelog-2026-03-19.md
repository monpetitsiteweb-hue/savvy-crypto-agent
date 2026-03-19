# Phase 2: Enable Multi-Lot (Pyramiding) — Changelog
## 2026-03-19

---

## Summary

Changed `maxLotsPerSymbol` from **1** to **2**, enabling the system to hold up to 2 independent BUY positions per symbol simultaneously.

---

## Changes Made

### 1. `src/utils/configDefaults.ts` — Line 75

**Before:**
```typescript
MAX_LOTS_PER_SYMBOL: 1,  // 1 = current behavior (single position). Increase to enable pyramiding.
```

**After:**
```typescript
MAX_LOTS_PER_SYMBOL: 2,  // 2 = allows up to 2 independent lots per symbol (pyramiding enabled).
```

**Why:** Frontend config default updated to reflect new operational limit.

---

### 2. `supabase/functions/trading-decision-coordinator/index.ts` — Gate 5b (Line ~6012)

**Before:**
```typescript
// Default: 1 (preserves current single-position behavior).
const MAX_LOTS_PER_SYMBOL = cfg.maxLotsPerSymbol ?? 1;
```

**After:**
```typescript
// Default: 2 (Phase 2 — allows up to 2 independent lots per symbol).
const MAX_LOTS_PER_SYMBOL = cfg.maxLotsPerSymbol ?? 2;
```

**Why:** The coordinator fallback must match the new default. Without this change, strategies without explicit `maxLotsPerSymbol` in their DB config would remain locked at 1.

---

## What Was NOT Changed

| Component | Status |
|---|---|
| SELL logic | Untouched |
| lotEngine.ts | Untouched |
| poolManager.ts | Untouched |
| Gate 5 (context dedup) | Untouched |
| Gate 6 (anti-contradictory) | Untouched |
| Exposure checks | Untouched |
| Thresholds | Untouched |
| Fusion scoring | Untouched |

---

## Expected Behavior

| Scenario | Result |
|---|---|
| 1st BUY on symbol | ✅ Allowed |
| 2nd BUY on symbol (different context) | ✅ Allowed |
| 3rd BUY on symbol | 🚫 Blocked (`max_lots_per_symbol_reached`) |
| 2nd BUY on symbol (same context) | 🚫 Blocked by Gate 5 (context dedup) |
| BUY within 60s of SELL on same symbol | 🚫 Blocked by Gate 6 (anti-contradictory) |

---

## Validation Queries

```sql
-- 1. Check multi-lot exists (expect rows with 2 lots)
SELECT cryptocurrency, COUNT(*) as open_lots
FROM mock_trades
WHERE is_open_position = true
GROUP BY cryptocurrency
HAVING COUNT(*) > 1;

-- 2. Ensure limit enforced (expect 0 rows)
SELECT cryptocurrency, COUNT(*) as open_lots
FROM mock_trades
WHERE is_open_position = true
GROUP BY cryptocurrency
HAVING COUNT(*) > 2;

-- 3. Check guard is active
SELECT reason, COUNT(*)
FROM decision_events
WHERE reason = 'max_lots_per_symbol_reached'
AND created_at > NOW() - INTERVAL '30 minutes'
GROUP BY reason;

-- 4. No regression
SELECT reason, COUNT(*)
FROM decision_events
WHERE created_at > NOW() - INTERVAL '30 minutes'
GROUP BY reason;
```

---

## Safety Model

- Gate 5b enforces `maxLotsPerSymbol = 2` (coordinator-level)
- Gate 5 blocks duplicate contexts (same trigger + timeframe + price)
- Gate 6 blocks BUY during active unwind (60s cooldown)
- Exposure checks cap total per-symbol and portfolio exposure
- `clearOpenPositionIfFullyClosed()` correctly handles multi-lot net position clearing
