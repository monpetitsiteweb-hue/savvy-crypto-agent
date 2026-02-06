-- ============================================================
-- STRUCTURAL FIX: Introduce trade_role discriminator
-- Separates ENGINE_TRADE from FUNDING semantically
-- ============================================================

-- Step 1: Add trade_role column with CHECK constraint
ALTER TABLE real_trades
ADD COLUMN IF NOT EXISTS trade_role text
CHECK (trade_role IN ('ENGINE_TRADE', 'FUNDING'))
DEFAULT 'ENGINE_TRADE';

-- Step 2: Mark existing funding/capital movement trades
-- These are internal transfers, not engine-executed trades
UPDATE real_trades
SET trade_role = 'FUNDING'
WHERE execution_authority = 'MANUAL'
   OR execution_target = 'WALLET_FUNDING'
   OR provider = 'INTERNAL';

-- Step 3: Recreate real_positions_view with trade_role filter
DROP VIEW IF EXISTS real_positions_view;

CREATE VIEW real_positions_view
WITH (security_invoker = on)
AS
SELECT 
  rt.user_id,
  rt.cryptocurrency AS symbol,
  rt.strategy_id,
  rt.chain_id,
  SUM(
    CASE 
      WHEN UPPER(rt.side) = 'BUY'  THEN rt.amount
      WHEN UPPER(rt.side) = 'SELL' THEN -rt.amount
      ELSE 0
    END
  ) AS position_size,
  MAX(rt.created_at) AS last_trade_at
FROM real_trades rt
WHERE rt.execution_status = 'CONFIRMED'
  AND rt.trade_role = 'ENGINE_TRADE'
  AND rt.is_system_operator = false
  AND rt.user_id = auth.uid()
GROUP BY rt.user_id, rt.cryptocurrency, rt.strategy_id, rt.chain_id
HAVING SUM(
  CASE 
    WHEN UPPER(rt.side) = 'BUY'  THEN rt.amount
    WHEN UPPER(rt.side) = 'SELL' THEN -rt.amount
    ELSE 0
  END
) <> 0;

COMMENT ON VIEW real_positions_view IS
'User-facing REAL positions. Engine trades only. Funding excluded by design.';

-- Step 4: Recreate real_trade_history_view with trade_role filter
DROP VIEW IF EXISTS real_trade_history_view;

CREATE VIEW real_trade_history_view
WITH (security_invoker = on)
AS
SELECT
  rt.id             AS real_trade_id,
  rt.trade_id       AS mock_trade_id,
  rt.id             AS trade_id,
  rt.user_id,
  rt.strategy_id,
  rt.cryptocurrency AS symbol,
  rt.side,
  rt.amount         AS filled_quantity,
  rt.price          AS effective_price,
  rt.total_value,
  rt.fees,
  rt.tx_hash,
  rt.chain_id,
  rt.provider,
  rt.execution_status,
  rt.execution_target,
  rt.execution_authority,
  rt.is_system_operator,
  rt.gas_used,
  rt.block_number,
  rt.block_timestamp,
  rt.decode_method,
  rt.error_reason,
  mt.executed_at    AS intent_ts,
  rt.created_at     AS execution_recorded_at
FROM real_trades rt
LEFT JOIN mock_trades mt ON mt.id = rt.trade_id
WHERE rt.trade_role = 'ENGINE_TRADE'
  AND rt.is_system_operator = false
  AND rt.user_id = auth.uid();

COMMENT ON VIEW real_trade_history_view IS
'User-facing REAL trade history. Engine trades only. Funding excluded by design.';