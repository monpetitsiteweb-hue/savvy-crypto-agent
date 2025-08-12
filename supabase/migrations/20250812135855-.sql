-- Fix the SELL snapshot trigger to match your exact specifications

DROP TRIGGER IF EXISTS mt_on_sell_snapshot_trigger ON public.mock_trades;
DROP FUNCTION IF EXISTS public.mt_on_sell_snapshot();

CREATE OR REPLACE FUNCTION public.mt_on_sell_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_symbol TEXT;
  v_user UUID := NEW.user_id;
  v_sell_amount NUMERIC := ROUND(NEW.amount::numeric, 8);
  v_exit_price NUMERIC := ROUND(NEW.price::numeric, 2);
  v_exit_value NUMERIC := ROUND((v_sell_amount * v_exit_price)::numeric, 2);

  v_fee_rate NUMERIC := COALESCE((SELECT CASE WHEN UPPER(p.account_type)='COINBASE_PRO' THEN 0 ELSE COALESCE(p.fee_rate,0) END
                                  FROM public.profiles p WHERE p.id = v_user), 0);
  
  -- FIFO matching variables
  need_amount NUMERIC := v_sell_amount;
  total_purchase_value NUMERIC := 0;
  total_purchase_amount NUMERIC := 0;
  lot_record RECORD;
BEGIN
  -- Only handle SELL trades
  IF NEW.trade_type <> 'sell' THEN
    RETURN NEW;
  END IF;

  -- Normalize symbol (append -EUR if missing)
  v_symbol := UPPER(TRIM(NEW.cryptocurrency));
  IF POSITION('-' IN v_symbol) = 0 THEN
    v_symbol := v_symbol || '-EUR';
  END IF;
  NEW.cryptocurrency := v_symbol;

  -- FIFO: Match this SELL with previous BUY trades
  FOR lot_record IN
    WITH available_buys AS (
      SELECT 
        id,
        amount,
        price,
        executed_at,
        -- Calculate how much of this BUY has already been consumed by previous SELLs
        amount - COALESCE((
          SELECT SUM(original_purchase_amount)
          FROM public.mock_trades past_sells
          WHERE past_sells.trade_type = 'sell'
            AND past_sells.user_id = v_user
            AND UPPER(past_sells.cryptocurrency) = v_symbol
            AND past_sells.original_purchase_value IS NOT NULL
            AND past_sells.executed_at >= buys.executed_at
        ), 0) AS remaining_amount
      FROM public.mock_trades buys
      WHERE buys.user_id = v_user
        AND buys.trade_type = 'buy'
        AND UPPER(buys.cryptocurrency) = v_symbol
      ORDER BY buys.executed_at, buys.id
    )
    SELECT id, remaining_amount, price
    FROM available_buys
    WHERE remaining_amount > 0
    ORDER BY id
  LOOP
    EXIT WHEN need_amount <= 0;
    
    DECLARE
      take_amount NUMERIC := LEAST(need_amount, ROUND(lot_record.remaining_amount::numeric, 8));
      lot_value NUMERIC := ROUND((take_amount * ROUND(lot_record.price::numeric, 2))::numeric, 2);
    BEGIN
      IF take_amount > 0 THEN
        total_purchase_amount := ROUND((total_purchase_amount + take_amount)::numeric, 8);
        total_purchase_value := ROUND((total_purchase_value + lot_value)::numeric, 2);
        need_amount := ROUND((need_amount - take_amount)::numeric, 8);
      END IF;
    END;
  END LOOP;

  -- Verify we have enough BUY coverage
  IF need_amount > 0 THEN
    RAISE EXCEPTION 'Cannot save SELL: insufficient BUY coverage for % (missing % units)', v_symbol, need_amount;
  END IF;

  -- Calculate snapshot fields according to your specs
  NEW.original_purchase_amount := total_purchase_amount;  -- amount → amount of coins purchased
  NEW.original_purchase_value := total_purchase_value;    -- purchase_value → purchase_price × amount
  NEW.original_purchase_price := CASE 
    WHEN total_purchase_amount > 0 THEN ROUND((total_purchase_value / total_purchase_amount)::numeric, 2) 
    ELSE 0 
  END;                                                    -- purchase_price → price when BUY trade executed

  -- exit_price → price when SELL trade executed (already in NEW.price)
  NEW.exit_value := v_exit_value;                         -- exit_value → exit_price × amount

  -- Calculate fees
  NEW.buy_fees := ROUND((total_purchase_value * v_fee_rate)::numeric, 2);
  NEW.sell_fees := ROUND((v_exit_value * v_fee_rate)::numeric, 2);

  -- Calculate P&L according to your specs
  NEW.realized_pnl := ROUND(((v_exit_value - NEW.sell_fees) - (total_purchase_value + NEW.buy_fees))::numeric, 2);  -- pnl → exit_value − purchase_value
  NEW.realized_pnl_pct := CASE 
    WHEN total_purchase_value > 0 THEN ROUND(((NEW.realized_pnl / total_purchase_value) * 100)::numeric, 2)
    ELSE 0 
  END;                                                    -- pnl_pct → (pnl ÷ purchase_value) × 100

  RETURN NEW;
END;
$$;

-- Create the trigger
CREATE TRIGGER mt_on_sell_snapshot_trigger
  BEFORE INSERT ON public.mock_trades
  FOR EACH ROW
  EXECUTE FUNCTION public.mt_on_sell_snapshot();

-- Update the past_positions_view to simply select stored values (no client-side math)
DROP VIEW IF EXISTS public.past_positions_view;
CREATE VIEW public.past_positions_view AS
SELECT
  id AS sell_trade_id,
  strategy_id,
  user_id,
  original_purchase_amount AS amount,
  original_purchase_price AS purchase_price,
  original_purchase_value AS purchase_value,
  price AS exit_price,
  exit_value,
  buy_fees,
  sell_fees,
  realized_pnl AS pnl,
  realized_pnl_pct AS pnl_pct,
  executed_at AS exit_at,
  cryptocurrency AS symbol
FROM public.mock_trades
WHERE trade_type = 'sell'
  AND user_id = auth.uid()
  AND original_purchase_value IS NOT NULL
ORDER BY executed_at DESC;