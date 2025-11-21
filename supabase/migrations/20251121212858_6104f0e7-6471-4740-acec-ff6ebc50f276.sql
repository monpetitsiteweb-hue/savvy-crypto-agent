-- Add original_trade_id column to mock_trades for targeted manual SELL semantics
-- This links a SELL to the specific BUY it closes (for manual UI SELLs)

ALTER TABLE public.mock_trades
ADD COLUMN IF NOT EXISTS original_trade_id uuid;

COMMENT ON COLUMN public.mock_trades.original_trade_id IS 'For manual SELLs: references the specific BUY trade being closed';
