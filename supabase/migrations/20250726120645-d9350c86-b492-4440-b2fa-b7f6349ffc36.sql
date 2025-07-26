-- Delete the most recent user's data from all public tables
-- User ID: c6e3e501-3b05-4928-a736-65d7e24d36f0 (Jose Luis Isturiz)

DELETE FROM public.user_roles WHERE user_id = 'c6e3e501-3b05-4928-a736-65d7e24d36f0';
DELETE FROM public.profiles WHERE id = 'c6e3e501-3b05-4928-a736-65d7e24d36f0';
DELETE FROM public.user_coinbase_connections WHERE user_id = 'c6e3e501-3b05-4928-a736-65d7e24d36f0';
DELETE FROM public.trading_strategies WHERE user_id = 'c6e3e501-3b05-4928-a736-65d7e24d36f0';
DELETE FROM public.mock_trades WHERE user_id = 'c6e3e501-3b05-4928-a736-65d7e24d36f0';
DELETE FROM public.strategy_performance WHERE user_id = 'c6e3e501-3b05-4928-a736-65d7e24d36f0';
DELETE FROM public.trading_history WHERE user_id = 'c6e3e501-3b05-4928-a736-65d7e24d36f0';
DELETE FROM public.conversation_history WHERE user_id = 'c6e3e501-3b05-4928-a736-65d7e24d36f0';