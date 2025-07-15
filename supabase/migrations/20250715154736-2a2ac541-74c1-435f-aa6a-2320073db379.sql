-- Remove the mock_trades table since we're using trading_history for sandbox trades
DROP TABLE IF EXISTS public.mock_trades CASCADE;

-- Remove the mock trade trigger
DROP TRIGGER IF EXISTS update_strategy_performance_trigger ON public.mock_trades;

-- Update the strategy performance function to work with trading_history instead
CREATE OR REPLACE FUNCTION public.update_strategy_performance_from_trades()
RETURNS TRIGGER AS $$
BEGIN
  -- This will be called when trading_history is inserted/updated
  -- to automatically update strategy performance metrics
  INSERT INTO public.strategy_performance (
    strategy_id,
    user_id,
    execution_date,
    total_trades,
    winning_trades,
    losing_trades,
    total_profit_loss,
    total_fees,
    win_rate,
    is_test_mode
  )
  SELECT 
    NEW.strategy_id,
    NEW.user_id,
    CURRENT_DATE,
    COUNT(*),
    COUNT(*) FILTER (WHERE 
      -- Calculate profit/loss based on trade type and price differences
      -- This is a simplified calculation for demonstration
      (trade_type = 'sell' AND price > (LAG(price) OVER (ORDER BY executed_at))) OR
      (trade_type = 'buy' AND price < (LEAD(price) OVER (ORDER BY executed_at)))
    ),
    COUNT(*) FILTER (WHERE 
      -- Opposite of winning condition
      (trade_type = 'sell' AND price < (LAG(price) OVER (ORDER BY executed_at))) OR
      (trade_type = 'buy' AND price > (LEAD(price) OVER (ORDER BY executed_at)))
    ),
    -- Simple P&L calculation based on fees
    -SUM(COALESCE(fees, 0)), -- Start with negative fees, add actual P&L later
    SUM(COALESCE(fees, 0)),
    CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(*) FILTER (WHERE 
          (trade_type = 'sell' AND price > (LAG(price) OVER (ORDER BY executed_at))) OR
          (trade_type = 'buy' AND price < (LEAD(price) OVER (ORDER BY executed_at)))
        ))::NUMERIC / COUNT(*) * 100, 2)
      ELSE 0 
    END,
    true -- Mark as test mode for sandbox trades
  FROM public.trading_history 
  WHERE strategy_id = NEW.strategy_id 
    AND user_id = NEW.user_id
    AND DATE(executed_at) = CURRENT_DATE
  ON CONFLICT (strategy_id, execution_date) 
  DO UPDATE SET
    total_trades = EXCLUDED.total_trades,
    winning_trades = EXCLUDED.winning_trades,
    losing_trades = EXCLUDED.losing_trades,
    total_profit_loss = EXCLUDED.total_profit_loss,
    total_fees = EXCLUDED.total_fees,
    win_rate = EXCLUDED.win_rate,
    updated_at = now();
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create new trigger for trading_history
CREATE TRIGGER update_strategy_performance_from_trades_trigger
  AFTER INSERT OR UPDATE ON public.trading_history
  FOR EACH ROW
  EXECUTE FUNCTION public.update_strategy_performance_from_trades();

-- Add a column to trading_history to distinguish sandbox vs live trades
ALTER TABLE public.trading_history 
ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN DEFAULT false;

-- Add a column to mark test mode vs live mode
ALTER TABLE public.trading_history 
ADD COLUMN IF NOT EXISTS trade_environment TEXT DEFAULT 'sandbox' CHECK (trade_environment IN ('sandbox', 'live'));