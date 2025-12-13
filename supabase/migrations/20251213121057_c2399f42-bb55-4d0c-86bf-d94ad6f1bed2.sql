
-- P2 Safe Force Mock Trade Insert RPC
-- Allows deterministic test trade insertion for debugging
-- SECURITY: Enforces strategy ownership, test mode, and proper validation

CREATE OR REPLACE FUNCTION public.force_mock_trade_insert(
  p_user_id UUID,
  p_strategy_id UUID,
  p_symbol TEXT,
  p_trade_type TEXT,
  p_amount NUMERIC,
  p_price NUMERIC,
  p_original_trade_id UUID DEFAULT NULL,
  p_original_purchase_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized_symbol TEXT;
  v_strategy_user_id UUID;
  v_remaining_amount NUMERIC;
  v_buy_price NUMERIC;
  v_buy_total_value NUMERIC;
  v_total_value NUMERIC;
  v_realized_pnl NUMERIC;
  v_realized_pnl_pct NUMERIC;
  v_trade_id UUID;
BEGIN
  -- 1. Access check: only authenticated user can insert for themselves
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized', 'message', 'User mismatch or not authenticated');
  END IF;
  
  -- 2. Validate inputs
  IF COALESCE(p_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_amount', 'message', 'Amount must be positive');
  END IF;
  
  IF COALESCE(p_price, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_price', 'message', 'Price must be positive');
  END IF;
  
  IF TRIM(COALESCE(p_symbol, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_symbol', 'message', 'Symbol cannot be empty');
  END IF;
  
  IF LOWER(p_trade_type) NOT IN ('buy', 'sell') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_trade_type', 'message', 'Trade type must be buy or sell');
  END IF;
  
  -- 3. Normalize symbol to base (strip -EUR, -USD, uppercase)
  v_normalized_symbol := UPPER(REPLACE(REPLACE(TRIM(p_symbol), '-EUR', ''), '-USD', ''));
  
  -- 4. Verify strategy belongs to user AND is test mode
  SELECT user_id INTO v_strategy_user_id
  FROM trading_strategies
  WHERE id = p_strategy_id
    AND user_id = p_user_id
    AND is_test_mode = true;
  
  IF v_strategy_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'strategy_not_found', 'message', 'Strategy not found, does not belong to user, or is not in test mode');
  END IF;
  
  -- 5. For SELL trades: validate lot exists and has sufficient remaining amount
  IF LOWER(p_trade_type) = 'sell' THEN
    IF p_original_trade_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'missing_original_trade_id', 'message', 'SELL requires original_trade_id of the BUY lot');
    END IF;
    
    IF COALESCE(p_original_purchase_amount, 0) <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'missing_original_purchase_amount', 'message', 'SELL requires original_purchase_amount > 0');
    END IF;
    
    -- Calculate remaining amount for this lot
    SELECT 
      b.amount - COALESCE(SUM(s.original_purchase_amount), 0),
      b.price,
      b.total_value
    INTO v_remaining_amount, v_buy_price, v_buy_total_value
    FROM mock_trades b
    LEFT JOIN mock_trades s ON s.original_trade_id = b.id AND s.trade_type = 'sell' AND s.is_test_mode = true
    WHERE b.id = p_original_trade_id
      AND b.user_id = p_user_id
      AND b.trade_type = 'buy'
      AND b.is_test_mode = true
    GROUP BY b.id, b.amount, b.price, b.total_value;
    
    IF v_remaining_amount IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'lot_not_found', 'message', 'Original BUY lot not found for this user');
    END IF;
    
    IF p_original_purchase_amount > v_remaining_amount + 0.00000001 THEN
      RETURN jsonb_build_object('success', false, 'error', 'insufficient_lot_amount', 'message', 'original_purchase_amount exceeds remaining lot amount', 'remaining', v_remaining_amount);
    END IF;
    
    -- Calculate realized P&L for SELL
    v_total_value := p_amount * p_price;
    v_realized_pnl := v_total_value - (p_original_purchase_amount * v_buy_price);
    v_realized_pnl_pct := CASE WHEN (p_original_purchase_amount * v_buy_price) > 0 
      THEN (v_realized_pnl / (p_original_purchase_amount * v_buy_price)) * 100 
      ELSE 0 END;
    
    -- Insert SELL trade
    INSERT INTO mock_trades (
      user_id, strategy_id, trade_type, cryptocurrency, amount, price, total_value,
      is_test_mode, executed_at, is_corrupted,
      original_trade_id, original_purchase_amount, original_purchase_price, original_purchase_value,
      exit_value, realized_pnl, realized_pnl_pct, profit_loss, notes
    ) VALUES (
      p_user_id, p_strategy_id, 'sell', v_normalized_symbol, p_amount, p_price, v_total_value,
      true, now(), false,
      p_original_trade_id, p_original_purchase_amount, v_buy_price, p_original_purchase_amount * v_buy_price,
      v_total_value, v_realized_pnl, v_realized_pnl_pct, v_realized_pnl, 'Force inserted via RPC'
    ) RETURNING id INTO v_trade_id;
    
  ELSE
    -- Insert BUY trade
    v_total_value := p_amount * p_price;
    
    INSERT INTO mock_trades (
      user_id, strategy_id, trade_type, cryptocurrency, amount, price, total_value,
      is_test_mode, executed_at, is_corrupted, notes
    ) VALUES (
      p_user_id, p_strategy_id, 'buy', v_normalized_symbol, p_amount, p_price, v_total_value,
      true, now(), false, 'Force inserted via RPC'
    ) RETURNING id INTO v_trade_id;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'trade_id', v_trade_id,
    'trade_type', p_trade_type,
    'symbol', v_normalized_symbol,
    'amount', p_amount,
    'price', p_price,
    'total_value', v_total_value,
    'realized_pnl', COALESCE(v_realized_pnl, 0)
  );
END;
$$;

-- Grant to authenticated only, revoke from anon
REVOKE ALL ON FUNCTION public.force_mock_trade_insert(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, UUID, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.force_mock_trade_insert(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, UUID, NUMERIC) TO authenticated;

COMMENT ON FUNCTION public.force_mock_trade_insert IS 'P2 Safe Force Mock Trade Insert - deterministic test trade injection with validation. Only works in test mode strategies. For SELL trades, requires valid original_trade_id and validates remaining lot amount.';
