-- Fix get_portfolio_metrics: price_snapshots uses "price" not "price_eur"
CREATE OR REPLACE FUNCTION public.get_portfolio_metrics(p_user_id uuid, p_is_test_mode boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_starting_capital numeric;
  v_cash numeric;
  v_reserved numeric;
  v_invested_cost_basis numeric := 0;
  v_current_position_value numeric := 0;
  v_realized_pnl numeric := 0;
  v_total_buy_fees numeric := 0;
  v_total_sell_fees numeric := 0;
  v_total_gas_eur numeric := 0;
  v_eth_eur_price numeric := 0;
BEGIN
  -- Get portfolio capital
  SELECT 
    COALESCE(starting_capital_eur, 0),
    COALESCE(cash_balance_eur, 0),
    COALESCE(reserved_eur, 0)
  INTO v_starting_capital, v_cash, v_reserved
  FROM portfolio_capital
  WHERE user_id = p_user_id;

  -- If no portfolio capital row exists, return not initialized
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'reason', 'no_portfolio_capital_row'
    );
  END IF;

  -- Live mode only: portfolio can be uninitialized
  IF NOT p_is_test_mode
     AND v_starting_capital = 0
     AND v_cash = 0
     AND v_reserved = 0
  THEN
    RETURN json_build_object(
      'success', false,
      'reason', 'portfolio_not_initialized'
    );
  END IF;

  -- Calculate invested cost basis from open lots
  -- For Live mode, only count execution_confirmed trades
  SELECT COALESCE(SUM(remaining_qty * cost_basis_per_unit), 0)
  INTO v_invested_cost_basis
  FROM (
    SELECT 
      t.id,
      t.cryptocurrency as symbol,
      t.amount as original_qty,
      t.amount - COALESCE(
        (SELECT SUM(s.amount) 
         FROM mock_trades s 
         WHERE s.original_trade_id = t.id 
           AND s.trade_type = 'sell'
           AND s.is_test_mode = p_is_test_mode
           AND (p_is_test_mode OR s.execution_confirmed = true)
        ), 0
      ) as remaining_qty,
      t.price as cost_basis_per_unit
    FROM mock_trades t
    WHERE t.user_id = p_user_id
      AND t.trade_type = 'buy'
      AND t.is_test_mode = p_is_test_mode
      AND (p_is_test_mode OR t.execution_confirmed = true)
      AND t.is_corrupted = false
  ) lots
  WHERE remaining_qty > 0;

  -- Calculate current position value using latest prices
  -- FIX: price_snapshots column is "price" not "price_eur"
  SELECT COALESCE(SUM(lots.remaining_qty * COALESCE(ps.price, lots.cost_basis_per_unit)), 0)
  INTO v_current_position_value
  FROM (
    SELECT 
      t.id,
      t.cryptocurrency as symbol,
      t.amount - COALESCE(
        (SELECT SUM(s.amount) 
         FROM mock_trades s 
         WHERE s.original_trade_id = t.id 
           AND s.trade_type = 'sell'
           AND s.is_test_mode = p_is_test_mode
           AND (p_is_test_mode OR s.execution_confirmed = true)
        ), 0
      ) as remaining_qty,
      t.price as cost_basis_per_unit
    FROM mock_trades t
    WHERE t.user_id = p_user_id
      AND t.trade_type = 'buy'
      AND t.is_test_mode = p_is_test_mode
      AND (p_is_test_mode OR t.execution_confirmed = true)
      AND t.is_corrupted = false
  ) lots
  LEFT JOIN LATERAL (
    SELECT price 
    FROM price_snapshots 
    WHERE symbol = lots.symbol 
    ORDER BY ts DESC 
    LIMIT 1
  ) ps ON true
  WHERE lots.remaining_qty > 0;

  -- Calculate realized P&L from closed trades
  SELECT COALESCE(SUM(realized_pnl), 0)
  INTO v_realized_pnl
  FROM mock_trades
  WHERE user_id = p_user_id
    AND trade_type = 'sell'
    AND is_test_mode = p_is_test_mode
    AND (p_is_test_mode OR execution_confirmed = true)
    AND is_corrupted = false;

  -- Calculate total fees
  SELECT 
    COALESCE(SUM(CASE WHEN trade_type = 'buy' THEN COALESCE(fees, 0) + COALESCE(buy_fees, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN trade_type = 'sell' THEN COALESCE(fees, 0) + COALESCE(sell_fees, 0) ELSE 0 END), 0)
  INTO v_total_buy_fees, v_total_sell_fees
  FROM mock_trades
  WHERE user_id = p_user_id
    AND is_test_mode = p_is_test_mode
    AND (p_is_test_mode OR execution_confirmed = true)
    AND is_corrupted = false;

  -- For Live mode, calculate gas costs in EUR
  IF NOT p_is_test_mode THEN
    -- Get latest ETH price (FIX: column is "price" not "price_eur")
    SELECT COALESCE(price, 0)
    INTO v_eth_eur_price
    FROM price_snapshots
    WHERE symbol IN ('ETH-EUR', 'ETH')
    ORDER BY ts DESC
    LIMIT 1;

    -- Sum gas costs and convert to EUR
    SELECT COALESCE(SUM(COALESCE(gas_cost_eth, 0)), 0) * v_eth_eur_price
    INTO v_total_gas_eur
    FROM mock_trades
    WHERE user_id = p_user_id
      AND is_test_mode = false
      AND execution_confirmed = true
      AND is_corrupted = false;
  END IF;

  -- Return all metrics
  RETURN json_build_object(
    'success', true,
    'starting_capital_eur', ROUND(v_starting_capital, 2),
    'cash_balance_eur', ROUND(v_cash, 2),
    'reserved_eur', ROUND(v_reserved, 2),
    'available_eur', ROUND(v_cash - v_reserved, 2),
    'invested_cost_basis_eur', ROUND(v_invested_cost_basis, 2),
    'current_position_value_eur', ROUND(v_current_position_value, 2),
    'unrealized_pnl_eur', ROUND(v_current_position_value - v_invested_cost_basis, 2),
    'realized_pnl_eur', ROUND(v_realized_pnl, 2),
    'total_pnl_eur', ROUND((v_current_position_value - v_invested_cost_basis) + v_realized_pnl - v_total_gas_eur, 2),
    'total_portfolio_value_eur', ROUND(v_cash + v_current_position_value - v_total_gas_eur, 2),
    'total_fees_eur', ROUND(v_total_buy_fees + v_total_sell_fees, 2),
    'total_buy_fees_eur', ROUND(v_total_buy_fees, 2),
    'total_sell_fees_eur', ROUND(v_total_sell_fees, 2),
    'total_gas_eur', ROUND(v_total_gas_eur, 2)
  );
END;
$$;