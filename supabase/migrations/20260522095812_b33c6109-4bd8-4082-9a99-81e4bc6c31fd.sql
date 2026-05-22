UPDATE trading_strategies
SET configuration = jsonb_set(
      configuration,
      '{selectedCoins}',
      '["BTC","ETH","SOL","AVAX","XRP","ADA"]'::jsonb
    ),
    updated_at = now()
WHERE id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e'::uuid
  AND configuration->'selectedCoins' =
      '["BTC","ETH","SOL","AVAX","XRP","ADA","USDT","USDC","DOGE"]'::jsonb;