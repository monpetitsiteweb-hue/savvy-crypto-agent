-- Fix past_positions_view to show ALL sell trades, not just ones with snapshot data
DROP VIEW IF EXISTS public.past_positions_view;

CREATE VIEW public.past_positions_view 
WITH (security_invoker = on) AS 
SELECT 
  id AS sell_trade_id,
  strategy_id,
  user_id,
  COALESCE(original_purchase_amount, amount) AS amount,
  COALESCE(original_purchase_price, 0) AS purchase_price,
  COALESCE(original_purchase_value, 0) AS purchase_value,
  price AS exit_price,
  COALESCE(exit_value, total_value) AS exit_value,
  COALESCE(buy_fees, 0) AS buy_fees,
  COALESCE(sell_fees, 0) AS sell_fees,
  COALESCE(realized_pnl, 0) AS pnl,
  COALESCE(realized_pnl_pct, 0) AS pnl_pct,
  executed_at AS exit_at,
  cryptocurrency AS symbol
FROM mock_trades
WHERE trade_type = 'sell';