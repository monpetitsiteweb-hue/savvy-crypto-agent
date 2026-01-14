-- =====================================================
-- REAL MONEY EXECUTION INTEGRATION - PHASE 1
-- =====================================================

-- 1. Create execution_jobs table (job queue for async execution)
CREATE TABLE IF NOT EXISTS public.execution_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES public.trading_strategies(id) ON DELETE CASCADE,
  execution_target TEXT NOT NULL CHECK (execution_target IN ('MOCK', 'REAL')),
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('ONCHAIN', 'COINBASE')),
  kind TEXT NOT NULL CHECK (kind IN ('SWAP', 'TRANSFER', 'LIQUIDATE')),
  side TEXT NOT NULL CHECK (upper(side) IN ('BUY', 'SELL')),
  symbol TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'LOCKED', 'SUBMITTED', 'CONFIRMED', 'FAILED')),
  tx_hash TEXT,
  idempotency_key TEXT,
  error_message TEXT,
  locked_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique index for REAL idempotency only
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_jobs_real_idempotency
ON public.execution_jobs(idempotency_key)
WHERE execution_target = 'REAL' AND idempotency_key IS NOT NULL;

-- Index for fast worker scans
CREATE INDEX IF NOT EXISTS idx_execution_jobs_ready_created
ON public.execution_jobs(created_at)
WHERE status = 'READY';

-- Enable RLS
ALTER TABLE public.execution_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies for execution_jobs
CREATE POLICY "Users can view their own execution jobs"
ON public.execution_jobs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own execution jobs"
ON public.execution_jobs FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- 2. Create claim_next_execution_job RPC (SECURITY DEFINER for safe job claiming)
CREATE OR REPLACE FUNCTION public.claim_next_execution_job()
RETURNS public.execution_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job public.execution_jobs;
BEGIN
  SELECT *
  INTO job
  FROM public.execution_jobs
  WHERE status = 'READY'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.execution_jobs
  SET
    status = 'LOCKED',
    locked_at = now(),
    updated_at = now()
  WHERE id = job.id;

  RETURN job;
END;
$$;

-- 3. Add is_test_mode to mock_trades (MOCK/REAL separation)
ALTER TABLE public.mock_trades
ADD COLUMN IF NOT EXISTS is_test_mode BOOLEAN;

UPDATE public.mock_trades
SET is_test_mode = true
WHERE is_test_mode IS NULL;

ALTER TABLE public.mock_trades
ALTER COLUMN is_test_mode SET NOT NULL;

-- Add index for MOCK/REAL filtering
CREATE INDEX IF NOT EXISTS idx_mock_trades_is_test_mode
ON public.mock_trades(is_test_mode);

-- Add idempotency_key column
ALTER TABLE public.mock_trades
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Partial unique index for REAL trades only
CREATE UNIQUE INDEX IF NOT EXISTS idx_mock_trades_real_idempotency
ON public.mock_trades(idempotency_key)
WHERE is_test_mode = false AND idempotency_key IS NOT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.mock_trades.is_test_mode IS 'true = MOCK trade, false = REAL trade';

-- 4. Add panic button columns to trading_strategies
ALTER TABLE public.trading_strategies
ADD COLUMN IF NOT EXISTS panic_active BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS panic_activated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS panic_trigger_strategy_id UUID REFERENCES public.trading_strategies(id);

-- 5. Create transfer_allowlist table
CREATE TABLE IF NOT EXISTS public.transfer_allowlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  label TEXT,
  chain_id INTEGER NOT NULL DEFAULT 8453,
  max_amount_wei TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, address, chain_id)
);

-- Enable RLS
ALTER TABLE public.transfer_allowlist ENABLE ROW LEVEL SECURITY;

-- RLS policy for transfer_allowlist
CREATE POLICY "Users can manage their own transfer allowlist"
ON public.transfer_allowlist FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 6. Triggers for updated_at
CREATE TRIGGER set_execution_jobs_updated_at
BEFORE UPDATE ON public.execution_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_transfer_allowlist_updated_at
BEFORE UPDATE ON public.transfer_allowlist
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();