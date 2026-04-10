
-- ============================================================
-- SETTLEMENT PIPELINE FOUNDATION
-- ============================================================

-- 1. New columns on mock_trades
ALTER TABLE mock_trades 
  ADD COLUMN IF NOT EXISTS settlement_status text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS original_trade_id uuid DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_mock_trades_settlement_status 
  ON mock_trades(settlement_status) WHERE settlement_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mock_trades_original_trade_id 
  ON mock_trades(original_trade_id) WHERE original_trade_id IS NOT NULL;

-- FIFO query index: open REAL BUY lots ordered by executed_at
CREATE INDEX IF NOT EXISTS idx_mock_trades_fifo_real
  ON mock_trades(user_id, strategy_id, cryptocurrency, executed_at ASC)
  WHERE is_open_position = true 
    AND is_test_mode = false 
    AND trade_type = 'BUY' 
    AND execution_confirmed = true;

-- ============================================================
-- 2. settle_buy_trade_v2 — atomic BUY settlement
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_buy_trade_v2(
  p_mock_trade_id UUID,
  p_user_id UUID,
  p_actual_spent_eur NUMERIC,
  p_reserved_amount NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
  v_cash numeric;
  v_reserved numeric;
  v_release_amount numeric;
BEGIN
  -- 1. Guard idempotence with row lock
  SELECT settlement_status INTO v_current_status
  FROM mock_trades
  WHERE id = p_mock_trade_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mock_trade_not_found');
  END IF;

  IF v_current_status = 'SETTLED' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_settled');
  END IF;

  -- 2. Lock portfolio_capital row and compute safe release
  SELECT cash_balance_eur, reserved_eur INTO v_cash, v_reserved
  FROM portfolio_capital
  WHERE user_id = p_user_id AND is_test_mode = false
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE mock_trades SET settlement_status = 'FAILED' WHERE id = p_mock_trade_id;
    RETURN jsonb_build_object('ok', false, 'error', 'portfolio_capital_not_found');
  END IF;

  -- Safe release formula: avoids reserved > cash after debit
  v_release_amount := LEAST(v_reserved, GREATEST(p_reserved_amount, v_reserved - (v_cash - p_actual_spent_eur)));

  UPDATE portfolio_capital
  SET
    cash_balance_eur = cash_balance_eur - p_actual_spent_eur,
    reserved_eur = GREATEST(reserved_eur - v_release_amount, 0),
    updated_at = now()
  WHERE user_id = p_user_id AND is_test_mode = false;

  -- 3. Mark as settled (same transaction)
  UPDATE mock_trades
  SET settlement_status = 'SETTLED'
  WHERE id = p_mock_trade_id;

  RETURN jsonb_build_object('ok', true, 'skipped', false, 'debited_eur', p_actual_spent_eur);
END;
$$;

-- ============================================================
-- 3. settle_sell_trade_v2 — atomic SELL settlement with FIFO
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_sell_trade_v2(
  p_mock_trade_id UUID,
  p_user_id UUID,
  p_strategy_id UUID,
  p_symbol TEXT,
  p_sold_qty NUMERIC,
  p_sell_price NUMERIC,
  p_proceeds_eur NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
  v_remaining numeric := p_sold_qty;
  v_lot RECORD;
  v_sold_from_lot numeric;
  v_pnl numeric;
  v_pnl_pct numeric;
  v_lots_closed integer := 0;
  v_lots_split integer := 0;
  v_total_pnl numeric := 0;
BEGIN
  -- 1. Guard idempotence with row lock
  SELECT settlement_status INTO v_current_status
  FROM mock_trades
  WHERE id = p_mock_trade_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mock_trade_not_found');
  END IF;

  IF v_current_status = 'SETTLED' OR v_current_status = 'SETTLED_NO_FIFO' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_settled');
  END IF;

  -- 2. FIFO matching with row locks on BUY lots
  FOR v_lot IN
    SELECT id, amount, purchase_price, purchase_value_eur, executed_at
    FROM mock_trades
    WHERE cryptocurrency = p_symbol
      AND is_open_position = true
      AND is_test_mode = false
      AND trade_type = 'BUY'
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
      v_pnl := (p_sell_price - v_lot.purchase_price) * v_sold_from_lot;
      v_pnl_pct := CASE WHEN v_lot.purchase_price > 0
                        THEN ((p_sell_price - v_lot.purchase_price) / v_lot.purchase_price) * 100
                        ELSE 0 END;

      UPDATE mock_trades SET
        is_open_position = false,
        sell_price = p_sell_price,
        exit_value = p_sell_price * v_sold_from_lot,
        profit_loss = v_pnl,
        profit_loss_percentage = v_pnl_pct,
        settlement_status = 'SETTLED'
      WHERE id = v_lot.id;

      v_remaining := v_remaining - v_sold_from_lot;
      v_lots_closed := v_lots_closed + 1;
      v_total_pnl := v_total_pnl + v_pnl;

    ELSE
      -- Partial lot — split
      v_sold_from_lot := v_remaining;
      v_pnl := (p_sell_price - v_lot.purchase_price) * v_sold_from_lot;
      v_pnl_pct := CASE WHEN v_lot.purchase_price > 0
                        THEN ((p_sell_price - v_lot.purchase_price) / v_lot.purchase_price) * 100
                        ELSE 0 END;

      -- Reduce the open lot
      UPDATE mock_trades SET
        amount = v_lot.amount - v_sold_from_lot
      WHERE id = v_lot.id;

      -- Insert the closed split portion
      INSERT INTO mock_trades (
        user_id, strategy_id, cryptocurrency, trade_type,
        amount, purchase_price, purchase_value_eur,
        is_open_position, is_test_mode,
        sell_price, exit_value, profit_loss, profit_loss_percentage,
        execution_confirmed, execution_source, execution_mode,
        executed_at, settlement_status, original_trade_id
      ) VALUES (
        p_user_id, p_strategy_id, p_symbol, 'BUY',
        v_sold_from_lot, v_lot.purchase_price, v_lot.purchase_price * v_sold_from_lot,
        false, false,
        p_sell_price, p_sell_price * v_sold_from_lot, v_pnl, v_pnl_pct,
        true, 'onchain_settled_split', 'REAL',
        v_lot.executed_at, 'SETTLED', v_lot.id
      );

      v_remaining := 0;
      v_lots_closed := v_lots_closed + 1;
      v_lots_split := v_lots_split + 1;
      v_total_pnl := v_total_pnl + v_pnl;
    END IF;
  END LOOP;

  -- 3. Credit cash (same transaction)
  UPDATE portfolio_capital
  SET
    cash_balance_eur = cash_balance_eur + p_proceeds_eur,
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
    'lots_split', v_lots_split,
    'total_pnl_eur', v_total_pnl,
    'orphan_qty', v_remaining,
    'credited_eur', p_proceeds_eur
  );
END;
$$;

-- ============================================================
-- 4. Permissions
-- ============================================================
GRANT EXECUTE ON FUNCTION public.settle_buy_trade_v2(UUID, UUID, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_buy_trade_v2(UUID, UUID, NUMERIC, NUMERIC) TO service_role;

GRANT EXECUTE ON FUNCTION public.settle_sell_trade_v2(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_sell_trade_v2(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC) TO service_role;
