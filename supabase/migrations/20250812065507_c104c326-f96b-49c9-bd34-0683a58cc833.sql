-- Phase 2: Add purchase snapshot fields to SELL trades for accurate Past Positions

ALTER TABLE mock_trades
  ADD COLUMN IF NOT EXISTS original_purchase_amount numeric(38,8),
  ADD COLUMN IF NOT EXISTS original_purchase_price  numeric(18,6),
  ADD COLUMN IF NOT EXISTS original_purchase_value  numeric(18,2),
  ADD COLUMN IF NOT EXISTS exit_value               numeric(18,2),  -- = amount * price (SELL)
  ADD COLUMN IF NOT EXISTS realized_pnl             numeric(18,2),  -- net of fees
  ADD COLUMN IF NOT EXISTS realized_pnl_pct         numeric(9,2),   -- net of fees
  ADD COLUMN IF NOT EXISTS buy_fees                 numeric(18,2),  -- snapshot of entry-side fees
  ADD COLUMN IF NOT EXISTS sell_fees                numeric(18,2);  -- snapshot of exit-side fees

-- Helpful indexes
CREATE INDEX IF NOT EXISTS mock_trades_user_time_idx
  ON mock_trades (user_id, executed_at DESC);

-- Optional: speed up Past Positions (SELL-only scans)
CREATE INDEX IF NOT EXISTS mock_trades_sell_user_time_idx
  ON mock_trades (user_id, executed_at DESC)
  WHERE trade_type = 'sell';

-- Clean interface for the UI (inherits RLS from mock_trades)
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
  AND user_id = auth.uid();