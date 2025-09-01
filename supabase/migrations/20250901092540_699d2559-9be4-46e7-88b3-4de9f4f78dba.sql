-- Add maxTotalTrades field to trading strategies and update existing strategies
-- This replaces the concept of maxOpenPositions with maxTotalTrades for clearer vocabulary

-- First, let's add a temporary column to store maxTotalTrades values
ALTER TABLE public.trading_strategies 
ADD COLUMN temp_max_total_trades INTEGER;

-- Set default values based on existing maxOpenPositions if it exists in configuration
UPDATE public.trading_strategies 
SET temp_max_total_trades = CASE 
  WHEN configuration->>'maxOpenPositions' IS NOT NULL 
  THEN (configuration->>'maxOpenPositions')::integer * 10  -- Convert positions to trade count estimate
  ELSE 200  -- Default value
END;

-- Update all strategy configurations to replace maxOpenPositions with maxTotalTrades
UPDATE public.trading_strategies 
SET configuration = configuration - 'maxOpenPositions' || 
  jsonb_build_object('maxTotalTrades', temp_max_total_trades);

-- Remove the temporary column
ALTER TABLE public.trading_strategies 
DROP COLUMN temp_max_total_trades;

-- Add a comment to document the change
COMMENT ON TABLE public.trading_strategies IS 'Trading strategies configuration. maxTotalTrades replaces maxOpenPositions for clearer trade limiting vocabulary.';