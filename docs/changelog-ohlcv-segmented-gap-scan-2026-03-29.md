# Changelog: OHLCV Segmented Gap Scan

**Date:** 2026-03-29  
**Files modified:**
- `supabase/functions/ohlcv-backfill/index.ts`
- Database: new function `public.find_largest_ohlcv_gap()`

## Problem

The bidirectional edge-based gap-fill (added 2026-03-28) suffered from **interior gap blindness**. When a previous run seeded day -30 to day -20 before timing out, `existingOldest` was already at day -30, so subsequent reruns saw no historical edge gap and only added ~20–40 rows per run from forward drift. Interior gaps (e.g., day -20 → day -8) were invisible to the edge-only logic.

## Root Cause

The resume logic only compared `startTime` vs `existingOldest` and `existingNewest` vs `endTime`. Any gap **between** existing rows was never detected.

## Changes

### Added: `find_largest_ohlcv_gap()` — Postgres function (migration)

```sql
CREATE OR REPLACE FUNCTION public.find_largest_ohlcv_gap(
  p_symbol, p_granularity, p_window_start, p_window_end, p_min_gap_minutes
)
```

- Uses `LEAD(ts_utc) OVER (ORDER BY ts_utc)` window function
- Filters for gaps > `p_min_gap_minutes` (default 10)
- Returns the single largest gap (`gap_start`, `gap_end`, `gap_minutes`)
- Uses the existing `(symbol, granularity, ts_utc)` index — no full table scan
- `SECURITY INVOKER`, `STABLE`, `search_path = public`

### Added: `InteriorGap` interface

```typescript
interface InteriorGap {
  gapStart: string;
  gapEnd: string;
  gapMinutes: number;
}
```

### Added: `findLargestInteriorGap()` function

- Calls `supabase.rpc('find_largest_ohlcv_gap', ...)` with the backfill window
- Falls back to `findLargestInteriorGapClientSide()` if RPC is unavailable

### Added: `findLargestInteriorGapClientSide()` fallback

- Fetches up to 9,000 `ts_utc` values and iterates to find the largest gap > 10 min
- Used only if the Postgres RPC fails (e.g., function not yet deployed)

### Modified: Main processing loop — priority logic

| Priority | Condition | Action |
|----------|-----------|--------|
| **1** | `bounds.count === 0` | Full seed from scratch |
| **2** | Interior gap > 10 min found | Fetch ONLY that gap window |
| **3** | `startTime < existingOldest` | Historical edge fill |
| **4** | `existingNewest < endTime` | Forward edge fill |

- Interior gap detection runs **before** edge logic
- If an interior gap is found, edge logic is **skipped** for that run
- Each run fills ~2,000–3,000 candles of the largest gap under the 50s guard
- Subsequent reruns find the next-largest remaining gap

### Added: `fill_strategy` field in response

Response now includes `fill_strategy` with values:
- `full-seed` — no existing data
- `interior-gap` — filling detected interior gap
- `historical-edge` — filling before oldest row
- `forward-edge` — filling after newest row
- `bidirectional-edge` — both historical and forward
- `complete` — no gaps found

## Unchanged

- Rate limiter logic
- 4h synthesis logic
- Upsert logic and `(symbol, granularity, ts_utc)` idempotency constraint
- Health metrics updates
- Authentication flow
- 50s elapsed-time guard
- Workflow files

## Progressive Convergence

Each rerun targets the single largest gap. After filling it (or partially filling under the 50s guard), the next run finds the next-largest gap. This guarantees monotonic convergence toward ~8,640 rows per symbol.

## Safety

- Idempotency: guaranteed by unique constraint — no duplicate risk
- No full-window refetch: only targeted gap windows are fetched
- Existing complete symbols (BTC, LTC, XRP, ETH, SOL): will show `fill_strategy: "complete"` or small forward-edge fills

## Verification (DOT-EUR test)

- Interior gap correctly detected: 280-min gap at `2026-03-21 02:40 → 07:20`
- Function fetched from gap start through to endTime (507 candles in one run vs ~2 before)
- `fill_strategy: "interior-gap"` confirmed in response
- Some gaps may represent genuine Coinbase data gaps (no candles available for those windows)
- The function now fills all **fillable** gaps progressively; unfillable gaps (Coinbase data holes) are harmless due to idempotent upsert
