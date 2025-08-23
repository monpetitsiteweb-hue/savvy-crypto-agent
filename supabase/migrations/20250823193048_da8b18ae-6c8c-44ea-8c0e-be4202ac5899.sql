-- Force enable unified decisions for the specific strategy
UPDATE trading_strategies 
SET unified_config = jsonb_set(
  COALESCE(unified_config, '{}'), 
  '{enableUnifiedDecisions}', 
  'true', 
  true
)
WHERE id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e' 
AND user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';