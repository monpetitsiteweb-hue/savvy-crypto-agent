-- ============================================================
-- FIX: Remove old indexes still attached to archived tables
-- ============================================================
DROP INDEX IF EXISTS public.idx_execution_wallets_user_id;
DROP INDEX IF EXISTS public.idx_execution_wallets_user_active;

-- ============================================================
-- Re-create indexes on NEW execution_wallets table
-- ============================================================
CREATE INDEX idx_execution_wallets_user_id
  ON public.execution_wallets(user_id);

CREATE INDEX idx_execution_wallets_user_active
  ON public.execution_wallets(user_id)
  WHERE is_active = true;

-- ============================================================
-- Ensure updated_at trigger exists
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_execution_wallet_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS execution_wallets_updated_at ON public.execution_wallets;

CREATE TRIGGER execution_wallets_updated_at
  BEFORE UPDATE ON public.execution_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_execution_wallet_updated_at();