-- ============================================================================
-- SURGICAL ADDITION: Extend check_live_trading_prerequisites with OR condition
-- 
-- This migration extends the existing check_live_trading_prerequisites RPC to
-- accept EITHER:
--   - execution_wallets.is_funded = true (existing Flow A)
--   - portfolio_capital exists for (user_id, is_test_mode = false) (new Flow B)
--
-- This is ADDITIVE ONLY - does not remove or modify existing behavior
-- ============================================================================

-- Add new check field: has_portfolio_capital
-- Update check_live_trading_prerequisites to check for REAL portfolio capital
CREATE OR REPLACE FUNCTION public.check_live_trading_prerequisites(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet RECORD;
  v_has_wallet BOOLEAN := false;
  v_wallet_active BOOLEAN := false;
  v_wallet_funded BOOLEAN := false;
  v_has_portfolio_capital BOOLEAN := false;  -- NEW: Flow B check
  v_rules_accepted BOOLEAN := false;
  v_chain_consistent BOOLEAN := true;
  v_panic_active BOOLEAN := false;
  v_ok BOOLEAN := false;
  v_wallet_chain_id INTEGER := NULL;
  v_role TEXT := COALESCE(
    current_setting('request.jwt.claims', true)::jsonb->>'role',
    ''
  );
BEGIN
  -- Access control: service_role OR self
  IF v_role <> 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object(
        'ok', false,
        'checks', jsonb_build_object(
          'has_wallet', false,
          'wallet_active', false,
          'wallet_funded', false,
          'has_portfolio_capital', false,
          'rules_accepted', false,
          'chain_consistent', false
        ),
        'panic_active', false,
        'wallet_chain_id', NULL
      );
    END IF;
  END IF;

  -- Active wallet check (Flow A)
  SELECT id, chain_id, is_active, is_funded
  INTO v_wallet
  FROM execution_wallets
  WHERE user_id = p_user_id
    AND is_active = true
  LIMIT 1;

  IF v_wallet.id IS NOT NULL THEN
    v_has_wallet := true;
    v_wallet_active := v_wallet.is_active;
    v_wallet_funded := COALESCE(v_wallet.is_funded, false);
    v_wallet_chain_id := v_wallet.chain_id;

    -- Chain consistency with REAL strategies
    IF EXISTS (
      SELECT 1
      FROM trading_strategies
      WHERE user_id = p_user_id
        AND execution_target = 'REAL'
        AND chain_id IS NOT NULL
        AND chain_id <> v_wallet.chain_id
    ) THEN
      v_chain_consistent := false;
    END IF;
  ELSE
    v_has_wallet := EXISTS (
      SELECT 1 FROM execution_wallets WHERE user_id = p_user_id
    );
  END IF;

  -- NEW: Check for REAL portfolio capital (Flow B)
  -- Portfolio capital is created only when first deposit is attributed
  v_has_portfolio_capital := EXISTS (
    SELECT 1 
    FROM portfolio_capital 
    WHERE user_id = p_user_id 
      AND is_test_mode = false
      AND cash_balance_eur > 0
  );

  -- Rules accepted
  SELECT COALESCE(rules_accepted, false)
  INTO v_rules_accepted
  FROM user_onboarding_status
  WHERE user_id = p_user_id;

  -- Panic mode (Phase-1 canonical)
  v_panic_active := EXISTS (
    SELECT 1
    FROM trading_strategies
    WHERE user_id = p_user_id
      AND execution_target = 'REAL'
      AND panic_active = true
  );

  -- UPDATED: ok is true if EITHER wallet is funded (Flow A) OR portfolio has capital (Flow B)
  -- Both flows still require: wallet exists, wallet active, rules accepted, chain consistent, no panic
  v_ok :=
    v_has_wallet
    AND v_wallet_active
    AND (v_wallet_funded OR v_has_portfolio_capital)  -- EITHER Flow A OR Flow B
    AND v_rules_accepted
    AND v_chain_consistent
    AND NOT v_panic_active;

  RETURN jsonb_build_object(
    'ok', v_ok,
    'checks', jsonb_build_object(
      'has_wallet', v_has_wallet,
      'wallet_active', v_wallet_active,
      'wallet_funded', v_wallet_funded,
      'has_portfolio_capital', v_has_portfolio_capital,  -- NEW field
      'rules_accepted', v_rules_accepted,
      'chain_consistent', v_chain_consistent
    ),
    'panic_active', v_panic_active,
    'wallet_chain_id', v_wallet_chain_id
  );
END;
$$;

-- Grant permissions (unchanged)
GRANT EXECUTE ON FUNCTION public.check_live_trading_prerequisites(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_live_trading_prerequisites(UUID) TO service_role;

-- Update the wrapper function to pass through the new field
CREATE OR REPLACE FUNCTION public.check_live_trading_prerequisites()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.check_live_trading_prerequisites(auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_live_trading_prerequisites() TO authenticated;