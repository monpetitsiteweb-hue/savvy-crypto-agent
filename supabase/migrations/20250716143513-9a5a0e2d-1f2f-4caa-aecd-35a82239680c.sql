-- Create external data sources configuration
CREATE TABLE public.ai_data_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  source_name TEXT NOT NULL, -- 'arkham_intelligence', 'coinbase_institutional', 'fear_greed_index', etc.
  source_type TEXT NOT NULL, -- 'blockchain_analytics', 'institutional_tracking', 'sentiment', 'market_data'
  api_endpoint TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  update_frequency TEXT NOT NULL DEFAULT 'daily', -- 'hourly', 'daily', 'weekly'
  configuration JSONB DEFAULT '{}', -- API keys, filters, etc.
  last_sync TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create external data storage
CREATE TABLE public.external_market_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES public.ai_data_sources(id) ON DELETE CASCADE,
  data_type TEXT NOT NULL, -- 'whale_transaction', 'institutional_flow', 'sentiment_score', 'price_prediction'
  entity TEXT, -- 'blackrock', 'trump', 'microstrategy', etc.
  cryptocurrency TEXT,
  data_value NUMERIC,
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_market_data ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can manage their own data sources"
ON public.ai_data_sources
FOR ALL
USING (user_id = auth.uid());

CREATE POLICY "Users can view their external market data"
ON public.external_market_data
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.ai_data_sources 
    WHERE id = external_market_data.source_id 
    AND user_id = auth.uid()
  )
);

-- Create indexes
CREATE INDEX idx_ai_data_sources_user ON public.ai_data_sources(user_id, is_active);
CREATE INDEX idx_external_market_data_source ON public.external_market_data(source_id, timestamp DESC);
CREATE INDEX idx_external_market_data_entity ON public.external_market_data(entity, cryptocurrency);

-- Create triggers
CREATE TRIGGER update_ai_data_sources_updated_at
BEFORE UPDATE ON public.ai_data_sources
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();