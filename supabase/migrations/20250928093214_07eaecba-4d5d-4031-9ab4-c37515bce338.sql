-- Add executed_at column to mock_trades first
ALTER TABLE public.mock_trades
  ADD COLUMN IF NOT EXISTS executed_at timestamptz DEFAULT now();

-- Add execution mode and on-chain details to mock_trades
ALTER TABLE public.mock_trades
  ADD COLUMN IF NOT EXISTS execution_mode text CHECK (execution_mode IN ('COINBASE','ONCHAIN')) DEFAULT 'COINBASE',
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS chain_id int,
  ADD COLUMN IF NOT EXISTS token_in text,
  ADD COLUMN IF NOT EXISTS token_out text,
  ADD COLUMN IF NOT EXISTS router text,
  ADD COLUMN IF NOT EXISTS route_source text,
  ADD COLUMN IF NOT EXISTS tx_hash text,
  ADD COLUMN IF NOT EXISTS gas_estimate_wei numeric,
  ADD COLUMN IF NOT EXISTS gas_used_wei numeric,
  ADD COLUMN IF NOT EXISTS fee_native_wei numeric,
  ADD COLUMN IF NOT EXISTS amount_in_wei numeric,
  ADD COLUMN IF NOT EXISTS amount_out_wei numeric,
  ADD COLUMN IF NOT EXISTS price_quoted numeric,
  ADD COLUMN IF NOT EXISTS price_realized numeric,
  ADD COLUMN IF NOT EXISTS slippage_bps numeric,
  ADD COLUMN IF NOT EXISTS price_impact_bps numeric,
  ADD COLUMN IF NOT EXISTS gas_cost_pct numeric,
  ADD COLUMN IF NOT EXISTS quote_age_ms int,
  ADD COLUMN IF NOT EXISTS mev_route text,
  ADD COLUMN IF NOT EXISTS effective_bps_cost numeric;

-- Add execution configuration to trading strategies
ALTER TABLE public.trading_strategies
  ADD COLUMN IF NOT EXISTS execution_mode text CHECK (execution_mode IN ('COINBASE','ONCHAIN')) DEFAULT 'COINBASE',
  ADD COLUMN IF NOT EXISTS chain_id int DEFAULT 8453,
  ADD COLUMN IF NOT EXISTS slippage_bps_default int DEFAULT 50,
  ADD COLUMN IF NOT EXISTS preferred_providers text[] DEFAULT ARRAY['0x','cow','1inch','uniswap'],
  ADD COLUMN IF NOT EXISTS mev_policy text DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS max_gas_cost_pct numeric DEFAULT 0.35,
  ADD COLUMN IF NOT EXISTS max_price_impact_bps int DEFAULT 40,
  ADD COLUMN IF NOT EXISTS max_quote_age_ms int DEFAULT 1500;

-- Create index for on-chain 24h queries
CREATE INDEX IF NOT EXISTS idx_mock_trades_onchain_executed_at
  ON public.mock_trades (executed_at)
  WHERE execution_mode = 'ONCHAIN';

-- Create execution quality metrics view for on-chain trades
CREATE OR REPLACE VIEW public.execution_quality_onchain_24h AS
SELECT 
  user_id,
  strategy_id,
  provider,
  chain_id,
  COUNT(*) AS trade_count,
  AVG(slippage_bps) AS avg_slippage_bps,
  AVG(gas_cost_pct) AS avg_gas_cost_pct,
  AVG(quote_age_ms) AS avg_quote_age_ms,
  AVG(price_impact_bps) AS avg_price_impact_bps,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY slippage_bps) AS slippage_p95_bps,
  COUNT(*) FILTER (WHERE slippage_bps > 50) AS high_slippage_count
FROM public.mock_trades
WHERE execution_mode = 'ONCHAIN'
  AND executed_at >= NOW() - INTERVAL '24 hours'
GROUP BY user_id, strategy_id, provider, chain_id;