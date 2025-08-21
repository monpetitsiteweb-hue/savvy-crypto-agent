-- Fix security issue: Replace views with proper access controls
-- Views inherit RLS from underlying tables, but we need explicit admin validation

-- Drop the problematic admin view that shows all data
DROP VIEW IF EXISTS public.past_positions_view_admin;

-- Keep the user view but ensure it's properly filtered
DROP VIEW IF EXISTS public.past_positions_view;

-- Recreate user view with explicit user filtering (redundant with RLS but explicit)
CREATE VIEW public.past_positions_view AS
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
  AND user_id = auth.uid()  -- Explicit user filtering
  AND original_purchase_value IS NOT NULL
ORDER BY executed_at DESC;

-- Create a secure function for admin access instead of a view
CREATE OR REPLACE FUNCTION public.get_all_past_positions()
RETURNS TABLE(
  sell_trade_id uuid,
  strategy_id uuid, 
  user_id uuid,
  amount numeric,
  purchase_price numeric,
  purchase_value numeric,
  exit_price numeric,
  exit_value numeric,
  buy_fees numeric,
  sell_fees numeric,
  pnl numeric,
  pnl_pct numeric,
  exit_at timestamp with time zone,
  symbol text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Only allow admins to access all trading positions
  SELECT 
    id AS sell_trade_id,
    strategy_id,
    mock_trades.user_id,
    original_purchase_amount AS amount,
    original_purchase_price AS purchase_price,
    original_purchase_value AS purchase_value,
    price AS exit_price,
    mock_trades.exit_value,
    buy_fees,
    sell_fees,
    realized_pnl AS pnl,
    realized_pnl_pct AS pnl_pct,
    executed_at AS exit_at,
    cryptocurrency AS symbol
  FROM public.mock_trades
  WHERE trade_type = 'sell'
    AND original_purchase_value IS NOT NULL
    AND public.has_role(auth.uid(), 'admin'::public.app_role) -- Admin validation
  ORDER BY executed_at DESC;
$function$;

-- Grant appropriate permissions
GRANT SELECT ON public.past_positions_view TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_past_positions() TO authenticated;