# Changelog — 5m Pipeline Feasibility Audit

**Date:** 2026-03-28  
**Scope:** Read-only audit, no code or schema changes

## Changes Made

**None.** This was a feasibility analysis only — no files were created, modified, or deleted.

## Files Read (for analysis)

| File | Purpose |
|---|---|
| `supabase/functions/ohlcv-live-ingest/index.ts` | Identified data source (Coinbase Exchange API), granularity mapping, rate limiter, feature computation logic |
| `supabase/functions/ohlcv-backfill/index.ts` | Identified pagination strategy, 4h synthesis from 1h, backfill window logic |

## Findings

1. **Data source:** Coinbase Exchange REST API (`api.exchange.coinbase.com`), supports `granularity=300` (5m) natively
2. **Storage:** No new tables needed — `market_ohlcv_raw` and `market_features_v0` accept any granularity string via `(symbol, granularity, ts_utc)` unique constraint
3. **Row growth estimate:** ~2,880 rows/day OHLCV + ~2,880 rows/day features (10 symbols × 288 bars/day)
4. **Backfill pagination:** ~35 API requests per symbol for 30-day seed (Coinbase max 300 candles/request = 25h per request at 5m)
5. **Rate limiting:** Existing `RateLimiter` class with circuit breaker is reusable

## Next Step (pending approval)

Implement the 5m ingestion pipeline:
- Update `ohlcv-backfill` to support `granularity=300` (5m)
- Update `ohlcv-live-ingest` to support 5m
- Update `features-refresh` to support 5m
- Add GitHub Actions workflow for 5m cron schedule
- Create index `(symbol, granularity, ts_utc DESC)` with `CONCURRENTLY`
