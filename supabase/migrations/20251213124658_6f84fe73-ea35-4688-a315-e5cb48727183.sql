-- Patch force_mock_trade_insert: SELL consistency + search_path hardening
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
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_normalized_symbol TEXT;
  v_trade_id UUID;
  v_total_value NUMERIC;
  v_remaining_amount NUMERIC;
  v_original_buy RECORD;
  v_realized_pnl NUMERIC;
  v_epsilon NUMERIC := 0.00000001;
BEGIN
  -- Auth check: caller must be authenticated and match p_user_id
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_failed', 'message', 'User must be authenticated and match p_user_id');
  END IF;

  -- Input validation
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_amount', 'message', 'Amount must be positive');
  END IF;
  
  IF p_price IS NULL OR p_price <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_price', 'message', 'Price must be positive');
  END IF;
  
  IF p_symbol IS NULL OR TRIM(p_symbol) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_symbol', 'message', 'Symbol cannot be empty');
  END IF;
  
  IF p_trade_type NOT IN ('buy', 'sell') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_trade_type', 'message', 'Trade type must be buy or sell');
  END IF;

  -- Normalize symbol to base (strip -EUR, -USD, uppercase)
  v_normalized_symbol := UPPER(TRIM(p_symbol));
  v_normalized_symbol := REPLACE(v_normalized_symbol, '-EUR', '');
  v_normalized_symbol := REPLACE(v_normalized_symbol, '-USD', '');

  -- Verify strategy belongs to user and is test mode
  IF NOT EXISTS (
    SELECT 1 FROM public.trading_strategies 
    WHERE id = p_strategy_id 
      AND user_id = p_user_id 
      AND is_test_mode = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_strategy', 'message', 'Strategy must belong to user and be in test mode');
  END IF;

  -- Generate trade ID
  v_trade_id := gen_random_uuid();

  IF p_trade_type = 'buy' THEN
    -- BUY: straightforward insert
    v_total_value := ROUND((p_amount * p_price)::numeric, 2);
    
    INSERT INTO public.mock_trades (
      id, user_id, strategy_id, trade_type, cryptocurrency, amount, price, total_value,
      executed_at, is_test_mode, is_corrupted, notes
    ) VALUES (
      v_trade_id, p_user_id, p_strategy_id, 'buy', v_normalized_symbol, 
      ROUND(p_amount::numeric, 8), ROUND(p_price::numeric, 2), v_total_value,
      now(), true, false, 'force_mock_trade_insert'
    );
    
    RETURN jsonb_build_object(
      'success', true,
      'trade_id', v_trade_id,
      'trade_type', 'buy',
      'symbol', v_normalized_symbol,
      'amount', ROUND(p_amount::numeric, 8),
      'price', ROUND(p_price::numeric, 2),
      'total_value', v_total_value
    );

  ELSE
    -- SELL: requires original_trade_id and original_purchase_amount
    IF p_original_trade_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'missing_original_trade_id', 'message', 'SELL requires p_original_trade_id');
    END IF;
    
    IF p_original_purchase_amount IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'missing_original_purchase_amount', 'message', 'SELL requires p_original_purchase_amount');
    END IF;

    -- SELL consistency: p_amount MUST equal p_original_purchase_amount (within epsilon)
    IF ABS(p_amount - p_original_purchase_amount) > v_epsilon THEN
      RETURN jsonb_build_object('success', false, 'error', 'amount_mismatch', 'message', 'SELL requires p_amount == p_original_purchase_amount');
    END IF;

    -- Validate original BUY lot exists and belongs to user
    SELECT id, amount, price, total_value, cryptocurrency
    INTO v_original_buy
    FROM public.mock_trades
    WHERE id = p_original_trade_id
      AND user_id = p_user_id
      AND trade_type = 'buy'
      AND is_test_mode = true
      AND is_corrupted = false;
    
    IF v_original_buy.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_original_trade', 'message', 'Original BUY lot not found or does not belong to user');
    END IF;

    -- Compute remaining amount for this lot (FIFO check)
    SELECT COALESCE(v_original_buy.amount, 0) - COALESCE(SUM(original_purchase_amount), 0)
    INTO v_remaining_amount
    FROM public.mock_trades
    WHERE original_trade_id = p_original_trade_id
      AND trade_type = 'sell'
      AND is_test_mode = true
      AND is_corrupted = false;

    IF v_remaining_amount IS NULL THEN
      v_remaining_amount := v_original_buy.amount;
    END IF;

    -- Validate we have enough remaining
    IF p_original_purchase_amount > v_remaining_amount + v_epsilon THEN
      RETURN jsonb_build_object('success', false, 'error', 'insufficient_remaining', 'message', 
        format('Insufficient remaining amount: requested %s, available %s', p_original_purchase_amount, v_remaining_amount));
    END IF;

    -- Use p_original_purchase_amount for all SELL calculations (consistency)
    v_total_value := ROUND((p_original_purchase_amount * p_price)::numeric, 2);
    
    -- Calculate realized P&L based on original purchase value
    v_realized_pnl := ROUND((v_total_value - (p_original_purchase_amount * v_original_buy.price))::numeric, 2);

    INSERT INTO public.mock_trades (
      id, user_id, strategy_id, trade_type, cryptocurrency, amount, price, total_value,
      executed_at, is_test_mode, is_corrupted, notes,
      original_trade_id, original_purchase_amount, original_purchase_price, original_purchase_value,
      exit_value, realized_pnl, realized_pnl_pct
    ) VALUES (
      v_trade_id, p_user_id, p_strategy_id, 'sell', v_normalized_symbol, 
      ROUND(p_original_purchase_amount::numeric, 8), ROUND(p_price::numeric, 2), v_total_value,
      now(), true, false, 'force_mock_trade_insert',
      p_original_trade_id, ROUND(p_original_purchase_amount::numeric, 8), 
      v_original_buy.price, ROUND((p_original_purchase_amount * v_original_buy.price)::numeric, 2),
      v_total_value, v_realized_pnl,
      CASE WHEN (p_original_purchase_amount * v_original_buy.price) > 0 
        THEN ROUND((v_realized_pnl / (p_original_purchase_amount * v_original_buy.price) * 100)::numeric, 2) 
        ELSE 0 
      END
    );
    
    RETURN jsonb_build_object(
      'success', true,
      'trade_id', v_trade_id,
      'trade_type', 'sell',
      'symbol', v_normalized_symbol,
      'amount', ROUND(p_original_purchase_amount::numeric, 8),
      'price', ROUND(p_price::numeric, 2),
      'total_value', v_total_value,
      'realized_pnl', v_realized_pnl,
      'original_trade_id', p_original_trade_id
    );
  END IF;
END;
$function$;

-- Ensure grants are correct
REVOKE ALL ON FUNCTION public.force_mock_trade_insert FROM PUBLIC;
REVOKE ALL ON FUNCTION public.force_mock_trade_insert FROM anon;
GRANT EXECUTE ON FUNCTION public.force_mock_trade_insert TO authenticated;