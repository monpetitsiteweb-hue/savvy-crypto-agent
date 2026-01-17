-- Add gas_cost_eth column for on-chain truth storage
-- EUR conversion happens in views/queries, not at insertion time
ALTER TABLE public.mock_trades 
ADD COLUMN IF NOT EXISTS gas_cost_eth NUMERIC;

-- Add comment documenting the invariant
COMMENT ON COLUMN public.mock_trades.gas_cost_eth IS 
'Gas cost in ETH (wei / 1e18). For real trades (execution_source=onchain), this is the ONLY gas value stored at insertion. EUR conversion must happen in views via price snapshots. gas_cost_eur remains for mock trades only.';