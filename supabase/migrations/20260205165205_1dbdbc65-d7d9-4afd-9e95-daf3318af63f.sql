-- FIX: get_portfolio_metrics uses price_snapshots.ts (not observed_at)
-- This resolves the hard RPC failure causing €0.00 display

DROP FUNCTION IF EXISTS public.get_portfolio_metrics(uuid, boolean);

CREATE OR REPLACE FUNCTION public.get_portfolio_metrics(
  p_user_id uuid,
  p_is_test_mode boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_starting NUMERIC := 0;
  v_cash NUMERIC := 0;
  v_reserved NUMERIC := 0;
  v_available NUMERIC := 0;
  v_cost_basis NUMERIC := 0;
  v_current_value NUMERIC := 0;
  v_unrealized NUMERIC := 0;
  v_realized NUMERIC := 0;
  v_total_pnl NUMERIC := 0;
  v_portfolio_value NUMERIC := 0;
  v_total_fees NUMERIC := 0;
  v_buy_fees NUMERIC := 0;
  v_sell_fees NUMERIC := 0;
  v_total_gas_eur NUMERIC := 0;
  v_eth_price NUMERIC := 0;
  v_row RECORD;
BEGIN
  -- =========================================================================
  -- STEP 1: Fetch portfolio_capital row (MODE-SCOPED)
  -- =========================================================================
  SELECT starting_capital_eur, cash_balance_eur, reserved_eur
  INTO v_starting, v_cash, v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode;

  IF NOT FOUND THEN
    -- FROZEN CONTRACT: Use exactly "portfolio_not_initialized"
    RETURN json_build_object(
      'success', false,
      'reason', 'portfolio_not_initialized',
      'starting_capital_eur', 0,
      'cash_balance_eur', 0,
      'reserved_eur', 0,
      'available_eur', 0,
      'invested_cost_basis_eur', 0,
      'current_position_value_eur', 0,
      'unrealized_pnl_eur', 0,
      'realized_pnl_eur', 0,
      'total_pnl_eur', 0,
      'total_portfolio_value_eur', 0,
      'total_fees_eur', 0,
      'total_buy_fees_eur', 0,
      'total_sell_fees_eur', 0
    );
  END IF;

  v_available := v_cash - v_reserved;

  -- =========================================================================
  -- STEP 2: Calculate cost basis from open positions (FIFO)
  -- =========================================================================
  SELECT COALESCE(SUM(
    (remaining_amount * buy_price) + 
    (CASE WHEN remaining_amount = ol.full_amount THEN buy_fee ELSE 0 END)
  ), 0)
  INTO v_cost_basis
  FROM (
    SELECT 
      b.id,
      b.cryptocurrency,
      b.amount as full_amount,
      ROUND((COALESCE(b.amount, 0) - COALESCE(s.sold_amount, 0))::numeric, 8) as remaining_amount,
      b.price as buy_price,
      (COALESCE(b.buy_fees, 0) + CASE WHEN COALESCE(b.buy_fees, 0) = 0 THEN COALESCE(b.fees, 0) ELSE 0 END) as buy_fee
    FROM public.mock_trades b
    LEFT JOIN (
      SELECT original_trade_id, SUM(COALESCE(original_purchase_amount, 0)) as sold_amount
      FROM public.mock_trades
      WHERE user_id = p_user_id
        AND trade_type = 'sell'
        AND original_trade_id IS NOT NULL
        AND is_corrupted = false
        AND is_test_mode = p_is_test_mode
      GROUP BY original_trade_id
    ) s ON s.original_trade_id = b.id
    WHERE b.user_id = p_user_id
      AND b.trade_type = 'buy'
      AND b.is_corrupted = false
      AND b.is_test_mode = p_is_test_mode
  ) ol
  WHERE ol.remaining_amount > 0.00000001;

  -- =========================================================================
  -- STEP 3: Calculate current position value using latest prices
  -- FIX: Use "ts" column instead of "observed_at" (schema-correct)
  -- =========================================================================
  SELECT COALESCE(SUM(ol.remaining_amount * COALESCE(ps.price, ol.buy_price)), 0)
  INTO v_current_value
  FROM (
    SELECT 
      b.cryptocurrency,
      ROUND((COALESCE(b.amount, 0) - COALESCE(s.sold_amount, 0))::numeric, 8) as remaining_amount,
      b.price as buy_price
    FROM public.mock_trades b
    LEFT JOIN (
      SELECT original_trade_id, SUM(COALESCE(original_purchase_amount, 0)) as sold_amount
      FROM public.mock_trades
      WHERE user_id = p_user_id
        AND trade_type = 'sell'
        AND original_trade_id IS NOT NULL
        AND is_corrupted = false
        AND is_test_mode = p_is_test_mode
      GROUP BY original_trade_id
    ) s ON s.original_trade_id = b.id
    WHERE b.user_id = p_user_id
      AND b.trade_type = 'buy'
      AND b.is_corrupted = false
      AND b.is_test_mode = p_is_test_mode
  ) ol
  LEFT JOIN LATERAL (
    SELECT price FROM public.price_snapshots
    WHERE symbol = ol.cryptocurrency
    ORDER BY ts DESC  -- FIX: was "observed_at", now "ts"
    LIMIT 1
  ) ps ON true
  WHERE ol.remaining_amount > 0.00000001;

  v_unrealized := v_current_value - v_cost_basis;

  -- =========================================================================
  -- STEP 4: Calculate realized P&L from closed trades
  -- =========================================================================
  SELECT COALESCE(SUM(realized_pnl), 0)
  INTO v_realized
  FROM public.mock_trades
  WHERE user_id = p_user_id
    AND trade_type = 'sell'
    AND is_corrupted = false
    AND is_test_mode = p_is_test_mode
    AND realized_pnl IS NOT NULL;

  -- =========================================================================
  -- STEP 5: Calculate fees
  -- =========================================================================
  SELECT 
    COALESCE(SUM(CASE WHEN trade_type = 'buy' THEN COALESCE(buy_fees, 0) + CASE WHEN COALESCE(buy_fees, 0) = 0 THEN COALESCE(fees, 0) ELSE 0 END ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN trade_type = 'sell' THEN COALESCE(sell_fees, 0) + CASE WHEN COALESCE(sell_fees, 0) = 0 THEN COALESCE(fees, 0) ELSE 0 END ELSE 0 END), 0)
  INTO v_buy_fees, v_sell_fees
  FROM public.mock_trades
  WHERE user_id = p_user_id
    AND is_corrupted = false
    AND is_test_mode = p_is_test_mode;

  v_total_fees := v_buy_fees + v_sell_fees;

  -- =========================================================================
  -- STEP 6: REAL mode only - calculate gas costs
  -- FIX: Use "ts" column instead of "observed_at" (schema-correct)
  -- =========================================================================
  IF p_is_test_mode = false THEN
    -- Get latest ETH price
    SELECT COALESCE(price, 0) INTO v_eth_price
    FROM public.price_snapshots
    WHERE symbol IN ('ETH-EUR', 'ETH')
    ORDER BY ts DESC  -- FIX: was "observed_at", now "ts"
    LIMIT 1;

    -- Sum gas costs and convert to EUR
    SELECT COALESCE(SUM(gas_cost_eth), 0) * v_eth_price
    INTO v_total_gas_eur
    FROM public.mock_trades
    WHERE user_id = p_user_id
      AND is_test_mode = false
      AND execution_confirmed = true
      AND gas_cost_eth IS NOT NULL;

    v_total_fees := v_total_fees + v_total_gas_eur;
  END IF;

  -- =========================================================================
  -- STEP 7: Final calculations
  -- =========================================================================
  v_total_pnl := v_unrealized + v_realized;
  v_portfolio_value := v_cash + v_current_value;

  RETURN json_build_object(
    'success', true,
    'queried_mode', p_is_test_mode,  -- GUARDRAIL: Return the mode that was queried
    'starting_capital_eur', ROUND(v_starting, 2),
    'cash_balance_eur', ROUND(v_cash, 2),
    'reserved_eur', ROUND(v_reserved, 2),
    'available_eur', ROUND(v_available, 2),
    'invested_cost_basis_eur', ROUND(v_cost_basis, 2),
    'current_position_value_eur', ROUND(v_current_value, 2),
    'unrealized_pnl_eur', ROUND(v_unrealized, 2),
    'realized_pnl_eur', ROUND(v_realized, 2),
    'total_pnl_eur', ROUND(v_total_pnl, 2),
    'total_portfolio_value_eur', ROUND(v_portfolio_value, 2),
    'total_fees_eur', ROUND(v_total_fees, 2),
    'total_buy_fees_eur', ROUND(v_buy_fees, 2),
    'total_sell_fees_eur', ROUND(v_sell_fees, 2)
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_portfolio_metrics(uuid, boolean) TO authenticated, service_role;