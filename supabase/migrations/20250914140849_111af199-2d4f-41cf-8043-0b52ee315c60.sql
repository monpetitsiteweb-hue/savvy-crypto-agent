-- Phase 2: Complete calibration system migration

-- Tables
CREATE TABLE IF NOT EXISTS public.calibration_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  horizon TEXT NOT NULL CHECK (horizon IN ('15m','1h','4h','24h')),
  time_window TEXT NOT NULL CHECK (time_window IN ('7d','30d','90d')),
  confidence_band TEXT NOT NULL CHECK (confidence_band IN ('[0.50-0.60)','[0.60-0.70)','[0.70-0.80)','[0.80-0.90)','[0.90-1.00]')),
  sample_count INTEGER NOT NULL DEFAULT 0,
  coverage_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  win_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  median_realized_pnl_pct NUMERIC(8,4),
  mean_realized_pnl_pct NUMERIC(8,4),
  median_mfe_pct NUMERIC(8,4),
  median_mae_pct NUMERIC(8,4),
  tp_hit_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  sl_hit_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  missed_opportunity_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  mean_expectation_error_pct NUMERIC(8,4),
  reliability_correlation NUMERIC(6,4),
  volatility_regime TEXT,
  window_start_ts TIMESTAMPTZ NOT NULL,
  window_end_ts   TIMESTAMPTZ NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, strategy_id, symbol, horizon, time_window, confidence_band)
);

CREATE TABLE IF NOT EXISTS public.calibration_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  horizon TEXT NOT NULL,
  suggestion_type TEXT NOT NULL CHECK (suggestion_type IN ('confidence_threshold','tp_adjustment','sl_adjustment','hold_period','cooldown')),
  current_value NUMERIC(8,4),
  suggested_value NUMERIC(8,4),
  expected_impact_pct NUMERIC(6,2),
  reason TEXT NOT NULL,
  confidence_score NUMERIC(4,2) NOT NULL DEFAULT 0.5,
  sample_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','dismissed')),
  applied_by UUID,
  applied_at TIMESTAMPTZ,
  dismissed_by UUID,
  dismissed_at TIMESTAMPTZ,
  based_on_window TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Guard: updated_at trigger helper
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;$f$;
  END IF;
END $$;

-- Triggers
DROP TRIGGER IF EXISTS update_calibration_metrics_updated_at ON public.calibration_metrics;
CREATE TRIGGER update_calibration_metrics_updated_at
  BEFORE UPDATE ON public.calibration_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_calibration_suggestions_updated_at ON public.calibration_suggestions;
CREATE TRIGGER update_calibration_suggestions_updated_at
  BEFORE UPDATE ON public.calibration_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.calibration_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calibration_suggestions ENABLE ROW LEVEL SECURITY;

-- RLS policies
-- calibration_metrics: owners can read their own rows
DROP POLICY IF EXISTS "Users can view their own calibration metrics" ON public.calibration_metrics;
CREATE POLICY "Users can view their own calibration metrics"
  ON public.calibration_metrics FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- calibration_suggestions: owners can read their own rows
DROP POLICY IF EXISTS "Users can view their own suggestions" ON public.calibration_suggestions;
CREATE POLICY "Users can view their own suggestions"
  ON public.calibration_suggestions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- calibration_suggestions: admins can manage
DROP POLICY IF EXISTS "Admins can manage suggestions" ON public.calibration_suggestions;
CREATE POLICY "Admins can manage suggestions"
  ON public.calibration_suggestions FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calibration_metrics_user_strategy
  ON public.calibration_metrics (user_id, strategy_id);

CREATE INDEX IF NOT EXISTS idx_calibration_metrics_lookup
  ON public.calibration_metrics (user_id, strategy_id, symbol, horizon, time_window);

CREATE INDEX IF NOT EXISTS idx_calibration_suggestions_user_status
  ON public.calibration_suggestions (user_id, status);

-- Cron job (02:00 UTC)
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('daily-calibration-aggregation');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

SELECT cron.schedule(
  'daily-calibration-aggregation',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/calibration-aggregator',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'x-cron-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := jsonb_build_object('scheduled', true, 'timestamp', now())
  );
  $$
);