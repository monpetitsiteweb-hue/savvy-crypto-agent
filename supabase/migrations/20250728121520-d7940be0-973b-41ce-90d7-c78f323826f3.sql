-- Insert test mock trades for debugging TradingHistory calculations
-- This creates both open and closed positions to test all P&L scenarios

-- First, get the user's current strategy (if any)
DO $$
DECLARE
    current_user_id uuid := auth.uid();
    test_strategy_id uuid;
    base_time timestamp with time zone := now() - interval '2 hours';
BEGIN
    -- Only proceed if user is authenticated
    IF current_user_id IS NULL THEN
        RAISE NOTICE 'User not authenticated, skipping test data insertion';
        RETURN;
    END IF;
    
    -- Get or create a test strategy
    SELECT id INTO test_strategy_id 
    FROM trading_strategies 
    WHERE user_id = current_user_id AND test_mode = true 
    ORDER BY created_at DESC 
    LIMIT 1;
    
    -- If no test strategy exists, create one
    IF test_strategy_id IS NULL THEN
        INSERT INTO trading_strategies (user_id, strategy_name, test_mode, configuration, is_active_test)
        VALUES (
            current_user_id,
            'Debug Test Strategy',
            true,
            '{"maxOpenPositions": 5, "buyTrigger": {"type": "price_drop", "percentage": 2}, "sellTrigger": {"type": "price_increase", "percentage": 3}}'::jsonb,
            true
        )
        RETURNING id INTO test_strategy_id;
        
        RAISE NOTICE 'Created test strategy: %', test_strategy_id;
    END IF;
    
    -- Clear any existing mock trades for this user/strategy to avoid conflicts
    DELETE FROM mock_trades WHERE user_id = current_user_id AND strategy_id = test_strategy_id;
    
    -- Insert BTC trades (1 closed position with profit)
    INSERT INTO mock_trades (user_id, strategy_id, trade_type, cryptocurrency, amount, price, total_value, fees, profit_loss, executed_at, is_test_mode) VALUES
    (current_user_id, test_strategy_id, 'buy', 'BTC', 0.001, 95000.00, 95.00, 0.48, 0, base_time, true),
    (current_user_id, test_strategy_id, 'sell', 'BTC', 0.001, 98000.00, 98.00, 0.49, 2.03, base_time + interval '30 minutes', true);
    
    -- Insert ETH trades (1 closed position with loss)  
    INSERT INTO mock_trades (user_id, strategy_id, trade_type, cryptocurrency, amount, price, total_value, fees, profit_loss, executed_at, is_test_mode) VALUES
    (current_user_id, test_strategy_id, 'buy', 'ETH', 0.03, 3400.00, 102.00, 0.51, 0, base_time + interval '15 minutes', true),
    (current_user_id, test_strategy_id, 'sell', 'ETH', 0.03, 3200.00, 96.00, 0.48, -6.99, base_time + interval '45 minutes', true);
    
    -- Insert SOL trades (1 open position)
    INSERT INTO mock_trades (user_id, strategy_id, trade_type, cryptocurrency, amount, price, total_value, fees, profit_loss, executed_at, is_test_mode) VALUES
    (current_user_id, test_strategy_id, 'buy', 'SOL', 1.5, 180.00, 270.00, 1.35, 0, base_time + interval '1 hour', true);
    
    -- Insert XRP trades (1 open position)
    INSERT INTO mock_trades (user_id, strategy_id, trade_type, cryptocurrency, amount, price, total_value, fees, profit_loss, executed_at, is_test_mode) VALUES
    (current_user_id, test_strategy_id, 'buy', 'XRP', 100, 2.50, 250.00, 1.25, 0, base_time + interval '1 hour 30 minutes', true);
    
    RAISE NOTICE 'Inserted test trades for user: % with strategy: %', current_user_id, test_strategy_id;
    RAISE NOTICE 'Test data includes: 2 closed positions (1 profit, 1 loss) and 2 open positions';
END $$;