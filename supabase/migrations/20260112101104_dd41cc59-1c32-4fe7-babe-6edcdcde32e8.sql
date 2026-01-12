
-- Patch missing canonical config fields for users Carlos Isturiz and Johann Baraut
-- These fields are REQUIRED by trading-decision-coordinator to execute trades
-- 
-- Missing fields being added:
-- - aiConfidenceThreshold (50 = 50% confidence minimum)
-- - priceStaleMaxMs (15000 = 15 seconds max price staleness)
-- - spreadThresholdBps (30 = 0.30% max spread)
-- - minHoldPeriodMs (120000 = 2 minute minimum hold)
-- - cooldownBetweenOppositeActionsMs (30000 = 30 second cooldown)

UPDATE trading_strategies 
SET configuration = configuration || 
  '{"aiConfidenceThreshold": 50, "priceStaleMaxMs": 15000, "spreadThresholdBps": 30, "minHoldPeriodMs": 120000, "cooldownBetweenOppositeActionsMs": 30000}'::jsonb,
  updated_at = NOW()
WHERE user_id IN (
  '0203b75f-ad1f-466d-ace8-77069a4cff62',
  '203a6283-a337-4378-92a1-c50f0802e6a2'
);
