-- STRICT PATCH: force_mock_trade_insert test-mode check + SELL P&L snapshot fields
-- Do not modify anything else.

DROP FUNCTION IF EXISTS public.force_mock_trade_insert(uuid, uuid, text, text, numeric, numeric, numeric, uuid, numeric);

CREATE OR REPLACE FUNCTION public.force_mock_trade_insert(
  p_user_id uuid,
  p_strategy_id uuid,
  p_trade_type text,
  p_symbol text,
  p_amount numeric,
  p_price numeric,
  p_fees numeric DEFAULT 0,
  p_original_trade_id uuid DEFAULT NULL,
  p_original_purchase_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trade_id uuid;
  v_total_value numeric;
  v_cash_before numeric;
  v_cash_after numeric;
  v_symbol text;
  v_lot_remaining numeric;
  v_entry_price numeric;
  v_original_purchase_value numeric;
  v_exit_value numeric;
  v_realized_pnl numeric;
  v_realized_pnl_pct numeric;
  v_is_test_mode boolean;
  v_eps numeric := 0.00000001;
BEGIN
  -- Access check (must already exist in your DB)
  PERFORM public.check_capital_access(p_user_id);

  -- Normalize symbol
  v_symbol := UPPER(TRIM(p_symbol));
  IF position('-' IN v_symbol) = 0 THEN
    v_symbol := v_symbol || '-EUR';
  END IF;

  -- STRICT: test-mode must come from the COLUMN, not config JSON
  SELECT is_test_mode INTO v_is_test_mode
  FROM public.trading_strategies
  WHERE id = p_strategy_id AND user_id = p_user_id;

  IF v_is_test_mode IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'strategy_not_found');
  END IF;
  IF v_is_test_mode = false THEN
    RETURN jsonb_build_object('success', false, 'reason', 'strategy_not_test_mode');
  END IF;

  -- Compute total value
  v_total_value := ROUND((p_amount * p_price)::numeric, 2);

  -- Lock portfolio_capital row
  SELECT cash_balance_eur INTO v_cash_before
  FROM public.portfolio_capital
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_cash_before IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'portfolio_not_initialized');
  END IF;

  -- BUY
  IF LOWER(p_trade_type) = 'buy' THEN
    IF v_cash_before < (v_total_value + COALESCE(p_fees, 0)) THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'insufficient_cash',
        'available', v_cash_before,
        'required', v_total_value + COALESCE(p_fees, 0)
      );
    END IF;

    INSERT INTO public.mock_trades (
      user_id, strategy_id, trade_type, cryptocurrency,
      amount, price, total_value,
      fees, buy_fees,
      is_test_mode, is_corrupted, executed_at
    ) VALUES (
      p_user_id, p_strategy_id, 'buy', v_symbol,
      ROUND(p_amount::numeric, 8),
      ROUND(p_price::numeric, 2),
      v_total_value,
      COALESCE(p_fees, 0),
      COALESCE(p_fees, 0),
      true, false, now()
    )
    RETURNING id INTO v_trade_id;

    v_cash_after := v_cash_before - v_total_value - COALESCE(p_fees, 0);

    UPDATE public.portfolio_capital
    SET cash_balance_eur = v_cash_after, updated_at = now()
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'trade_id', v_trade_id,
      'trade_type', 'buy',
      'symbol', v_symbol,
      'amount', p_amount,
      'price', p_price,
      'total_value', v_total_value,
      'fees', COALESCE(p_fees, 0),
      'cash_balance_eur_before', v_cash_before,
      'cash_balance_eur_after', v_cash_after
    );

  -- SELL
  ELSIF LOWER(p_trade_type) = 'sell' THEN
    IF p_original_trade_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'reason', 'missing_original_trade_id');
    END IF;

    IF p_original_purchase_amount IS NULL OR ABS(p_amount - p_original_purchase_amount) > v_eps THEN
      RETURN jsonb_build_object('success', false, 'reason', 'amount_must_equal_original_purchase_amount');
    END IF;

    -- Validate lot remaining (proper filters)
    SELECT
      ROUND((b.amount - COALESCE(SUM(s.original_purchase_amount), 0))::numeric, 8),
      b.price
    INTO v_lot_remaining, v_entry_price
    FROM public.mock_trades b
    LEFT JOIN public.mock_trades s
      ON s.original_trade_id = b.id
     AND s.trade_type = 'sell'
     AND s.is_test_mode = true
     AND s.is_corrupted = false
    WHERE b.id = p_original_trade_id
      AND b.user_id = p_user_id
      AND b.trade_type = 'buy'
      AND b.is_test_mode = true
      AND b.is_corrupted = false
    GROUP BY b.id, b.amount, b.price;

    IF v_lot_remaining IS NULL THEN
      RETURN jsonb_build_object('success', false, 'reason', 'lot_not_found');
    END IF;

    IF v_lot_remaining < p_amount - v_eps THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'insufficient_lot_remaining',
        'remaining', v_lot_remaining,
        'requested', p_amount
      );
    END IF;

    -- STRICT: snapshot fields + realized P&L
    v_original_purchase_value := ROUND((p_amount * v_entry_price)::numeric, 2);
    v_exit_value := v_total_value;
    v_realized_pnl := ROUND((v_exit_value - v_original_purchase_value - COALESCE(p_fees, 0))::numeric, 2);
    v_realized_pnl_pct := CASE
      WHEN v_original_purchase_value > 0 THEN ROUND((v_realized_pnl / v_original_purchase_value * 100)::numeric, 2)
      ELSE 0
    END;

    INSERT INTO public.mock_trades (
      user_id, strategy_id, trade_type, cryptocurrency,
      amount, price, total_value,
      fees, sell_fees,
      is_test_mode, is_corrupted, executed_at,
      original_trade_id, original_purchase_amount, original_purchase_price, original_purchase_value,
      exit_value, realized_pnl, realized_pnl_pct, profit_loss
    ) VALUES (
      p_user_id, p_strategy_id, 'sell', v_symbol,
      ROUND(p_amount::numeric, 8),
      ROUND(p_price::numeric, 2),
      v_total_value,
      COALESCE(p_fees, 0),
      COALESCE(p_fees, 0),
      true, false, now(),
      p_original_trade_id,
      ROUND(p_amount::numeric, 8),
      v_entry_price,
      v_original_purchase_value,
      v_exit_value,
      v_realized_pnl,
      v_realized_pnl_pct,
      v_realized_pnl
    )
    RETURNING id INTO v_trade_id;

    v_cash_after := v_cash_before + v_exit_value - COALESCE(p_fees, 0);

    UPDATE public.portfolio_capital
    SET cash_balance_eur = v_cash_after, updated_at = now()
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'trade_id', v_trade_id,
      'trade_type', 'sell',
      'symbol', v_symbol,
      'amount', p_amount,
      'price', p_price,
      'total_value', v_total_value,
      'fees', COALESCE(p_fees, 0),
      'realized_pnl', v_realized_pnl,
      'realized_pnl_pct', v_realized_pnl_pct,
      'cash_balance_eur_before', v_cash_before,
      'cash_balance_eur_after', v_cash_after
    );
  ELSE
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_trade_type');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.force_mock_trade_insert(uuid, uuid, text, text, numeric, numeric, numeric, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.force_mock_trade_insert(uuid, uuid, text, text, numeric, numeric, numeric, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.force_mock_trade_insert(uuid, uuid, text, text, numeric, numeric, numeric, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.force_mock_trade_insert(uuid, uuid, text, text, numeric, numeric, numeric, uuid, numeric) TO service_role;