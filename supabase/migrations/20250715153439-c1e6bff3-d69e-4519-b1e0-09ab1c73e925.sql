-- Create strategy performance tracking table
CREATE TABLE public.strategy_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_id UUID NOT NULL REFERENCES public.trading_strategies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  execution_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  total_profit_loss NUMERIC(15,2) DEFAULT 0,
  total_fees NUMERIC(10,2) DEFAULT 0,
  portfolio_value NUMERIC(15,2) DEFAULT 0,
  max_drawdown NUMERIC(5,2) DEFAULT 0,
  win_rate NUMERIC(5,2) DEFAULT 0,
  average_gain NUMERIC(10,2) DEFAULT 0,
  average_loss NUMERIC(10,2) DEFAULT 0,
  is_test_mode BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create mock trades table for test mode
CREATE TABLE public.mock_trades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_id UUID NOT NULL REFERENCES public.trading_strategies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  trade_type TEXT NOT NULL CHECK (trade_type IN ('buy', 'sell')),
  cryptocurrency TEXT NOT NULL,
  amount NUMERIC(20,8) NOT NULL,
  price NUMERIC(15,2) NOT NULL,
  total_value NUMERIC(15,2) NOT NULL,
  fees NUMERIC(10,2) DEFAULT 0,
  executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_test_mode BOOLEAN DEFAULT true,
  strategy_trigger TEXT,
  market_conditions JSONB,
  profit_loss NUMERIC(15,2) DEFAULT 0,
  notes TEXT
);

-- Enable RLS on new tables
ALTER TABLE public.strategy_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_trades ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for strategy_performance
CREATE POLICY "Users can view their own strategy performance" 
ON public.strategy_performance 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own strategy performance" 
ON public.strategy_performance 
FOR ALL 
USING (user_id = auth.uid());

-- Create RLS policies for mock_trades
CREATE POLICY "Users can view their own mock trades" 
ON public.mock_trades 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own mock trades" 
ON public.mock_trades 
FOR ALL 
USING (user_id = auth.uid());

-- Add test_mode column to trading_strategies
ALTER TABLE public.trading_strategies 
ADD COLUMN test_mode BOOLEAN DEFAULT true;

-- Create function to update strategy performance
CREATE OR REPLACE FUNCTION public.update_strategy_performance()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- Create trigger for strategy performance updates
CREATE TRIGGER update_strategy_performance_trigger
  AFTER INSERT OR UPDATE ON public.mock_trades
  FOR EACH ROW
  EXECUTE FUNCTION public.update_strategy_performance();

-- Create updated_at triggers
CREATE TRIGGER update_strategy_performance_updated_at
  BEFORE UPDATE ON public.strategy_performance
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_mock_trades_updated_at
  BEFORE UPDATE ON public.mock_trades
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add unique constraint for strategy performance per day
ALTER TABLE public.strategy_performance 
ADD CONSTRAINT unique_strategy_performance_per_day 
UNIQUE (strategy_id, execution_date);