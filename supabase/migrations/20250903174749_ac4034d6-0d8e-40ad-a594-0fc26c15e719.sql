-- Create a stable view for price data with indicators
CREATE OR REPLACE VIEW price_data_with_indicators AS
SELECT 
  id,
  symbol,
  metadata,
  timestamp,
  source_id,
  user_id,
  open_price,
  high_price,
  low_price,
  close_price,
  volume,
  interval_type,
  source,
  created_at,
  (metadata ? 'indicators') AS has_indicators
FROM price_data
WHERE metadata ? 'indicators';

-- Add an index to speed up the view
CREATE INDEX IF NOT EXISTS idx_price_data_indicators_timestamp 
ON price_data USING GIN (metadata) 
WHERE metadata ? 'indicators';