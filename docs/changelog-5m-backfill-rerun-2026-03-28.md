# Changelog — 5m Backfill Rerun & Features Historical Seed

**Date:** 2026-03-28  
**Scope:** Targeted OHLCV rerun workflow + one-time features seed mechanism

---

## Files Created

| File | Purpose |
|---|---|
| `.github/workflows/ohlcv-5m-backfill-rerun.yml` | Targeted rerun: 1 symbol per batch (7 symbols: ETH, ADA, SOL, DOT, BCH, AVAX, LINK), `max-parallel: 1`, with HTTP status validation |
| `.github/workflows/features-5m-historical-seed.yml` | One-time features seed: 1 symbol per batch (all 10), passes `_seed_limit: 9000` for full 30-day coverage |

## Files Modified

| File | Change |
|---|---|
| `supabase/functions/features-refresh/index.ts` | Added optional `queryLimit` parameter to `computeFeatures()`. Reads `_seed_limit` from payload — when absent, defaults to 2200 (5m) / 500 (others). Production pg_cron is unchanged. |

## Files NOT Modified

- `supabase/functions/ohlcv-backfill/index.ts` — no changes needed, rerun uses existing function
- `supabase/functions/ohlcv-live-ingest/index.ts` — untouched
- Default granularity arrays — still `["1h", "4h", "24h"]` everywhere
- Coordinator — zero changes

## Design Decisions

1. **One symbol per batch** — avoids the 60s Edge Function wall-clock timeout that caused the original seed failures
2. **`_seed_limit` payload parameter** — temporary override, not a permanent config change. Production `features-refresh` pg_cron sends no `_seed_limit`, so it defaults to 2200
3. **Both workflows are `workflow_dispatch` only** — manual trigger, no cron schedule

## Execution Sequence

1. Merge to default branch so workflows appear in GitHub Actions
2. Run `ohlcv-5m-backfill-rerun` — verify all 10 symbols have ~8,640 rows
3. Run `features-5m-historical-seed` — verify features coverage matches OHLCV
4. Proceed with `entry_filter_shadow` implementation
