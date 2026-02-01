-- Add propagation columns to trades table (transport layer)
ALTER TABLE public.trades 
ADD COLUMN IF NOT EXISTS is_system_operator BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS user_id UUID,
ADD COLUMN IF NOT EXISTS strategy_id UUID;

COMMENT ON COLUMN public.trades.is_system_operator IS 
'Transport: Carries system_operator_mode from intent to ledger insertion. Written by onchain-execute, read by onchain-receipts.';