# Changelog: OHLCV Backfill Resume Pagination

**Date:** 2026-03-28  
**File:** `supabase/functions/ohlcv-backfill/index.ts`

## Problem

The 60-second Edge Function wall-clock limit caused partial backfills for 5 of 10 symbols (ADA, LINK, AVAX, BCH, DOT). Each rerun restarted the full 30-day window, re-fetching already-stored candles.

## Changes

### Added: `fetchExistingBounds()` (new function)
Queries `market_ohlcv_raw` for the oldest and newest `ts_utc` plus row count for a given (symbol, granularity) pair. Uses three parallel Supabase queries.

### Added: `FetchResult` interface
Return type for `fetchCoinbaseCandlesPaginated` now includes:
- `candles: CoinbaseCandle[]`
- `timedOut: boolean`
- `lastFetchedStart?: string`

### Modified: `fetchCoinbaseCandlesPaginated()`
- **New parameter:** `functionStartTime: number` — wall-clock start for elapsed guard
- **Elapsed-time guard:** Checks `Date.now() - functionStartTime > 50_000ms` at the top of each pagination loop. Stops cleanly with `timedOut: true` instead of being killed at 60s.
- **Return type:** Now returns `FetchResult` instead of `CoinbaseCandle[]`

### Modified: Main processing loop (native granularities block)
Replaced single full-window fetch with **bidirectional gap-fill**:

| Case | Condition | Action |
|------|-----------|--------|
| **Empty** | `bounds.count === 0` | Full seed from `startTime` → `endTime` |
| **Historical gap** | `startTime < existingOldest` | Fetch `startTime` → `existingOldest` only |
| **Forward gap** | `existingNewest < endTime` | Fetch `existingNewest + 1s` → `endTime` only |

- Forward gap only runs if the historical gap didn't time out
- Result object now includes `existing_count`, `status` ("complete" | "partial"), and `resume_from`

### Added: `functionStartTime` variable
Set once at the start of the processing loop, passed through to all `fetchCoinbaseCandlesPaginated` calls.

## Unchanged
- Rate limiter logic
- 4h synthesis logic
- Upsert logic and idempotency constraint
- Health metrics updates
- Authentication flow
- Workflow files (no changes needed)

## Safety
- Idempotency guaranteed by `(symbol, granularity, ts_utc)` unique constraint
- Partial runs are safe to rerun — they will resume from where they left off
- `status: "partial"` in response allows workflows to detect incomplete runs
