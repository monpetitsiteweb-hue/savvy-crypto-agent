-- =====================================================
-- Portfolio Capital System with FIFO-Correct Metrics
-- Production Safety Hardening Phase A
-- =====================================================

-- 1) Create portfolio_capital table
CREATE TABLE IF NOT EXISTS public.portfolio_capital (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  starting_capital_eur NUMERIC(18,2) NOT NULL DEFAULT 30000.00,
  cash_balance_eur NUMERIC(18,2) NOT NULL DEFAULT 30000.00,
  reserved_eur NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) Add CHECK constraints (table-scoped idempotency)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cash_balance_non_negative'
      AND conrelid = 'public.portfolio_capital'::regclass
  ) THEN
    ALTER TABLE public.portfolio_capital
    ADD CONSTRAINT cash_balance_non_negative CHECK (cash_balance_eur >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reserved_non_negative'
      AND conrelid = 'public.portfolio_capital'::regclass
  ) THEN
    ALTER TABLE public.portfolio_capital
    ADD CONSTRAINT reserved_non_negative CHECK (reserved_eur >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reserved_lte_cash'
      AND conrelid = 'public.portfolio_capital'::regclass
  ) THEN
    ALTER TABLE public.portfolio_capital
    ADD CONSTRAINT reserved_lte_cash CHECK (reserved_eur <= cash_balance_eur);
  END IF;
END $$;

-- 3) Migration-safe trigger: both DROP and CREATE inside table-existence guard
DO $$
BEGIN
  IF to_regclass('public.portfolio_capital') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_portfolio_capital_updated_at ON public.portfolio_capital;
    CREATE TRIGGER set_portfolio_capital_updated_at
      BEFORE UPDATE ON public.portfolio_capital
      FOR EACH ROW
      EXECUTE FUNCTION public.tg_set_updated_at();
  END IF;
END $$;

-- 4) Enable RLS
ALTER TABLE public.portfolio_capital ENABLE ROW LEVEL SECURITY;

-- 5) RLS policies (user-only, no blanket service-role policy)
DROP POLICY IF EXISTS "Users can view own capital" ON public.portfolio_capital;
CREATE POLICY "Users can view own capital"
  ON public.portfolio_capital FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own capital" ON public.portfolio_capital;
CREATE POLICY "Users can insert own capital"
  ON public.portfolio_capital FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own capital" ON public.portfolio_capital;
CREATE POLICY "Users can update own capital"
  ON public.portfolio_capital FOR UPDATE
  USING (auth.uid() = user_id);

-- 6) Access control helper (RETURNS BOOLEAN, raises exception on denial)
CREATE OR REPLACE FUNCTION public.check_capital_access(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_role TEXT;
  v_claims JSONB;
BEGIN
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
$$;

-- 7) reserve_capital RPC
CREATE OR REPLACE FUNCTION public.reserve_capital(
  p_user_id UUID,
  p_amount_eur NUMERIC
)
RETURNS JSONB
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
  
  -- Ensure row exists (idempotent insert)
  INSERT INTO public.portfolio_capital (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Lock row for update
  SELECT cash_balance_eur, reserved_eur
  INTO v_cash, v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  v_available := v_cash - v_reserved;
  
  IF v_available < p_amount_eur THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'insufficient_available_balance',
      'available_eur', v_available,
      'requested_eur', p_amount_eur
    );
  END IF;
  
  UPDATE public.portfolio_capital
  SET reserved_eur = reserved_eur + p_amount_eur
  WHERE user_id = p_user_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'reserved_amount_eur', p_amount_eur,
    'new_reserved_total_eur', v_reserved + p_amount_eur,
    'available_after_eur', v_available - p_amount_eur
  );
END;
$$;

-- 8) release_reservation RPC
CREATE OR REPLACE FUNCTION public.release_reservation(
  p_user_id UUID,
  p_amount_eur NUMERIC
)
RETURNS JSONB
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
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  IF v_reserved IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_capital_record'
    );
  END IF;
  
  v_release := LEAST(p_amount_eur, v_reserved);
  
  UPDATE public.portfolio_capital
  SET reserved_eur = reserved_eur - v_release
  WHERE user_id = p_user_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'released_eur', v_release,
    'new_reserved_total_eur', v_reserved - v_release
  );
END;
$$;

-- 9) settle_buy_trade RPC (with invariant-preserving release in BOTH paths)
CREATE OR REPLACE FUNCTION public.settle_buy_trade(
  p_user_id UUID,
  p_reserved_amount NUMERIC,
  p_actual_spent NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash NUMERIC;
  v_reserved NUMERIC;
  v_cash_after NUMERIC;
  v_release_amount NUMERIC;
BEGIN
  PERFORM public.check_capital_access(p_user_id);
  
  SELECT cash_balance_eur, reserved_eur
  INTO v_cash, v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  IF v_cash IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_capital_record'
    );
  END IF;
  
  IF v_cash < p_actual_spent THEN
    -- Insufficient cash: release enough to restore invariant
    v_release_amount := LEAST(
      v_reserved,
      GREATEST(p_reserved_amount, v_reserved - v_cash)
    );
    
    UPDATE public.portfolio_capital
    SET reserved_eur = reserved_eur - v_release_amount
    WHERE user_id = p_user_id;
    
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'insufficient_cash_balance',
      'cash_balance_eur', v_cash,
      'actual_spent_eur', p_actual_spent,
      'released_reservation_eur', v_release_amount
    );
  END IF;
  
  -- Success path: compute release_needed to preserve reserved <= cash_after
  v_cash_after := v_cash - p_actual_spent;
  v_release_amount := LEAST(
    v_reserved,
    GREATEST(p_reserved_amount, v_reserved - v_cash_after)
  );
  
  UPDATE public.portfolio_capital
  SET 
    cash_balance_eur = cash_balance_eur - p_actual_spent,
    reserved_eur = reserved_eur - v_release_amount
  WHERE user_id = p_user_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'spent_eur', p_actual_spent,
    'new_cash_balance_eur', v_cash_after,
    'new_reserved_total_eur', v_reserved - v_release_amount
  );
END;
$$;

-- 10) settle_sell_trade RPC
CREATE OR REPLACE FUNCTION public.settle_sell_trade(
  p_user_id UUID,
  p_proceeds_eur NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_cash NUMERIC;
BEGIN
  PERFORM public.check_capital_access(p_user_id);
  
  -- Ensure row exists
  INSERT INTO public.portfolio_capital (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  
  UPDATE public.portfolio_capital
  SET cash_balance_eur = cash_balance_eur + p_proceeds_eur
  WHERE user_id = p_user_id
  RETURNING cash_balance_eur INTO v_new_cash;
  
  RETURN jsonb_build_object(
    'success', true,
    'proceeds_eur', p_proceeds_eur,
    'new_cash_balance_eur', v_new_cash
  );
END;
$$;

-- 11) reset_portfolio_capital RPC
CREATE OR REPLACE FUNCTION public.reset_portfolio_capital(
  p_user_id UUID,
  p_starting_capital NUMERIC DEFAULT 30000.00
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.check_capital_access(p_user_id);
  
  INSERT INTO public.portfolio_capital (user_id, starting_capital_eur, cash_balance_eur, reserved_eur)
  VALUES (p_user_id, p_starting_capital, p_starting_capital, 0)
  ON CONFLICT (user_id) DO UPDATE SET
    starting_capital_eur = p_starting_capital,
    cash_balance_eur = p_starting_capital,
    reserved_eur = 0,
    updated_at = now();
  
  RETURN jsonb_build_object(
    'success', true,
    'starting_capital_eur', p_starting_capital,
    'cash_balance_eur', p_starting_capital,
    'reserved_eur', 0
  );
END;
$$;

-- 12) get_portfolio_metrics RPC (FIFO-correct using original_trade_id linkage)
CREATE OR REPLACE FUNCTION public.get_portfolio_metrics(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_starting_capital NUMERIC := 30000.00;
  v_cash NUMERIC := 30000.00;
  v_reserved NUMERIC := 0;
  v_invested_cost_basis NUMERIC := 0;
  v_current_position_value NUMERIC := 0;
  v_realized_pnl NUMERIC := 0;
  v_unrealized_pnl NUMERIC;
  v_total_pnl NUMERIC;
  v_total_portfolio_value NUMERIC;
  v_buy RECORD;
  v_sold_amount NUMERIC;
  v_remaining_amount NUMERIC;
  v_lot_cost_basis NUMERIC;
  v_current_price NUMERIC;
  v_symbol_base TEXT;
  v_symbol_eur TEXT;
BEGIN
  PERFORM public.check_capital_access(p_user_id);
  
  -- Get capital record if exists
  SELECT starting_capital_eur, cash_balance_eur, reserved_eur
  INTO v_starting_capital, v_cash, v_reserved
  FROM public.portfolio_capital
  WHERE user_id = p_user_id;
  
  -- Use defaults if no record
  v_starting_capital := COALESCE(v_starting_capital, 30000.00);
  v_cash := COALESCE(v_cash, 30000.00);
  v_reserved := COALESCE(v_reserved, 0);
  
  -- Iterate through BUY lots for FIFO-correct metrics
  FOR v_buy IN
    SELECT id, cryptocurrency, amount, price, total_value, 
           COALESCE(buy_fees, 0) + COALESCE(fees, 0) AS total_fees
    FROM public.mock_trades
    WHERE user_id = p_user_id
      AND trade_type = 'buy'
      AND is_corrupted = false
      AND is_test_mode = true
  LOOP
    -- Calculate sold amount from linked SELLs (FIFO linkage via original_trade_id)
    SELECT COALESCE(SUM(original_purchase_amount), 0)
    INTO v_sold_amount
    FROM public.mock_trades
    WHERE user_id = p_user_id
      AND trade_type = 'sell'
      AND original_trade_id = v_buy.id
      AND is_corrupted = false
      AND is_test_mode = true;
    
    v_remaining_amount := v_buy.amount - v_sold_amount;
    
    -- Process open lots (remaining > epsilon)
    IF v_remaining_amount > 0.00000001 THEN
      -- Proportional cost basis for remaining amount
      v_lot_cost_basis := (v_remaining_amount / v_buy.amount) * (v_buy.total_value + v_buy.total_fees);
      v_invested_cost_basis := v_invested_cost_basis + v_lot_cost_basis;
      
      -- Get current price from price_snapshots
      v_symbol_base := REPLACE(UPPER(v_buy.cryptocurrency), '-EUR', '');
      v_symbol_eur := v_symbol_base || '-EUR';
      
      SELECT price INTO v_current_price
      FROM public.price_snapshots
      WHERE symbol IN (v_buy.cryptocurrency, v_symbol_base, v_symbol_eur)
      ORDER BY ts DESC
      LIMIT 1;
      
      -- Fallback to buy price if no snapshot
      v_current_price := COALESCE(v_current_price, v_buy.price);
      
      v_current_position_value := v_current_position_value + (v_remaining_amount * v_current_price);
    END IF;
  END LOOP;
  
  -- Sum realized PnL from SELL rows
  SELECT COALESCE(SUM(realized_pnl), 0)
  INTO v_realized_pnl
  FROM public.mock_trades
  WHERE user_id = p_user_id
    AND trade_type = 'sell'
    AND realized_pnl IS NOT NULL
    AND is_corrupted = false
    AND is_test_mode = true;
  
  -- Compute derived metrics
  v_unrealized_pnl := v_current_position_value - v_invested_cost_basis;
  v_total_pnl := v_realized_pnl + v_unrealized_pnl;
  v_total_portfolio_value := v_cash + v_current_position_value;
  
  RETURN jsonb_build_object(
    'success', true,
    'starting_capital_eur', ROUND(v_starting_capital, 2),
    'cash_balance_eur', ROUND(v_cash, 2),
    'reserved_eur', ROUND(v_reserved, 2),
    'available_eur', ROUND(v_cash - v_reserved, 2),
    'invested_cost_basis_eur', ROUND(v_invested_cost_basis, 2),
    'current_position_value_eur', ROUND(v_current_position_value, 2),
    'unrealized_pnl_eur', ROUND(v_unrealized_pnl, 2),
    'realized_pnl_eur', ROUND(v_realized_pnl, 2),
    'total_pnl_eur', ROUND(v_total_pnl, 2),
    'total_portfolio_value_eur', ROUND(v_total_portfolio_value, 2)
  );
END;
$$;

-- 13) Grant EXECUTE to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.check_capital_access(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_capital(UUID, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_reservation(UUID, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_buy_trade(UUID, NUMERIC, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_sell_trade(UUID, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_portfolio_capital(UUID, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portfolio_metrics(UUID) TO authenticated, service_role;