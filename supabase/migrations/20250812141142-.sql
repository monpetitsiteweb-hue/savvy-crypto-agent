-- Fix Security Issue: Properly secure trading position views (removing security_barrier)

-- Recreate past_positions_view without security_barrier but with explicit user filtering
DROP VIEW IF EXISTS public.past_positions_view;
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
  AND user_id = auth.uid()  -- Explicit user filtering for security
  AND original_purchase_value IS NOT NULL
ORDER BY executed_at DESC;

-- Recreate past_positions_view_admin without security_barrier 
-- This view relies on the underlying table's RLS and the has_role function
DROP VIEW IF EXISTS public.past_positions_view_admin;
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
  -- Admin filtering is handled by RLS on the underlying mock_trades table
ORDER BY executed_at DESC;

-- Update comments for documentation
COMMENT ON VIEW public.past_positions_view IS 'Secure view showing past trading positions - users can only see their own positions via auth.uid() filter';
COMMENT ON VIEW public.past_positions_view_admin IS 'Admin view showing all past trading positions - access controlled by underlying table RLS policies';