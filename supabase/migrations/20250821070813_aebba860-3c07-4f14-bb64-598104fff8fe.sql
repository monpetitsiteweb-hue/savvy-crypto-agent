-- Fix Security Definer View vulnerability by recreating views without SECURITY DEFINER
-- and implementing proper RLS policies

-- Drop existing views
DROP VIEW IF EXISTS public.past_positions_view;
DROP VIEW IF EXISTS public.past_positions_view_admin;

-- Recreate past_positions_view without SECURITY DEFINER
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
  AND original_purchase_value IS NOT NULL
ORDER BY executed_at DESC;

-- Recreate past_positions_view_admin without SECURITY DEFINER  
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

-- Enable RLS on the views
ALTER VIEW public.past_positions_view ENABLE ROW LEVEL SECURITY;
ALTER VIEW public.past_positions_view_admin ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for past_positions_view (user can see their own data)
CREATE POLICY "Users can view their own past positions"
ON public.past_positions_view
FOR SELECT
USING (user_id = auth.uid());

-- Create RLS policy for past_positions_view_admin (only admins can access)
CREATE POLICY "Only admins can view all past positions"
ON public.past_positions_view_admin
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));