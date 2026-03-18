-- Fix: restore mock_trades deletion in reset_portfolio_capital(uuid, boolean)
-- The (uuid, boolean) overload was missing DELETE FROM mock_trades
-- which the original (uuid, numeric) overload had.

CREATE OR REPLACE FUNCTION public.reset_portfolio_capital(
  p_user_id uuid,
  p_is_test_mode boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_trades integer;
BEGIN
  -- HARD INVARIANT: REAL capital must NEVER be reset programmatically
  IF p_is_test_mode = false THEN
    RAISE EXCEPTION 'Cannot reset REAL portfolio capital programmatically';
  END IF;

  -- Access guard: only own user or service_role
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  -- 1. DELETE all test-mode trades for the user (HARD RESET)
  DELETE FROM public.mock_trades
  WHERE user_id = p_user_id
    AND is_test_mode = true;

  GET DIAGNOSTICS deleted_trades = ROW_COUNT;

  -- 2. Delete existing TEST row if present
  DELETE FROM public.portfolio_capital
  WHERE user_id = p_user_id AND is_test_mode = true;

  -- 3. Insert fresh TEST row with default capital
  INSERT INTO public.portfolio_capital (user_id, is_test_mode, starting_capital_eur, cash_balance_eur, reserved_eur)
  VALUES (p_user_id, true, 30000, 30000, 0);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'test',
    'deleted_trades', deleted_trades,
    'starting_capital_eur', 30000,
    'cash_balance_eur', 30000
  );
END;
$$;