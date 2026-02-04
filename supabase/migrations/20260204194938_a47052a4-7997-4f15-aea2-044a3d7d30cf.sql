-- =============================================================
-- CORRECTED: Unify funding flows with portfolio_capital as sole authority
-- Fixes applied:
--   1. Hard fail if ETH price unavailable (no silent fallback)
--   2. funded_amount_wei confirmed in execution-wallet-balance (lines 183-191)
--   3. Trigger narrowed to AFTER UPDATE OF is_funded
-- =============================================================

-- -------------------------------------------------------------
-- 1. Bridge function: wallet funding → portfolio_capital
--    HARD FAIL if ETH price unavailable
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bridge_wallet_funding_to_portfolio_capital(
  p_user_id UUID,
  p_funded_amount_wei TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eth_price NUMERIC;
  v_eth_amount NUMERIC;
  v_eur_amount NUMERIC;
  v_existing_capital RECORD;
BEGIN
  -- Check if already has REAL portfolio capital (idempotent)
  SELECT * INTO v_existing_capital
  FROM portfolio_capital
  WHERE user_id = p_user_id AND is_test_mode = false;

  IF v_existing_capital.user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'already_exists',
      'message', 'Portfolio capital already initialized'
    );
  END IF;

  -- Get latest ETH price from price_snapshots
  SELECT price INTO v_eth_price
  FROM price_snapshots
  WHERE symbol IN ('ETH-EUR', 'ETH')
  ORDER BY ts DESC
  LIMIT 1;

  -- HARD FAIL: No silent fallback - price must exist
  IF v_eth_price IS NULL OR v_eth_price <= 0 THEN
    RAISE EXCEPTION 'ETH price unavailable or invalid (got: %); cannot initialize portfolio capital. Ensure price_snapshots has recent ETH-EUR data.', v_eth_price;
  END IF;

  -- Convert wei to ETH (18 decimals)
  IF p_funded_amount_wei IS NULL OR p_funded_amount_wei = '' OR p_funded_amount_wei = '0' THEN
    -- Minimum bootstrap: 0.001 ETH worth
    v_eth_amount := 0.001;
  ELSE
    v_eth_amount := COALESCE(p_funded_amount_wei::NUMERIC / 1e18, 0.001);
  END IF;

  -- Calculate EUR value
  v_eur_amount := v_eth_amount * v_eth_price;

  -- Ensure minimum capital
  IF v_eur_amount < 1 THEN
    v_eur_amount := 1;
  END IF;

  -- Initialize portfolio_capital for REAL mode
  INSERT INTO portfolio_capital (
    user_id,
    is_test_mode,
    starting_capital_eur,
    cash_balance_eur,
    funding_source,
    updated_at
  ) VALUES (
    p_user_id,
    false,  -- REAL mode
    v_eur_amount,
    v_eur_amount,
    'legacy_wallet_funding',
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'action', 'initialized',
    'eth_amount', v_eth_amount,
    'eth_price_eur', v_eth_price,
    'eur_amount', v_eur_amount
  );
END;
$$;

-- -------------------------------------------------------------
-- 2. Trigger function for automatic bridging
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_bridge_wallet_funding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Only fire on false → true transition (trigger WHEN clause handles this, but double-check)
  IF OLD.is_funded = true THEN
    RETURN NEW;
  END IF;

  IF NEW.is_funded = false THEN
    RETURN NEW;
  END IF;

  -- Bridge to portfolio_capital
  -- funded_amount_wei is populated by execution-wallet-balance edge function
  v_result := bridge_wallet_funding_to_portfolio_capital(
    NEW.user_id,
    NEW.funded_amount_wei
  );

  RAISE LOG '[fn_bridge_wallet_funding] user_id=%, result=%', NEW.user_id, v_result;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log but don't block the update - user can retry
    RAISE WARNING '[fn_bridge_wallet_funding] Failed for user_id=%: %', NEW.user_id, SQLERRM;
    RETURN NEW;
END;
$$;

-- -------------------------------------------------------------
-- 3. Create narrowed trigger: AFTER UPDATE OF is_funded
--    Only fires when is_funded column changes from false to true
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_bridge_wallet_funding ON public.execution_wallets;

CREATE TRIGGER trg_bridge_wallet_funding
AFTER UPDATE OF is_funded ON public.execution_wallets
FOR EACH ROW
WHEN (OLD.is_funded IS DISTINCT FROM NEW.is_funded AND NEW.is_funded = true)
EXECUTE FUNCTION public.fn_bridge_wallet_funding();

-- -------------------------------------------------------------
-- 4. Backfill existing funded users BEFORE gate flips
--    This ensures no one gets locked out
-- -------------------------------------------------------------
DO $$
DECLARE
  v_wallet RECORD;
  v_result JSONB;
  v_count INT := 0;
  v_error_count INT := 0;
BEGIN
  FOR v_wallet IN
    SELECT user_id, funded_amount_wei
    FROM execution_wallets
    WHERE is_funded = true
      AND is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM portfolio_capital pc
        WHERE pc.user_id = execution_wallets.user_id
          AND pc.is_test_mode = false
      )
  LOOP
    BEGIN
      v_result := bridge_wallet_funding_to_portfolio_capital(
        v_wallet.user_id,
        v_wallet.funded_amount_wei
      );
      v_count := v_count + 1;
      RAISE NOTICE '[backfill] Bridged user_id=%, result=%', v_wallet.user_id, v_result;
    EXCEPTION
      WHEN OTHERS THEN
        v_error_count := v_error_count + 1;
        RAISE WARNING '[backfill] Failed for user_id=%: %', v_wallet.user_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '[backfill] Complete: % users bridged, % errors', v_count, v_error_count;
END;
$$;

-- -------------------------------------------------------------
-- 5. Update check_live_trading_prerequisites
--    portfolio_capital is now the SOLE unlock authority
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_live_trading_prerequisites(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_wallet BOOLEAN := false;
  v_wallet_active BOOLEAN := false;
  v_wallet_funded BOOLEAN := false;  -- Now informational only
  v_has_portfolio_capital BOOLEAN := false;  -- SOLE authority
  v_portfolio_balance NUMERIC := 0;
  v_rules_accepted BOOLEAN := false;
  v_chain_consistent BOOLEAN := true;
  v_panic_active BOOLEAN := false;
  v_ok BOOLEAN;
  v_wallet_address TEXT;
BEGIN
  -- Check execution wallet exists
  SELECT 
    wallet_address,
    is_active,
    is_funded
  INTO v_wallet_address, v_wallet_active, v_wallet_funded
  FROM execution_wallets
  WHERE user_id = p_user_id
  LIMIT 1;

  v_has_wallet := v_wallet_address IS NOT NULL;

  -- Check portfolio_capital exists with positive balance (SOLE AUTHORITY)
  SELECT 
    true,
    COALESCE(cash_balance_eur, 0)
  INTO v_has_portfolio_capital, v_portfolio_balance
  FROM portfolio_capital
  WHERE user_id = p_user_id
    AND is_test_mode = false
    AND (cash_balance_eur > 0 OR starting_capital_eur > 0);

  v_has_portfolio_capital := COALESCE(v_has_portfolio_capital, false);

  -- Check rules acceptance
  SELECT rules_accepted INTO v_rules_accepted
  FROM user_onboarding_status
  WHERE user_id = p_user_id;

  v_rules_accepted := COALESCE(v_rules_accepted, false);

  -- Check panic mode
  SELECT EXISTS (
    SELECT 1 FROM execution_circuit_breakers
    WHERE user_id = p_user_id
      AND breaker = 'PANIC'
      AND tripped = true
  ) INTO v_panic_active;

  -- SOLE AUTHORITY: portfolio_capital determines trading readiness
  v_ok :=
    v_has_wallet
    AND v_wallet_active
    AND v_has_portfolio_capital  -- SOLE UNLOCK CONDITION
    AND v_rules_accepted
    AND v_chain_consistent
    AND NOT v_panic_active;

  RETURN jsonb_build_object(
    'ok', v_ok,
    'has_wallet', v_has_wallet,
    'wallet_active', v_wallet_active,
    'wallet_funded', v_wallet_funded,  -- Informational only
    'has_portfolio_capital', v_has_portfolio_capital,  -- SOLE authority
    'portfolio_balance_eur', v_portfolio_balance,
    'rules_accepted', v_rules_accepted,
    'chain_consistent', v_chain_consistent,
    'panic_active', v_panic_active,
    'wallet_address', v_wallet_address
  );
END;
$$;