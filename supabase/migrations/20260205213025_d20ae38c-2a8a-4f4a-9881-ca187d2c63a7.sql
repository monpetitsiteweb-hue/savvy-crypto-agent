-- Drop and recreate check_live_trading_prerequisites with CORRECT architecture
-- External wallet = user_external_addresses (funding source)
-- NO execution_wallets in LIVE readiness logic

DROP FUNCTION IF EXISTS public.check_live_trading_prerequisites(uuid);

CREATE OR REPLACE FUNCTION public.check_live_trading_prerequisites(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_exists boolean := false;
  v_wallet_address text := null;
  v_has_portfolio_capital boolean := false;
  v_portfolio_balance numeric := 0;
  v_rules_accepted boolean := false;
  v_panic_active boolean := false;
  v_ok boolean := false;
BEGIN
  -- 1. External wallet registered (user_external_addresses on Base chain)
  SELECT true, address
  INTO v_wallet_exists, v_wallet_address
  FROM user_external_addresses
  WHERE user_id = p_user_id
    AND chain_id = 8453
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    v_wallet_exists := false;
    v_wallet_address := null;
  END IF;

  -- 2. REAL portfolio capital (SOLE authority for funding status)
  SELECT true, COALESCE(cash_balance_eur, 0)
  INTO v_has_portfolio_capital, v_portfolio_balance
  FROM portfolio_capital
  WHERE user_id = p_user_id
    AND is_test_mode = false
    AND cash_balance_eur > 0;

  IF NOT FOUND THEN
    v_has_portfolio_capital := false;
    v_portfolio_balance := 0;
  END IF;

  -- 3. Trading rules acceptance
  SELECT COALESCE(rules_accepted, false)
  INTO v_rules_accepted
  FROM user_onboarding_status
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    v_rules_accepted := false;
  END IF;

  -- 4. Panic state
  SELECT EXISTS (
    SELECT 1
    FROM execution_circuit_breakers
    WHERE user_id = p_user_id
      AND breaker = 'PANIC'
      AND tripped = true
  )
  INTO v_panic_active;

  -- 5. Final readiness: external wallet + capital + rules + no panic
  v_ok := v_wallet_exists
          AND v_has_portfolio_capital
          AND v_rules_accepted
          AND NOT v_panic_active;

  -- 6. Return strict contract (removed wallet_funded - no longer relevant)
  RETURN jsonb_build_object(
    'ok', v_ok,
    'checks', jsonb_build_object(
      'wallet_exists', v_wallet_exists,
      'has_portfolio_capital', v_has_portfolio_capital,
      'rules_accepted', v_rules_accepted
    ),
    'panic_active', v_panic_active,
    'meta', jsonb_build_object(
      'external_wallet_address', v_wallet_address,
      'portfolio_balance_eur', v_portfolio_balance
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_live_trading_prerequisites(uuid)
TO authenticated, service_role;