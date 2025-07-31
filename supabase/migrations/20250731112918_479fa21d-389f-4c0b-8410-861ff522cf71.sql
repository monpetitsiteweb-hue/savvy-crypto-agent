-- Find and activate the Stablecoin Daily Trading Strategy for test mode
UPDATE trading_strategies 
SET is_active_test = true, 
    updated_at = now()
WHERE strategy_name = 'Stablecoin Daily Trading Strategy' 
  AND is_active_test = false
  AND id = '65db76c2-ea9e-44c9-8396-c3dcd1342556';

-- If no existing strategy matches, create a High Risk Momentum Trader strategy
INSERT INTO trading_strategies (
  strategy_name,
  description,
  is_active_test,
  is_active_live,
  test_mode,
  configuration,
  user_id
)
SELECT 
  'High Risk Momentum Trader',
  'High-risk momentum trading strategy for aggressive returns',
  true,
  false,
  true,
  jsonb_build_object(
    'strategyName', 'High Risk Momentum Trader',
    'riskProfile', 'high',
    'maxActiveCoins', 5,
    'perTradeAllocation', 1000,
    'selectedCoins', ARRAY['BTC', 'ETH', 'XRP'],
    'enableAI', true,
    'stopLossPercentage', 5,
    'takeProfitPercentage', 10,
    'enableTestTrading', true,
    'enableLiveTrading', false,
    'aiIntelligenceConfig', jsonb_build_object(
      'enableAIOverride', true,
      'aiAutonomyLevel', 80,
      'aiConfidenceThreshold', 70,
      'enableLearning', true,
      'enablePatternRecognition', true,
      'enableExternalSignals', true,
      'decisionMode', 'aggressive'
    )
  ),
  (SELECT id FROM auth.users LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM trading_strategies 
  WHERE is_active_test = true 
    AND user_id = (SELECT id FROM auth.users LIMIT 1)
);