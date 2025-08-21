-- Fix the remaining SECURITY DEFINER functions with empty search paths

-- Fix update_data_sources_updated_at
CREATE OR REPLACE FUNCTION public.update_data_sources_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'  -- Changed from empty string
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Fix update_strategy_performance
CREATE OR REPLACE FUNCTION public.update_strategy_performance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'  -- Changed from empty string
AS $function$
BEGIN
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