-- GOAL 2.B: Add pnl_at_decision_pct column to mock_trades
-- This tracks the P&L percentage at the moment the exit decision was made
-- versus the realized P&L when the trade was actually executed

ALTER TABLE public.mock_trades 
ADD COLUMN IF NOT EXISTS pnl_at_decision_pct NUMERIC(10,4);

-- Add comment for documentation
COMMENT ON COLUMN public.mock_trades.pnl_at_decision_pct IS 'P&L percentage at the moment the exit decision was made (TP/SL/etc.). Compare with realized_pnl_pct to see execution quality.';