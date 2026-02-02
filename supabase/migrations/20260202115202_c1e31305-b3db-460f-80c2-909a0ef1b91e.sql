-- ============================================================================
-- PHASE 1: real_trades - Shadow Ledger for Blockchain Execution Truth
-- ============================================================================
-- PURPOSE:
-- Stores confirmed on-chain execution truth, independent from business logic.
-- One row = one on-chain transaction outcome.
-- Inserted ONLY after receipt decoding.
-- WRITE-ONLY. NO TRIGGERS. NO COVERAGE/FIFO/STRATEGY LOGIC.
-- 
-- NON-AUTHORITATIVE: mock_trades remains the sole authoritative ledger.
-- This table is used for reconciliation, audit, and future authority flip.
-- ============================================================================

CREATE TABLE public.real_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL,                    -- links to mock_trades.id
  tx_hash TEXT NOT NULL,                     -- on-chain transaction hash
  
  -- Execution status tracking
  execution_status TEXT NOT NULL,            -- SUBMITTED | MINED | CONFIRMED | REVERTED | DROPPED
  receipt_status BOOLEAN,                    -- true = success, false = revert, null = pending
  block_number BIGINT,
  block_timestamp TIMESTAMPTZ,
  gas_used NUMERIC,
  error_reason TEXT,
  
  -- Trade economics (decoded from receipt)
  cryptocurrency TEXT NOT NULL,
  side TEXT NOT NULL,                        -- BUY / SELL
  amount NUMERIC NOT NULL,                   -- filled amount from receipt
  price NUMERIC,                             -- executed price from receipt
  total_value NUMERIC,                       -- total value from receipt
  fees NUMERIC,                              -- gas fees in native token
  
  -- Execution context
  execution_target TEXT NOT NULL DEFAULT 'REAL',  -- always REAL for this table
  execution_authority TEXT NOT NULL,         -- USER | SYSTEM
  is_system_operator BOOLEAN NOT NULL,
  user_id UUID,
  strategy_id UUID,
  chain_id INTEGER NOT NULL DEFAULT 8453,
  provider TEXT,                             -- 0x, 1inch, uniswap, etc.
  
  -- Audit trail
  decode_method TEXT,                        -- erc20_transfer_pair | two_transfer_fallback | none
  raw_receipt JSONB,                         -- full receipt for audit
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for linking to mock_trades
CREATE INDEX idx_real_trades_trade_id ON public.real_trades(trade_id);

-- Index for tx_hash lookups (deduplication)
CREATE UNIQUE INDEX idx_real_trades_tx_hash ON public.real_trades(tx_hash);

-- Index for status queries
CREATE INDEX idx_real_trades_status ON public.real_trades(execution_status);

-- Index for user queries
CREATE INDEX idx_real_trades_user_id ON public.real_trades(user_id) WHERE user_id IS NOT NULL;

-- Enable RLS but with minimal policies (service role access only for now)
ALTER TABLE public.real_trades ENABLE ROW LEVEL SECURITY;

-- Service role can insert (for onchain-receipts edge function)
CREATE POLICY "Service role can insert real_trades"
ON public.real_trades
FOR INSERT
TO service_role
WITH CHECK (true);

-- Users can view their own trades (for future reconciliation UI)
CREATE POLICY "Users can view their own real_trades"
ON public.real_trades
FOR SELECT
USING (user_id = auth.uid());

-- Add table comment documenting purpose
COMMENT ON TABLE public.real_trades IS 
'Shadow ledger storing blockchain execution truth.
Non-authoritative. No business logic. No triggers.
Used for reconciliation, audit, and future authority flip.
mock_trades remains the SOLE authoritative execution ledger.';