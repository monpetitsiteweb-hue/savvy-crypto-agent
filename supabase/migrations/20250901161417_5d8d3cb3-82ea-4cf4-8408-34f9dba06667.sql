-- Reduce opposite-action cooldown to 15s for active test strategy to enable gate testing
UPDATE trading_strategies
SET configuration = jsonb_set(
  configuration,
  '{unifiedConfig,cooldownBetweenOppositeActionsMs}',
  '15000'::jsonb,
  true
)
WHERE is_active_test = true;