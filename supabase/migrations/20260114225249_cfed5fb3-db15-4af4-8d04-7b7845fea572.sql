-- ============================================================================
-- PHASE 1: COORDINATOR → REAL TRADING - RPC FUNCTIONS
-- ============================================================================

-- 1. PROMOTE STRATEGY TO LIVE (Copy to Live flow)
-- Source must be MOCK (execution_target='MOCK' OR test_mode=true)
-- Creates new LIVE strategy in PAUSED state
-- ============================================================================
CREATE OR REPLACE FUNCTION public.promote_strategy_to_live(
  p_strategy_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source RECORD;
  v_new_id UUID;
  v_new_name TEXT;
BEGIN
  -- SECURITY: Verify caller is the owner
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- Fetch source strategy
  SELECT * INTO v_source
  FROM trading_strategies
  WHERE id = p_strategy_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'strategy_not_found');
  END IF;

  -- Source must be MOCK mode
  IF v_source.execution_target IS DISTINCT FROM 'MOCK' AND v_source.test_mode IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'source_must_be_mock');
  END IF;

  -- Generate unique name for the new LIVE strategy
  v_new_name := v_source.strategy_name || ' (LIVE)';
  
  -- Handle name collision
  WHILE EXISTS (
    SELECT 1 FROM trading_strategies 
    WHERE user_id = p_user_id AND strategy_name = v_new_name
  ) LOOP
    v_new_name := v_new_name || '_' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  -- Insert new LIVE strategy with reset counters
  INSERT INTO trading_strategies (
    user_id,
    strategy_name,
    description,
    configuration,
    unified_config,
    -- LIVE mode settings
    execution_target,
    test_mode,
    is_active,
    is_active_test,
    is_active_live,
    state,
    -- Execution settings (copy from source)
    chain_id,
    slippage_bps_default,
    preferred_providers,
    mev_policy,
    max_gas_cost_pct,
    max_price_impact_bps,
    max_quote_age_ms,
    -- Safety defaults
    on_disable_policy,
    panic_active
  )
  VALUES (
    p_user_id,
    v_new_name,
    COALESCE(v_source.description, '') || ' [Promoted from MOCK]',
    v_source.configuration,
    v_source.unified_config,
    -- LIVE mode
    'REAL',
    false,
    false,  -- is_active = false (must be explicitly activated)
    false,  -- is_active_test = false
    false,  -- is_active_live = false (must be explicitly activated)
    'PAUSED',
    -- Copy execution settings
    v_source.chain_id,
    v_source.slippage_bps_default,
    v_source.preferred_providers,
    v_source.mev_policy,
    v_source.max_gas_cost_pct,
    v_source.max_price_impact_bps,
    v_source.max_quote_age_ms,
    -- Safety defaults
    'MANAGE_ONLY',
    false
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'new_strategy_id', v_new_id,
    'new_strategy_name', v_new_name,
    'source_strategy_id', p_strategy_id
  );
END;
$$;

-- ============================================================================
-- 2. TRIGGER PANIC LIQUIDATION
-- Marks all LIVE strategies as panic_active
-- Enqueues LIQUIDATE jobs for open positions (from mock_trades)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trigger_panic_liquidation(
  p_user_id UUID,
  p_strategy_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'manual_panic'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID := gen_random_uuid();
  v_affected_strategies INTEGER := 0;
  v_jobs_created INTEGER := 0;
  v_open_position RECORD;
BEGIN
  -- SECURITY: Verify caller is the owner
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- Update all LIVE strategies for this user
  UPDATE trading_strategies
  SET
    panic_active = true,
    panic_activated_at = now(),
    panic_trigger_strategy_id = COALESCE(p_strategy_id, id),
    is_active = false,
    is_active_live = false,
    state = 'PAUSED',
    on_disable_policy = 'CLOSE_ALL',
    liquidation_batch_id = v_batch_id,
    liquidation_requested_at = now()
  WHERE user_id = p_user_id
    AND execution_target = 'REAL'
    AND is_active = true;

  GET DIAGNOSTICS v_affected_strategies = ROW_COUNT;

  -- Find open positions: BUYs without matching SELLs in mock_trades (is_test_mode=false = REAL)
  FOR v_open_position IN
    SELECT 
      b.id AS buy_id,
      b.strategy_id,
      b.cryptocurrency AS symbol,
      b.amount,
      b.price AS entry_price
    FROM mock_trades b
    WHERE b.user_id = p_user_id
      AND b.is_test_mode = false  -- REAL trades
      AND b.trade_type = 'buy'
      AND NOT EXISTS (
        SELECT 1 FROM mock_trades s
        WHERE s.original_trade_id = b.id
          AND s.trade_type = 'sell'
          AND s.is_test_mode = false
      )
  LOOP
    -- Insert LIQUIDATE job for each open position
    INSERT INTO execution_jobs (
      user_id,
      strategy_id,
      execution_target,
      execution_mode,
      kind,
      side,
      symbol,
      amount,
      status,
      payload,
      idempotency_key,
      created_at,
      updated_at
    )
    VALUES (
      p_user_id,
      v_open_position.strategy_id,
      'REAL',
      'ONCHAIN',  -- Default to onchain; signer can override
      'LIQUIDATE',
      'SELL',
      v_open_position.symbol,
      v_open_position.amount,
      'READY',
      jsonb_build_object(
        'liquidation_batch_id', v_batch_id,
        'reason', p_reason,
        'original_buy_id', v_open_position.buy_id,
        'entry_price', v_open_position.entry_price,
        'triggered_by_strategy', p_strategy_id,
        'triggered_at', now()
      ),
      'panic_' || v_batch_id::text || '_' || v_open_position.buy_id::text,
      now(),
      now()
    );

    v_jobs_created := v_jobs_created + 1;
  END LOOP;

  -- Log decision_event for audit
  INSERT INTO decision_events (
    user_id,
    strategy_id,
    symbol,
    side,
    source,
    reason,
    decision_ts,
    metadata
  )
  VALUES (
    p_user_id,
    p_strategy_id,
    'ALL',
    'SELL',
    'panic_liquidation',
    'panic_triggered',
    now(),
    jsonb_build_object(
      'batch_id', v_batch_id,
      'reason', p_reason,
      'affected_strategies', v_affected_strategies,
      'jobs_created', v_jobs_created
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'affected_strategies', v_affected_strategies,
    'liquidation_jobs_created', v_jobs_created
  );
END;
$$;

-- ============================================================================
-- 3. CLEAR PANIC STATE (by batch)
-- Clears panic for all strategies with matching liquidation_batch_id
-- ============================================================================
CREATE OR REPLACE FUNCTION public.clear_panic_state(
  p_user_id UUID,
  p_batch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cleared INTEGER := 0;
BEGIN
  -- SECURITY: Verify caller is the owner
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- Clear panic state for all strategies in this batch
  UPDATE trading_strategies
  SET
    panic_active = false,
    panic_activated_at = NULL,
    panic_trigger_strategy_id = NULL,
    liquidation_batch_id = NULL,
    liquidation_requested_at = NULL
    -- Note: Keep state=PAUSED, is_active=false - user must explicitly reactivate
  WHERE user_id = p_user_id
    AND liquidation_batch_id = p_batch_id;

  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'strategies_cleared', v_cleared
  );
END;
$$;

-- ============================================================================
-- 4. CHECK LIVE TRADING PREREQUISITES
-- Hard blocker for REAL mode - NO circuit breaker checks (Phase 1)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_live_trading_prerequisites(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_ok BOOLEAN := false;
  v_rules_ok BOOLEAN := false;
  v_panic_active BOOLEAN := false;
  v_wallet_address TEXT;
BEGIN
  -- SECURITY: Verify caller is the owner (or service_role)
  IF auth.uid() IS DISTINCT FROM p_user_id 
     AND current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- Check 1: Active + funded execution wallet
  SELECT 
    (is_active = true AND is_funded = true),
    wallet_address
  INTO v_wallet_ok, v_wallet_address
  FROM execution_wallets
  WHERE user_id = p_user_id
    AND is_active = true
  LIMIT 1;

  v_wallet_ok := COALESCE(v_wallet_ok, false);

  -- Check 2: Rules accepted
  SELECT rules_accepted INTO v_rules_ok
  FROM user_onboarding_status
  WHERE user_id = p_user_id
  LIMIT 1;

  v_rules_ok := COALESCE(v_rules_ok, false);

  -- Check 3: No panic active on any REAL strategy
  SELECT EXISTS (
    SELECT 1 FROM trading_strategies
    WHERE user_id = p_user_id
      AND execution_target = 'REAL'
      AND panic_active = true
  ) INTO v_panic_active;

  RETURN jsonb_build_object(
    'can_trade_live', (v_wallet_ok AND v_rules_ok AND NOT v_panic_active),
    'wallet_ok', v_wallet_ok,
    'wallet_address', v_wallet_address,
    'rules_accepted', v_rules_ok,
    'panic_active', v_panic_active,
    'checks', jsonb_build_object(
      'has_active_funded_wallet', v_wallet_ok,
      'has_accepted_rules', v_rules_ok,
      'no_panic_active', NOT v_panic_active
    )
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.promote_strategy_to_live(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_panic_liquidation(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_panic_state(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_live_trading_prerequisites(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_live_trading_prerequisites(UUID) TO service_role;