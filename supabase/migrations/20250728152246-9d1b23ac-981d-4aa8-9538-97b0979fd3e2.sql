-- Clean up phantom test data and insert controlled test dataset
-- Clear all existing mock trades to remove phantom data
DELETE FROM public.mock_trades WHERE is_test_mode = true;

-- Re-insert controlled test dataset: 2 closed positions only
-- Use existing strategy to avoid null constraint
INSERT INTO public.mock_trades (
  user_id, 
  strategy_id, 
  trade_type, 
  cryptocurrency, 
  amount, 
  price, 
  total_value, 
  fees, 
  executed_at, 
  is_test_mode,
  profit_loss,
  notes
) VALUES 
-- BTC closed position (buy + sell = 1 position)
('25a0c221-1f0e-431d-8d79-db9fb4db9cb3', '3eea0463-a5ad-4f46-af3d-3ab0af4a1491',
 'buy', 'BTC', 0.001, 50000, 50, 0.5, '2025-01-15 10:00:00+00', true, 0, 'Test BTC buy'),
('25a0c221-1f0e-431d-8d79-db9fb4db9cb3', '3eea0463-a5ad-4f46-af3d-3ab0af4a1491',
 'sell', 'BTC', 0.001, 52000, 52, 0.5, '2025-01-16 10:00:00+00', true, 1.0, 'Test BTC sell - profit'),

-- ETH closed position (buy + sell = 1 position)  
('25a0c221-1f0e-431d-8d79-db9fb4db9cb3', '3eea0463-a5ad-4f46-af3d-3ab0af4a1491',
 'buy', 'ETH', 0.02, 3500, 70, 0.7, '2025-01-17 10:00:00+00', true, 0, 'Test ETH buy'),
('25a0c221-1f0e-431d-8d79-db9fb4db9cb3', '3eea0463-a5ad-4f46-af3d-3ab0af4a1491',
 'sell', 'ETH', 0.02, 3200, 64, 0.6, '2025-01-18 10:00:00+00', true, -7.3, 'Test ETH sell - loss');

-- Expected results after this migration:
-- Total Positions: 2 (BTC and ETH positions were opened)
-- Open Positions: 0 (both positions are fully closed)
-- Past Positions: 2 (both positions are now closed)