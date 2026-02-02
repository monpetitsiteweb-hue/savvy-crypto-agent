-- Fix: Add system operator guard to update_strategy_performance trigger
-- This prevents NOT NULL violation on strategy_performance.strategy_id
-- when inserting system operator trades (which have strategy_id = NULL)

CREATE OR REPLACE FUNCTION public.update_strategy_performance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- ========================================================================
  -- HARD BYPASS: SYSTEM OPERATOR TRADES
  -- System operator trades have no strategy_id - skip performance tracking
  -- ========================================================================
  IF NEW.is_system_operator = TRUE THEN
    RETURN NEW;
  END IF;

  -- This will be called when mock trades are inserted/updated
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
    COUNT(*) FILTER (WHERE profit_loss > 0),
    COUNT(*) FILTER (WHERE profit_loss < 0),
    SUM(profit_loss),
    SUM(fees),
    CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(*) FILTER (WHERE profit_loss > 0))::NUMERIC / COUNT(*) * 100, 2)
      ELSE 0 
    END,
    NEW.is_test_mode
  FROM public.mock_trades 
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
$function$;