-- Reset trading data and set starting portfolio to €250,000

-- Delete all mock trades for all users (you can modify this to target specific user if needed)
DELETE FROM public.mock_trades;

-- Delete all strategy performance records
DELETE FROM public.strategy_performance;

-- Delete all trading history records  
DELETE FROM public.trading_history;

-- Create a function to reset mock wallet balances
CREATE OR REPLACE FUNCTION public.reset_mock_wallet_balances()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This function will be called by the frontend to reset wallet balances
  -- Since we don't store wallet balances in the database directly,
  -- this is a placeholder that can be extended if needed
  
  -- Log the reset action
  RAISE NOTICE 'Mock wallet balances reset requested';
END;
$$;

-- Reset any existing AI learning data if you want a completely fresh start
DELETE FROM public.ai_learning_metrics;
DELETE FROM public.ai_knowledge_base;

-- Note: Mock wallet balances are handled in the frontend useMockWallet hook
-- The starting balance of €250,000 will need to be set in the frontend code