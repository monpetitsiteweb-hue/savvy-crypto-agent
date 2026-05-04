CREATE OR REPLACE FUNCTION public.settle_sell_trade_v2(
  p_mock_trade_id uuid,
  p_user_id       uuid,
  p_strategy_id   uuid,
  p_symbol        text,
  p_sold_qty      numeric,
  p_sell_price    numeric,
  p_proceeds_eur  numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status text;
  v_remaining      numeric := p_sold_qty;
  v_lot            RECORD;
  v_sold_from_lot  numeric;
  v_pnl            numeric;
  v_pnl_pct        numeric;
  v_lots_closed    integer := 0;
  v_lots_split     integer := 0;
  v_total_pnl      numeric := 0;
BEGIN
  -- 1. Idempotence guard with row lock on the SELL placeholder
  SELECT settlement_status INTO v_current_status
  FROM mock_trades
  WHERE id = p_mock_trade_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mock_trade_not_found');
  END IF;

  IF v_current_status IN ('SETTLED', 'SETTLED_NO_FIFO') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_settled');
  END IF;

  -- 2. FIFO matching with row locks on open BUY lots (REAL only)
  FOR v_lot IN
    SELECT id, amount, price, total_value, executed_at
    FROM mock_trades
    WHERE cryptocurrency = p_symbol
      AND is_open_position = true
      AND is_test_mode = false
      AND lower(trade_type) = 'buy'
      AND execution_confirmed = true
      AND user_id = p_user_id
      AND strategy_id = p_strategy_id
    ORDER BY executed_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    IF v_lot.amount <= v_remaining THEN
      -- Full lot closure
      v_sold_from_lot := v_lot.amount;
      v_pnl     := (p_sell_price - v_lot.price) * v_sold_from_lot;
      v_pnl_pct := CASE WHEN v_lot.price > 0
                        THEN ((p_sell_price - v_lot.price) / v_lot.price) * 100
                        ELSE 0 END;

      UPDATE mock_trades SET
        is_open_position    = false,
        exit_value          = p_sell_price * v_sold_from_lot,
        profit_loss         = v_pnl,
        realized_pnl        = v_pnl,
        realized_pnl_pct    = v_pnl_pct,
        settlement_status   = 'SETTLED'
      WHERE id = v_lot.id;

      v_remaining   := v_remaining - v_sold_from_lot;
      v_lots_closed := v_lots_closed + 1;
      v_total_pnl   := v_total_pnl + v_pnl;

    ELSE
      -- Partial lot — split
      v_sold_from_lot := v_remaining;
      v_pnl     := (p_sell_price - v_lot.price) * v_sold_from_lot;
      v_pnl_pct := CASE WHEN v_lot.price > 0
                        THEN ((p_sell_price - v_lot.price) / v_lot.price) * 100
                        ELSE 0 END;

      -- Reduce the open lot proportionally (amount AND total_value)
      UPDATE mock_trades SET
        amount      = v_lot.amount - v_sold_from_lot,
        total_value = v_lot.price * (v_lot.amount - v_sold_from_lot)
      WHERE id = v_lot.id;

      -- Insert the SETTLED split portion (mirror of parent BUY, now closed)
      INSERT INTO mock_trades (
        user_id, strategy_id, cryptocurrency, trade_type,
        amount, price, total_value,
        is_open_position, is_test_mode,
        exit_value, profit_loss, realized_pnl, realized_pnl_pct,
        execution_confirmed, execution_source, execution_mode,
        executed_at, settlement_status, original_trade_id
      ) VALUES (
        p_user_id, p_strategy_id, p_symbol, 'buy',
        v_sold_from_lot, v_lot.price, v_lot.price * v_sold_from_lot,
        false, false,
        p_sell_price * v_sold_from_lot, v_pnl, v_pnl, v_pnl_pct,
        true, 'onchain_settled_split', 'REAL',
        v_lot.executed_at, 'SETTLED', v_lot.id
      );

      v_remaining   := 0;
      v_lots_closed := v_lots_closed + 1;
      v_lots_split  := v_lots_split + 1;
      v_total_pnl   := v_total_pnl + v_pnl;
    END IF;
  END LOOP;

  -- 3. Credit cash (REAL portfolio) — same transaction
  UPDATE portfolio_capital
  SET cash_balance_eur = cash_balance_eur + p_proceeds_eur,
      updated_at = now()
  WHERE user_id = p_user_id AND is_test_mode = false;

  -- 4. Mark SELL placeholder as settled
  UPDATE mock_trades
  SET settlement_status = CASE
        WHEN v_lots_closed > 0 THEN 'SETTLED'
        ELSE 'SETTLED_NO_FIFO'
      END
  WHERE id = p_mock_trade_id;

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'lots_closed', v_lots_closed,
    'lots_split',  v_lots_split,
    'total_pnl_eur', v_total_pnl,
    'orphan_qty', v_remaining,
    'credited_eur', p_proceeds_eur
  );
END;
$function$;