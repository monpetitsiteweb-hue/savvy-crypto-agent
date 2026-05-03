CREATE OR REPLACE VIEW public.real_positions_view AS
SELECT 
  user_id,
  cryptocurrency AS symbol,
  strategy_id,
  chain_id,
  SUM(
    CASE 
      WHEN upper(side) = 'BUY' THEN
        CASE 
          WHEN decode_method = 'manual_backfill' THEN amount
          WHEN price > 0 THEN amount / price
          ELSE 0
        END
      WHEN upper(side) = 'SELL' THEN
        -1 * CASE 
          WHEN decode_method = 'manual_backfill' THEN amount
          WHEN price > 0 THEN amount / price
          ELSE 0
        END
      ELSE 0
    END
  ) AS position_size,
  MAX(created_at) AS last_trade_at
FROM real_trades
WHERE execution_status = 'CONFIRMED'
  AND trade_role = 'ENGINE_TRADE'
  AND user_id = auth.uid()
GROUP BY user_id, cryptocurrency, strategy_id, chain_id
HAVING SUM(
  CASE 
    WHEN upper(side) = 'BUY' THEN
      CASE 
        WHEN decode_method = 'manual_backfill' THEN amount
        WHEN price > 0 THEN amount / price
        ELSE 0
      END
    WHEN upper(side) = 'SELL' THEN
      -1 * CASE 
        WHEN decode_method = 'manual_backfill' THEN amount
        WHEN price > 0 THEN amount / price
        ELSE 0
      END
    ELSE 0
  END
) <> 0;