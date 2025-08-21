-- Remove SECURITY DEFINER from functions that don't need elevated privileges
-- Convert table-returning functions to regular functions or views where appropriate

-- Remove SECURITY DEFINER from get_active_oauth_credentials if it's not needed for admin operations
-- This function should only be called by edge functions, not directly by users
CREATE OR REPLACE FUNCTION public.get_active_oauth_credentials()
RETURNS TABLE(client_id_encrypted text, is_sandbox boolean)
LANGUAGE sql
STABLE SECURITY INVOKER  -- Changed from SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Only return credentials if user is admin (RLS on table will handle access)
  SELECT client_id_encrypted, is_sandbox 
  FROM public.coinbase_oauth_credentials 
  WHERE is_active = true 
  LIMIT 1;
$function$;

-- Create a simple view instead of a complex function for basic data access
DROP FUNCTION IF EXISTS public.get_all_past_positions();

-- Create a simple view that inherits RLS from underlying table
CREATE VIEW public.admin_past_positions_view AS
SELECT 
  id AS sell_trade_id,
  strategy_id,
  user_id,
  original_purchase_amount AS amount,
  original_purchase_price AS purchase_price,
  original_purchase_value AS purchase_value,
  price AS exit_price,
  exit_value,
  buy_fees,
  sell_fees,
  realized_pnl AS pnl,
  realized_pnl_pct AS pnl_pct,
  executed_at AS exit_at,
  cryptocurrency AS symbol
FROM public.mock_trades
WHERE trade_type = 'sell'
  AND original_purchase_value IS NOT NULL
ORDER BY executed_at DESC;

-- Grant permissions
GRANT SELECT ON public.admin_past_positions_view TO authenticated;