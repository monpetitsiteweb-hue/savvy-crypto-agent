-- Clean up all phantom/old test data and reset with only our debug test data
-- This ensures KPIs show accurate counts

-- Clear all existing mock trades to remove phantom data
DELETE FROM public.mock_trades WHERE is_test_mode = true;

-- Re-insert our controlled test dataset for debugging
-- 2 Closed positions (for testing "Past Positions" count)
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
  notes
) VALUES 
-- BTC buy position
((SELECT id FROM auth.users WHERE email = 'mon.petit.site.web@gmail.com'), 
 (SELECT id FROM public.trading_strategies WHERE strategy_name = 'Debug Test Strategy' LIMIT 1),
 'buy', 'BTC', 0.001, 50000, 50, 0.5, '2025-01-15 10:00:00+00', true, 'Test buy BTC'),

-- BTC sell position (closes above position with profit)
((SELECT id FROM auth.users WHERE email = 'mon.petit.site.web@gmail.com'), 
 (SELECT id FROM public.trading_strategies WHERE strategy_name = 'Debug Test Strategy' LIMIT 1),
 'sell', 'BTC', 0.001, 52000, 52, 0.5, '2025-01-16 10:00:00+00', true, 'Test sell BTC'),

-- ETH buy position  
((SELECT id FROM auth.users WHERE email = 'mon.petit.site.web@gmail.com'), 
 (SELECT id FROM public.trading_strategies WHERE strategy_name = 'Debug Test Strategy' LIMIT 1),
 'buy', 'ETH', 0.02, 3500, 70, 0.7, '2025-01-17 10:00:00+00', true, 'Test buy ETH'),

-- ETH sell position (closes above position with loss)
((SELECT id FROM auth.users WHERE email = 'mon.petit.site.web@gmail.com'), 
 (SELECT id FROM public.trading_strategies WHERE strategy_name = 'Debug Test Strategy' LIMIT 1),
 'sell', 'ETH', 0.02, 3200, 64, 0.6, '2025-01-18 10:00:00+00', true, 'Test sell ETH');

-- Update profit_loss for sell trades
UPDATE public.mock_trades 
SET profit_loss = 1.0  -- €52 - €50 - €0.5 - €0.5 = €1.0 profit
WHERE trade_type = 'sell' 
  AND cryptocurrency = 'BTC' 
  AND is_test_mode = true;

UPDATE public.mock_trades 
SET profit_loss = -7.3  -- €64 - €70 - €0.7 - €0.6 = €-7.3 loss  
WHERE trade_type = 'sell' 
  AND cryptocurrency = 'ETH' 
  AND is_test_mode = true;