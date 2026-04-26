-- Resync state column with is_active for all trading_strategies rows
-- Rule: is_active=true -> state='ACTIVE', is_active=false -> state='PAUSED'
UPDATE public.trading_strategies
SET state = CASE WHEN is_active = true THEN 'ACTIVE' ELSE 'PAUSED' END
WHERE (is_active = true AND state = 'PAUSED')
   OR (is_active = false AND state = 'ACTIVE');