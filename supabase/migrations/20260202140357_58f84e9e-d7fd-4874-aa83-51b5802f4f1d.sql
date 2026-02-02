-- Phase 3B Schema Fix: Allow strategy_id to be NULL for system operator trades
-- This aligns with the CHECK constraint chk_system_operator_strategy_null which enforces:
--   (is_system_operator = TRUE AND strategy_id IS NULL) OR (is_system_operator = FALSE)

-- 1. Make strategy_id nullable in mock_trades
ALTER TABLE public.mock_trades
ALTER COLUMN strategy_id DROP NOT NULL;

-- 2. Make strategy_id nullable in real_trades
ALTER TABLE public.real_trades
ALTER COLUMN strategy_id DROP NOT NULL;

-- Add comment documenting the invariant
COMMENT ON COLUMN public.mock_trades.strategy_id IS 
'Strategy UUID. Must be NULL for system operator trades (is_system_operator=true), enforced by chk_system_operator_strategy_null.';

COMMENT ON COLUMN public.real_trades.strategy_id IS 
'Strategy UUID. May be NULL for system operator trades. Links to trading_strategies when present.';