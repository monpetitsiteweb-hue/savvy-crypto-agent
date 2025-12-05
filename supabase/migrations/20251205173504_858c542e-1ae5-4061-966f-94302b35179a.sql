-- Fix all 9 incorrect strategy settings with correct field paths
UPDATE trading_strategies
SET configuration = configuration
  -- 1. enterThreshold in signalFusion
  || jsonb_build_object('signalFusion', 
       (configuration->'signalFusion') || '{"enterThreshold": 0.15, "exitThreshold": 0.10}'::jsonb
     )
  -- 2. enterThreshold in aiIntelligenceConfig.features.fusion
  || jsonb_build_object('aiIntelligenceConfig',
       (configuration->'aiIntelligenceConfig') || jsonb_build_object('features',
         (configuration->'aiIntelligenceConfig'->'features') || jsonb_build_object('fusion',
           (configuration->'aiIntelligenceConfig'->'features'->'fusion') || '{"enterThreshold": 0.15, "exitThreshold": 0.10}'::jsonb
         )
       )
     )
  -- 3. spreadThresholdBps at top level and in contextGates
  || '{"spreadThresholdBps": 30}'::jsonb
  || jsonb_build_object('contextGates',
       (configuration->'contextGates') || '{"spreadThresholdBps": 30, "minDepthRatio": 0.2}'::jsonb
     )
  -- 4. minDepthRatio at top level
  || '{"minDepthRatio": 0.2}'::jsonb
  -- 5. trailingStopLossPercentage (correct field name)
  || '{"trailingStopLossPercentage": 1.5}'::jsonb
  -- 6. trailingStopMinProfitThreshold (correct field name)
  || '{"trailingStopMinProfitThreshold": 0.5}'::jsonb
  -- 7. min_confidence at top level
  || '{"min_confidence": 0.20}'::jsonb
  -- 8. unifiedConfig.minHoldPeriodMs
  || jsonb_build_object('unifiedConfig',
       (configuration->'unifiedConfig') || '{"minHoldPeriodMs": 120000}'::jsonb
     )
  -- 9. selectedCoins (6 coins, not 8)
  || '{"selectedCoins": ["BTC", "ETH", "SOL", "AVAX", "XRP", "ADA"]}'::jsonb
WHERE id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e';