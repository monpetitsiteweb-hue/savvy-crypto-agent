CREATE OR REPLACE FUNCTION public.find_largest_ohlcv_gap(
  p_symbol TEXT,
  p_granularity TEXT,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ,
  p_min_gap_minutes NUMERIC DEFAULT 10
)
RETURNS TABLE(gap_start TIMESTAMPTZ, gap_end TIMESTAMPTZ, gap_minutes NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT gap_start, gap_end, gap_minutes
  FROM (
    SELECT
      ts_utc AS gap_start,
      LEAD(ts_utc) OVER (ORDER BY ts_utc) AS gap_end,
      EXTRACT(EPOCH FROM (LEAD(ts_utc) OVER (ORDER BY ts_utc) - ts_utc)) / 60 AS gap_minutes
    FROM market_ohlcv_raw
    WHERE symbol = p_symbol
      AND granularity = p_granularity
      AND ts_utc >= p_window_start
      AND ts_utc <= p_window_end
  ) sub
  WHERE gap_end IS NOT NULL
    AND gap_minutes > p_min_gap_minutes
  ORDER BY gap_minutes DESC
  LIMIT 1;
$$;