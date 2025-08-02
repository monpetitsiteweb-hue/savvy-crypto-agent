-- Delete all trading history data
DELETE FROM public.trading_history;

-- Delete all mock trades data  
DELETE FROM public.mock_trades;

-- Delete all strategy performance data
DELETE FROM public.strategy_performance;

-- Reset any related audit logs for trading data
DELETE FROM public.security_audit_log 
WHERE table_name IN ('trading_history', 'mock_trades', 'strategy_performance');