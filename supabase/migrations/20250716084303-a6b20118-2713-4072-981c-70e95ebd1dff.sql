-- Enable real-time updates for mock_trades table
ALTER TABLE public.mock_trades REPLICA IDENTITY FULL;

-- Add the table to the realtime publication so it can send real-time updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.mock_trades;