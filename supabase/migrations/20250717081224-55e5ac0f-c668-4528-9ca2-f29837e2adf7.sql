-- Create categories management table
CREATE TABLE public.ai_data_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_name TEXT NOT NULL UNIQUE,
  category_type TEXT NOT NULL,
  description TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  importance_score NUMERIC NOT NULL DEFAULT 0.5,
  confidence_level NUMERIC NOT NULL DEFAULT 0.5,
  last_performance_update TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create category performance tracking table
CREATE TABLE public.ai_category_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID NOT NULL REFERENCES public.ai_data_categories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  winning_trades INTEGER NOT NULL DEFAULT 0,
  total_trades INTEGER NOT NULL DEFAULT 0,
  profit_impact NUMERIC NOT NULL DEFAULT 0,
  accuracy_score NUMERIC NOT NULL DEFAULT 0,
  influence_weight NUMERIC NOT NULL DEFAULT 0,
  market_condition TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Update ai_data_sources to link to categories
ALTER TABLE public.ai_data_sources 
ADD COLUMN category_id UUID REFERENCES public.ai_data_categories(id);

-- Add category context to external market data
ALTER TABLE public.external_market_data
ADD COLUMN category_context JSONB DEFAULT '{}';

-- Enable RLS on new tables
ALTER TABLE public.ai_data_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_category_performance ENABLE ROW LEVEL SECURITY;

-- RLS policies for categories (admin-only management)
CREATE POLICY "Only admins can manage data categories" 
ON public.ai_data_categories 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view enabled categories" 
ON public.ai_data_categories 
FOR SELECT 
USING (is_enabled = true);

-- RLS policies for category performance
CREATE POLICY "Users can view their own category performance" 
ON public.ai_category_performance 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "System can insert category performance" 
ON public.ai_category_performance 
FOR INSERT 
WITH CHECK (true);

-- Insert default categories
INSERT INTO public.ai_data_categories (category_name, category_type, description, is_enabled) VALUES
('Social Sentiment', 'sentiment', 'Market sentiment and social media analysis', true),
('Whale Activity', 'whale_tracking', 'Large transaction monitoring and whale movements', true),
('Institutional Flow', 'institutional', 'Institutional buying/selling patterns', true),
('Market Fear & Greed', 'sentiment', 'Fear and greed index analysis', true),
('Technical Indicators', 'technical', 'Traditional technical analysis signals', true);

-- Create indexes for performance
CREATE INDEX idx_ai_category_performance_user_period ON public.ai_category_performance(user_id, period_start, period_end);
CREATE INDEX idx_ai_category_performance_category ON public.ai_category_performance(category_id);
CREATE INDEX idx_ai_data_sources_category ON public.ai_data_sources(category_id);
CREATE INDEX idx_external_market_data_category_context ON public.external_market_data USING GIN(category_context);

-- Create trigger for updating category updated_at
CREATE TRIGGER update_ai_data_categories_updated_at
  BEFORE UPDATE ON public.ai_data_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Update existing data sources with categories
UPDATE public.ai_data_sources 
SET category_id = (
  SELECT id FROM public.ai_data_categories 
  WHERE category_name = 
    CASE 
      WHEN source_name = 'fear_greed_index' THEN 'Market Fear & Greed'
      WHEN source_name = 'whale_alerts' THEN 'Whale Activity'
      WHEN source_name = 'arkham_intelligence' THEN 'Institutional Flow'
      WHEN source_name = 'coinbase_institutional' THEN 'Institutional Flow'
      ELSE 'Technical Indicators'
    END
);