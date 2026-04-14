INSERT INTO signal_registry (key, category, description, default_weight, min_weight, max_weight, direction_hint, timeframe_hint, is_enabled)
VALUES (
  'mean_reversion_bullish',
  'technical',
  'Composite signal: RSI oversold + MA cross bearish = dip-buying opportunity (mean reversion)',
  1.3,
  0.5,
  2.0,
  'bullish',
  'short',
  true
)
ON CONFLICT (key) DO UPDATE SET
  default_weight = EXCLUDED.default_weight,
  direction_hint = EXCLUDED.direction_hint,
  description = EXCLUDED.description,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();