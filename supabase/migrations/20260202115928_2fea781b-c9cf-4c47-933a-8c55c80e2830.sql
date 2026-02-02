-- Phase 1 Refinements: Add constraints to real_trades

-- 1. Add CHECK constraint for execution_status values
ALTER TABLE public.real_trades
ADD CONSTRAINT chk_execution_status_values
CHECK (execution_status IN ('SUBMITTED', 'MINED', 'CONFIRMED', 'REVERTED', 'DROPPED'));

-- 2. Add FK to mock_trades (NOT VALID to avoid blocking scans)
ALTER TABLE public.real_trades
ADD CONSTRAINT fk_real_trades_mock
FOREIGN KEY (trade_id) REFERENCES public.mock_trades(id) NOT VALID;

COMMENT ON CONSTRAINT chk_execution_status_values ON public.real_trades IS 'Enforces valid execution status enum values';
COMMENT ON CONSTRAINT fk_real_trades_mock ON public.real_trades IS 'Links to authoritative mock_trades ledger - NOT VALID to avoid table scan blocking';