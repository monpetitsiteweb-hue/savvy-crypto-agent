-- Add separate activation fields for test and live modes
ALTER TABLE public.trading_strategies 
ADD COLUMN is_active_test BOOLEAN DEFAULT false,
ADD COLUMN is_active_live BOOLEAN DEFAULT false;

-- Migrate existing data: if is_active=true and test_mode=true, set is_active_test=true
UPDATE public.trading_strategies 
SET is_active_test = true 
WHERE is_active = true AND test_mode = true;

-- Migrate existing data: if is_active=true and test_mode=false, set is_active_live=true  
UPDATE public.trading_strategies 
SET is_active_live = true 
WHERE is_active = true AND test_mode = false;

-- Add constraint: only one strategy can be active in test mode per user
CREATE UNIQUE INDEX CONCURRENTLY idx_one_active_test_strategy_per_user 
ON public.trading_strategies (user_id) 
WHERE is_active_test = true;

-- Add constraint: only one strategy can be active in live mode per user
CREATE UNIQUE INDEX CONCURRENTLY idx_one_active_live_strategy_per_user 
ON public.trading_strategies (user_id) 
WHERE is_active_live = true;