-- A) COINBASE_PRO (0% fees) test
UPDATE public.profiles SET account_type='COINBASE_PRO', fee_rate=0
WHERE id='25a0c221-1f0e-431d-8d79-db9fb4db9cb3';

-- BUY then SELL for XRP-EUR
INSERT INTO public.mock_trades (id, user_id, trade_type, cryptocurrency, amount, price, total_value, executed_at)
VALUES (gen_random_uuid(), '25a0c221-1f0e-431d-8d79-db9fb4db9cb3', 'buy',  'XRP-EUR', 1.00000000, 100.00, 100.00, now());

INSERT INTO public.mock_trades (id, user_id, trade_type, cryptocurrency, amount, price, total_value, executed_at)
VALUES (gen_random_uuid(), '25a0c221-1f0e-431d-8d79-db9fb4db9cb3', 'sell', 'XRP-EUR', 1.00000000, 120.00, 120.00, now());

-- B) OTHER (5% fees) test
UPDATE public.profiles SET account_type='OTHER', fee_rate=0.05
WHERE id='25a0c221-1f0e-431d-8d79-db9fb4db9cb3';

INSERT INTO public.mock_trades (id, user_id, trade_type, cryptocurrency, amount, price, total_value, executed_at)
VALUES (gen_random_uuid(), '25a0c221-1f0e-431d-8d79-db9fb4db9cb3', 'buy',  'ETH-EUR', 1.00000000, 100.00, 100.00, now());

INSERT INTO public.mock_trades (id, user_id, trade_type, cryptocurrency, amount, price, total_value, executed_at)
VALUES (gen_random_uuid(), '25a0c221-1f0e-431d-8d79-db9fb4db9cb3', 'sell', 'ETH-EUR', 1.00000000, 120.00, 120.00, now());