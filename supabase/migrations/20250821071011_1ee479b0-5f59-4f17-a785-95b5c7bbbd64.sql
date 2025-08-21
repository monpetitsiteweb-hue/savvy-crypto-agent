-- Fix SECURITY DEFINER functions by adding proper admin role validation
-- These functions need SECURITY DEFINER for admin operations but must validate permissions

-- Update admin_list_past_positions to validate admin role
CREATE OR REPLACE FUNCTION public.admin_list_past_positions(p_user uuid)
RETURNS TABLE(sell_trade_id uuid, symbol text, amount numeric, purchase_price numeric, purchase_value numeric, exit_price numeric, exit_value numeric, buy_fees numeric, sell_fees numeric, pnl numeric, pnl_pct numeric, exit_at timestamp with time zone)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  -- Validate that only admins can call this function
  SELECT
    id AS sell_trade_id,
    cryptocurrency AS symbol,
    original_purchase_amount AS amount,
    original_purchase_price AS purchase_price,
    original_purchase_value AS purchase_value,
    price AS exit_price,
    COALESCE(exit_value, total_value) AS exit_value,
    buy_fees, sell_fees,
    realized_pnl AS pnl,
    realized_pnl_pct AS pnl_pct,
    executed_at AS exit_at
  FROM public.mock_trades
  WHERE trade_type='sell'
    AND user_id = p_user
    AND original_purchase_value IS NOT NULL
    AND has_role(auth.uid(), 'admin'::app_role) -- Only admins can access
  ORDER BY executed_at DESC
  LIMIT 50;
$function$;

-- Update admin_seed_sequence to validate admin role
CREATE OR REPLACE FUNCTION public.admin_seed_sequence(p_user uuid, p_symbol text, p_amount numeric, p_buy_price numeric, p_sell_price numeric, p_account_type text, p_fee_rate numeric)
RETURNS TABLE(sell_id uuid, user_id uuid, symbol text, amount numeric, purchase_price numeric, purchase_value numeric, exit_price numeric, exit_value numeric, buy_fees numeric, sell_fees numeric, realized_pnl numeric, realized_pnl_pct numeric, executed_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  norm_symbol TEXT;
  now_ts TIMESTAMPTZ := now();
  buy_id UUID := gen_random_uuid();
  sell_row_id UUID := gen_random_uuid();
  amt NUMERIC := round(p_amount::numeric, 8);
  buy_val NUMERIC := round((p_amount * p_buy_price)::numeric, 2);
  exit_val NUMERIC := round((p_amount * p_sell_price)::numeric, 2);
  fee_rate NUMERIC := CASE WHEN upper(p_account_type)='COINBASE_PRO' THEN 0 ELSE p_fee_rate END;
  buy_fee NUMERIC := round((buy_val * fee_rate)::numeric, 2);
  sell_fee NUMERIC := round((exit_val * fee_rate)::numeric, 2);
  pnl NUMERIC := round(((exit_val - sell_fee) - (buy_val + buy_fee))::numeric, 2);
  pnl_pct NUMERIC := CASE WHEN buy_val > 0 THEN round(((pnl / buy_val) * 100)::numeric, 2) ELSE 0 END;
BEGIN
  -- Validate that only admins can call this function
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- normalize symbol to BASE-QUOTE (EUR default for missing quote)
  norm_symbol := upper(trim(p_symbol));
  IF position('-' IN norm_symbol) = 0 THEN
    norm_symbol := norm_symbol || '-EUR';
  END IF;

  -- set profile fee state explicitly for determinism
  UPDATE public.profiles
    SET account_type = upper(p_account_type),
        fee_rate = fee_rate -- keep as-is; tests set it explicitly before calling
  WHERE id = p_user;

  -- BUY row
  INSERT INTO public.mock_trades(
    id, user_id, trade_type, cryptocurrency, amount, price, total_value, executed_at
  )
  VALUES (
    buy_id, p_user, 'buy', norm_symbol, amt, round(p_buy_price::numeric, 2), buy_val, now_ts
  );

  -- SELL row with snapshot fields
  INSERT INTO public.mock_trades(
    id, user_id, trade_type, cryptocurrency, amount, price, total_value, executed_at,
    original_purchase_amount, original_purchase_price, original_purchase_value,
    exit_value, buy_fees, sell_fees, realized_pnl, realized_pnl_pct
  )
  VALUES (
    sell_row_id, p_user, 'sell', norm_symbol, amt, round(p_sell_price::numeric, 2), exit_val, now_ts,
    amt, round(p_buy_price::numeric, 2), buy_val,
    exit_val, buy_fee, sell_fee, pnl, pnl_pct
  );

  RETURN QUERY
  SELECT
    sell_row_id,
    p_user,
    norm_symbol,
    amt,
    round(p_buy_price::numeric, 2) AS purchase_price,
    buy_val AS purchase_value,
    round(p_sell_price::numeric, 2) AS exit_price,
    exit_val AS exit_value,
    buy_fee AS buy_fees,
    sell_fee AS sell_fees,
    pnl AS realized_pnl,
    pnl_pct AS realized_pnl_pct,
    now_ts AS executed_at;
END;
$function$;