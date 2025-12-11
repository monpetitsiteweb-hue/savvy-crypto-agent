-- Drop dependent view first
DROP VIEW IF EXISTS public.past_positions_view;

-- Increase price precision for all price-related columns in mock_trades
-- This fixes the issue where low-price cryptos (ADA, XRP, etc.) get rounded to 2 decimals
ALTER TABLE public.mock_trades
  ALTER COLUMN price TYPE numeric(18,8),
  ALTER COLUMN original_purchase_price TYPE numeric(18,8),
  ALTER COLUMN price_quoted TYPE numeric(18,8),
  ALTER COLUMN price_realized TYPE numeric(18,8);

-- Also fix price_snapshots which is used for historical price lookups
ALTER TABLE public.price_snapshots
  ALTER COLUMN price TYPE numeric(18,8);

-- Fix decision_events entry_price for accurate decision logging
ALTER TABLE public.decision_events
  ALTER COLUMN entry_price TYPE numeric(18,8);

-- Recreate the view with the new column types
CREATE VIEW public.past_positions_view AS
SELECT 
  id AS sell_trade_id,
  cryptocurrency AS symbol,
  original_purchase_amount AS amount,
  original_purchase_price AS purchase_price,
  original_purchase_value AS purchase_value,
  price AS exit_price,
  COALESCE(exit_value, total_value) AS exit_value,
  buy_fees,
  sell_fees,
  realized_pnl AS pnl,
  realized_pnl_pct AS pnl_pct,
  executed_at AS exit_at,
  user_id,
  strategy_id
FROM public.mock_trades
WHERE trade_type = 'sell' AND original_purchase_value IS NOT NULL;