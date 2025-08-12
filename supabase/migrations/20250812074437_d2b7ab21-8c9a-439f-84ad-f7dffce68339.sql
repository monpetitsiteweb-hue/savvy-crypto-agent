-- Update the view to hide orphan SELLs (those without BUY coverage)
CREATE OR REPLACE VIEW past_positions_view AS
SELECT
  id                             AS sell_trade_id,
  strategy_id,
  user_id,
  cryptocurrency                 AS symbol,
  original_purchase_amount       AS amount,
  original_purchase_price        AS purchase_price,
  original_purchase_value        AS purchase_value,
  price                          AS exit_price,
  COALESCE(exit_value, total_value) AS exit_value,
  buy_fees,
  sell_fees,
  realized_pnl                   AS pnl,
  realized_pnl_pct               AS pnl_pct,
  executed_at                    AS exit_at
FROM mock_trades
WHERE trade_type = 'sell'
  AND user_id = auth.uid()
  AND original_purchase_value IS NOT NULL;  -- hide orphans