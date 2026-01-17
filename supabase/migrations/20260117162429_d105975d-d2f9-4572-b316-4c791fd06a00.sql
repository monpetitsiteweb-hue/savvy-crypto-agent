-- ============================================================================
-- UNIFIED LEDGER SCHEMA EVOLUTION
-- Adds execution_source, execution_confirmed, execution_ts to mock_trades
-- Supports dual-mode execution: mock (simulated) and real (on-chain)
-- ============================================================================

-- 1. Add execution_source column (authoritative execution provenance)
ALTER TABLE mock_trades 
ADD COLUMN IF NOT EXISTS execution_source TEXT DEFAULT 'mock_engine';

-- 2. Add execution_confirmed column (fail-closed: default FALSE)
-- For mock trades: set to TRUE at insert time
-- For real trades: set to TRUE ONLY after successful receipt decoding
ALTER TABLE mock_trades 
ADD COLUMN IF NOT EXISTS execution_confirmed BOOLEAN DEFAULT false;

-- 3. Add execution_ts column (authoritative execution timestamp)
-- Mock trades: execution_ts = executed_at
-- Real trades: execution_ts = block timestamp from confirmed receipt
ALTER TABLE mock_trades 
ADD COLUMN IF NOT EXISTS execution_ts TIMESTAMPTZ;

-- ============================================================================
-- BACKFILL EXISTING MOCK TRADES ONLY
-- Critical: Only auto-confirm trades where is_test_mode = true
-- This prevents any future real trade from being accidentally confirmed
-- ============================================================================
UPDATE mock_trades
SET 
  execution_source = 'mock_engine',
  execution_confirmed = true,
  execution_ts = executed_at
WHERE is_test_mode = true
  AND (execution_source IS NULL OR execution_confirmed IS NULL OR execution_ts IS NULL);

-- ============================================================================
-- COLUMN DOCUMENTATION
-- ============================================================================

-- Mark execution_mode as deprecated
COMMENT ON COLUMN mock_trades.execution_mode IS 
'DEPRECATED. Do not use. Replaced by execution_source. All logic must rely exclusively on execution_source.';

-- Document execution_confirmed semantics
COMMENT ON COLUMN mock_trades.execution_confirmed IS 
'Fail-closed confirmation flag. FALSE by default. Set to TRUE for mock trades at insert. For real trades (execution_source=onchain), set to TRUE ONLY after successful receipt decoding. Ledger queries must filter on execution_confirmed=true.';

-- Document execution_source semantics
COMMENT ON COLUMN mock_trades.execution_source IS 
'Authoritative execution provenance. Values: mock_engine (simulated execution) | onchain (confirmed on-chain execution). This replaces the deprecated execution_mode column.';

-- Document execution_ts semantics
COMMENT ON COLUMN mock_trades.execution_ts IS 
'Authoritative execution timestamp. For mock trades: equals executed_at. For real trades: block timestamp from the confirmed on-chain receipt. Used for time-based analytics and learning correctness.';

-- ============================================================================
-- INDEXES FOR QUERY PERFORMANCE
-- ============================================================================

-- Index on execution_source for filtering by provenance
CREATE INDEX IF NOT EXISTS idx_mock_trades_execution_source 
ON mock_trades(execution_source);

-- Partial index for confirmed trades only (most queries need this)
CREATE INDEX IF NOT EXISTS idx_mock_trades_execution_confirmed 
ON mock_trades(execution_confirmed) 
WHERE execution_confirmed = true;

-- Composite index for user + mode + confirmed (portfolio queries)
CREATE INDEX IF NOT EXISTS idx_mock_trades_user_mode_confirmed 
ON mock_trades(user_id, is_test_mode, execution_confirmed) 
WHERE execution_confirmed = true;

-- ============================================================================
-- IDEMPOTENCY FOR REAL TRADES
-- Prevents duplicate real trade insertion using idempotency_key
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_mock_trades_real_idempotency 
ON mock_trades(idempotency_key) 
WHERE is_test_mode = false AND idempotency_key IS NOT NULL;