-- B1 Step 1: Backup live_signals
CREATE TABLE IF NOT EXISTS public.live_signals_backup_20260327 AS
SELECT * FROM public.live_signals;

-- B1 Step 2: Normalized view for EDA/ML analysis
CREATE OR REPLACE VIEW public.live_signals_normalized AS
SELECT *,
  CASE
    WHEN symbol IN ('BTC','ETH','XRP','SOL','ADA','AVAX',
                    'DOT','LINK','LTC','BCH')
    THEN symbol || '-EUR'
    ELSE symbol
  END AS symbol_normalized
FROM public.live_signals;