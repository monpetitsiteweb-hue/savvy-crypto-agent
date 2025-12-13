-- Drop existing function first (parameter names changed)
DROP FUNCTION IF EXISTS public.reset_portfolio_capital(uuid, numeric);

-- Recreate with HARD RESET semantics (deletes all test trades)
CREATE OR REPLACE FUNCTION public.reset_portfolio_capital(p_user_id uuid, p_amount_eur numeric DEFAULT 30000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  deleted_trades integer;
BEGIN
  -- Access guard
  PERFORM public.check_capital_access(p_user_id);

  -- 1. DELETE all test-mode trades for the user (HARD RESET)
  DELETE FROM public.mock_trades
  WHERE user_id = p_user_id
    AND is_test_mode = true;
  
  GET DIAGNOSTICS deleted_trades = ROW_COUNT;

  -- 2. Reset portfolio_capital to clean state
  INSERT INTO public.portfolio_capital (user_id, starting_capital_eur, cash_balance_eur, reserved_eur)
  VALUES (p_user_id, p_amount_eur, p_amount_eur, 0)
  ON CONFLICT (user_id) DO UPDATE SET
    starting_capital_eur = p_amount_eur,
    cash_balance_eur = p_amount_eur,
    reserved_eur = 0,
    updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'deleted_trades', deleted_trades,
    'starting_capital_eur', p_amount_eur,
    'cash_balance_eur', p_amount_eur,
    'reserved_eur', 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_portfolio_capital(uuid, numeric) TO authenticated, service_role;