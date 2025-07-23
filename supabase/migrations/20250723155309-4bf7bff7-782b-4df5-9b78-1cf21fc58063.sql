-- Enable real-time updates for trading strategies
ALTER TABLE public.trading_strategies REPLICA IDENTITY FULL;

-- Add trading_strategies to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.trading_strategies;