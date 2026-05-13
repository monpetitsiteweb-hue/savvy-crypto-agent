-- ============================================================
-- P1: mt_on_sell_snapshot — no-op on placeholder, B5 filters on fallback
-- ============================================================
CREATE OR REPLACE FUNCTION public.mt_on_sell_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_buy RECORD;
BEGIN
  IF NEW.trade_type != 'sell' THEN
    RETURN NEW;
  END IF;

  -- Branch A: coordinator-supplied FIFO. Respect it. Only fill exit_value
  -- if a real price is known.
  IF NEW.original_trade_id IS NOT NULL THEN
    IF NEW.exit_value IS NULL AND NEW.price IS NOT NULL AND NEW.price > 0 THEN
      NEW.exit_value := ROUND((NEW.amount * NEW.price)::numeric, 2);
    END IF;
    RETURN NEW;
  END IF;

  -- Branch B: placeholder (no price yet). Do NOT stamp anything.
  -- settle_sell_trade_v2 will write FIFO fields when real price is known.
  IF NEW.price IS NULL OR NEW.price <= 0 THEN
    RETURN NEW;
  END IF;

  -- Branch C: rare fallback FIFO with B5 filters
  SELECT *
  INTO v_buy
  FROM mock_trades
  WHERE trade_type = 'buy'
    AND cryptocurrency = NEW.cryptocurrency
    AND user_id = NEW.user_id
    AND strategy_id = NEW.strategy_id
    AND is_test_mode = NEW.is_test_mode
    AND is_corrupted = false
    AND is_open_position = true
    AND execution_confirmed = true
    AND price > 0
    AND price < 1000000
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
$function$;

-- ============================================================
-- P3: settle_sell_trade_v2 — B5 in-loop guards + write FIFO on SELL row
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_sell_trade_v2(
  p_mock_trade_id uuid,
  p_user_id uuid,
  p_strategy_id uuid,
  p_symbol text,
  p_sold_qty numeric,
  p_sell_price numeric,
  p_proceeds_eur numeric
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
  v_sell_row       RECORD;
  v_sold_from_lot  numeric;
  v_pnl            numeric;
  v_pnl_pct        numeric;
  v_lots_closed    integer := 0;
  v_lots_split     integer := 0;
  v_total_pnl      numeric := 0;
  v_parents        jsonb   := '[]'::jsonb;
  v_parent_rec     jsonb;
  v_idx            integer;
  v_n              integer;
  v_p_id           uuid;
  v_p_price        numeric;
  v_p_qty          numeric;
  v_p_pv           numeric;
  v_p_ev           numeric;
  v_p_pnl          numeric;
  v_p_pnl_pct      numeric;
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
    SELECT id, amount, price, total_value, executed_at, is_corrupted, execution_confirmed
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
    EXIT WHEN v_remaining <= 1e-8;

    -- B5 belt-and-suspenders guards (skip-and-continue)
    IF v_lot.is_corrupted = true THEN
      RAISE NOTICE '[B5_GUARD][settle_sell_trade_v2] skip parent_corrupted parentId=%', v_lot.id;
      BEGIN
        INSERT INTO decision_events (user_id, strategy_id, symbol, side, source, reason, metadata)
        VALUES (p_user_id, p_strategy_id, p_symbol, 'SELL', 'system', 'b5_guard_blocked',
                jsonb_build_object('context','settle_sell_trade_v2','candidate_parent_id',v_lot.id,'sell_mock_trade_id',p_mock_trade_id,'error_reason','parent_corrupted'));
      EXCEPTION WHEN OTHERS THEN NULL; END;
      CONTINUE;
    END IF;

    IF v_lot.execution_confirmed IS DISTINCT FROM true THEN
      RAISE NOTICE '[B5_GUARD][settle_sell_trade_v2] skip parent_unconfirmed parentId=%', v_lot.id;
      BEGIN
        INSERT INTO decision_events (user_id, strategy_id, symbol, side, source, reason, metadata)
        VALUES (p_user_id, p_strategy_id, p_symbol, 'SELL', 'system', 'b5_guard_blocked',
                jsonb_build_object('context','settle_sell_trade_v2','candidate_parent_id',v_lot.id,'sell_mock_trade_id',p_mock_trade_id,'error_reason','parent_unconfirmed'));
      EXCEPTION WHEN OTHERS THEN NULL; END;
      CONTINUE;
    END IF;

    IF v_lot.price IS NULL OR v_lot.price <= 0 OR v_lot.price >= 1000000 THEN
      RAISE NOTICE '[B5_GUARD][settle_sell_trade_v2] skip parent_bad_price parentId=% price=%', v_lot.id, v_lot.price;
      BEGIN
        INSERT INTO decision_events (user_id, strategy_id, symbol, side, source, reason, metadata)
        VALUES (p_user_id, p_strategy_id, p_symbol, 'SELL', 'system', 'b5_guard_blocked',
                jsonb_build_object('context','settle_sell_trade_v2','candidate_parent_id',v_lot.id,'sell_mock_trade_id',p_mock_trade_id,'error_reason','parent_bad_price','price',v_lot.price));
      EXCEPTION WHEN OTHERS THEN NULL; END;
      CONTINUE;
    END IF;

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
      v_parents := v_parents || jsonb_build_object('parent_id', v_lot.id, 'qty', v_sold_from_lot, 'price', v_lot.price);

    ELSE
      -- Partial lot — split
      v_sold_from_lot := v_remaining;
      v_pnl     := (p_sell_price - v_lot.price) * v_sold_from_lot;
      v_pnl_pct := CASE WHEN v_lot.price > 0
                        THEN ((p_sell_price - v_lot.price) / v_lot.price) * 100
                        ELSE 0 END;

      UPDATE mock_trades SET
        amount      = v_lot.amount - v_sold_from_lot,
        total_value = v_lot.price * (v_lot.amount - v_sold_from_lot)
      WHERE id = v_lot.id;

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
      v_parents := v_parents || jsonb_build_object('parent_id', v_lot.id, 'qty', v_sold_from_lot, 'price', v_lot.price);
    END IF;
  END LOOP;

  -- 3. Credit cash (REAL portfolio) — same transaction
  UPDATE portfolio_capital
  SET cash_balance_eur = cash_balance_eur + p_proceeds_eur,
      updated_at = now()
  WHERE user_id = p_user_id AND is_test_mode = false;

  -- 4. Write FIFO fields on the SELL row(s)
  v_n := jsonb_array_length(v_parents);

  IF v_lots_closed = 0 THEN
    -- Unlinked SELL — no valid parent, exit_value still useful for ledger
    UPDATE mock_trades
    SET settlement_status = 'SETTLED_NO_FIFO',
        exit_value        = ROUND((p_sell_price * p_sold_qty)::numeric, 2)
    WHERE id = p_mock_trade_id;

  ELSIF v_n = 1 THEN
    v_parent_rec := v_parents->0;
    v_p_id    := (v_parent_rec->>'parent_id')::uuid;
    v_p_price := (v_parent_rec->>'price')::numeric;
    v_p_qty   := (v_parent_rec->>'qty')::numeric;
    v_p_pv    := ROUND((v_p_qty * v_p_price)::numeric, 2);
    v_p_ev    := ROUND((v_p_qty * p_sell_price)::numeric, 2);
    v_p_pnl   := ROUND((v_p_ev - v_p_pv)::numeric, 2);
    v_p_pnl_pct := CASE WHEN v_p_pv > 0
                       THEN ROUND(((v_p_pnl / v_p_pv) * 100)::numeric, 2)
                       ELSE 0 END;

    UPDATE mock_trades SET
      original_trade_id        = v_p_id,
      original_purchase_amount = v_p_qty,
      original_purchase_price  = v_p_price,
      original_purchase_value  = v_p_pv,
      exit_value               = v_p_ev,
      realized_pnl             = v_p_pnl,
      realized_pnl_pct         = v_p_pnl_pct,
      settlement_status        = 'SETTLED'
    WHERE id = p_mock_trade_id;

  ELSE
    -- v_n >= 2: multi-parent aggregated SELL → Option A per-lot split
    SELECT * INTO v_sell_row FROM mock_trades WHERE id = p_mock_trade_id;
    v_idx := 0;
    FOR v_parent_rec IN SELECT * FROM jsonb_array_elements(v_parents) LOOP
      v_p_id    := (v_parent_rec->>'parent_id')::uuid;
      v_p_price := (v_parent_rec->>'price')::numeric;
      v_p_qty   := (v_parent_rec->>'qty')::numeric;
      v_p_pv    := ROUND((v_p_qty * v_p_price)::numeric, 2);
      v_p_ev    := ROUND((v_p_qty * p_sell_price)::numeric, 2);
      v_p_pnl   := ROUND((v_p_ev - v_p_pv)::numeric, 2);
      v_p_pnl_pct := CASE WHEN v_p_pv > 0
                         THEN ROUND(((v_p_pnl / v_p_pv) * 100)::numeric, 2)
                         ELSE 0 END;
      v_idx := v_idx + 1;

      IF v_idx = 1 THEN
        UPDATE mock_trades SET
          amount                   = v_p_qty,
          total_value              = v_p_ev,
          original_trade_id        = v_p_id,
          original_purchase_amount = v_p_qty,
          original_purchase_price  = v_p_price,
          original_purchase_value  = v_p_pv,
          exit_value               = v_p_ev,
          realized_pnl             = v_p_pnl,
          realized_pnl_pct         = v_p_pnl_pct,
          settlement_status        = 'SETTLED',
          notes                    = COALESCE(notes,'') || ' | settle_sell_trade_v2: lot 1/' || v_n || ' split'
        WHERE id = p_mock_trade_id;
      ELSE
        INSERT INTO mock_trades (
          user_id, strategy_id, cryptocurrency, trade_type,
          amount, price, total_value,
          is_open_position, is_test_mode,
          executed_at, execution_ts, tx_hash, chain_id,
          execution_confirmed, execution_source, execution_mode,
          settlement_status,
          original_trade_id, original_purchase_amount, original_purchase_price, original_purchase_value,
          exit_value, profit_loss, realized_pnl, realized_pnl_pct,
          notes
        ) VALUES (
          v_sell_row.user_id, v_sell_row.strategy_id, v_sell_row.cryptocurrency, 'sell',
          v_p_qty, p_sell_price, v_p_ev,
          false, v_sell_row.is_test_mode,
          v_sell_row.executed_at, v_sell_row.execution_ts, v_sell_row.tx_hash, v_sell_row.chain_id,
          true, v_sell_row.execution_source, v_sell_row.execution_mode,
          'SETTLED',
          v_p_id, v_p_qty, v_p_price, v_p_pv,
          v_p_ev, v_p_pnl, v_p_pnl, v_p_pnl_pct,
          'settle_sell_trade_v2: lot ' || v_idx || '/' || v_n || ' split from ' || left(p_mock_trade_id::text, 8)
        );
      END IF;
    END LOOP;
  END IF;

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