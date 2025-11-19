-- ============================================
-- Phase 1: Strategy Parameters Table
-- ============================================

-- Create strategy_parameters table for agentic optimization
CREATE TABLE IF NOT EXISTS public.strategy_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES public.trading_strategies(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  
  -- Trading parameters (with safety constraints)
  tp_pct NUMERIC NOT NULL DEFAULT 1.5 CHECK (tp_pct >= 0.3 AND tp_pct <= 50),
  sl_pct NUMERIC NOT NULL DEFAULT 0.8 CHECK (sl_pct >= 0.1 AND sl_pct <= 15),
  min_confidence NUMERIC NOT NULL DEFAULT 0.6 CHECK (min_confidence >= 0.1 AND min_confidence <= 0.90),
  
  -- Signal weights
  technical_weight NUMERIC NOT NULL DEFAULT 0.5 CHECK (technical_weight >= 0 AND technical_weight <= 1),
  ai_weight NUMERIC NOT NULL DEFAULT 0.5 CHECK (ai_weight >= 0 AND ai_weight <= 1),
  
  -- Audit and tracking
  last_updated_by TEXT NOT NULL DEFAULT 'manual',
  last_optimizer_run_at TIMESTAMPTZ,
  optimization_iteration INTEGER NOT NULL DEFAULT 0,
  
  -- Metadata for optimizer decisions
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Ensure one config per strategy+symbol
  UNIQUE(strategy_id, symbol)
);

-- Enable RLS
ALTER TABLE public.strategy_parameters ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own strategy parameters"
  ON public.strategy_parameters
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own strategy parameters"
  ON public.strategy_parameters
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own strategy parameters"
  ON public.strategy_parameters
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can manage all strategy parameters"
  ON public.strategy_parameters
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER set_updated_at_strategy_parameters
  BEFORE UPDATE ON public.strategy_parameters
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for fast lookups
CREATE INDEX idx_strategy_parameters_strategy_symbol 
  ON public.strategy_parameters(strategy_id, symbol);

CREATE INDEX idx_strategy_parameters_user 
  ON public.strategy_parameters(user_id);

-- Add comment
COMMENT ON TABLE public.strategy_parameters IS 
  'Stores dynamic trading parameters optimized by the AI optimization loop. Parameters are constrained by safety rules.';
