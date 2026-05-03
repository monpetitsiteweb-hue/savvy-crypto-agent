-- Fix views post Custodial Bot Model migration:
-- Under the central bot model, ALL real_trades have is_system_operator=true
-- (the bot signs from BOT_ADDRESS). User attribution is preserved via user_id.
-- The legacy `is_system_operator = false` filter was excluding 100% of valid
-- engine trades from the History tab and Positions panel.

CREATE OR REPLACE VIEW public.real_trade_history_view AS
SELECT
  rt.id AS real_trade_id,
  rt.trade_id AS mock_trade_id,
  rt.id AS trade_id,
  rt.user_id,
  rt.strategy_id,
  rt.cryptocurrency AS symbol,
  rt.side,
  rt.amount AS filled_quantity,
  rt.price AS effective_price,
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
  mt.executed_at AS intent_ts,
  rt.created_at AS execution_recorded_at
FROM real_trades rt
LEFT JOIN mock_trades mt ON mt.id = rt.trade_id
WHERE rt.trade_role = 'ENGINE_TRADE'
  AND rt.user_id = auth.uid();

CREATE OR REPLACE VIEW public.real_positions_view AS
SELECT
  user_id,
  cryptocurrency AS symbol,
  strategy_id,
  chain_id,
  SUM(CASE
        WHEN UPPER(side) = 'BUY' THEN amount
        WHEN UPPER(side) = 'SELL' THEN -amount
        ELSE 0
      END) AS position_size,
  MAX(created_at) AS last_trade_at
FROM real_trades rt
WHERE execution_status = 'CONFIRMED'
  AND trade_role = 'ENGINE_TRADE'
  AND user_id = auth.uid()
GROUP BY user_id, cryptocurrency, strategy_id, chain_id
HAVING SUM(CASE
             WHEN UPPER(side) = 'BUY' THEN amount
             WHEN UPPER(side) = 'SELL' THEN -amount
             ELSE 0
           END) <> 0;