-- Clear all mock trades for the current user to reset test data
-- This will automatically reset the portfolio to starting balance (€100,000) when wallet refreshes
DELETE FROM public.mock_trades 
WHERE user_id = auth.uid() AND is_test_mode = true;