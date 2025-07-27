-- Fix strategies table to use correct user_id
UPDATE trading_strategies 
SET user_id = 'b58753c0-e516-44de-9427-c73773f59310'
WHERE user_id IN ('cf4252a5-5aee-473d-bdbc-44a2e992ec6f', '25a0c221-1f0e-431d-8d79-db9fb4db9cb3');

-- Re-enable the trigger for future updates
CREATE TRIGGER update_mock_trades_updated_at
  BEFORE UPDATE ON mock_trades
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();