# Changelog — 5m Pipeline Implementation

**Date:** 2026-03-28  
**Scope:** 5m OHLCV ingestion, feature computation, lifecycle retention

## Changes Made

### Edge Functions Modified

| File | Change |
|---|---|
| `supabase/functions/ohlcv-backfill/index.ts` | Added `'5m': 300` to granularity map (native Coinbase 5m support) |
| `supabase/functions/ohlcv-live-ingest/index.ts` | Added `'5m': 300` granularity; replaced fractional `step` with integer `stepMinutes` map (`{5m:5, 1h:60, 4h:240, 24h:1440}`); added `'5m'` to default granularities |
| `supabase/functions/features-refresh/index.ts` | Replaced fractional `step` with integer `stepMinutes`; raised query limit to 2200 for 5m (7d window = 2016 candles); added `'5m'` to default granularities |
| `supabase/functions/price-data-lifecycle/index.ts` | Added Step 4: bounded batch pruning for `granularity='5m'` rows in `market_ohlcv_raw` and `market_features_v0` (45-day hot window, 5000-row batches) |

### Files Created

| File | Purpose |
|---|---|
| `.github/workflows/ohlcv-5m-backfill-seed.yml` | One-time manual workflow to seed 30-day 5m backfill (4 sequential batches of symbols) |

### Database Changes (Migrations)

| Change | Description |
|---|---|
| `prune_5m_market_data_batch()` RPC | SECURITY DEFINER function for bounded 5m pruning; accepts only `market_ohlcv_raw` or `market_features_v0`; uses ctid-based LIMIT delete |
| `ohlcv-live-ingest-5m` pg_cron | `*/5 * * * *` — ingests 5m candles for 10 EUR symbols via vault credentials |
| `features-refresh-5m` pg_cron | `1-59/5 * * * *` — computes 5m features 1 minute after ingest, 8-day lookback |

### Key Design Decisions

1. **Integer stepMinutes** — All window scaling uses integer division (`Math.round(60/5)=12`) to eliminate floating-point corruption risk from `1/12 = 0.08333...`
2. **Retention ships with pipeline** — 45-day 5m pruning in `price-data-lifecycle` is live from day one (lesson from price_data incident)
3. **Supabase-native scheduling** — pg_cron with vault credentials (no GitHub Actions for recurring 5m jobs)
4. **Query limit raised** — `features-refresh` uses 2200-row limit for 5m to support 7d volatility window (2016 candles)

### Indexes Verified

- `idx_market_ohlcv_raw_symbol_granularity_ts` on `(symbol, granularity, ts_utc DESC)` — already exists
- `idx_ohlcv_symbol_gran_ts` — already exists

### Row Growth Estimate

- OHLCV: ~2,880 rows/day (10 symbols × 288 bars)
- Features: ~2,880 rows/day
- Total: ~5,760 rows/day → ~172,800 rows/30 days
- Lifecycle prunes at 45 days → steady state ~259,200 rows

### Next Steps

1. **Trigger backfill**: Run `ohlcv-5m-backfill-seed` workflow manually from GitHub Actions
2. **Verify**: Check `market_ohlcv_raw WHERE granularity='5m'` counts per symbol
3. **Monitor**: Watch pg_cron logs for `ohlcv-live-ingest-5m` and `features-refresh-5m`
4. **Shadow validation**: Once 5m data is seeded, proceed with entry_filter_shadow using 5m RSI/EMA50
