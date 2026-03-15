
-- Fix incorrect threshold values (0.15/0.10 are legacy wrong values, should be 0.65/0.50)
-- Only update if current values are suspiciously low (< 0.30 in 0-1 scale = < 30 in 0-100 scale)
UPDATE trading_strategies
SET configuration = jsonb_set(
  jsonb_set(
    configuration,
    '{signalFusion,enterThreshold}',
    '0.65'::jsonb
  ),
  '{signalFusion,exitThreshold}',
  '0.50'::jsonb
)
WHERE configuration IS NOT NULL
  AND configuration ? 'signalFusion'
  AND (configuration->'signalFusion'->>'enterThreshold')::numeric < 0.30;
