-- Fix Security Issue: Properly secure trading position views
-- Views inherit security from underlying tables, but we need to ensure proper user filtering

-- Recreate past_positions_view with explicit user filtering and security barrier
DROP VIEW IF EXISTS public.past_positions_view;
CREATE VIEW public.past_positions_view WITH (security_barrier = true) AS
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
  AND user_id = auth.uid()  -- Explicit user filtering for security
  AND original_purchase_value IS NOT NULL
ORDER BY executed_at DESC;

-- Recreate past_positions_view_admin with security barrier and admin-only access
DROP VIEW IF EXISTS public.past_positions_view_admin;
CREATE VIEW public.past_positions_view_admin WITH (security_barrier = true) AS
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
  AND has_role(auth.uid(), 'admin'::app_role)  -- Only admins can see all positions
ORDER BY executed_at DESC;

-- Grant appropriate permissions
GRANT SELECT ON public.past_positions_view TO authenticated;
GRANT SELECT ON public.past_positions_view_admin TO authenticated;

-- Add comments for documentation
COMMENT ON VIEW public.past_positions_view IS 'Secure view showing past trading positions for authenticated users - users can only see their own positions';
COMMENT ON VIEW public.past_positions_view_admin IS 'Admin-only view showing all past trading positions - requires admin role';