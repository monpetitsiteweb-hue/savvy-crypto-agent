-- Fix the trigger function with proper cursor syntax
CREATE OR REPLACE FUNCTION public.mt_on_sell_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_symbol TEXT;
  v_user UUID := NEW.user_id;
  v_amt NUMERIC := ROUND(NEW.amount::numeric, 8);
  v_exit_price NUMERIC := ROUND(NEW.price::numeric, 2);
  v_exit_value NUMERIC := ROUND((v_amt * v_exit_price)::numeric, 2);

  v_fee_rate NUMERIC := COALESCE((SELECT CASE WHEN UPPER(p.account_type)='COINBASE_PRO' THEN 0 ELSE COALESCE(p.fee_rate,0) END
                                  FROM public.profiles p WHERE p.id = v_user), 0);
  -- FIFO accumulation
  need NUMERIC := v_amt;
  take NUMERIC := 0;
  lot_record RECORD;

  acc_amt NUMERIC := 0;
  acc_val NUMERIC := 0;
BEGIN
  -- only handle SELL
  IF NEW.trade_type <> 'sell' THEN
    RETURN NEW;
  END IF;

  -- normalize symbol to BASE-QUOTE (append -EUR if missing)
  v_symbol := UPPER(TRIM(NEW.cryptocurrency));
  IF POSITION('-' IN v_symbol) = 0 THEN
    v_symbol := v_symbol || '-EUR';
  END IF;
  NEW.cryptocurrency := v_symbol;

  -- sanity
  IF v_amt <= 0 THEN
    RAISE EXCEPTION 'SELL amount must be > 0';
  END IF;

  -- walk FIFO buys
  FOR lot_record IN
    WITH buys AS (
      SELECT id, amount, price, executed_at
      FROM public.mock_trades
      WHERE user_id = v_user
        AND trade_type = 'buy'
        AND UPPER(cryptocurrency) = v_symbol
      ORDER BY executed_at, id
    ),
    consumed AS (
      -- total previously consumed from each BUY by prior SELL snapshots
      SELECT bt.id AS buy_id,
             COALESCE(SUM(st.original_purchase_amount),0) AS consumed_amt
      FROM buys bt
      LEFT JOIN public.mock_trades st
        ON st.trade_type = 'sell'
       AND st.user_id = v_user
       AND UPPER(st.cryptocurrency) = v_symbol
       AND st.original_purchase_value IS NOT NULL
       AND st.executed_at >= bt.executed_at
      GROUP BY bt.id
    )
    SELECT b.id, b.amount - COALESCE(c.consumed_amt,0) AS remaining, b.price
    FROM buys b
    LEFT JOIN consumed c ON c.buy_id = b.id
    WHERE (b.amount - COALESCE(c.consumed_amt,0)) > 0
    ORDER BY b.executed_at, b.id
  LOOP
    EXIT WHEN need <= 0;
    take := LEAST(need, ROUND(lot_record.remaining::numeric, 8));
    IF take > 0 THEN
      acc_amt := ROUND((acc_amt + take)::numeric, 8);
      acc_val := ROUND((acc_val + (take * ROUND(lot_record.price::numeric,2)))::numeric, 2);
      need := ROUND((need - take)::numeric, 8);
    END IF;
  END LOOP;

  -- if not fully covered, block the insert
  IF need > 0 THEN
    RAISE EXCEPTION 'Cannot save SELL: insufficient BUY coverage for % (missing % units). FIFO snapshot would be incomplete.',
      v_symbol, need;
  END IF;

  -- compute averages and fees/pnl
  NEW.original_purchase_amount := acc_amt;
  NEW.original_purchase_value  := acc_val;
  NEW.original_purchase_price  := CASE WHEN acc_amt > 0 THEN ROUND((acc_val / acc_amt)::numeric, 2) ELSE 0 END;

  NEW.exit_value := v_exit_value;

  NEW.buy_fees  := ROUND((acc_val * v_fee_rate)::numeric, 2);
  NEW.sell_fees := ROUND((v_exit_value * v_fee_rate)::numeric, 2);

  NEW.realized_pnl := ROUND(((v_exit_value - NEW.sell_fees) - (acc_val + NEW.buy_fees))::numeric, 2);
  NEW.realized_pnl_pct := CASE WHEN acc_val > 0
                               THEN ROUND(((NEW.realized_pnl / acc_val) * 100)::numeric, 2)
                               ELSE 0 END;

  RETURN NEW;
END;
$$;