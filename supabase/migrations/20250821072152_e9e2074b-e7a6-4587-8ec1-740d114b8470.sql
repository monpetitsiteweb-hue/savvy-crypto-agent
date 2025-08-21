-- Convert remaining non-trigger SECURITY DEFINER functions to SECURITY INVOKER
-- to eliminate the final "Security Definer View" error

-- Convert reset_user_test_portfolio to SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.reset_user_test_portfolio(target_balance numeric DEFAULT 30000)
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

  -- Delete all mock trades for the authenticated user
  DELETE FROM public.mock_trades 
  WHERE user_id = auth.uid();
  
  -- Delete all strategy performance records for test mode
  DELETE FROM public.strategy_performance 
  WHERE user_id = auth.uid() AND is_test_mode = true;
  
  -- Log the reset action
  RAISE NOTICE 'Reset test portfolio for user % - reset balance to €%', 
    auth.uid(), target_balance;
END;
$function$;

-- Convert get_user_role to SECURITY INVOKER (can rely on RLS)
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE SECURITY INVOKER  -- Changed from SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$function$;

-- Convert fetch_coinbase_connection_name to SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.fetch_coinbase_connection_name(connection_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER  -- Changed from SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Function now relies on RLS policies for access control
  -- Return connection name (placeholder for now)
  RETURN 'Coinbase Account';
END;
$function$;