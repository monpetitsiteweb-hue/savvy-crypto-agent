-- Market data foundation tables for production

-- OHLCV raw data table (using consistent column names: open, high, low, close, volume)
CREATE TABLE IF NOT EXISTS public.market_ohlcv_raw (
  symbol text NOT NULL,
  granularity text NOT NULL,
  ts_utc timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (symbol, granularity, ts_utc)
);

-- Features computed from OHLCV data
CREATE TABLE IF NOT EXISTS public.market_features_v0 (
  symbol text NOT NULL,
  granularity text NOT NULL,
  ts_utc timestamptz NOT NULL,
  ret_1h numeric,
  ret_4h numeric,
  ret_24h numeric,
  ret_7d numeric,
  vol_1h numeric,
  vol_4h numeric,
  vol_24h numeric,
  vol_7d numeric,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (symbol, granularity, ts_utc)
);

-- Health monitoring for data quality
CREATE TABLE IF NOT EXISTS public.market_data_health (
  symbol text NOT NULL,
  granularity text NOT NULL,
  last_ts_utc timestamptz,
  last_backfill_at timestamptz,
  last_live_ingest_at timestamptz,
  coverage_pct_90d numeric DEFAULT 0,
  max_staleness_min numeric DEFAULT 0,
  error_count_24h integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (symbol, granularity)
);

-- Enable RLS (read-only for authenticated users)
ALTER TABLE public.market_ohlcv_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_features_v0 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_data_health ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS market_ohlcv_raw_read ON public.market_ohlcv_raw;
DROP POLICY IF EXISTS market_features_v0_read ON public.market_features_v0;
DROP POLICY IF EXISTS market_data_health_read ON public.market_data_health;

-- Authenticated users can read only
CREATE POLICY market_ohlcv_raw_read
  ON public.market_ohlcv_raw FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY market_features_v0_read
  ON public.market_features_v0 FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY market_data_health_read
  ON public.market_data_health FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Health metrics refresh function with correct string granularities
CREATE OR REPLACE FUNCTION public.refresh_data_health_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update health metrics for each symbol/granularity combination
  INSERT INTO public.market_data_health (
    symbol, 
    granularity, 
    last_ts_utc, 
    coverage_pct_90d, 
    max_staleness_min,
    error_count_24h,
    updated_at
  )
  SELECT 
    symbol,
    granularity,
    MAX(ts_utc) as last_ts_utc,
    LEAST(100.0, (COUNT(*) * 100.0 / CASE granularity
      WHEN '1h'  THEN 90 * 24   -- 2,160
      WHEN '4h'  THEN 90 * 6    --   540  
      WHEN '24h' THEN 90        --    90
      ELSE 90 * 24
    END)) as coverage_pct_90d,
    EXTRACT(EPOCH FROM (NOW() - MAX(ts_utc))) / 60.0 as max_staleness_min,
    0 as error_count_24h,
    NOW() as updated_at
  FROM public.market_ohlcv_raw
  WHERE ts_utc >= NOW() - INTERVAL '90 days'
  GROUP BY symbol, granularity
  ON CONFLICT (symbol, granularity) 
  DO UPDATE SET
    last_ts_utc = EXCLUDED.last_ts_utc,
    coverage_pct_90d = EXCLUDED.coverage_pct_90d,
    max_staleness_min = EXCLUDED.max_staleness_min,
    error_count_24h = EXCLUDED.error_count_24h,
    updated_at = EXCLUDED.updated_at;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.refresh_data_health_metrics() TO authenticated;