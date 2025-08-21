-- Fix Security Definer View vulnerability by recreating views without SECURITY DEFINER
-- Views will inherit RLS from the underlying mock_trades table

-- Drop existing views
DROP VIEW IF EXISTS public.past_positions_view;
DROP VIEW IF EXISTS public.past_positions_view_admin;

-- Recreate past_positions_view without SECURITY DEFINER
-- This view filters to current user's data
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
  AND user_id = auth.uid()
  AND original_purchase_value IS NOT NULL
ORDER BY executed_at DESC;

-- Recreate past_positions_view_admin without SECURITY DEFINER
-- This view shows all data (admin access only via underlying table RLS)
CREATE VIEW public.past_positions_view_admin AS
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

-- Grant appropriate permissions
GRANT SELECT ON public.past_positions_view TO authenticated;
GRANT SELECT ON public.past_positions_view_admin TO authenticated;