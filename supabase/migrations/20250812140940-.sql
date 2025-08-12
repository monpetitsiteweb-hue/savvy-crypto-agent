-- Fix Security Issue: Add RLS policies to trading position views

-- Enable RLS on past_positions_view
ALTER VIEW public.past_positions_view SET (security_barrier = true);
-- Note: Views inherit RLS from underlying tables, but we need explicit policies

-- Enable RLS on past_positions_view_admin  
ALTER VIEW public.past_positions_view_admin SET (security_barrier = true);

-- Create RLS policy for past_positions_view - users can only see their own positions
CREATE POLICY "Users can view their own past positions"
ON public.past_positions_view
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Create RLS policy for past_positions_view_admin - only admins can see all positions
CREATE POLICY "Admins can view all past positions"
ON public.past_positions_view_admin  
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Since these are views based on mock_trades, also ensure the views properly filter by RLS context
-- Recreate past_positions_view with explicit user filtering
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

-- Recreate past_positions_view_admin with security barrier
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
ORDER BY executed_at DESC;

-- Enable RLS on both views
ALTER VIEW public.past_positions_view ENABLE ROW LEVEL SECURITY;
ALTER VIEW public.past_positions_view_admin ENABLE ROW LEVEL SECURITY;

-- Add the RLS policies
CREATE POLICY "Users can view their own past positions"
ON public.past_positions_view
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all past positions" 
ON public.past_positions_view_admin
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));