-- create a safe admin reader (no writes) for verification
CREATE OR REPLACE FUNCTION admin_list_past_positions(p_user UUID)
RETURNS TABLE(
  sell_trade_id UUID,
  symbol TEXT,
  amount NUMERIC,
  purchase_price NUMERIC,
  purchase_value NUMERIC,
  exit_price NUMERIC,
  exit_value NUMERIC,
  buy_fees NUMERIC,
  sell_fees NUMERIC,
  pnl NUMERIC,
  pnl_pct NUMERIC,
  exit_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    id AS sell_trade_id,
    cryptocurrency AS symbol,
    original_purchase_amount AS amount,
    original_purchase_price AS purchase_price,
    original_purchase_value AS purchase_value,
    price AS exit_price,
    COALESCE(exit_value, total_value) AS exit_value,
    buy_fees, sell_fees,
    realized_pnl AS pnl,
    realized_pnl_pct AS pnl_pct,
    executed_at AS exit_at
  FROM public.mock_trades
  WHERE trade_type='sell'
    AND user_id = p_user
    AND original_purchase_value IS NOT NULL
  ORDER BY executed_at DESC
  LIMIT 50;
$$;

-- lock it down (owner-only execution unless explicitly granted)
REVOKE ALL ON FUNCTION admin_list_past_positions(UUID) FROM PUBLIC;