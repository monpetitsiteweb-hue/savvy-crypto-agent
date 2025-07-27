-- Clean up anonymous users and their data
-- First, remove any profiles for anonymous users
DELETE FROM public.profiles 
WHERE id IN (
  SELECT id FROM auth.users 
  WHERE is_anonymous = true
);

-- Remove any user roles for anonymous users
DELETE FROM public.user_roles 
WHERE user_id IN (
  SELECT id FROM auth.users 
  WHERE is_anonymous = true
);

-- Remove any other user-related data for anonymous users
DELETE FROM public.trading_strategies 
WHERE user_id IN (
  SELECT id FROM auth.users 
  WHERE is_anonymous = true
);

DELETE FROM public.conversation_history 
WHERE user_id IN (
  SELECT id FROM auth.users 
  WHERE is_anonymous = true
);

DELETE FROM public.user_coinbase_connections 
WHERE user_id IN (
  SELECT id FROM auth.users 
  WHERE is_anonymous = true
);