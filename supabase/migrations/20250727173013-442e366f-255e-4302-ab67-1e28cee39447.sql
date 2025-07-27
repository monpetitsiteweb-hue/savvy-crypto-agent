-- Temporarily disable the trigger that's causing issues
DROP TRIGGER IF EXISTS update_mock_trades_updated_at ON mock_trades;

-- Update past trades to current user
UPDATE mock_trades 
SET user_id = 'b58753c0-e516-44de-9427-c73773f59310'
WHERE user_id IN ('cf4252a5-5aee-473d-bdbc-44a2e992ec6f', '25a0c221-1f0e-431d-8d79-db9fb4db9cb3') 
AND is_test_mode = true;