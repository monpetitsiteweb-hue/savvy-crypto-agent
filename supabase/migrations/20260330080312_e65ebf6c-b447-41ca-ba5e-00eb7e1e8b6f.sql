-- Remove trading_strategies from Realtime publication
-- This table has only ~1.5K total writes since stats reset.
-- All consumers now use 30s polling instead of Realtime.
-- This eliminates WAL event streaming for this table entirely.
ALTER PUBLICATION supabase_realtime DROP TABLE public.trading_strategies;