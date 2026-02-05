-- SEV-0 FIX: Prevent cross-user data leakage in REAL trade history
-- Adds: SECURITY INVOKER + explicit user_id filter + system operator exclusion

DROP VIEW IF EXISTS real_trade_history_view;

CREATE VIEW real_trade_history_view
WITH (security_invoker = on)
AS
SELECT 
  rt.id AS real_trade_id,
  rt.trade_id AS mock_trade_id,
  rt.tx_hash,
  rt.user_id,
  rt.cryptocurrency AS symbol,
  rt.strategy_id,
  rt.chain_id,
  upper(rt.side) AS side,
  rt.amount AS filled_quantity,
  rt.price AS effective_price,
  rt.total_value,
  rt.gas_used,
  rt.fees,
  rt.execution_status,
  rt.execution_authority,
  rt.execution_target,
  rt.is_system_operator,
  rt.provider,
  rt.decode_method,
  rt.error_reason,
  mt.executed_at AS intent_ts,
  rt.created_at AS execution_recorded_at,
  rt.block_timestamp,
  rt.block_number
FROM real_trades rt
LEFT JOIN mock_trades mt ON rt.trade_id = mt.id
WHERE rt.is_system_operator = false
  AND rt.user_id = auth.uid();

COMMENT ON VIEW real_trade_history_view IS 
  'User-facing REAL trade history. SECURITY INVOKER + explicit user filter. Excludes system/operator trades.';