UPDATE public.trading_strategies
SET configuration = jsonb_set(configuration, '{maxTradesPerDay}', '-5'::jsonb)
WHERE id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e';