-- Add technical indicator columns to market_features_v0
-- RSI, MACD, and EMA indicators for trading engine consumption

ALTER TABLE public.market_features_v0 
ADD COLUMN IF NOT EXISTS rsi_14 numeric,
ADD COLUMN IF NOT EXISTS macd_line numeric,
ADD COLUMN IF NOT EXISTS macd_signal numeric,
ADD COLUMN IF NOT EXISTS macd_hist numeric,
ADD COLUMN IF NOT EXISTS ema_20 numeric,
ADD COLUMN IF NOT EXISTS ema_50 numeric,
ADD COLUMN IF NOT EXISTS ema_200 numeric,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Add comment for documentation
COMMENT ON COLUMN public.market_features_v0.rsi_14 IS 'RSI with 14-period Wilder smoothing';
COMMENT ON COLUMN public.market_features_v0.macd_line IS 'MACD line = EMA(12) - EMA(26)';
COMMENT ON COLUMN public.market_features_v0.macd_signal IS 'MACD signal = EMA(9) of MACD line';
COMMENT ON COLUMN public.market_features_v0.macd_hist IS 'MACD histogram = macd_line - macd_signal';
COMMENT ON COLUMN public.market_features_v0.ema_20 IS 'Exponential Moving Average (20 periods)';
COMMENT ON COLUMN public.market_features_v0.ema_50 IS 'Exponential Moving Average (50 periods)';
COMMENT ON COLUMN public.market_features_v0.ema_200 IS 'Exponential Moving Average (200 periods)';
COMMENT ON COLUMN public.market_features_v0.updated_at IS 'Last update timestamp';