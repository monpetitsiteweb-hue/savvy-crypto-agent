UPDATE mock_trades
SET tx_hash             = '0x370b22fe6895f88a90808e99abef088d28abee34f981f8140533c2a9723b20ec',
    price               = 1984.060000,
    total_value         = 8.450647,
    fees                = 0.012694,
    gas_cost_eth        = 0.000001324093316666,
    executed_at         = '2026-05-04 10:15:09+00'::timestamptz,
    execution_ts        = '2026-05-04 10:15:09+00'::timestamptz,
    execution_confirmed = true,
    execution_source    = 'onchain_confirmed',
    settlement_status   = 'SETTLED',
    chain_id            = 8453,
    notes               = 'On-chain execution confirmed | tx:0x370b22fe... | provider:0x | decoded:erc20_transfer_pair | convention=usdc_fx_eur, fx_usd_eur=0.8546, usdc_spent=9.89, eur_spent=8.45 | BACKFILL 2026-05-06 forensic recovery phantom SELL'
WHERE id = 'bc828e14-b949-45fd-88e7-ba8219b6928e'
  AND tx_hash IS NULL
  AND execution_confirmed = false;