-- RPC for bounded 5m pruning used by price-data-lifecycle
CREATE OR REPLACE FUNCTION public.prune_5m_market_data_batch(
  p_table TEXT,
  p_cutoff TIMESTAMPTZ,
  p_batch_size INT DEFAULT 5000
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INT;
BEGIN
  -- Safety: only allow known tables
  IF p_table NOT IN ('market_ohlcv_raw', 'market_features_v0') THEN
    RAISE EXCEPTION 'Invalid table: %', p_table;
  END IF;

  IF p_table = 'market_ohlcv_raw' THEN
    WITH to_delete AS (
      SELECT ctid FROM market_ohlcv_raw
      WHERE granularity = '5m' AND ts_utc < p_cutoff
      LIMIT p_batch_size
    )
    DELETE FROM market_ohlcv_raw WHERE ctid IN (SELECT ctid FROM to_delete);
  ELSE
    WITH to_delete AS (
      SELECT ctid FROM market_features_v0
      WHERE granularity = '5m' AND ts_utc < p_cutoff
      LIMIT p_batch_size
    )
    DELETE FROM market_features_v0 WHERE ctid IN (SELECT ctid FROM to_delete);
  END IF;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;