CREATE OR REPLACE FUNCTION public.mt_on_sell_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_buy RECORD;
BEGIN
  -- Only process SELL trades
  IF NEW.trade_type != 'sell' THEN
    RETURN NEW;
  END IF;

  -- Respect coordinator FIFO completely
  IF NEW.original_trade_id IS NOT NULL THEN
    IF NEW.exit_value IS NULL THEN
      NEW.exit_value := ROUND((NEW.amount * NEW.price)::numeric, 2);
    END IF;
    RETURN NEW;
  END IF;

  -- Fallback FIFO lookup (rare path only)
  SELECT *
  INTO v_buy
  FROM mock_trades
  WHERE trade_type = 'buy'
    AND cryptocurrency = NEW.cryptocurrency
    AND user_id = NEW.user_id
    AND strategy_id = NEW.strategy_id
    AND is_test_mode = NEW.is_test_mode
    AND is_corrupted = false
  ORDER BY executed_at ASC
  LIMIT 1;

  IF v_buy.id IS NOT NULL THEN
    NEW.original_trade_id := v_buy.id;
    NEW.original_purchase_amount := NEW.amount;
    NEW.original_purchase_price := v_buy.price;
    NEW.original_purchase_value := ROUND((NEW.amount * v_buy.price)::numeric, 2);
    NEW.exit_value := ROUND((NEW.amount * NEW.price)::numeric, 2);
    NEW.realized_pnl := ROUND((NEW.exit_value - NEW.original_purchase_value)::numeric, 2);
    NEW.realized_pnl_pct := CASE
      WHEN NEW.original_purchase_value > 0 THEN
        ROUND(((NEW.realized_pnl / NEW.original_purchase_value) * 100)::numeric, 2)
      ELSE 0
    END;
  ELSE
    NEW.exit_value := ROUND((NEW.amount * NEW.price)::numeric, 2);
  END IF;

  RETURN NEW;
END;
$$;