-- Add columns to distinguish sandbox vs live trades
ALTER TABLE public.trading_history 
ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN DEFAULT false;

-- Add a column to mark test mode vs live mode
ALTER TABLE public.trading_history 
ADD COLUMN IF NOT EXISTS trade_environment TEXT DEFAULT 'live' CHECK (trade_environment IN ('sandbox', 'live'));