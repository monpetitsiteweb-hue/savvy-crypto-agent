# Data Foundation - Implementation Pack v1

## Status: ✅ READY FOR TESTING

### What's Delivered

**Database Layer (Migration Required)**
- `market_ohlcv_raw`: Immutable OHLCV storage with unique index on (symbol, granularity, ts_utc)
- `market_features_v0`: Deterministic rolling returns & volatility features  
- `market_data_health`: Observability metrics for coverage, staleness, errors

**Edge Functions**
- `ohlcv-backfill`: Idempotent historical data backfill with rate limiting & circuit breaker
- `ohlcv-live-ingest`: Append-only live ingestion with high-water-mark tracking

**UI Integration**
- Data Health panel in Dev/Learning page showing coverage %, staleness, SLOs
- Simulated metrics until migration is run

### Contracts Implemented

✅ **Raw Layer**: Immutable & unique on (symbol, granularity, ts_utc)  
✅ **Features v0**: Rolling [1h, 4h, 24h, 7d] returns & volatility  
✅ **Rate-safe**: 10 req/sec, exponential backoff, circuit breaker  
✅ **Idempotent**: Duplicate runs yield identical state  
✅ **Observable**: Coverage %, staleness, error tracking  

### Next Steps

1. **Run Migration**: Execute the Supabase migration to create tables
2. **Test Backfill**: Verify 90-day BTC/ETH/ADA/SOL × [1h,4h,24h] ingestion  
3. **Validate SLOs**: Confirm 99.5%+ completeness, <5min live lag
4. **Performance Check**: Sub-second 30-day feature queries

### Acceptance Proofs (Post-Migration)

```sql
-- Completeness: Should show ~12 series with 90d coverage
SELECT symbol, granularity, COUNT(*)
FROM market_ohlcv_raw 
WHERE ts_utc >= NOW() - INTERVAL '90 days'
GROUP BY symbol, granularity;

-- Idempotency: Double backfill should show zero new records
-- (Run backfill twice, compare counts)

-- Performance: Should return <1s
SELECT * FROM market_features_v0 
WHERE ts_utc >= NOW() - INTERVAL '30 days' LIMIT 1000;
```

**Ready for Signals v0 when SLOs are green** ✅