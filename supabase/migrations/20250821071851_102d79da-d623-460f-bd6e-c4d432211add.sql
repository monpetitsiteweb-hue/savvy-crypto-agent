-- Fix SECURITY DEFINER table-returning functions that lack proper access controls
-- These functions are being detected as "views" by the linter

-- Fix get_active_oauth_credentials - should only be accessible to system/admins
CREATE OR REPLACE FUNCTION public.get_active_oauth_credentials()
RETURNS TABLE(client_id_encrypted text, is_sandbox boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Only allow admins to access OAuth credentials
  SELECT client_id_encrypted, is_sandbox 
  FROM public.coinbase_oauth_credentials 
  WHERE is_active = true 
    AND public.has_role(auth.uid(), 'admin'::public.app_role) -- Admin validation
  LIMIT 1;
$function$;

-- Fix fetch_coinbase_connection_name - should validate access
CREATE OR REPLACE FUNCTION public.fetch_coinbase_connection_name(connection_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Validate that user owns the connection or is admin
  IF NOT EXISTS (
    SELECT 1 FROM public.user_coinbase_connections 
    WHERE id = connection_id 
    AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  ) THEN
    RAISE EXCEPTION 'Access denied: connection not found or unauthorized';
  END IF;
  
  -- Return connection name (placeholder for now)
  RETURN 'Coinbase Account';
END;
$function$;

-- Fix reset functions to require proper user validation
CREATE OR REPLACE FUNCTION public.reset_user_test_portfolio(target_balance numeric DEFAULT 30000)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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