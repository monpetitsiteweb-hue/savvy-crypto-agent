-- Clean up anonymous users that were created by the auto-login feature
-- These are causing confusion and taking up space

-- First, delete any user_roles associated with anonymous users
DELETE FROM public.user_roles 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE is_anonymous = true
);

-- Delete any other data associated with anonymous users
DELETE FROM public.trading_strategies 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE is_anonymous = true
);

DELETE FROM public.mock_trades 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE is_anonymous = true
);

DELETE FROM public.strategy_performance 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE is_anonymous = true
);

-- Note: We cannot delete from auth.users directly as it's managed by Supabase Auth
-- The anonymous users will remain in auth.users but won't have any associated data