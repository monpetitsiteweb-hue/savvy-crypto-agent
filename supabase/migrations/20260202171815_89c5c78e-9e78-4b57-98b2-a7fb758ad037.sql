-- ============================================================
-- REAL MONEY ANALYTICS BACKBONE - Phase 3
-- Views: real_trade_history_view, real_positions_view
-- P&L views deferred (FIFO not yet implemented)
-- ============================================================

-- 1. real_trade_history_view
-- Purpose: Full trade history joining intent (mock_trades) with execution truth (real_trades)
-- Includes both CONFIRMED and REVERTED for audit trail
CREATE OR REPLACE VIEW public.real_trade_history_view AS
SELECT
  -- Identifiers
  rt.id AS real_trade_id,
  rt.trade_id AS mock_trade_id,
  rt.tx_hash,
  
  -- Core trade data
  rt.user_id,
  rt.cryptocurrency AS symbol,
  rt.strategy_id,
  rt.chain_id,
  UPPER(rt.side) AS side,
  
  -- Quantities and prices (from execution truth)
  rt.amount AS filled_quantity,
  rt.price AS effective_price,
  rt.total_value,
  
  -- Gas (raw values, no conversion)
  rt.gas_used,
  rt.fees,
  
  -- Execution metadata
  rt.execution_status,
  rt.execution_authority,
  rt.execution_target,
  rt.is_system_operator,
  rt.provider,
  rt.decode_method,
  rt.error_reason,
  
  -- Timestamps
  mt.executed_at AS intent_ts,
  rt.created_at AS execution_recorded_at,
  rt.block_timestamp,
  rt.block_number

FROM public.real_trades rt
LEFT JOIN public.mock_trades mt ON rt.trade_id = mt.id;

-- 2. real_positions_view
-- Purpose: Current on-chain positions (QUANTITY ONLY)
-- No prices, no gas, no cost basis
CREATE OR REPLACE VIEW public.real_positions_view AS
SELECT
  rt.user_id,
  rt.cryptocurrency AS symbol,
  rt.strategy_id,
  rt.chain_id,
  
  SUM(
    CASE
      WHEN UPPER(rt.side) = 'BUY' THEN rt.amount
      WHEN UPPER(rt.side) = 'SELL' THEN -rt.amount
      ELSE 0
    END
  ) AS position_size,
  
  MAX(rt.created_at) AS last_trade_at

FROM public.real_trades rt
WHERE rt.execution_status = 'CONFIRMED'
GROUP BY rt.user_id, rt.cryptocurrency, rt.strategy_id, rt.chain_id
HAVING SUM(
  CASE
    WHEN UPPER(rt.side) = 'BUY' THEN rt.amount
    WHEN UPPER(rt.side) = 'SELL' THEN -rt.amount
    ELSE 0
  END
) <> 0;

-- Grant SELECT to authenticated users
GRANT SELECT ON public.real_trade_history_view TO authenticated;
GRANT SELECT ON public.real_positions_view TO authenticated;