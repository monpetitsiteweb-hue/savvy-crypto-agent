-- Create signal_registry table
CREATE TABLE IF NOT EXISTS public.signal_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  category text NOT NULL,
  description text,
  default_weight numeric NOT NULL DEFAULT 1.0,
  min_weight numeric NOT NULL DEFAULT 0.0,
  max_weight numeric NOT NULL DEFAULT 3.0,
  direction_hint text NOT NULL DEFAULT 'symmetric',
  timeframe_hint text NOT NULL DEFAULT 'multi',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add trigger for updated_at
CREATE TRIGGER set_signal_registry_updated_at
  BEFORE UPDATE ON public.signal_registry
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Pre-populate with existing signal types from live_signals
INSERT INTO public.signal_registry (key, category, description, default_weight, direction_hint, timeframe_hint) VALUES
  ('ma_cross_bullish', 'technical', 'Moving average bullish crossover', 1.2, 'bullish', '1h'),
  ('ma_cross_bearish', 'technical', 'Moving average bearish crossover', 1.2, 'bearish', '1h'),
  ('rsi_oversold_bullish', 'technical', 'RSI oversold condition (bullish signal)', 1.0, 'bullish', '4h'),
  ('rsi_overbought_bearish', 'technical', 'RSI overbought condition (bearish signal)', 1.0, 'bearish', '4h'),
  ('volume_spike', 'technical', 'Unusual volume spike detected', 0.8, 'symmetric', '15m'),
  ('ma_momentum_bearish', 'technical', 'Moving average momentum bearish', 0.9, 'bearish', '1h'),
  ('fear_index_extreme', 'sentiment', 'Extreme fear (<20) - contrarian bullish', 1.5, 'bullish', '24h'),
  ('fear_index_moderate', 'sentiment', 'Moderate fear (20-45)', 0.6, 'bullish', '24h'),
  ('greed_index_moderate', 'sentiment', 'Moderate greed (55-80)', 0.6, 'bearish', '24h'),
  ('sentiment_bullish_strong', 'sentiment', 'Strong bullish news sentiment', 1.3, 'bullish', '4h'),
  ('sentiment_bearish_strong', 'sentiment', 'Strong bearish news sentiment', 1.3, 'bearish', '4h'),
  ('sentiment_bullish_moderate', 'sentiment', 'Moderate bullish news sentiment', 0.7, 'bullish', '4h'),
  ('sentiment_bearish_moderate', 'sentiment', 'Moderate bearish news sentiment', 0.7, 'bearish', '4h'),
  ('sentiment_mixed_bullish', 'sentiment', 'Mixed sentiment leaning bullish', 0.5, 'bullish', '4h'),
  ('news_volume_high', 'sentiment', 'High news volume', 0.4, 'symmetric', '1h'),
  ('news_volume_spike', 'sentiment', 'Sudden news volume spike', 0.6, 'symmetric', '15m'),
  ('price_breakout_bullish', 'technical', 'Price breakout above resistance', 1.4, 'bullish', '1h'),
  ('price_breakout_bearish', 'technical', 'Price breakdown below support', 1.4, 'bearish', '1h'),
  ('price_sentiment_combo', 'sentiment', 'Combined price and sentiment signal', 1.1, 'contextual', '4h')
ON CONFLICT (key) DO NOTHING;

-- Enable RLS
ALTER TABLE public.signal_registry ENABLE ROW LEVEL SECURITY;

-- Admin can manage signal registry
CREATE POLICY "Admin can manage signal registry"
  ON public.signal_registry
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Authenticated users can read signal registry
CREATE POLICY "Users can read signal registry"
  ON public.signal_registry
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Create strategy_signal_weights table for per-strategy overrides
CREATE TABLE IF NOT EXISTS public.strategy_signal_weights (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_id uuid NOT NULL REFERENCES public.trading_strategies(id) ON DELETE CASCADE,
  signal_key text NOT NULL REFERENCES public.signal_registry(key) ON DELETE CASCADE,
  weight numeric,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, signal_key)
);

-- Add trigger for updated_at
CREATE TRIGGER set_strategy_signal_weights_updated_at
  BEFORE UPDATE ON public.strategy_signal_weights
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.strategy_signal_weights ENABLE ROW LEVEL SECURITY;

-- Users can manage their own strategy signal weights
CREATE POLICY "Users can manage their strategy signal weights"
  ON public.strategy_signal_weights
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.trading_strategies
      WHERE trading_strategies.id = strategy_signal_weights.strategy_id
      AND trading_strategies.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trading_strategies
      WHERE trading_strategies.id = strategy_signal_weights.strategy_id
      AND trading_strategies.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.signal_registry IS 'Registry of all signal types with metadata and default weights';
COMMENT ON TABLE public.strategy_signal_weights IS 'Per-strategy signal weight overrides';
