-- =====================================================
-- CHAIN-FIRST PORTFOLIO + GAS ACCOUNTING (SECURITY HARDENED)
-- =====================================================

-- 1) Add wallet_address to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS wallet_address text;

-- 2) Add gas_cost_eur to mock_trades for REAL mode actual gas tracking
ALTER TABLE public.mock_trades 
ADD COLUMN IF NOT EXISTS gas_cost_eur numeric;

-- 3) Create wallet_balance_snapshots table for chain-first portfolio
CREATE TABLE IF NOT EXISTS public.wallet_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  chain_id integer NOT NULL DEFAULT 8453,
  token_address text,
  symbol text NOT NULL,
  decimals integer NOT NULL DEFAULT 18,
  balance_raw text NOT NULL,
  balance numeric NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'rpc',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_wallet_snapshots_user_observed 
  ON public.wallet_balance_snapshots (user_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_snapshots_user_symbol_observed 
  ON public.wallet_balance_snapshots (user_id, symbol, observed_at DESC);

-- Enable RLS
ALTER TABLE public.wallet_balance_snapshots ENABLE ROW LEVEL SECURITY;

-- 4) RLS Policies - SECURE VERSION
-- Users can only SELECT their own snapshots
DROP POLICY IF EXISTS "Users can view their own balance snapshots" ON public.wallet_balance_snapshots;
CREATE POLICY "Users can view their own balance snapshots"
ON public.wallet_balance_snapshots
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- ONLY service_role can INSERT (edge function uses service role key)
DROP POLICY IF EXISTS "Service role can insert balance snapshots" ON public.wallet_balance_snapshots;
CREATE POLICY "Service role can insert balance snapshots"
ON public.wallet_balance_snapshots
FOR INSERT
TO service_role
WITH CHECK (true);

-- No UPDATE/DELETE policies - snapshots are immutable audit trail

-- 5) SECURE RPC: get_wallet_portfolio_latest with auth guard
CREATE OR REPLACE FUNCTION public.get_wallet_portfolio_latest(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet_address text;
  v_latest_ts timestamptz;
  v_balances jsonb;
  v_eth_balance numeric := 0;
BEGIN
  -- SECURITY: Reject cross-user queries
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  SELECT wallet_address INTO v_wallet_address
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_wallet_address IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_wallet_configured',
      'message', 'No wallet address configured in profile'
    );
  END IF;

  SELECT MAX(observed_at) INTO v_latest_ts
  FROM public.wallet_balance_snapshots
  WHERE user_id = p_user_id;

  IF v_latest_ts IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_snapshots',
      'message', 'No balance snapshots found. Sync required.',
      'wallet_address', v_wallet_address
    );
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'symbol', symbol,
      'balance', balance,
      'token_address', token_address,
      'decimals', decimals
    )
  )
  INTO v_balances
  FROM (
    SELECT DISTINCT ON (symbol) symbol, balance, token_address, decimals
    FROM public.wallet_balance_snapshots
    WHERE user_id = p_user_id
      AND observed_at >= v_latest_ts - interval '1 minute'
    ORDER BY symbol, observed_at DESC
  ) latest;

  SELECT balance INTO v_eth_balance
  FROM public.wallet_balance_snapshots
  WHERE user_id = p_user_id
    AND symbol = 'ETH'
    AND token_address IS NULL
  ORDER BY observed_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'wallet_address', v_wallet_address,
    'observed_at', v_latest_ts,
    'eth_balance', COALESCE(v_eth_balance, 0),
    'balances', COALESCE(v_balances, '[]'::jsonb)
  );
END;
$$;

-- 6) SECURE RPC: get_gas_spent_eur with auth guard
CREATE OR REPLACE FUNCTION public.get_gas_spent_eur(
  p_user_id uuid,
  p_is_test_mode boolean DEFAULT true,
  p_mock_gas_rate_pct numeric DEFAULT 0.002
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gas_eur numeric := 0;
  v_trade_count integer := 0;
BEGIN
  -- SECURITY: Reject cross-user queries
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  IF p_is_test_mode THEN
    -- MOCK mode: estimate gas as % of trade notional
    SELECT COUNT(*),
           COALESCE(SUM(total_value * p_mock_gas_rate_pct), 0)
    INTO v_trade_count, v_gas_eur
    FROM public.mock_trades
    WHERE user_id = p_user_id
      AND is_test_mode = true
      AND COALESCE(is_corrupted, false) = false;

    RETURN jsonb_build_object(
      'success', true,
      'mode', 'mock',
      'gas_spent_eur', ROUND(v_gas_eur, 2),
      'is_estimate', true,
      'trade_count', v_trade_count,
      'rate_pct', p_mock_gas_rate_pct * 100
    );
  ELSE
    -- REAL mode: sum actual gas_cost_eur from receipts
    SELECT COUNT(*),
           COALESCE(SUM(COALESCE(gas_cost_eur, 0)), 0)
    INTO v_trade_count, v_gas_eur
    FROM public.mock_trades
    WHERE user_id = p_user_id
      AND is_test_mode = false
      AND COALESCE(is_corrupted, false) = false;

    RETURN jsonb_build_object(
      'success', true,
      'mode', 'real',
      'gas_spent_eur', ROUND(v_gas_eur, 2),
      'is_estimate', false,
      'trade_count', v_trade_count
    );
  END IF;
END;
$$;

-- 7) Grant execute to authenticated (auth guard inside prevents cross-user)
GRANT EXECUTE ON FUNCTION public.get_wallet_portfolio_latest(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_gas_spent_eur(uuid, boolean, numeric) TO authenticated;