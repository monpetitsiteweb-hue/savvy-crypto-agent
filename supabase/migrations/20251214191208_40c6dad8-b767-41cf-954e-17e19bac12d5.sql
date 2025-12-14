-- =====================================================
-- TRADING STRATEGY STATE MACHINE & EXECUTION TARGET
-- With safe migration and fixed liquidation logic
-- =====================================================

-- 1) Add new columns to trading_strategies (nullable initially)
ALTER TABLE public.trading_strategies
  ADD COLUMN IF NOT EXISTS execution_target TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS on_disable_policy TEXT,
  ADD COLUMN IF NOT EXISTS liquidation_batch_id UUID,
  ADD COLUMN IF NOT EXISTS liquidation_requested_at TIMESTAMPTZ;

-- 2) Migrate execution_target from existing flags (safe & deterministic)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='trading_strategies' AND column_name='test_mode'
  ) THEN
    UPDATE public.trading_strategies
    SET execution_target = CASE WHEN COALESCE(test_mode, true) THEN 'MOCK' ELSE 'REAL' END
    WHERE execution_target IS NULL;
  ELSE
    UPDATE public.trading_strategies
    SET execution_target = CASE
      WHEN COALESCE(NULLIF(configuration->>'is_test_mode','')::boolean, true) THEN 'MOCK'
      ELSE 'REAL'
    END
    WHERE execution_target IS NULL;
  END IF;
END $$;

-- 3) Set remaining NULLs to MOCK, then enforce default + NOT NULL
UPDATE public.trading_strategies
SET execution_target = 'MOCK'
WHERE execution_target IS NULL;

ALTER TABLE public.trading_strategies
  ALTER COLUMN execution_target SET DEFAULT 'MOCK',
  ALTER COLUMN execution_target SET NOT NULL;

-- 4) Migrate state column (default ACTIVE for existing strategies)
UPDATE public.trading_strategies
SET state = 'ACTIVE'
WHERE state IS NULL;

ALTER TABLE public.trading_strategies
  ALTER COLUMN state SET DEFAULT 'ACTIVE',
  ALTER COLUMN state SET NOT NULL;

-- 5) Add CHECK constraints for valid values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_execution_target' 
    AND conrelid = 'public.trading_strategies'::regclass
  ) THEN
    ALTER TABLE public.trading_strategies
      ADD CONSTRAINT chk_execution_target CHECK (execution_target IN ('MOCK', 'REAL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_strategy_state' 
    AND conrelid = 'public.trading_strategies'::regclass
  ) THEN
    ALTER TABLE public.trading_strategies
      ADD CONSTRAINT chk_strategy_state CHECK (state IN ('ACTIVE', 'PAUSED_MANAGE_ONLY', 'PAUSED', 'DETACHED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_on_disable_policy' 
    AND conrelid = 'public.trading_strategies'::regclass
  ) THEN
    ALTER TABLE public.trading_strategies
      ADD CONSTRAINT chk_on_disable_policy CHECK (on_disable_policy IS NULL OR on_disable_policy IN ('MANAGE_ONLY', 'CLOSE_ALL', 'DETACH_TO_MANUAL'));
  END IF;
END $$;

-- 6) get_strategy_open_position_count with owner guard and execution_target filter
CREATE OR REPLACE FUNCTION public.get_strategy_open_position_count(p_strategy_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_execution_target TEXT;
  v_is_test_mode BOOLEAN;
  v_user_id UUID;
BEGIN
  SELECT user_id, execution_target
  INTO v_user_id, v_execution_target
  FROM public.trading_strategies
  WHERE id = p_strategy_id;

  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Owner guard
  IF auth.uid() IS NULL OR v_user_id <> auth.uid() THEN
    RETURN 0;
  END IF;

  v_is_test_mode := (v_execution_target = 'MOCK');

  WITH sell_allocations AS (
    SELECT
      original_trade_id,
      SUM(COALESCE(original_purchase_amount, 0)) AS sold_amount
    FROM public.mock_trades
    WHERE strategy_id = p_strategy_id
      AND trade_type = 'sell'
      AND original_trade_id IS NOT NULL
      AND is_corrupted = false
      AND is_test_mode = v_is_test_mode
    GROUP BY original_trade_id
  )
  SELECT COUNT(*) INTO v_count
  FROM public.mock_trades b
  LEFT JOIN sell_allocations s ON s.original_trade_id = b.id
  WHERE b.strategy_id = p_strategy_id
    AND b.trade_type = 'buy'
    AND b.is_corrupted = false
    AND b.is_test_mode = v_is_test_mode
    AND (COALESCE(b.amount, 0) - COALESCE(s.sold_amount, 0)) > 0.00000001;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- 7) check_strategy_can_delete
CREATE OR REPLACE FUNCTION public.check_strategy_can_delete(p_strategy_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_open_count INTEGER;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.trading_strategies
  WHERE id = p_strategy_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('can_delete', false, 'reason', 'strategy_not_found');
  END IF;

  IF auth.uid() IS NULL OR v_user_id <> auth.uid() THEN
    RETURN jsonb_build_object('can_delete', false, 'reason', 'not_owner');
  END IF;

  v_open_count := public.get_strategy_open_position_count(p_strategy_id);

  IF v_open_count > 0 THEN
    RETURN jsonb_build_object(
      'can_delete', false,
      'reason', 'has_open_positions',
      'open_position_count', v_open_count
    );
  END IF;

  RETURN jsonb_build_object('can_delete', true, 'reason', NULL);
END;
$$;

-- 8) update_strategy_state
CREATE OR REPLACE FUNCTION public.update_strategy_state(
  p_strategy_id UUID,
  p_new_state TEXT,
  p_on_disable_policy TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_current_state TEXT;
BEGIN
  SELECT user_id, state INTO v_user_id, v_current_state
  FROM public.trading_strategies
  WHERE id = p_strategy_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'strategy_not_found');
  END IF;

  IF auth.uid() IS NULL OR v_user_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_owner');
  END IF;

  IF p_new_state NOT IN ('ACTIVE', 'PAUSED_MANAGE_ONLY', 'PAUSED', 'DETACHED') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_state');
  END IF;

  IF p_on_disable_policy IS NOT NULL AND p_on_disable_policy NOT IN ('MANAGE_ONLY', 'CLOSE_ALL', 'DETACH_TO_MANUAL') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_policy');
  END IF;

  UPDATE public.trading_strategies
  SET 
    state = p_new_state,
    on_disable_policy = COALESCE(p_on_disable_policy, on_disable_policy),
    updated_at = now()
  WHERE id = p_strategy_id;

  RETURN jsonb_build_object(
    'success', true,
    'previous_state', v_current_state,
    'new_state', p_new_state
  );
END;
$$;

-- 9) initiate_liquidation with early-return when no positions
CREATE OR REPLACE FUNCTION public.initiate_liquidation(p_strategy_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_current_batch_id UUID;
  v_new_batch_id UUID;
  v_open_count INTEGER;
BEGIN
  SELECT user_id, liquidation_batch_id INTO v_user_id, v_current_batch_id
  FROM public.trading_strategies
  WHERE id = p_strategy_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'strategy_not_found');
  END IF;

  IF auth.uid() IS NULL OR v_user_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_owner');
  END IF;

  v_open_count := public.get_strategy_open_position_count(p_strategy_id);

  -- Block when no positions - return success but no batch
  IF v_open_count = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'batch_id', NULL,
      'is_existing_batch', false,
      'open_position_count', 0,
      'status', 'no_positions'
    );
  END IF;

  -- Idempotency: return existing batch if already in progress
  IF v_current_batch_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'batch_id', v_current_batch_id,
      'is_existing_batch', true,
      'open_position_count', v_open_count,
      'status', 'in_progress'
    );
  END IF;

  -- Generate new batch and set state to PAUSED
  v_new_batch_id := gen_random_uuid();

  UPDATE public.trading_strategies
  SET 
    liquidation_batch_id = v_new_batch_id,
    liquidation_requested_at = now(),
    state = 'PAUSED',
    updated_at = now()
  WHERE id = p_strategy_id;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_new_batch_id,
    'is_existing_batch', false,
    'open_position_count', v_open_count,
    'status', 'initiated'
  );
END;
$$;

-- 10) check_real_trading_prerequisites (uses auth.uid() directly)
CREATE OR REPLACE FUNCTION public.check_real_trading_prerequisites()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_has_coinbase_connection BOOLEAN := false;
  v_has_valid_payment_method BOOLEAN := false;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'ready', false,
      'reason', 'not_authenticated'
    );
  END IF;

  -- Check for active Coinbase connection
  SELECT EXISTS (
    SELECT 1 FROM public.user_coinbase_connections
    WHERE user_id = v_user_id AND is_active = true
  ) INTO v_has_coinbase_connection;

  -- REAL trading is NOT implemented - always return false
  RETURN jsonb_build_object(
    'ready', false,
    'reason', 'real_trading_not_implemented',
    'checks', jsonb_build_object(
      'has_coinbase_connection', v_has_coinbase_connection,
      'has_valid_payment_method', v_has_valid_payment_method,
      'real_pipe_enabled', false
    )
  );
END;
$$;

-- 11) strategy_open_positions view with consistent is_test_mode filtering
DROP VIEW IF EXISTS public.strategy_open_positions;

CREATE VIEW public.strategy_open_positions AS
WITH sell_allocations AS (
  SELECT
    s.original_trade_id,
    s.is_test_mode,
    SUM(COALESCE(s.original_purchase_amount, 0)) AS sold_amount
  FROM public.mock_trades s
  WHERE s.trade_type = 'sell'
    AND s.original_trade_id IS NOT NULL
    AND s.is_corrupted = false
  GROUP BY s.original_trade_id, s.is_test_mode
)
SELECT
  b.strategy_id,
  ts.user_id,
  ts.execution_target,
  b.cryptocurrency AS symbol,
  b.id AS lot_id,
  ROUND((COALESCE(b.amount, 0) - COALESCE(sa.sold_amount, 0))::numeric, 8) AS remaining_qty,
  b.price AS entry_price,
  b.executed_at AS opened_at,
  b.is_test_mode,
  CASE WHEN ts.state = 'DETACHED' THEN false ELSE true END AS managed_by_strategy
FROM public.mock_trades b
JOIN public.trading_strategies ts ON ts.id = b.strategy_id
LEFT JOIN sell_allocations sa
  ON sa.original_trade_id = b.id
 AND sa.is_test_mode = b.is_test_mode
WHERE b.trade_type = 'buy'
  AND b.is_corrupted = false
  AND (COALESCE(b.amount, 0) - COALESCE(sa.sold_amount, 0)) > 0.00000001
  AND b.is_test_mode = (ts.execution_target = 'MOCK');

-- 12) Grant permissions
GRANT SELECT ON public.strategy_open_positions TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_strategy_open_position_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_strategy_can_delete(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_strategy_state(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_liquidation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_real_trading_prerequisites() TO authenticated;