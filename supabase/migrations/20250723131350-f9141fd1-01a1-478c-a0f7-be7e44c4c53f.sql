-- Create tables for the three new data sources
-- BigQuery historical market data
CREATE TABLE public.historical_market_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL,
  user_id UUID NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  symbol TEXT NOT NULL,
  price NUMERIC NOT NULL,
  volume NUMERIC,
  exchange TEXT,
  market_cap NUMERIC,
  source TEXT NOT NULL DEFAULT 'bigquery',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Crypto news data
CREATE TABLE public.crypto_news (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL,
  user_id UUID NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  symbol TEXT,
  headline TEXT NOT NULL,
  content TEXT,
  source_name TEXT,
  news_type TEXT,
  sentiment_score NUMERIC,
  url TEXT,
  author TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(headline, timestamp, source_name)
);

-- Price data (EODHD)
CREATE TABLE public.price_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL,
  user_id UUID NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  symbol TEXT NOT NULL,
  open_price NUMERIC NOT NULL,
  high_price NUMERIC NOT NULL,
  low_price NUMERIC NOT NULL,
  close_price NUMERIC NOT NULL,
  volume NUMERIC,
  interval_type TEXT NOT NULL, -- 'daily', '1min', '5min', '1hour'
  source TEXT NOT NULL DEFAULT 'eodhd',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(symbol, timestamp, interval_type, source)
);

-- Live signals table for real-time events
CREATE TABLE public.live_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL,
  user_id UUID NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  symbol TEXT NOT NULL,
  signal_type TEXT NOT NULL, -- 'price_spike', 'volume_surge', 'sentiment_shift', etc.
  signal_strength NUMERIC NOT NULL DEFAULT 0, -- 0-100 scale
  source TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.historical_market_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crypto_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_signals ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own historical market data" 
ON public.historical_market_data 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "System can insert historical market data" 
ON public.historical_market_data 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Users can view their own crypto news" 
ON public.crypto_news 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "System can insert crypto news" 
ON public.crypto_news 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Users can view their own price data" 
ON public.price_data 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "System can insert price data" 
ON public.price_data 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Users can view their own live signals" 
ON public.live_signals 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "System can insert live signals" 
ON public.live_signals 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "System can update live signals" 
ON public.live_signals 
FOR UPDATE 
USING (true);

-- Create indexes for performance
CREATE INDEX idx_historical_market_data_symbol_timestamp ON public.historical_market_data(symbol, timestamp);
CREATE INDEX idx_historical_market_data_user_symbol ON public.historical_market_data(user_id, symbol);

CREATE INDEX idx_crypto_news_symbol_timestamp ON public.crypto_news(symbol, timestamp);
CREATE INDEX idx_crypto_news_user_sentiment ON public.crypto_news(user_id, sentiment_score);

CREATE INDEX idx_price_data_symbol_timestamp ON public.price_data(symbol, timestamp);
CREATE INDEX idx_price_data_user_symbol_interval ON public.price_data(user_id, symbol, interval_type);

CREATE INDEX idx_live_signals_symbol_timestamp ON public.live_signals(symbol, timestamp);
CREATE INDEX idx_live_signals_processed ON public.live_signals(processed, created_at);

-- Add computed fields and triggers for price analysis
CREATE OR REPLACE FUNCTION public.calculate_price_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Add price change calculations to metadata
  IF TG_OP = 'INSERT' THEN
    -- Calculate percentage change from open to close
    NEW.metadata = NEW.metadata || jsonb_build_object(
      'price_change_pct', 
      CASE 
        WHEN NEW.open_price > 0 THEN 
          ROUND(((NEW.close_price - NEW.open_price) / NEW.open_price * 100)::numeric, 2)
        ELSE 0 
      END,
      'price_range_pct',
      CASE 
        WHEN NEW.low_price > 0 THEN 
          ROUND(((NEW.high_price - NEW.low_price) / NEW.low_price * 100)::numeric, 2)
        ELSE 0 
      END
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_price_changes_trigger
BEFORE INSERT ON public.price_data
FOR EACH ROW
EXECUTE FUNCTION public.calculate_price_changes();