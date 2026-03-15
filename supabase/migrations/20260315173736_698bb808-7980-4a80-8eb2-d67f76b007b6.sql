
-- Migrate thresholds from legacy paths into canonical configuration.signalFusion
-- This handles strategies where thresholds were stored at wrong paths

-- Step 1: Migrate from configuration.enterThreshold (root level) to configuration.signalFusion
UPDATE trading_strategies
SET configuration = jsonb_set(
  jsonb_set(
    CASE 
      WHEN configuration ? 'signalFusion' THEN configuration
      ELSE jsonb_set(configuration, '{signalFusion}', '{"enabled": true}'::jsonb)
    END,
    '{signalFusion,enterThreshold}',
    COALESCE(
      configuration->'signalFusion'->'enterThreshold',
      configuration->'enterThreshold',
      '0.65'::jsonb
    )
  ),
  '{signalFusion,exitThreshold}',
  COALESCE(
    configuration->'signalFusion'->'exitThreshold',
    configuration->'exitThreshold',
    '0.50'::jsonb
  )
)
WHERE configuration IS NOT NULL
  AND (
    -- Has root-level thresholds that need migrating
    (configuration ? 'enterThreshold' AND NOT (configuration->'signalFusion' ? 'enterThreshold'))
    OR
    -- Has no signalFusion thresholds at all
    (NOT (configuration->'signalFusion' ? 'enterThreshold'))
  );

-- Step 2: Migrate from aiIntelligenceConfig.features.fusion to signalFusion (if signalFusion is missing thresholds)
UPDATE trading_strategies
SET configuration = jsonb_set(
  jsonb_set(
    configuration,
    '{signalFusion,enterThreshold}',
    COALESCE(
      configuration->'signalFusion'->'enterThreshold',
      configuration#>'{aiIntelligenceConfig,features,fusion,enterThreshold}',
      '0.65'::jsonb
    )
  ),
  '{signalFusion,exitThreshold}',
  COALESCE(
    configuration->'signalFusion'->'exitThreshold',
    configuration#>'{aiIntelligenceConfig,features,fusion,exitThreshold}',
    '0.50'::jsonb
  )
)
WHERE configuration IS NOT NULL
  AND configuration ? 'signalFusion'
  AND (
    NOT (configuration->'signalFusion' ? 'enterThreshold')
    OR NOT (configuration->'signalFusion' ? 'exitThreshold')
  );

-- Step 3: Ensure signalFusion.weights exist (migrate from top-level weight keys if needed)
UPDATE trading_strategies
SET configuration = jsonb_set(
  configuration,
  '{signalFusion,weights}',
  COALESCE(
    configuration->'signalFusion'->'weights',
    jsonb_build_object(
      'trend', 0.30,
      'volatility', 0.15,
      'momentum', 0.25,
      'whale', 0.15,
      'sentiment', 0.15
    )
  )
)
WHERE configuration IS NOT NULL
  AND configuration ? 'signalFusion'
  AND NOT (configuration->'signalFusion' ? 'weights');
