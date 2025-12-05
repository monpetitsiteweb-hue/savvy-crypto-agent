-- Fix the trigger to properly detect per-lot sells from coordinator
-- The coordinator sets original_trade_id, original_purchase_amount, original_purchase_value
-- This should bypass FIFO logic regardless of notes content

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
    ELSE COALESCE((SELECT CASE WHEN UPPER(p.account_type)='COINBASE_PRO' THEN 0 ELSE COALESCE(p.fee_rate,0) END
                  FROM public.profiles p WHERE p.id = v_user), 0)
  END;
  
  need_amount NUMERIC := v_sell_amount;
  total_purchase_value NUMERIC := 0;
  total_purchase_amount NUMERIC := 0;
  lot_record RECORD;
  
  -- FIXED: Detect per-lot sell when all FIFO fields are pre-filled (regardless of notes)
  v_has_pre_filled_snapshot BOOLEAN := FALSE;
BEGIN
  IF NEW.trade_type <> 'sell' THEN
    RETURN NEW;
  END IF;

  v_symbol := UPPER(TRIM(NEW.cryptocurrency));
  v_symbol := REPLACE(v_symbol, '-EUR', '');
  NEW.cryptocurrency := v_symbol;

  -- FIXED: Detect pre-filled snapshot when coordinator provides lot-level data
  -- This covers BOTH manual overrides AND coordinator per-lot sells
  v_has_pre_filled_snapshot := (
    NEW.original_trade_id IS NOT NULL 
    AND NEW.original_purchase_amount IS NOT NULL
    AND NEW.original_purchase_value IS NOT NULL
  );

  -- TARGETED/PER-LOT SELL: Trust pre-filled snapshot from coordinator
  IF v_has_pre_filled_snapshot THEN
    total_purchase_amount := NEW.original_purchase_amount;
    total_purchase_value := NEW.original_purchase_value;
    NEW.exit_value := v_exit_value;
    need_amount := 0;
    
    RAISE NOTICE 'PER-LOT SELL: Using pre-filled snapshot for original_trade_id=%, amount=%, value=%', 
      NEW.original_trade_id, total_purchase_amount, total_purchase_value;
  ELSE
    -- STANDARD FIFO LOGIC for legacy sells
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
              AND past_sells.original_purchase_value IS NOT NULL
              AND past_sells.original_trade_id = buys.id  -- FIXED: Match by lot ID, not timestamp
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

    -- Verify coverage for non-prefilled sells
    IF need_amount > 1e-9 THEN
      RAISE EXCEPTION 'Cannot save SELL: insufficient BUY coverage for % in strategy % (missing % units)',
        v_symbol, NEW.strategy_id, ROUND(need_amount::numeric, 8);
    END IF;
  END IF;

  -- Compute fees and P&L
  NEW.original_purchase_amount := total_purchase_amount;
  NEW.original_purchase_value := total_purchase_value;
  NEW.original_purchase_price := CASE WHEN total_purchase_amount > 0 
    THEN ROUND((total_purchase_value / total_purchase_amount)::numeric, 2) ELSE 0 END;
  NEW.exit_value := v_exit_value;
  
  NEW.buy_fees := ROUND((total_purchase_value * v_fee_rate)::numeric, 2);
  NEW.sell_fees := ROUND((v_exit_value * v_fee_rate)::numeric, 2);
  NEW.fees := ROUND((NEW.buy_fees + NEW.sell_fees)::numeric, 2);
  
  NEW.realized_pnl := ROUND((v_exit_value - total_purchase_value - NEW.fees)::numeric, 2);
  NEW.realized_pnl_pct := CASE WHEN total_purchase_value > 0 
    THEN ROUND(((NEW.realized_pnl / total_purchase_value) * 100)::numeric, 2) ELSE 0 END;
  NEW.profit_loss := NEW.realized_pnl;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;