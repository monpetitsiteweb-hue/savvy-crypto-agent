UPDATE trading_strategies
SET configuration = jsonb_set(
  configuration,
  '{antiContradictoryCooldownMs}',
  '60000'::jsonb,
  true
)
WHERE id IN (
  '658ad973-e693-42d5-a0f7-21a1aa922679',
  '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e'
)
  AND NOT (configuration ? 'antiContradictoryCooldownMs');