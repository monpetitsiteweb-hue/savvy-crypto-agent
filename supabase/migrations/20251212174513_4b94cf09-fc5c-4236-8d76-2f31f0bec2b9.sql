-- P0: Portfolio Capital Single Source of Truth with Full Safety Guards

-- 1. Change table defaults to 0 (no money creation)
ALTER TABLE public.portfolio_capital 
  ALTER COLUMN starting_capital_eur SET DEFAULT 0,
  ALTER COLUMN cash_balance_eur SET DEFAULT 0,
  ALTER COLUMN reserved_eur SET DEFAULT 0;

-- 2. Update check_capital_access to contain admin bypass
CREATE OR REPLACE FUNCTION public.check_capital_access(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_auth_uid UUID;
  v_role TEXT;
  v_claims JSONB;
BEGIN
  -- Admin bypass for SQL editor debugging
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN TRUE;
  END IF;

  v_auth_uid := auth.uid();
  
  -- Authenticated user must match
  IF v_auth_uid IS NOT NULL THEN
    IF v_auth_uid = p_user_id THEN
      RETURN TRUE;
    ELSE
      RAISE EXCEPTION 'Access denied: user_id mismatch';
    END IF;
  END IF;
  
  -- Service role check (for coordinator/backend)
  v_role := current_setting('request.jwt.claim.role', true);
  IF v_role = 'service_role' THEN
    RETURN TRUE;
  END IF;
  
  -- Fallback: parse claims JSON
  BEGIN
    v_claims := current_setting('request.jwt.claims', true)::jsonb;
    IF v_claims->>'role' = 'service_role' THEN
      RETURN TRUE;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  
  RAISE EXCEPTION 'Access denied: no valid authentication';
END;
$function$;

-- 3. get_portfolio_metrics with full corrections
CREATE OR REPLACE FUNCTION public.get_portfolio_metrics(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_starting NUMERIC;
  v_cash NUMERIC;
  v_reserved NUMERIC;
  v_available NUMERIC;
  v_invested_cost_basis NUMERIC := 0;
  v_current_position_value NUMERIC := 0;
  v_realized_pnl NUMERIC := 0;
  v_total_buy_fees NUMERIC := 0;
  v_total_sell_fees NUMERIC := 0;
  v_total_fees NUMERIC := 0;
  buy_rec RECORD;
  v_sold_amount NUMERIC;
  v_remaining NUMERIC;
  v_lot_cost_basis NUMERIC;
  v_lot_buy_fee NUMERIC;
  v_latest_price NUMERIC;
  v_base TEXT;
BEGIN
  -- Access check (admin bypass lives inside check_capital_access)
  PERFORM public.check_capital_access(p_user_id);
  
  -- Ensure row exists (user_id only, no money creation)
  INSERT INTO public.portfolio_capital (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Read capital row
  SELECT starting_capital_eur, cash_balance_eur, reserved_eur
  INTO v_starting, v_cash, v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id;
  
  -- Portfolio not initialized guard
  IF COALESCE(v_starting, 0) = 0 AND COALESCE(v_cash, 0) = 0 AND COALESCE(v_reserved, 0) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'portfolio_not_initialized',
      'message', 'Call reset_portfolio_capital to initialize'
    );
  END IF;
  
  -- Null-safe available calculation
  v_available := COALESCE(v_cash, 0) - COALESCE(v_reserved, 0);
  
  -- Aggregate fees from all trades (prevent double-counting)
  SELECT 
    COALESCE(SUM(
      CASE WHEN trade_type = 'buy' THEN
        COALESCE(buy_fees, 0) + CASE WHEN COALESCE(buy_fees, 0) = 0 THEN COALESCE(fees, 0) ELSE 0 END
      ELSE 0 END
    ), 0),
    COALESCE(SUM(
      CASE WHEN trade_type = 'sell' THEN
        COALESCE(sell_fees, 0) + CASE WHEN COALESCE(sell_fees, 0) = 0 THEN COALESCE(fees, 0) ELSE 0 END
      ELSE 0 END
    ), 0)
  INTO v_total_buy_fees, v_total_sell_fees
  FROM public.mock_trades
  WHERE user_id = p_user_id
    AND is_corrupted = false
    AND is_test_mode = true;
  
  v_total_fees := v_total_buy_fees + v_total_sell_fees;
  
  -- Realized P&L from SELL trades
  SELECT COALESCE(SUM(COALESCE(realized_pnl, 0)), 0)
  INTO v_realized_pnl
  FROM public.mock_trades
  WHERE user_id = p_user_id
    AND trade_type = 'sell'
    AND is_corrupted = false
    AND is_test_mode = true;
  
  -- FIFO loop for open positions
  FOR buy_rec IN
    SELECT 
      id,
      cryptocurrency,
      amount AS buy_amount,
      price AS buy_price,
      total_value AS buy_total_value,
      COALESCE(buy_fees, 0) + CASE WHEN COALESCE(buy_fees, 0) = 0 THEN COALESCE(fees, 0) ELSE 0 END AS buy_fee
    FROM public.mock_trades
    WHERE user_id = p_user_id
      AND trade_type = 'buy'
      AND is_corrupted = false
      AND is_test_mode = true
    ORDER BY executed_at ASC
  LOOP
    -- Skip if buy_amount is zero or null (prevent division by zero)
    IF COALESCE(buy_rec.buy_amount, 0) <= 0 THEN
      CONTINUE;
    END IF;
    
    -- Calculate sold amount for this lot
    SELECT COALESCE(SUM(COALESCE(original_purchase_amount, 0)), 0)
    INTO v_sold_amount
    FROM public.mock_trades
    WHERE trade_type = 'sell'
      AND user_id = p_user_id
      AND original_trade_id = buy_rec.id
      AND is_corrupted = false
      AND is_test_mode = true;
    
    v_remaining := buy_rec.buy_amount - v_sold_amount;
    
    IF v_remaining > 0.00000001 THEN
      -- Proportional cost basis (safe division)
      v_lot_cost_basis := (v_remaining / NULLIF(buy_rec.buy_amount, 0)) * (COALESCE(buy_rec.buy_total_value, 0) + COALESCE(buy_rec.buy_fee, 0));
      v_invested_cost_basis := v_invested_cost_basis + COALESCE(v_lot_cost_basis, 0);
      
      -- Price lookup with symbol normalization
      v_base := REPLACE(REPLACE(UPPER(buy_rec.cryptocurrency), '-EUR', ''), '-USD', '');
      
      SELECT price INTO v_latest_price
      FROM public.price_snapshots
      WHERE symbol = v_base || '-EUR'
      ORDER BY ts DESC LIMIT 1;
      
      IF v_latest_price IS NULL THEN
        SELECT price INTO v_latest_price
        FROM public.price_snapshots
        WHERE symbol = v_base
        ORDER BY ts DESC LIMIT 1;
      END IF;
      
      IF v_latest_price IS NULL THEN
        SELECT price INTO v_latest_price
        FROM public.price_snapshots
        WHERE symbol = buy_rec.cryptocurrency
        ORDER BY ts DESC LIMIT 1;
      END IF;
      
      -- Fallback to buy price
      IF v_latest_price IS NULL OR v_latest_price <= 0 THEN
        v_latest_price := COALESCE(buy_rec.buy_price, 0);
      END IF;
      
      v_current_position_value := v_current_position_value + (v_remaining * v_latest_price);
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'starting_capital_eur', ROUND(COALESCE(v_starting, 0), 2),
    'cash_balance_eur', ROUND(COALESCE(v_cash, 0), 2),
    'reserved_eur', ROUND(COALESCE(v_reserved, 0), 2),
    'available_eur', ROUND(COALESCE(v_available, 0), 2),
    'invested_cost_basis_eur', ROUND(v_invested_cost_basis, 2),
    'current_position_value_eur', ROUND(v_current_position_value, 2),
    'unrealized_pnl_eur', ROUND(v_current_position_value - v_invested_cost_basis, 2),
    'realized_pnl_eur', ROUND(v_realized_pnl, 2),
    'total_pnl_eur', ROUND((v_current_position_value - v_invested_cost_basis) + v_realized_pnl, 2),
    'total_portfolio_value_eur', ROUND(COALESCE(v_cash, 0) + v_current_position_value, 2),
    'total_fees_eur', ROUND(v_total_fees, 2),
    'total_buy_fees_eur', ROUND(v_total_buy_fees, 2),
    'total_sell_fees_eur', ROUND(v_total_sell_fees, 2)
  );
END;
$function$;

-- 4. reserve_capital with null-safe math and not_initialized guard
CREATE OR REPLACE FUNCTION public.reserve_capital(p_user_id uuid, p_amount_eur numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_starting NUMERIC;
  v_cash NUMERIC;
  v_reserved NUMERIC;
  v_available NUMERIC;
BEGIN
  PERFORM public.check_capital_access(p_user_id);
  
  -- Input validation
  IF p_amount_eur IS NULL OR p_amount_eur <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'invalid_amount',
      'message', 'Amount must be positive'
    );
  END IF;
  
  -- Ensure row exists (user_id only, no money creation)
  INSERT INTO public.portfolio_capital (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Lock row for update
  SELECT starting_capital_eur, cash_balance_eur, reserved_eur
  INTO v_starting, v_cash, v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  -- Portfolio not initialized guard
  IF COALESCE(v_starting, 0) = 0 AND COALESCE(v_cash, 0) = 0 AND COALESCE(v_reserved, 0) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'portfolio_not_initialized',
      'message', 'Call reset_portfolio_capital to initialize'
    );
  END IF;
  
  -- Null-safe available calculation
  v_available := COALESCE(v_cash, 0) - COALESCE(v_reserved, 0);
  
  IF v_available < p_amount_eur THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'insufficient_available_balance',
      'available_eur', v_available,
      'requested_eur', p_amount_eur
    );
  END IF;
  
  -- Null-safe update
  UPDATE public.portfolio_capital
  SET reserved_eur = COALESCE(reserved_eur, 0) + p_amount_eur
  WHERE user_id = p_user_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'reserved_amount_eur', p_amount_eur,
    'new_reserved_total_eur', COALESCE(v_reserved, 0) + p_amount_eur,
    'available_after_eur', v_available - p_amount_eur
  );
END;
$function$;

-- 5. release_reservation with null-safe math and not_initialized guard
CREATE OR REPLACE FUNCTION public.release_reservation(p_user_id uuid, p_amount_eur numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_starting NUMERIC;
  v_cash NUMERIC;
  v_reserved NUMERIC;
  v_release NUMERIC;
BEGIN
  PERFORM public.check_capital_access(p_user_id);
  
  -- Input validation
  IF p_amount_eur IS NULL OR p_amount_eur <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'invalid_amount',
      'message', 'Amount must be positive'
    );
  END IF;
  
  -- Ensure row exists
  INSERT INTO public.portfolio_capital (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  
  SELECT starting_capital_eur, cash_balance_eur, reserved_eur
  INTO v_starting, v_cash, v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  -- Portfolio not initialized guard
  IF COALESCE(v_starting, 0) = 0 AND COALESCE(v_cash, 0) = 0 AND COALESCE(v_reserved, 0) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'portfolio_not_initialized',
      'message', 'Call reset_portfolio_capital to initialize'
    );
  END IF;
  
  -- Null-safe release (can only release what's reserved)
  v_release := LEAST(p_amount_eur, COALESCE(v_reserved, 0));
  
  UPDATE public.portfolio_capital
  SET reserved_eur = COALESCE(reserved_eur, 0) - v_release
  WHERE user_id = p_user_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'released_eur', v_release,
    'new_reserved_total_eur', COALESCE(v_reserved, 0) - v_release
  );
END;
$function$;

-- 6. settle_buy_trade with null-safe math and not_initialized guard
CREATE OR REPLACE FUNCTION public.settle_buy_trade(p_user_id uuid, p_reserved_amount numeric, p_actual_spent numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_starting NUMERIC;
  v_cash NUMERIC;
  v_reserved NUMERIC;
  v_cash_after NUMERIC;
  v_release_amount NUMERIC;
BEGIN
  PERFORM public.check_capital_access(p_user_id);
  
  -- Input validation
  IF p_reserved_amount IS NULL OR p_reserved_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'invalid_reserved_amount',
      'message', 'Reserved amount must be positive'
    );
  END IF;
  
  IF p_actual_spent IS NULL OR p_actual_spent <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'invalid_actual_spent',
      'message', 'Actual spent must be positive'
    );
  END IF;
  
  -- Ensure row exists
  INSERT INTO public.portfolio_capital (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  
  SELECT starting_capital_eur, cash_balance_eur, reserved_eur
  INTO v_starting, v_cash, v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  -- Portfolio not initialized guard
  IF COALESCE(v_starting, 0) = 0 AND COALESCE(v_cash, 0) = 0 AND COALESCE(v_reserved, 0) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'portfolio_not_initialized',
      'message', 'Call reset_portfolio_capital to initialize'
    );
  END IF;
  
  -- Null-safe check
  IF COALESCE(v_cash, 0) < p_actual_spent THEN
    -- Insufficient cash: release enough to restore invariant
    v_release_amount := LEAST(
      COALESCE(v_reserved, 0),
      GREATEST(p_reserved_amount, COALESCE(v_reserved, 0) - COALESCE(v_cash, 0))
    );
    
    UPDATE public.portfolio_capital
    SET reserved_eur = COALESCE(reserved_eur, 0) - v_release_amount
    WHERE user_id = p_user_id;
    
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'insufficient_cash_balance',
      'cash_balance_eur', COALESCE(v_cash, 0),
      'actual_spent_eur', p_actual_spent,
      'released_reservation_eur', v_release_amount
    );
  END IF;
  
  -- Success path: compute release_needed to preserve reserved <= cash_after
  v_cash_after := COALESCE(v_cash, 0) - p_actual_spent;
  v_release_amount := LEAST(
    COALESCE(v_reserved, 0),
    GREATEST(p_reserved_amount, COALESCE(v_reserved, 0) - v_cash_after)
  );
  
  UPDATE public.portfolio_capital
  SET 
    cash_balance_eur = COALESCE(cash_balance_eur, 0) - p_actual_spent,
    reserved_eur = COALESCE(reserved_eur, 0) - v_release_amount
  WHERE user_id = p_user_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'spent_eur', p_actual_spent,
    'new_cash_balance_eur', v_cash_after,
    'new_reserved_total_eur', COALESCE(v_reserved, 0) - v_release_amount
  );
END;
$function$;

-- 7. settle_sell_trade with null-safe math and not_initialized guard
CREATE OR REPLACE FUNCTION public.settle_sell_trade(p_user_id uuid, p_proceeds_eur numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_starting NUMERIC;
  v_cash NUMERIC;
  v_reserved NUMERIC;
BEGIN
  PERFORM public.check_capital_access(p_user_id);
  
  -- Input validation
  IF p_proceeds_eur IS NULL OR p_proceeds_eur <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'invalid_proceeds',
      'message', 'Proceeds must be positive'
    );
  END IF;
  
  -- Ensure row exists
  INSERT INTO public.portfolio_capital (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  
  SELECT starting_capital_eur, cash_balance_eur, reserved_eur
  INTO v_starting, v_cash, v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  -- Portfolio not initialized guard
  IF COALESCE(v_starting, 0) = 0 AND COALESCE(v_cash, 0) = 0 AND COALESCE(v_reserved, 0) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'portfolio_not_initialized',
      'message', 'Call reset_portfolio_capital to initialize'
    );
  END IF;
  
  UPDATE public.portfolio_capital
  SET cash_balance_eur = COALESCE(cash_balance_eur, 0) + p_proceeds_eur
  WHERE user_id = p_user_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'proceeds_eur', p_proceeds_eur,
    'new_cash_balance_eur', COALESCE(v_cash, 0) + p_proceeds_eur
  );
END;
$function$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.check_capital_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portfolio_metrics(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_capital(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_reservation(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_buy_trade(uuid, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_sell_trade(uuid, numeric) TO authenticated, service_role;