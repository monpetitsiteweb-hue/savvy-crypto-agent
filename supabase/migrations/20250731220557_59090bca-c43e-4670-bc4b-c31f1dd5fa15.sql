-- Clean up contradictory AI flags in existing strategy configurations
UPDATE trading_strategies 
SET configuration = configuration || jsonb_build_object(
  'is_ai_enabled', (configuration->>'enableAI')::boolean,
  'aiIntelligenceConfig', 
  COALESCE(configuration->'aiIntelligenceConfig', '{}'::jsonb) || jsonb_build_object(
    'enableAIOverride', (configuration->>'enableAI')::boolean
  )
)
WHERE configuration ? 'enableAI';