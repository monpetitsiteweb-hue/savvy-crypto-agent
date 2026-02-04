-- Step 2: Update all RPCs with is_test_mode filter
-- DEPLOY STRATEGY: All RPCs use DEFAULT true (backward compatible)

-- ============================================================================
-- 2.1: get_portfolio_metrics - Add is_test_mode filter to portfolio_capital
-- ============================================================================
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
    ORDER BY observed_at DESC
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
  -- =========================================================================
  IF p_is_test_mode = false THEN
    -- Get latest ETH price
    SELECT COALESCE(price, 0) INTO v_eth_price
    FROM public.price_snapshots
    WHERE symbol IN ('ETH-EUR', 'ETH')
    ORDER BY observed_at DESC
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

-- ============================================================================
-- 2.2: reset_portfolio_capital - Add is_test_mode with HARD REJECT for REAL
-- ============================================================================
DROP FUNCTION IF EXISTS public.reset_portfolio_capital(uuid, boolean);
DROP FUNCTION IF EXISTS public.reset_portfolio_capital(uuid);

CREATE OR REPLACE FUNCTION public.reset_portfolio_capital(
  p_user_id uuid,
  p_is_test_mode boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- HARD INVARIANT: REAL capital must NEVER be reset programmatically
  IF p_is_test_mode = false THEN
    RAISE EXCEPTION 'Cannot reset REAL portfolio capital programmatically';
  END IF;

  -- Access guard: only own user or service_role
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  -- Delete existing TEST row if present
  DELETE FROM public.portfolio_capital
  WHERE user_id = p_user_id AND is_test_mode = true;

  -- Insert fresh TEST row with default capital
  INSERT INTO public.portfolio_capital (user_id, is_test_mode, starting_capital_eur, cash_balance_eur, reserved_eur)
  VALUES (p_user_id, true, 30000, 30000, 0);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'test',
    'starting_capital_eur', 30000,
    'cash_balance_eur', 30000
  );
END;
$$;

-- ============================================================================
-- 2.3: settle_buy_trade - Add is_test_mode filter
-- ============================================================================
DROP FUNCTION IF EXISTS public.settle_buy_trade(uuid, numeric, numeric);
DROP FUNCTION IF EXISTS public.settle_buy_trade(uuid, numeric, numeric, boolean);

CREATE OR REPLACE FUNCTION public.settle_buy_trade(
  p_user_id uuid,
  p_actual_spent numeric,
  p_reserved_amount numeric DEFAULT 0,
  p_is_test_mode boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash NUMERIC;
  v_reserved NUMERIC;
  v_release_amount NUMERIC;
BEGIN
  -- Access guard
  PERFORM public.check_capital_access(p_user_id);

  SELECT cash_balance_eur, reserved_eur
  INTO v_cash, v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode
  FOR UPDATE;

  IF v_cash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'portfolio_not_initialized');
  END IF;

  IF v_cash < p_actual_spent THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'insufficient_cash',
      'cash_balance', v_cash,
      'actual_spent', p_actual_spent
    );
  END IF;

  v_release_amount := LEAST(v_reserved, p_reserved_amount);

  UPDATE public.portfolio_capital
  SET cash_balance_eur = cash_balance_eur - p_actual_spent,
      reserved_eur = reserved_eur - v_release_amount,
      updated_at = now()
  WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode;

  RETURN jsonb_build_object(
    'success', true,
    'cash_before', v_cash,
    'actual_spent', p_actual_spent,
    'reserved_released', v_release_amount,
    'cash_after', v_cash - p_actual_spent
  );
END;
$$;

-- ============================================================================
-- 2.4: settle_sell_trade - Add is_test_mode filter
-- ============================================================================
DROP FUNCTION IF EXISTS public.settle_sell_trade(uuid, numeric);
DROP FUNCTION IF EXISTS public.settle_sell_trade(uuid, numeric, boolean);

CREATE OR REPLACE FUNCTION public.settle_sell_trade(
  p_user_id uuid,
  p_proceeds numeric,
  p_is_test_mode boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash NUMERIC;
BEGIN
  PERFORM public.check_capital_access(p_user_id);

  SELECT cash_balance_eur
  INTO v_cash
  FROM public.portfolio_capital
  WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode
  FOR UPDATE;

  IF v_cash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'portfolio_not_initialized');
  END IF;

  UPDATE public.portfolio_capital
  SET cash_balance_eur = cash_balance_eur + p_proceeds,
      updated_at = now()
  WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode;

  RETURN jsonb_build_object(
    'success', true,
    'cash_before', v_cash,
    'proceeds', p_proceeds,
    'cash_after', v_cash + p_proceeds
  );
END;
$$;

-- ============================================================================
-- 2.5: reserve_capital - Add is_test_mode filter
-- ============================================================================
DROP FUNCTION IF EXISTS public.reserve_capital(uuid, numeric);
DROP FUNCTION IF EXISTS public.reserve_capital(uuid, numeric, boolean);

CREATE OR REPLACE FUNCTION public.reserve_capital(
  p_user_id uuid,
  p_amount numeric,
  p_is_test_mode boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash NUMERIC;
  v_reserved NUMERIC;
  v_available NUMERIC;
BEGIN
  PERFORM public.check_capital_access(p_user_id);

  SELECT cash_balance_eur, reserved_eur
  INTO v_cash, v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode
  FOR UPDATE;

  IF v_cash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'portfolio_not_initialized');
  END IF;

  v_available := v_cash - v_reserved;

  IF v_available < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'insufficient_available',
      'available', v_available,
      'requested', p_amount
    );
  END IF;

  UPDATE public.portfolio_capital
  SET reserved_eur = reserved_eur + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode;

  RETURN jsonb_build_object(
    'success', true,
    'reserved_before', v_reserved,
    'amount', p_amount,
    'reserved_after', v_reserved + p_amount
  );
END;
$$;

-- ============================================================================
-- 2.6: release_reservation - Add is_test_mode filter
-- ============================================================================
DROP FUNCTION IF EXISTS public.release_reservation(uuid, numeric);
DROP FUNCTION IF EXISTS public.release_reservation(uuid, numeric, boolean);

CREATE OR REPLACE FUNCTION public.release_reservation(
  p_user_id uuid,
  p_amount numeric,
  p_is_test_mode boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reserved NUMERIC;
  v_release NUMERIC;
BEGIN
  PERFORM public.check_capital_access(p_user_id);

  SELECT reserved_eur
  INTO v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode
  FOR UPDATE;

  IF v_reserved IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'portfolio_not_initialized');
  END IF;

  v_release := LEAST(v_reserved, p_amount);

  UPDATE public.portfolio_capital
  SET reserved_eur = reserved_eur - v_release,
      updated_at = now()
  WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode;

  RETURN jsonb_build_object(
    'success', true,
    'reserved_before', v_reserved,
    'released', v_release,
    'reserved_after', v_reserved - v_release
  );
END;
$$;

-- ============================================================================
-- 2.7: recalculate_cash_from_trades - Add is_test_mode filter to portfolio_capital
-- ============================================================================
DROP FUNCTION IF EXISTS public.recalculate_cash_from_trades(uuid, boolean);

CREATE OR REPLACE FUNCTION public.recalculate_cash_from_trades(
  p_user_id uuid,
  p_is_test_mode boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_starting NUMERIC;
  v_actual_cash NUMERIC;
  v_buy_total NUMERIC := 0;
  v_sell_total NUMERIC := 0;
  v_expected_cash NUMERIC := 0;
BEGIN
  -- SECURITY: only allow service role to run this
  IF auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  SELECT starting_capital_eur, cash_balance_eur
  INTO v_starting, v_actual_cash
  FROM public.portfolio_capital
  WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode;

  IF v_starting IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'portfolio_not_initialized');
  END IF;

  SELECT
    COALESCE(SUM(
      CASE WHEN LOWER(trade_type) = 'buy'
        THEN total_value + COALESCE(fees, 0) + COALESCE(buy_fees, 0)
        ELSE 0 END
    ), 0),
    COALESCE(SUM(
      CASE WHEN LOWER(trade_type) = 'sell'
        THEN COALESCE(exit_value, total_value - COALESCE(fees, 0) - COALESCE(sell_fees, 0))
        ELSE 0 END
    ), 0)
  INTO v_buy_total, v_sell_total
  FROM public.mock_trades
  WHERE user_id = p_user_id
    AND is_test_mode = p_is_test_mode
    AND COALESCE(is_corrupted, false) = false;

  v_expected_cash := v_starting - v_buy_total + v_sell_total;

  UPDATE public.portfolio_capital
  SET cash_balance_eur = v_expected_cash,
      updated_at = now()
  WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode;

  RETURN jsonb_build_object(
    'success', true,
    'mode', CASE WHEN p_is_test_mode THEN 'test' ELSE 'real' END,
    'starting_capital_eur', ROUND(v_starting, 2),
    'total_buy_cost', ROUND(v_buy_total, 2),
    'total_sell_proceeds', ROUND(v_sell_total, 2),
    'expected_cash', ROUND(v_expected_cash, 2),
    'previous_cash', ROUND(v_actual_cash, 2),
    'correction', ROUND(v_expected_cash - v_actual_cash, 2)
  );
END;
$$;