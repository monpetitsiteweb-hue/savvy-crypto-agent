-- Phase 2: Insert missing signal types into signal_registry
INSERT INTO signal_registry (key, category, default_weight, direction_hint, is_enabled) VALUES
  ('whale_large_movement', 'whale', 1.2, 'symmetric', true),
  ('momentum_neutral', 'technical', 0.3, 'symmetric', true),
  ('trend_bearish', 'technical', 1.0, 'bearish', true),
  ('trend_bullish', 'technical', 1.0, 'bullish', true),
  ('momentum_bullish', 'technical', 1.0, 'bullish', true),
  ('ma_momentum_bearish', 'technical', 0.9, 'bearish', true)
ON CONFLICT (key) DO NOTHING;