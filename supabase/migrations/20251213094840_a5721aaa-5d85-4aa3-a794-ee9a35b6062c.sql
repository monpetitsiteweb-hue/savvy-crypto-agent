CREATE OR REPLACE FUNCTION public.get_open_lots(p_user_id uuid)
RETURNS TABLE (
  buy_trade_id uuid,
  cryptocurrency text,
  remaining_amount numeric,
  buy_price numeric,
  buy_total_value numeric,
  executed_at timestamptz,
  strategy_id uuid,
  buy_fee numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  -- Access guard (same rule as P0 RPCs)
  SELECT public.check_capital_access(p_user_id);

  WITH sell_allocations AS (
    SELECT 
      original_trade_id,
      SUM(COALESCE(original_purchase_amount, 0)) as sold_amount
    FROM public.mock_trades
    WHERE user_id = p_user_id
      AND trade_type = 'sell'
      AND original_trade_id IS NOT NULL
      AND is_corrupted = false
      AND is_test_mode = true
    GROUP BY original_trade_id
  ),
  open_lots AS (
    SELECT 
      b.id as buy_trade_id,
      b.cryptocurrency,
      ROUND((COALESCE(b.amount,0) - COALESCE(s.sold_amount,0))::numeric, 8) as remaining_amount,
      b.price as buy_price,
      b.total_value as buy_total_value,
      b.executed_at,
      b.strategy_id,
      -- Prevent fee double counting (same logic as P0)
      (COALESCE(b.buy_fees,0) + CASE WHEN COALESCE(b.buy_fees,0)=0 THEN COALESCE(b.fees,0) ELSE 0 END) as buy_fee
    FROM public.mock_trades b
    LEFT JOIN sell_allocations s ON s.original_trade_id = b.id
    WHERE b.user_id = p_user_id
      AND b.trade_type = 'buy'
      AND b.is_corrupted = false
      AND b.is_test_mode = true
  )
  SELECT * FROM open_lots
  WHERE remaining_amount > 0.00000001
  ORDER BY executed_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_open_lots(uuid) TO authenticated, service_role;