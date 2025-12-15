-- Drop existing settle_buy_trade to allow parameter rename
DROP FUNCTION IF EXISTS public.settle_buy_trade(uuid, numeric, numeric);

-- 1) Fix settle_buy_trade to accept p_reserved_amount = 0 (immediate deduction model)
CREATE OR REPLACE FUNCTION public.settle_buy_trade(
  p_user_id uuid,
  p_actual_spent numeric,
  p_reserved_amount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_cash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'portfolio_not_initialized');
  END IF;

  -- Immediate deduction model: p_reserved_amount = 0 is valid
  -- Just deduct actual_spent from cash
  IF v_cash < p_actual_spent THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'insufficient_cash',
      'cash_balance', v_cash,
      'actual_spent', p_actual_spent
    );
  END IF;

  -- Release reserved if any was held, then deduct actual spent
  v_release_amount := LEAST(v_reserved, p_reserved_amount);

  UPDATE public.portfolio_capital
  SET cash_balance_eur = cash_balance_eur - p_actual_spent,
      reserved_eur = reserved_eur - v_release_amount,
      updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'cash_before', v_cash,
    'actual_spent', p_actual_spent,
    'reserved_released', v_release_amount,
    'cash_after', v_cash - p_actual_spent
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.settle_buy_trade(uuid, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_buy_trade(uuid, numeric, numeric) TO service_role;

-- 2) SAFE: recompute cash for ONE user and ONE mode (mock or real)
-- NOTE: if exit_value is present, we assume it is already NET (no extra fee subtraction).
CREATE OR REPLACE FUNCTION public.recalculate_cash_from_trades(
  p_user_id uuid,
  p_is_test_mode boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_starting NUMERIC;
  v_actual_cash NUMERIC;
  v_buy_total NUMERIC := 0;
  v_sell_total NUMERIC := 0;
  v_expected_cash NUMERIC := 0;
BEGIN
  -- SECURITY: only allow service role to run this (avoid exposing a "rewrite my cash" button)
  IF auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  SELECT starting_capital_eur, cash_balance_eur
  INTO v_starting, v_actual_cash
  FROM public.portfolio_capital
  WHERE user_id = p_user_id;

  IF v_starting IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'portfolio_not_initialized');
  END IF;

  -- BUY cost: total_value + (fees/buy_fees if ever populated)
  SELECT
    COALESCE(SUM(
      CASE WHEN LOWER(trade_type) = 'buy'
        THEN total_value
           + COALESCE(fees, 0)
           + COALESCE(buy_fees, 0)
        ELSE 0 END
    ), 0),
    COALESCE(SUM(
      CASE WHEN LOWER(trade_type) = 'sell'
        -- SELL proceeds: prefer exit_value (assumed NET).
        THEN COALESCE(
               exit_value,
               total_value
               - COALESCE(fees, 0)
               - COALESCE(sell_fees, 0)
             )
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
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'mode', CASE WHEN p_is_test_mode THEN 'mock' ELSE 'real' END,
    'starting_capital_eur', ROUND(v_starting, 2),
    'total_buy_cost', ROUND(v_buy_total, 2),
    'total_sell_proceeds', ROUND(v_sell_total, 2),
    'expected_cash', ROUND(v_expected_cash, 2),
    'previous_cash', ROUND(v_actual_cash, 2),
    'correction', ROUND(v_expected_cash - v_actual_cash, 2)
  );
END;
$$;

-- Only service_role should execute this
REVOKE ALL ON FUNCTION public.recalculate_cash_from_trades(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_cash_from_trades(uuid, boolean) TO service_role;