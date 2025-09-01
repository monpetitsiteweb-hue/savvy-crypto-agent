-- Apply corrected ScalpSmart configuration with proper key structure
UPDATE trading_strategies
SET configuration = configuration
  || jsonb_build_object(
      'signalFusion', jsonb_build_object(
        'enabled', true,
        'enterThreshold', 0.65,
        'exitThreshold', 0.35,
        'conflictPenalty', 0.30,
        'weights', jsonb_build_object(
          'trend', 0.25,
          'volatility', 0.20,
          'momentum', 0.25,
          'whale', 0.15,
          'sentiment', 0.15
        )
      ),
      'contextGates', jsonb_build_object(
        'spreadThresholdBps', 12,           -- 0.12%
        'minDepthRatio', 3.0,
        'whaleConflictWindowMs', 300000     -- 5 minutes
      ),
      'brackets', jsonb_build_object(
        'stopLossPctWhenNotAtr', 0.40,      -- 0.40%
        'trailBufferPct', 0.40,             -- 0.40% activation buffer
        'enforceRiskReward', true,
        'minTpSlRatio', 1.2,
        'atrScaled', false,
        'atrMultipliers', jsonb_build_object('tp', 2.6, 'sl', 2.0)
      ),
      -- Legacy/top-level fields that non-ScalpSmart paths read:
      'takeProfitPercentage', 0.65,         -- 0.65%
      'stopLossPercentage', 0.40,           -- 0.40%
      'perTradeAllocation', 50,             -- €50
      'allocationUnit', 'euro'
    )
WHERE id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e';