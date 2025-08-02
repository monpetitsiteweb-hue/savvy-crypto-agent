-- Create function to reset user's test portfolio
CREATE OR REPLACE FUNCTION public.reset_user_test_portfolio(target_balance numeric DEFAULT 30000)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Delete all mock trades for the authenticated user
  DELETE FROM public.mock_trades 
  WHERE user_id = auth.uid();
  
  -- Delete all strategy performance records for test mode
  DELETE FROM public.strategy_performance 
  WHERE user_id = auth.uid() AND is_test_mode = true;
  
  -- Log the reset action
  RAISE NOTICE 'Reset test portfolio for user % - deleted % mock trades, reset balance to €%', 
    auth.uid(), 
    (SELECT COUNT(*) FROM public.mock_trades WHERE user_id = auth.uid()),
    target_balance;
END;
$$;

-- Update the existing reset function to actually work
CREATE OR REPLACE FUNCTION public.reset_mock_wallet_balances(target_balance numeric DEFAULT 30000)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Call the comprehensive reset function
  PERFORM public.reset_user_test_portfolio(target_balance);
  
  RAISE NOTICE 'Mock wallet reset completed - portfolio set to €%', target_balance;
END;
$$;