-- Migrate existing ScalpSmart configs to unified AI structure
-- This migration adds aiIntelligenceConfig with unified features while preserving old keys for compatibility

UPDATE trading_strategies 
SET configuration = configuration || jsonb_build_object(
  'aiIntelligenceConfig', jsonb_build_object(
    'enableAIOverride', COALESCE((configuration -> 'signalFusion' ->> 'enabled')::boolean, false),
    'autonomy', jsonb_build_object('level', 25),
    'features', jsonb_build_object(
      'fusion', COALESCE(
        configuration -> 'signalFusion',
        jsonb_build_object(
          'enabled', false,
          'weights', jsonb_build_object(
            'trend', 0.25,
            'volatility', 0.20, 
            'momentum', 0.25,
            'whale', 0.15,
            'sentiment', 0.15
          ),
          'enterThreshold', 0.65,
          'exitThreshold', 0.35,
          'conflictPenalty', 0.30
        )
      ),
      'contextGates', COALESCE(
        configuration -> 'contextGates',
        jsonb_build_object(
          'spreadThresholdBps', 20,
          'minDepthRatio', 2.0,
          'whaleConflictWindowMs', 600000
        )
      ),
      'bracketPolicy', COALESCE(
        configuration -> 'brackets',
        jsonb_build_object(
          'atrScaled', false,
          'stopLossPctWhenNotAtr', 0.40,
          'trailBufferPct', 0.40,
          'enforceRiskReward', true,
          'minTpSlRatio', 1.2,
          'atrMultipliers', jsonb_build_object('tp', 2.6, 'sl', 2.0)
        )
      ),
      'overridesPolicy', jsonb_build_object(
        'allowedKeys', jsonb_build_array('tpPct', 'slPct', 'enterThreshold', 'exitThreshold'),
        'bounds', jsonb_build_object(
          'slPct', jsonb_build_array(0.15, 1.00),
          'tpOverSlMin', 1.2
        ),
        'ttlMs', 900000
      )
    )
  )
)
WHERE configuration IS NOT NULL
  AND configuration -> 'aiIntelligenceConfig' IS NULL;