-- ONE-TIME FIX: Reconcile cash_balance_eur with historical trade flows (fee-aware)
-- This corrects cash for trades executed before the ledger was connected
-- Uses exit_value (net, trigger-computed) for SELLs instead of total_value (gross)

WITH trade_flows AS (
  SELECT
    user_id,
    -- BUY reduces cash by total_value + any buy-side fees
    SUM(
      CASE WHEN trade_type = 'buy'
        THEN -( total_value
              + COALESCE(fees, 0)
              + COALESCE(buy_fees, 0)
             )
        ELSE 0
      END
    ) AS buy_outflows,
    -- SELL increases cash by exit_value (net, trigger-computed) when available
    -- Fall back to total_value - fees if exit_value is null
    SUM(
      CASE WHEN trade_type = 'sell'
        THEN COALESCE(exit_value, total_value - COALESCE(fees, 0) - COALESCE(sell_fees, 0))
        ELSE 0
      END
    ) AS sell_inflows
  FROM public.mock_trades
  WHERE is_test_mode = true
    AND COALESCE(is_corrupted, false) = false
  GROUP BY user_id
)
UPDATE public.portfolio_capital pc
SET
  cash_balance_eur = pc.starting_capital_eur
                   + COALESCE(tf.buy_outflows, 0)
                   + COALESCE(tf.sell_inflows, 0),
  updated_at = now()
FROM trade_flows tf
WHERE pc.user_id = tf.user_id;