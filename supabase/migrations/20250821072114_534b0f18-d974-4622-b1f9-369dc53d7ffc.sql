-- Remove the admin view that might be causing security issues
-- And check for any other problematic functions

DROP VIEW IF EXISTS public.admin_past_positions_view;

-- Check if there are any duplicate functions with same names
-- Sometimes there can be function overloads causing issues
DROP FUNCTION IF EXISTS public.reset_mock_wallet_balances() CASCADE;
DROP FUNCTION IF EXISTS public.reset_mock_wallet_balances(numeric) CASCADE;

-- Recreate the single reset function without SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.reset_mock_wallet_balances(target_balance numeric DEFAULT 30000)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER  -- Changed from SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Validate authenticated user
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Call the comprehensive reset function
  PERFORM public.reset_user_test_portfolio(target_balance);
  
  RAISE NOTICE 'Mock wallet reset completed - portfolio set to €%', target_balance;
END;
$function$;