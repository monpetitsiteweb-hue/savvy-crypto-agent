-- Fix get_portfolio_metrics RPC to accept p_is_test_mode parameter
-- This resolves the 404 error caused by signature mismatch

CREATE OR REPLACE FUNCTION public.get_portfolio_metrics(
  p_user_id uuid,
  p_is_test_mode boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_starting_capital numeric(18,2);
  v_cash_balance numeric(18,2);
  v_reserved numeric(18,2);
  v_invested_cost_basis numeric(18,2) := 0;
  v_current_position_value numeric(18,2) := 0;
  v_realized_pnl numeric(18,2) := 0;
  v_unrealized_pnl numeric(18,2) := 0;
  v_total_gas_eur numeric(18,2) := 0;
  v_eth_eur_price numeric(18,2) := 0;
  v_total_portfolio_value numeric(18,2);
  v_lot record;
BEGIN
  -- Get portfolio capital
  SELECT 
    COALESCE(starting_capital_eur, 0),
    COALESCE(cash_balance_eur, 0),
    COALESCE(reserved_eur, 0)
  INTO v_starting_capital, v_cash_balance, v_reserved
  FROM portfolio_capital
  WHERE user_id = p_user_id;

  -- If no portfolio_capital row exists, return not initialized
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'portfolio_not_initialized'
    );
  END IF;

  -- Check if portfolio is initialized (all zeros = not initialized)
  IF v_starting_capital = 0 AND v_cash_balance = 0 AND v_reserved = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'portfolio_not_initialized'
    );
  END IF;

  -- Calculate invested cost basis from open lots
  -- Filter by p_is_test_mode and (for live mode) require execution_confirmed
  SELECT COALESCE(SUM(l.remaining_qty * l.unit_cost_eur), 0)
  INTO v_invested_cost_basis
  FROM lots l
  JOIN mock_trades t ON l.buy_trade_id = t.id
  WHERE t.user_id = p_user_id
    AND t.is_test_mode = p_is_test_mode
    AND (p_is_test_mode OR t.execution_confirmed = true)
    AND l.remaining_qty > 0;

  -- Calculate current position value using latest prices
  FOR v_lot IN
    SELECT 
      l.remaining_qty,
      l.symbol,
      l.unit_cost_eur
    FROM lots l
    JOIN mock_trades t ON l.buy_trade_id = t.id
    WHERE t.user_id = p_user_id
      AND t.is_test_mode = p_is_test_mode
      AND (p_is_test_mode OR t.execution_confirmed = true)
      AND l.remaining_qty > 0
  LOOP
    -- Get latest price for this symbol
    DECLARE
      v_price numeric(18,8);
    BEGIN
      SELECT price INTO v_price
      FROM price_snapshots
      WHERE symbol = v_lot.symbol || '-EUR'
         OR symbol = v_lot.symbol
      ORDER BY ts DESC
      LIMIT 1;

      IF v_price IS NOT NULL THEN
        v_current_position_value := v_current_position_value + (v_lot.remaining_qty * v_price);
      ELSE
        -- Fallback to cost basis if no price available
        v_current_position_value := v_current_position_value + (v_lot.remaining_qty * v_lot.unit_cost_eur);
      END IF;
    END;
  END LOOP;

  -- Calculate realized P&L from closed trades (sells)
  SELECT COALESCE(SUM(realized_pnl_eur), 0)
  INTO v_realized_pnl
  FROM mock_trades
  WHERE user_id = p_user_id
    AND side = 'SELL'
    AND is_test_mode = p_is_test_mode
    AND (p_is_test_mode OR execution_confirmed = true);

  -- Calculate unrealized P&L
  v_unrealized_pnl := v_current_position_value - v_invested_cost_basis;

  -- For Live mode, calculate gas costs in EUR
  IF NOT p_is_test_mode THEN
    -- Get latest ETH-EUR price
    SELECT price INTO v_eth_eur_price
    FROM price_snapshots
    WHERE symbol IN ('ETH-EUR', 'ETH')
    ORDER BY ts DESC
    LIMIT 1;

    IF v_eth_eur_price IS NULL THEN
      v_eth_eur_price := 0;
    END IF;

    -- Sum gas costs from confirmed trades
    SELECT COALESCE(SUM(gas_cost_eth), 0) * v_eth_eur_price
    INTO v_total_gas_eur
    FROM mock_trades
    WHERE user_id = p_user_id
      AND is_test_mode = false
      AND execution_confirmed = true;
  END IF;

  -- Calculate total portfolio value
  v_total_portfolio_value := v_cash_balance + v_current_position_value - v_total_gas_eur;

  -- Return all metrics with 2 decimal precision
  RETURN jsonb_build_object(
    'success', true,
    'starting_capital_eur', ROUND(v_starting_capital, 2),
    'cash_balance_eur', ROUND(v_cash_balance, 2),
    'reserved_eur', ROUND(v_reserved, 2),
    'available_eur', ROUND(v_cash_balance - v_reserved, 2),
    'invested_cost_basis_eur', ROUND(v_invested_cost_basis, 2),
    'current_position_value_eur', ROUND(v_current_position_value, 2),
    'unrealized_pnl_eur', ROUND(v_unrealized_pnl, 2),
    'realized_pnl_eur', ROUND(v_realized_pnl, 2),
    'total_pnl_eur', ROUND(v_realized_pnl + v_unrealized_pnl, 2),
    'total_portfolio_value_eur', ROUND(v_total_portfolio_value, 2),
    'total_gas_eur', ROUND(v_total_gas_eur, 2),
    'is_test_mode', p_is_test_mode
  );
END;
$$;