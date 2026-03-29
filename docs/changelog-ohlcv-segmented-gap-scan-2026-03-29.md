# Changelog: OHLCV Segmented Gap Scan

**Date:** 2026-03-29

---

## Problem

The bidirectional edge-based gap-fill (added 2026-03-28) suffered from **interior gap blindness**. Symbols like DOT-EUR, BCH-EUR, AVAX-EUR had hundreds of small interior gaps invisible to edge-only logic, causing +21–137 rows/run instead of ~2,000–3,000.

---

## Files Modified

### 1. `supabase/functions/ohlcv-backfill/index.ts`

#### Added: `InteriorGap` interface (new)

```typescript
interface InteriorGap {
  gapStart: string;
  gapEnd: string;
  gapMinutes: number;
}
```

#### Added: `findLargestInteriorGap()` function (new)

- Calls `supabase.rpc('find_largest_ohlcv_gap', ...)` to detect the largest interior gap > 10 min
- Falls back to `findLargestInteriorGapClientSide()` if RPC is unavailable

#### Added: `findLargestInteriorGapClientSide()` function (new)

- Fetches up to 9,000 `ts_utc` values, iterates to find largest gap > 10 min
- Used only if Postgres RPC call fails

#### Modified: Main processing loop (native granularities block)

**Before (lines ~574–648):**
```
Edge-only logic:
  Case 1: Empty → full seed
  Case 2: startTime < existingOldest → historical edge fill
  Case 3: existingNewest < endTime → forward edge fill
```

**After:**
```
Priority-based logic:
  Case 1: Empty → full seed
  Case 2: Interior gap > 10 min found → fetch from gap start through endTime
  Case 3: No interior gaps → historical edge fill (if applicable)
  Case 4: No interior gaps → forward edge fill (if applicable)
```

Key change: interior gap detection runs **first**. If found, edge logic is **skipped**. The fetch window extends from `gapStart` to `endTime` (not just `gapEnd`), allowing one run to fill across multiple consecutive gaps.

#### Added: `fill_strategy` field in response object

New values: `full-seed`, `interior-gap`, `historical-edge`, `forward-edge`, `bidirectional-edge`, `complete`

---

### 2. Database: new function `public.find_largest_ohlcv_gap()` (migration)

```sql
CREATE OR REPLACE FUNCTION public.find_largest_ohlcv_gap(
  p_symbol TEXT,
  p_granularity TEXT,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ,
  p_min_gap_minutes NUMERIC DEFAULT 10
)
RETURNS TABLE(gap_start TIMESTAMPTZ, gap_end TIMESTAMPTZ, gap_minutes NUMERIC)
```

- Uses `LEAD(ts_utc) OVER (ORDER BY ts_utc)` window function
- Filters gaps > `p_min_gap_minutes`
- Returns the single largest gap
- Uses existing `(symbol, granularity, ts_utc)` index — no full table scan
- `SECURITY INVOKER`, `STABLE`, `search_path = public`

---

## Files NOT Modified

- Workflow files (no changes)
- Rate limiter logic
- 4h synthesis logic
- Upsert logic / idempotency constraint
- Health metrics updates
- Authentication flow
- 50s elapsed-time guard
- Coordinator
- Live crons

---

## Verification (DOT-EUR test)

| Metric | Before | After |
|--------|--------|-------|
| Rows added per rerun | ~21 | 507 fetched in one run |
| Fill strategy | edge-only | `interior-gap` detected |
| Largest gap found | invisible | 280 min at `2026-03-21 02:40` |
| Status | partial convergence | `complete` (full window covered) |

**Note:** Some gaps represent genuine Coinbase data holes (no candles available). These are harmless — idempotent upsert skips them safely.
