-- =============================================================================
-- EXECUTION WALLETS: Production-grade server-side wallet system
-- Adapted to existing schema conventions (update_updated_at_column, app_role, etc.)
-- =============================================================================

-- 1. EXECUTION_WALLETS: User-visible metadata only (NO secrets)
CREATE TABLE IF NOT EXISTS public.execution_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL UNIQUE,
  chain_id INTEGER NOT NULL DEFAULT 8453, -- Base mainnet
  is_funded BOOLEAN NOT NULL DEFAULT false,
  funded_at TIMESTAMPTZ,
  funded_amount_wei TEXT, -- Stored as string to handle large numbers
  funding_tx_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. EXECUTION_WALLET_SECRETS: Encrypted key material (service-role ONLY)
CREATE TABLE IF NOT EXISTS public.execution_wallet_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL UNIQUE REFERENCES public.execution_wallets(id) ON DELETE CASCADE,
  -- Envelope encryption fields
  encrypted_private_key BYTEA NOT NULL, -- AES-GCM encrypted with DEK
  iv BYTEA NOT NULL, -- 12 bytes for AES-GCM
  auth_tag BYTEA NOT NULL, -- 16 bytes authentication tag
  encrypted_dek BYTEA NOT NULL, -- DEK encrypted with KEK
  dek_iv BYTEA NOT NULL, -- IV for DEK encryption
  dek_auth_tag BYTEA NOT NULL, -- Auth tag for DEK encryption
  kek_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. WALLET_FUNDING_REQUESTS: Idempotent funding tracking with reconciliation
CREATE TABLE IF NOT EXISTS public.wallet_funding_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  execution_wallet_id UUID NOT NULL REFERENCES public.execution_wallets(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  chain_id INTEGER NOT NULL DEFAULT 8453,
  -- Request details
  source_asset TEXT NOT NULL, -- e.g., 'ETH', 'USDC', 'EUR'
  requested_amount TEXT NOT NULL, -- Original requested amount as string
  requested_amount_wei TEXT, -- Converted to wei if applicable
  -- Reconciliation
  expected_amount_wei TEXT,
  received_amount_wei TEXT,
  tx_hash TEXT,
  block_number BIGINT,
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'initiated', 'confirming', 'confirmed', 'failed', 'expired')),
  status_message TEXT,
  coinbase_withdrawal_id TEXT,
  -- Timestamps
  initiated_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Ensure idempotency per user
  CONSTRAINT unique_user_idempotency_key UNIQUE (user_id, idempotency_key)
);

-- 4. USER_ONBOARDING_STATUS: Track onboarding progress
CREATE TABLE IF NOT EXISTS public.user_onboarding_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  current_step TEXT NOT NULL DEFAULT 'welcome' CHECK (current_step IN ('welcome', 'coinbase_connect', 'capital_allocation', 'wallet_creation', 'funding', 'rules_confirmation', 'complete')),
  coinbase_connected BOOLEAN NOT NULL DEFAULT false,
  wallet_created BOOLEAN NOT NULL DEFAULT false,
  funding_initiated BOOLEAN NOT NULL DEFAULT false,
  funding_confirmed BOOLEAN NOT NULL DEFAULT false,
  rules_accepted BOOLEAN NOT NULL DEFAULT false,
  rules_accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- INDEXES for performance
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_execution_wallets_user_id ON public.execution_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_execution_wallets_address ON public.execution_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_funding_requests_user_id ON public.wallet_funding_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_funding_requests_status ON public.wallet_funding_requests(status);
CREATE INDEX IF NOT EXISTS idx_wallet_funding_requests_idempotency ON public.wallet_funding_requests(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_user_onboarding_status_user_id ON public.user_onboarding_status(user_id);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE public.execution_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_wallet_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_funding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_onboarding_status ENABLE ROW LEVEL SECURITY;

-- EXECUTION_WALLETS: Users can only read their own wallet metadata
CREATE POLICY "Users can view own wallet metadata"
  ON public.execution_wallets
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE for users - only service role can manage wallets
-- (RLS blocks by default when no policy exists)

-- EXECUTION_WALLET_SECRETS: NO user access whatsoever
-- Explicit REVOKE to ensure no access
REVOKE ALL ON public.execution_wallet_secrets FROM anon;
REVOKE ALL ON public.execution_wallet_secrets FROM authenticated;
-- Only service_role (backend) can access this table

-- WALLET_FUNDING_REQUESTS: Users can view their own requests
CREATE POLICY "Users can view own funding requests"
  ON public.wallet_funding_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can create funding requests (INSERT only)
CREATE POLICY "Users can create funding requests"
  ON public.wallet_funding_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- USER_ONBOARDING_STATUS: Users can manage their own onboarding
CREATE POLICY "Users can view own onboarding status"
  ON public.user_onboarding_status
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding status"
  ON public.user_onboarding_status
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own onboarding status"
  ON public.user_onboarding_status
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- TRIGGERS: Use existing update_updated_at_column function
-- =============================================================================
CREATE TRIGGER update_execution_wallets_updated_at
  BEFORE UPDATE ON public.execution_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_wallet_funding_requests_updated_at
  BEFORE UPDATE ON public.wallet_funding_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_onboarding_status_updated_at
  BEFORE UPDATE ON public.user_onboarding_status
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- SAFE VIEW: User-accessible wallet info (no secrets)
-- =============================================================================
CREATE OR REPLACE VIEW public.user_wallet_info AS
SELECT 
  ew.id,
  ew.user_id,
  ew.wallet_address,
  ew.chain_id,
  ew.is_funded,
  ew.funded_at,
  ew.funded_amount_wei,
  ew.is_active,
  ew.created_at,
  ew.updated_at
FROM public.execution_wallets ew
WHERE ew.user_id = auth.uid();

-- Grant SELECT on view to authenticated users
GRANT SELECT ON public.user_wallet_info TO authenticated;

-- =============================================================================
-- SERVICE-ROLE ONLY FUNCTION: Get wallet secrets for trading
-- Returns encrypted bytes - decryption happens in Edge Function with KEK
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_execution_wallet_for_trading(p_user_id UUID)
RETURNS TABLE (
  wallet_id UUID,
  wallet_address TEXT,
  chain_id INTEGER,
  encrypted_private_key BYTEA,
  iv BYTEA,
  auth_tag BYTEA,
  encrypted_dek BYTEA,
  dek_iv BYTEA,
  dek_auth_tag BYTEA,
  kek_version INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- HARD GUARD: Only service_role can call this function
  v_role := current_setting('request.jwt.claim.role', true);
  
  IF v_role IS NULL OR v_role != 'service_role' THEN
    RAISE EXCEPTION 'Access denied: service_role required. Current role: %', COALESCE(v_role, 'none');
  END IF;

  RETURN QUERY
  SELECT 
    ew.id AS wallet_id,
    ew.wallet_address,
    ew.chain_id,
    ews.encrypted_private_key,
    ews.iv,
    ews.auth_tag,
    ews.encrypted_dek,
    ews.dek_iv,
    ews.dek_auth_tag,
    ews.kek_version
  FROM public.execution_wallets ew
  INNER JOIN public.execution_wallet_secrets ews ON ews.wallet_id = ew.id
  WHERE ew.user_id = p_user_id
    AND ew.is_active = true;
END;
$$;

-- Revoke execute from public, grant only to service_role
REVOKE ALL ON FUNCTION public.get_execution_wallet_for_trading(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_execution_wallet_for_trading(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.get_execution_wallet_for_trading(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_execution_wallet_for_trading(UUID) TO service_role;

-- =============================================================================
-- HELPER FUNCTION: Check if user has execution wallet
-- =============================================================================
CREATE OR REPLACE FUNCTION public.user_has_execution_wallet(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.execution_wallets
    WHERE user_id = p_user_id AND is_active = true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_has_execution_wallet(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_execution_wallet(UUID) TO service_role;