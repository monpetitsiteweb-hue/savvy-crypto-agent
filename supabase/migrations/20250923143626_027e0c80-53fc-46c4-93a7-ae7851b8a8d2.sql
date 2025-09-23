-- Add performance indexes for market data tables
create index if not exists idx_ohlcv_symbol_gran_ts on market_ohlcv_raw(symbol, granularity, ts_utc);
create index if not exists idx_features_symbol_gran_ts on market_features_v0(symbol, granularity, ts_utc);