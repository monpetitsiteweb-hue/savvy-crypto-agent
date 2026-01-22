-- ============================================================================
-- PART 2 — EXECUTION WALLET BALANCE SNAPSHOTS (ANALYTICS ONLY)
--
-- PURPOSE:
--   - Historical observability
--   - Audit & reconciliation
--   - Post-mortem analysis
--
-- ABSOLUTE RULES:
--   - NEVER used by UI for live balances
--   - NEVER used as cache
--   - Append-only
--   - Wallet-centric (not portfolio, not user abstraction)
--
-- LIVE balances are fetched exclusively via execution-wallet-balance Edge Function
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1️⃣ Rename table (if not already done)
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.wallet_balance_snapshots
RENAME TO execution_wallet_balance_snapshots;

-- ---------------------------------------------------------------------------
-- 2️⃣ Rename indexes (wallet-centric naming)
-- ---------------------------------------------------------------------------
ALTER INDEX IF EXISTS idx_wallet_snapshots_user_observed
RENAME TO idx_exec_wallet_snapshots_wallet_observed;

ALTER INDEX IF EXISTS idx_wallet_snapshots_user_symbol_observed
RENAME TO idx_exec_wallet_snapshots_wallet_symbol_observed;

-- ---------------------------------------------------------------------------
-- 3️⃣ Ensure correct access-pattern index
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_exec_wallet_snapshots_wallet_observed_at
ON execution_wallet_balance_snapshots (wallet_address, observed_at DESC);

-- ---------------------------------------------------------------------------
-- 4️⃣ REMOVE misleading legacy function
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_execution_wallet_balances(text);

-- ---------------------------------------------------------------------------
-- 5️⃣ Historical SNAPSHOT query (explicit, analytics-only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_execution_wallet_balance_snapshots(
  p_wallet_address text,
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS TABLE (
  observed_at   timestamptz,
  symbol        text,
  balance       numeric,
  token_address text,
  decimals      integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    observed_at,
    symbol,
    balance,
    token_address,
    decimals
  FROM execution_wallet_balance_snapshots
  WHERE wallet_address = p_wallet_address
    AND (p_from IS NULL OR observed_at >= p_from)
    AND (p_to   IS NULL OR observed_at <= p_to)
  ORDER BY observed_at DESC;
$$;

COMMENT ON FUNCTION public.get_execution_wallet_balance_snapshots IS
'ANALYTICS ONLY. Historical wallet balance snapshots. NEVER live data.';

-- ---------------------------------------------------------------------------
-- 6️⃣ Latest snapshot helper (still historical, explicit)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_execution_wallet_latest_snapshot(
  p_wallet_address text
)
RETURNS TABLE (
  observed_at   timestamptz,
  symbol        text,
  balance       numeric,
  token_address text,
  decimals      integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT ON (symbol)
    observed_at,
    symbol,
    balance,
    token_address,
    decimals
  FROM execution_wallet_balance_snapshots
  WHERE wallet_address = p_wallet_address
  ORDER BY symbol, observed_at DESC;
$$;

COMMENT ON FUNCTION public.get_execution_wallet_latest_snapshot IS
'ANALYTICS ONLY. Latest known snapshot per token. NOT live.';

-- ---------------------------------------------------------------------------
-- 7️⃣ Enforce APPEND-ONLY behavior (defensive)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_execution_wallet_snapshot_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'execution_wallet_balance_snapshots is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_update_execution_wallet_snapshots
ON execution_wallet_balance_snapshots;

CREATE TRIGGER trg_no_update_execution_wallet_snapshots
BEFORE UPDATE ON execution_wallet_balance_snapshots
FOR EACH ROW
EXECUTE FUNCTION prevent_execution_wallet_snapshot_update();

-- ---------------------------------------------------------------------------
-- 8️⃣ Final table documentation
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.execution_wallet_balance_snapshots IS
'ANALYTICS ONLY. Append-only historical on-chain wallet balance snapshots. Used for audit, reconciliation, and observability. NEVER queried by UI for live balances.';