-- (a) INSERT real_trades
INSERT INTO real_trades (
  id, trade_id, tx_hash, execution_status, receipt_status,
  cryptocurrency, side, amount, price, total_value,
  execution_target, execution_authority, is_system_operator,
  user_id, strategy_id, chain_id, block_number, block_timestamp,
  gas_used, fees, provider, decode_method, raw_receipt, trade_role, created_at
) VALUES (
  gen_random_uuid(),
  '9cc6dc07-fc47-4f51-a8da-2b2694208829',
  '0x4bbffbb454f2066371c9dc1a640c3ca5021e7bc17c51193bfe0fe1441e1545e8',
  'CONFIRMED', true,
  'ETH', 'BUY', 0.004319633592525303, 1972.55, 8.52,
  'REAL', 'SYSTEM', true,
  '3a05bf2d-0a8c-4909-9e79-bed87e46270c', NULL, 8453, 45508333, '2026-05-03 11:00:13+00',
  229195, 0.002713, '0x', 'manual_backfill',
  jsonb_build_object(
    'backfill', true,
    'reason', 'onchain tx confirmed but real_trades row missing',
    'price_source', 'market_ohlcv_raw',
    'gas_used_dec', 229195,
    'gas_used_hex', '0x37f4b',
    'gas_cost_eur', 0.002713,
    'backfilled_at', now()
  ),
  'ENGINE_TRADE', now()
);

-- (b) UPDATE mock_trades
UPDATE mock_trades
SET price = 1972.55,
    amount = 0.004319633592525303,
    total_value = 8.52,
    tx_hash = '0x4bbffbb454f2066371c9dc1a640c3ca5021e7bc17c51193bfe0fe1441e1545e8',
    execution_confirmed = true,
    execution_ts = '2026-05-03 11:00:13+00',
    execution_source = 'onchain_confirmed_manual',
    is_open_position = true,
    notes = COALESCE(notes,'') || E'\n[manual_backfill ' || now()::text || '] reconciled with onchain tx 0x4bbf...1545e8; price from market_ohlcv_raw; total_value=8.52'
WHERE id = '9cc6dc07-fc47-4f51-a8da-2b2694208829';

-- (c) SETTLE
SELECT settle_buy_trade_v2(
  '9cc6dc07-fc47-4f51-a8da-2b2694208829'::uuid,
  '3a05bf2d-0a8c-4909-9e79-bed87e46270c'::uuid,
  8.52::numeric,
  10.00::numeric
) AS settle_result;