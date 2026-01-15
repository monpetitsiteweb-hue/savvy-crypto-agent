-- 1) Secure activate_execution_wallet
CREATE OR REPLACE FUNCTION public.activate_execution_wallet(
  p_wallet_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet RECORD;
BEGIN
  -- Enforce caller = owner (security definer => must check!)
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT id, wallet_address, chain_id, is_active, is_funded
  INTO v_wallet
  FROM execution_wallets
  WHERE id = p_wallet_id AND user_id = p_user_id;

  IF v_wallet.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wallet_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_onboarding_status
    WHERE user_id = p_user_id AND rules_accepted = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'rules_not_accepted');
  END IF;

  UPDATE execution_wallets
  SET is_active = false, updated_at = now()
  WHERE user_id = p_user_id AND id != p_wallet_id;

  UPDATE execution_wallets
  SET is_active = true, updated_at = now()
  WHERE id = p_wallet_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'wallet', jsonb_build_object(
      'id', v_wallet.id,
      'wallet_address', v_wallet.wallet_address,
      'chain_id', v_wallet.chain_id,
      'is_active', true,
      'is_funded', v_wallet.is_funded
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_execution_wallet(UUID, UUID) TO authenticated;


-- 2) Secure + consistent check_live_trading_prerequisites(p_user_id)
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
  v_rules_accepted BOOLEAN := false;
  v_chain_consistent BOOLEAN := true;
  v_panic_active BOOLEAN := false;
  v_ok BOOLEAN := false;
  v_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role','');
BEGIN
  -- Allow service_role OR user must be requesting self
  IF v_role != 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object(
        'ok', false,
        'checks', jsonb_build_object(
          'has_wallet', false,
          'wallet_active', false,
          'wallet_funded', false,
          'rules_accepted', false,
          'chain_consistent', false
        ),
        'panic_active', false
      );
    END IF;
  END IF;

  SELECT id, wallet_address, chain_id, is_active, is_funded
  INTO v_wallet
  FROM execution_wallets
  WHERE user_id = p_user_id AND is_active = true
  LIMIT 1;

  IF v_wallet.id IS NOT NULL THEN
    v_has_wallet := true;
    v_wallet_active := COALESCE(v_wallet.is_active, false);
    v_wallet_funded := COALESCE(v_wallet.is_funded, false);

    IF EXISTS (
      SELECT 1 FROM trading_strategies
      WHERE user_id = p_user_id
        AND execution_target = 'REAL'
        AND chain_id IS NOT NULL
        AND chain_id != v_wallet.chain_id
    ) THEN
      v_chain_consistent := false;
    END IF;
  ELSE
    v_has_wallet := EXISTS (SELECT 1 FROM execution_wallets WHERE user_id = p_user_id);
  END IF;

  SELECT COALESCE(rules_accepted, false)
  INTO v_rules_accepted
  FROM user_onboarding_status
  WHERE user_id = p_user_id;

  -- IMPORTANT: Phase 1 canonical panic flag
  v_panic_active := EXISTS (
    SELECT 1 FROM trading_strategies
    WHERE user_id = p_user_id
      AND execution_target = 'REAL'
      AND panic_active = true
  );

  v_ok := v_has_wallet
    AND v_wallet_active
    AND v_wallet_funded
    AND v_rules_accepted
    AND v_chain_consistent
    AND NOT v_panic_active;

  RETURN jsonb_build_object(
    'ok', v_ok,
    'checks', jsonb_build_object(
      'has_wallet', v_has_wallet,
      'wallet_active', v_wallet_active,
      'wallet_funded', v_wallet_funded,
      'rules_accepted', v_rules_accepted,
      'chain_consistent', v_chain_consistent
    ),
    'panic_active', v_panic_active
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_live_trading_prerequisites(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_live_trading_prerequisites(UUID) TO service_role;

-- 3) Wrapper stays
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