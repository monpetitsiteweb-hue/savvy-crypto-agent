-- Drop and recreate get_portfolio_metrics with REQUIRED p_is_test_mode (no default)
-- This enforces the single deterministic contract between frontend and database

DROP FUNCTION IF EXISTS public.get_portfolio_metrics(uuid);
DROP FUNCTION IF EXISTS public.get_portfolio_metrics(uuid, boolean);

CREATE OR REPLACE FUNCTION public.get_portfolio_metrics(
  p_user_id uuid,
  p_is_test_mode boolean  -- REQUIRED, no default - mode must be explicit
)
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

  -- If all values are zero, portfolio is not initialized
  IF v_starting_capital = 0 AND v_cash = 0 AND v_reserved = 0 THEN
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
  SELECT COALESCE(SUM(lots.remaining_qty * COALESCE(ps.price_eur, lots.cost_basis_per_unit)), 0)
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
    SELECT price_eur 
    FROM price_snapshots 
    WHERE symbol = lots.symbol 
    ORDER BY updated_at DESC 
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
    -- Get latest ETH price
    SELECT COALESCE(price_eur, 0)
    INTO v_eth_eur_price
    FROM price_snapshots
    WHERE symbol IN ('ETH-EUR', 'ETH')
    ORDER BY updated_at DESC
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

  -- Return the metrics
  RETURN json_build_object(
    'success', true,
    'is_test_mode', p_is_test_mode,
    'starting_capital_eur', v_starting_capital,
    'cash_balance_eur', v_cash,
    'reserved_eur', v_reserved,
    'available_eur', v_cash - v_reserved,
    'invested_cost_basis_eur', v_invested_cost_basis,
    'current_position_value_eur', v_current_position_value,
    'unrealized_pnl_eur', v_current_position_value - v_invested_cost_basis,
    'realized_pnl_eur', v_realized_pnl,
    'total_pnl_eur', (v_current_position_value - v_invested_cost_basis) + v_realized_pnl,
    'total_portfolio_value_eur', v_cash + v_current_position_value - v_total_gas_eur,
    'total_fees_eur', v_total_buy_fees + v_total_sell_fees,
    'total_buy_fees_eur', v_total_buy_fees,
    'total_sell_fees_eur', v_total_sell_fees,
    'total_gas_eur', v_total_gas_eur
  );
END;
$$;