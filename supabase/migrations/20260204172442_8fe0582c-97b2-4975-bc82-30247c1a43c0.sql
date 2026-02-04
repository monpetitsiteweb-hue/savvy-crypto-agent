-- =============================================
-- FUNDING ATTRIBUTION SYSTEM — COMPLETE MIGRATION
-- Single atomic transaction
-- Tables + FKs + RLS + triggers + functions + constraints
-- =============================================

-- ============================================================
-- 1. BASE TABLES
-- ============================================================

-- 1.1 User external addresses
CREATE TABLE public.user_external_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  chain_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  label TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.2 Deposit attributions (credited deposits)
CREATE TABLE public.deposit_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  from_address TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  amount_raw TEXT NOT NULL,
  asset TEXT NOT NULL,
  asset_address TEXT,
  chain_id INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ NOT NULL,
  eur_rate NUMERIC NOT NULL,
  eur_amount NUMERIC NOT NULL CHECK (eur_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.3 Unattributed deposits
CREATE TABLE public.unattributed_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash TEXT NOT NULL UNIQUE,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  amount_raw TEXT NOT NULL,
  asset TEXT NOT NULL,
  asset_address TEXT,
  chain_id INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolved_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. FOREIGN KEYS
-- ============================================================

ALTER TABLE public.user_external_addresses
ADD CONSTRAINT user_external_addresses_user_fk
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE CASCADE;

ALTER TABLE public.deposit_attributions
ADD CONSTRAINT deposit_attributions_user_fk
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE RESTRICT;

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.user_external_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unattributed_deposits ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. RLS POLICIES
-- ============================================================

-- user_external_addresses
CREATE POLICY "Users select own addresses"
ON public.user_external_addresses
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users insert own addresses"
ON public.user_external_addresses
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own addresses"
ON public.user_external_addresses
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own addresses"
ON public.user_external_addresses
FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- deposit_attributions
CREATE POLICY "Users select own deposits"
ON public.deposit_attributions
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Service inserts deposits"
ON public.deposit_attributions
FOR INSERT TO service_role
WITH CHECK (true);

-- unattributed_deposits
CREATE POLICY "Service inserts unattributed"
ON public.unattributed_deposits
FOR INSERT TO service_role
WITH CHECK (true);

CREATE POLICY "Service updates unattributed"
ON public.unattributed_deposits
FOR UPDATE TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service selects unattributed"
ON public.unattributed_deposits
FOR SELECT TO service_role
USING (true);

-- Explicitly deny mutation of deposit_attributions by users
REVOKE UPDATE, DELETE ON public.deposit_attributions FROM authenticated;

-- ============================================================
-- 5. ADDRESS NORMALIZATION + UNIQUENESS
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_lowercase_address()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.address := LOWER(NEW.address);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lowercase_user_address
BEFORE INSERT OR UPDATE ON public.user_external_addresses
FOR EACH ROW
EXECUTE FUNCTION public.enforce_lowercase_address();

CREATE UNIQUE INDEX user_external_addresses_chain_address_unique
ON public.user_external_addresses (chain_id, LOWER(address));

-- ============================================================
-- 6. UPDATED_AT MAINTENANCE
-- ============================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_user_external_addresses
BEFORE UPDATE ON public.user_external_addresses
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_touch_unattributed_deposits
BEFORE UPDATE ON public.unattributed_deposits
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- 7. LOOKUP FUNCTION (NO FALSE MATCHES)
-- ============================================================

CREATE OR REPLACE FUNCTION public.lookup_user_by_external_address(
  p_chain_id INTEGER,
  p_address TEXT
)
RETURNS TABLE (
  user_id UUID,
  match_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH matches AS (
    SELECT user_id
    FROM public.user_external_addresses
    WHERE chain_id = p_chain_id
      AND address = LOWER(p_address)
  )
  SELECT
    user_id,
    (SELECT COUNT(*) FROM matches)
  FROM matches;
$$;

-- ============================================================
-- 8. SETTLEMENT FUNCTION (IDEMPOTENT + HARD GUARDS)
-- ============================================================

CREATE OR REPLACE FUNCTION public.settle_deposit_attribution(
  p_tx_hash TEXT,
  p_user_id UUID,
  p_from_address TEXT,
  p_amount NUMERIC,
  p_amount_raw TEXT,
  p_asset TEXT,
  p_asset_address TEXT,
  p_chain_id INTEGER,
  p_block_number BIGINT,
  p_block_timestamp TIMESTAMPTZ,
  p_eur_rate NUMERIC,
  p_eur_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
BEGIN
  IF p_eur_amount IS NULL OR p_eur_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid EUR amount';
  END IF;

  SELECT id INTO v_existing
  FROM public.deposit_attributions
  WHERE tx_hash = p_tx_hash;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_processed', true
    );
  END IF;

  INSERT INTO public.deposit_attributions (
    tx_hash, user_id, from_address,
    amount, amount_raw, asset, asset_address,
    chain_id, block_number, block_timestamp,
    eur_rate, eur_amount
  ) VALUES (
    p_tx_hash, p_user_id, p_from_address,
    p_amount, p_amount_raw, p_asset, p_asset_address,
    p_chain_id, p_block_number, p_block_timestamp,
    p_eur_rate, p_eur_amount
  );

  INSERT INTO public.portfolio_capital (
    user_id, is_test_mode,
    starting_capital_eur, cash_balance_eur, reserved_eur
  ) VALUES (
    p_user_id, false,
    p_eur_amount, p_eur_amount, 0
  )
  ON CONFLICT (user_id, is_test_mode)
  DO UPDATE SET
    starting_capital_eur = portfolio_capital.starting_capital_eur + EXCLUDED.starting_capital_eur,
    cash_balance_eur = portfolio_capital.cash_balance_eur + EXCLUDED.cash_balance_eur,
    updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'already_processed', false,
    'eur_credited', p_eur_amount
  );
END;
$$;

-- ============================================================
-- 9. CHAIN CONSTRAINTS (BASE ONLY)
-- ============================================================

ALTER TABLE public.user_external_addresses
ADD CONSTRAINT user_external_addresses_chain_supported
CHECK (chain_id = 8453);

ALTER TABLE public.deposit_attributions
ADD CONSTRAINT deposit_attributions_chain_supported
CHECK (chain_id = 8453);

ALTER TABLE public.unattributed_deposits
ADD CONSTRAINT unattributed_deposits_chain_supported
CHECK (chain_id = 8453);