
-- Patch Carlos's imported strategy with required root-level config fields
UPDATE trading_strategies
SET configuration = configuration || jsonb_build_object(
  'aiConfidenceThreshold', 0.5,
  'priceStaleMaxMs', 15000,
  'spreadThresholdBps', 150,
  'minHoldPeriodMs', COALESCE((configuration->'unifiedConfig'->>'minHoldPeriodMs')::int, 120000),
  'cooldownBetweenOppositeActionsMs', COALESCE((configuration->'unifiedConfig'->>'cooldownBetweenOppositeActionsMs')::int, 5000)
)
WHERE id = '1fdc9428-1560-4acd-9c39-fff723b75202';

-- Also ensure ALL strategies have these fields (defensive patch for any other imports)
UPDATE trading_strategies
SET configuration = configuration || jsonb_build_object(
  'aiConfidenceThreshold', COALESCE((configuration->>'aiConfidenceThreshold')::numeric, 0.5),
  'priceStaleMaxMs', COALESCE((configuration->>'priceStaleMaxMs')::int, 15000),
  'spreadThresholdBps', COALESCE((configuration->>'spreadThresholdBps')::int, 150),
  'minHoldPeriodMs', COALESCE(
    (configuration->>'minHoldPeriodMs')::int, 
    (configuration->'unifiedConfig'->>'minHoldPeriodMs')::int, 
    120000
  ),
  'cooldownBetweenOppositeActionsMs', COALESCE(
    (configuration->>'cooldownBetweenOppositeActionsMs')::int, 
    (configuration->'unifiedConfig'->>'cooldownBetweenOppositeActionsMs')::int, 
    5000
  )
)
WHERE configuration->>'aiConfidenceThreshold' IS NULL
   OR configuration->>'priceStaleMaxMs' IS NULL
   OR configuration->>'spreadThresholdBps' IS NULL
   OR configuration->>'minHoldPeriodMs' IS NULL
   OR configuration->>'cooldownBetweenOppositeActionsMs' IS NULL;
