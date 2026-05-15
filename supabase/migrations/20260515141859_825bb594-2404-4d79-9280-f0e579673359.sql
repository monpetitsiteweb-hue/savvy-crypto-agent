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
  c_dust_threshold CONSTANT numeric := 1e-7;
  v_placeholder       RECORD;
  v_parent            RECORD;
  v_parent_id         uuid;
  v_already_sold      numeric;
  v_remaining_before  numeric;
  v_remaining_after   numeric;
  v_exit_value        numeric;
  v_original_pv       numeric;
  v_pnl               numeric;
  v_pnl_pct           numeric;
  v_dust_recognized   boolean := false;
  v_dust_amount       numeric := 0;
  v_dust_value_eur    numeric := 0;
  v_parent_new_status public.position_status_enum;
BEGIN
  SELECT id, original_trade_id, settlement_status, tx_hash, execution_ts
    INTO v_placeholder
    FROM mock_trades
   WHERE id = p_mock_trade_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mock_trade_not_found');
  END IF;

  IF v_placeholder.settlement_status IN ('SETTLED', 'SETTLED_NO_FIFO') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_settled');
  END IF;

  IF v_placeholder.original_trade_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'sell_without_parent',
      'mock_trade_id', p_mock_trade_id
    );
  END IF;

  v_parent_id := v_placeholder.original_trade_id;

  SELECT id, amount, price, total_value, executed_at, tx_hash,
         is_open_position, position_status, is_corrupted, execution_confirmed
    INTO v_parent
    FROM mock_trades
   WHERE id = v_parent_id
     AND user_id = p_user_id
     AND strategy_id = p_strategy_id
     AND cryptocurrency = p_symbol
     AND lower(trade_type) = 'buy'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'parent_not_found_or_mismatch',
      'parent_id', v_parent_id
    );
  END IF;

  IF v_parent.is_corrupted = true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'parent_corrupted', 'parent_id', v_parent_id);
  END IF;

  IF v_parent.execution_confirmed IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'parent_unconfirmed', 'parent_id', v_parent_id);
  END IF;

  IF v_parent.price IS NULL OR v_parent.price <= 0 OR v_parent.price >= 1000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'parent_bad_price', 'parent_id', v_parent_id);
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_already_sold
    FROM mock_trades
   WHERE original_trade_id = v_parent_id
     AND trade_type = 'sell'
     AND settlement_status = 'SETTLED'
     AND is_archived = false
     AND is_corrupted = false
     AND id <> p_mock_trade_id;

  v_remaining_before := v_parent.amount - v_already_sold;

  IF p_sold_qty > v_remaining_before THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'sell_qty_exceeds_parent',
      'parent_id', v_parent_id,
      'parent_amount', v_parent.amount,
      'already_sold', v_already_sold,
      'remaining_before', v_remaining_before,
      'requested_qty', p_sold_qty
    );
  END IF;

  v_remaining_after := v_remaining_before - p_sold_qty;

  v_exit_value  := ROUND((p_sold_qty * p_sell_price)::numeric, 2);
  v_original_pv := ROUND((p_sold_qty * v_parent.price)::numeric, 2);
  v_pnl         := ROUND((v_exit_value - v_original_pv)::numeric, 2);
  v_pnl_pct     := CASE WHEN v_original_pv > 0
                        THEN ROUND(((v_pnl / v_original_pv) * 100)::numeric, 2)
                        ELSE 0 END;

  UPDATE mock_trades SET
    original_trade_id        = v_parent_id,
    original_purchase_amount = p_sold_qty,
    original_purchase_price  = v_parent.price,
    original_purchase_value  = v_original_pv,
    exit_value               = v_exit_value,
    profit_loss              = v_pnl,
    realized_pnl             = v_pnl,
    realized_pnl_pct         = v_pnl_pct,
    settlement_status        = 'SETTLED',
    notes                    = COALESCE(notes, '') ||
                               ' | settle_v2_strict: parent=' || left(v_parent_id::text, 8) ||
                               ' qty=' || p_sold_qty ||
                               ' remaining_after=' || v_remaining_after
  WHERE id = p_mock_trade_id;

  IF v_remaining_after <= c_dust_threshold AND v_remaining_after > 0 THEN
    v_dust_recognized := true;
    v_dust_amount := v_remaining_after;
    v_dust_value_eur := ROUND((v_dust_amount * p_sell_price)::numeric, 4);
    v_parent_new_status := 'CLOSED';

    INSERT INTO dust_pool (
      parent_buy_id, user_id, strategy_id, cryptocurrency,
      dust_amount, dust_value_eur_at_recognition,
      parent_tx_hash, notes
    ) VALUES (
      v_parent_id, p_user_id, p_strategy_id, p_symbol,
      v_dust_amount, v_dust_value_eur,
      v_parent.tx_hash,
      'Recognized on SELL settle ' || left(p_mock_trade_id::text, 8)
    );
  ELSIF v_remaining_after = 0 THEN
    v_parent_new_status := 'CLOSED';
  ELSE
    v_parent_new_status := 'PARTIALLY_CLOSED';
  END IF;

  UPDATE mock_trades SET
    is_open_position = (v_parent_new_status = 'PARTIALLY_CLOSED'),
    position_status  = v_parent_new_status
  WHERE id = v_parent_id;

  UPDATE portfolio_capital
     SET cash_balance_eur = cash_balance_eur + p_proceeds_eur,
         updated_at = now()
   WHERE user_id = p_user_id
     AND is_test_mode = false;

  RETURN jsonb_build_object(
    'ok',                      true,
    'skipped',                 false,
    'lots_closed',             CASE WHEN v_parent_new_status = 'CLOSED' THEN 1 ELSE 0 END,
    'lots_split',              0,
    'orphan_qty',              0,
    'total_pnl_eur',           v_pnl,
    'credited_eur',            p_proceeds_eur,
    'parent_buy_id',           v_parent_id,
    'parent_amount_remaining', v_remaining_after,
    'parent_new_status',       v_parent_new_status,
    'dust_recognized',         v_dust_recognized,
    'dust_amount',             v_dust_amount,
    'dust_value_eur',          v_dust_value_eur
  );
END;
$function$;