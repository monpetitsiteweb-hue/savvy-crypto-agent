-- Create AI knowledge base for learning system
CREATE TABLE public.ai_knowledge_base (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  knowledge_type TEXT NOT NULL, -- 'market_pattern', 'trading_strategy', 'performance_insight', 'risk_assessment'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 0.5 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  data_points INTEGER NOT NULL DEFAULT 1, -- Number of trades/events this insight is based on
  last_validated_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create performance metrics tracking
CREATE TABLE public.ai_learning_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  metric_type TEXT NOT NULL, -- 'win_rate_improvement', 'risk_optimization', 'market_prediction_accuracy'
  metric_value NUMERIC NOT NULL,
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  trades_analyzed INTEGER NOT NULL DEFAULT 0,
  insights_generated INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_learning_metrics ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can manage their own AI knowledge"
ON public.ai_knowledge_base
FOR ALL
USING (user_id = auth.uid());

CREATE POLICY "Users can view their own learning metrics"
ON public.ai_learning_metrics
FOR ALL
USING (user_id = auth.uid());

-- Create indexes for performance
CREATE INDEX idx_ai_knowledge_user_type ON public.ai_knowledge_base(user_id, knowledge_type);
CREATE INDEX idx_ai_knowledge_confidence ON public.ai_knowledge_base(confidence_score DESC);
CREATE INDEX idx_ai_learning_metrics_user ON public.ai_learning_metrics(user_id, metric_type);

-- Create trigger for updated_at
CREATE TRIGGER update_ai_knowledge_updated_at
BEFORE UPDATE ON public.ai_knowledge_base
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();