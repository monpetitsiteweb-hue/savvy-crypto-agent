-- Clear all mock trades for the specific user ID to reset test data
DELETE FROM public.mock_trades 
WHERE user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3' AND is_test_mode = true;