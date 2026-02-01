CREATE OR REPLACE FUNCTION public.mt_on_sell_snapshot()
RETURNS TRIGGER AS $$
DECLARE
  v_symbol TEXT;
  v_user UUID := NEW.user_id;
  v_sell_amount NUMERIC := ROUND(NEW.amount::numeric, 8);
  v_exit_price NUMERIC := ROUND(NEW.price::numeric, 2);
  v_exit_value NUMERIC := ROUND((v_sell_amount * v_exit_price)::numeric, 2);

  v_fee_rate NUMERIC := CASE 
    WHEN NEW.is_test_mode = true THEN 0 
    ELSE COALESCE((
      SELECT CASE 
        WHEN UPPER(p.account_type) = 'COINBASE_PRO' THEN 0 
        ELSE COALESCE(p.fee_rate, 0) 
      END
      FROM public.profiles p 
      WHERE p.id = v_user
    ), 0)
  END;

  need_amount NUMERIC := v_sell_amount;
  total_purchase_value NUMERIC := 0;
  total_purchase_amount NUMERIC := 0;
  lot_record RECORD;

  v_is_system_operator BOOLEAN := FALSE;
BEGIN
  -- Only apply to SELL
  IF NEW.trade_type <> 'sell' THEN
    RETURN NEW;
  END IF;

  -- Normalize symbol
  v_symbol := UPPER(TRIM(NEW.cryptocurrency));
  v_symbol := REPLACE(v_symbol, '-EUR', '');
  NEW.cryptocurrency := v_symbol;

  -- Detect system operator mode (STRICT)
  v_is_system_operator := (
    NEW.market_conditions IS NOT NULL
    AND NEW.market_conditions ? 'system_operator_mode'
    AND (NEW.market_conditions->>'system_operator_mode')::boolean = true
  );

  ------------------------------------------------------------------
  -- OPTION B: HARD BYPASS — SYSTEM OPERATOR NEVER TOUCHES COVERAGE
  ------------------------------------------------------------------
  IF v_is_system_operator THEN
    -- Minimal accounting only, NO FIFO, NO STRATEGY, NO COVERAGE
    -- Use explicit zeroes instead of NULL for downstream safety
    NEW.exit_value := v_exit_value;

    NEW.original_purchase_amount := 0;
    NEW.original_purchase_price := 0;
    NEW.original_purchase_value := 0;

    NEW.buy_fees := 0;
    NEW.sell_fees := 0;
    NEW.fees := 0;

    NEW.realized_pnl := 0;
    NEW.realized_pnl_pct := 0;
    NEW.profit_loss := 0;

    RETURN NEW;
  END IF;

  ------------------------------------------------------------------
  -- NORMAL USER SELL (UNCHANGED LEGACY FIFO LOGIC)
  ------------------------------------------------------------------

  FOR lot_record IN
    WITH available_buys AS (
      SELECT 
        id,
        amount,
        price,
        executed_at,
        amount - COALESCE((
          SELECT SUM(original_purchase_amount)
          FROM public.mock_trades past_sells
          WHERE past_sells.trade_type = 'sell'
            AND past_sells.user_id = v_user
            AND past_sells.strategy_id = NEW.strategy_id
            AND REPLACE(UPPER(past_sells.cryptocurrency), '-EUR', '') = v_symbol
            AND past_sells.is_test_mode IS NOT DISTINCT FROM NEW.is_test_mode
            AND past_sells.original_trade_id = buys.id
        ), 0) AS remaining_amount
      FROM public.mock_trades buys
      WHERE buys.user_id = v_user
        AND buys.trade_type = 'buy'
        AND buys.strategy_id = NEW.strategy_id
        AND REPLACE(UPPER(buys.cryptocurrency), '-EUR', '') = v_symbol
        AND buys.is_test_mode IS NOT DISTINCT FROM NEW.is_test_mode
      ORDER BY buys.executed_at, buys.id
    )
    SELECT id, remaining_amount, price
    FROM available_buys
    WHERE remaining_amount > 1e-9
    ORDER BY id
  LOOP
    EXIT WHEN need_amount <= 1e-9;

    DECLARE
      take_amount NUMERIC := LEAST(need_amount, ROUND(lot_record.remaining_amount::numeric, 8));
      lot_value NUMERIC := ROUND((take_amount * ROUND(lot_record.price::numeric, 2))::numeric, 2);
    BEGIN
      IF take_amount > 1e-9 THEN
        total_purchase_amount := ROUND((total_purchase_amount + take_amount)::numeric, 8);
        total_purchase_value := ROUND((total_purchase_value + lot_value)::numeric, 2);
        need_amount := ROUND((need_amount - take_amount)::numeric, 8);
      END IF;
    END;
  END LOOP;

  IF need_amount > 1e-9 THEN
    RAISE EXCEPTION
      'Cannot save SELL: insufficient BUY coverage for % in strategy % (missing % units)',
      v_symbol, NEW.strategy_id, ROUND(need_amount::numeric, 8);
  END IF;

  -- Fees & PnL
  NEW.original_purchase_amount := total_purchase_amount;
  NEW.original_purchase_value := total_purchase_value;
  NEW.original_purchase_price := CASE
    WHEN total_purchase_amount > 0 THEN
      ROUND((total_purchase_value / total_purchase_amount)::numeric, 2)
    ELSE 0
  END;

  NEW.exit_value := v_exit_value;

  NEW.buy_fees := ROUND((total_purchase_value * v_fee_rate)::numeric, 2);
  NEW.sell_fees := ROUND((v_exit_value * v_fee_rate)::numeric, 2);
  NEW.fees := ROUND((NEW.buy_fees + NEW.sell_fees)::numeric, 2);

  NEW.realized_pnl := ROUND((v_exit_value - total_purchase_value - NEW.fees)::numeric, 2);
  NEW.realized_pnl_pct := CASE
    WHEN total_purchase_value > 0 THEN
      ROUND(((NEW.realized_pnl / total_purchase_value) * 100)::numeric, 2)
    ELSE 0
  END;

  NEW.profit_loss := NEW.realized_pnl;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;