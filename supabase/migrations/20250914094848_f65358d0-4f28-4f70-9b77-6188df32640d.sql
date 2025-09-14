-- Clean up duplicate decision outcomes (keep newest per decision_id, horizon)
DELETE FROM public.decision_outcomes o
USING public.decision_outcomes newer
WHERE o.decision_id = newer.decision_id
  AND o.horizon = newer.horizon
  AND o.created_at < newer.created_at;

-- Clean up orphaned decision outcomes (no matching decision_events)
DELETE FROM public.decision_outcomes
WHERE decision_id NOT IN (SELECT id FROM public.decision_events);

-- Idempotently add unique constraint on decision_outcomes (decision_id, horizon)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'decision_outcomes_decision_id_horizon_key'
  ) THEN
    ALTER TABLE public.decision_outcomes 
    ADD CONSTRAINT decision_outcomes_decision_id_horizon_key 
    UNIQUE (decision_id, horizon);
  END IF;
END $$;

-- Idempotently add foreign key from decision_outcomes to decision_events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'decision_outcomes_decision_id_fkey'
  ) THEN
    ALTER TABLE public.decision_outcomes 
    ADD CONSTRAINT decision_outcomes_decision_id_fkey 
    FOREIGN KEY (decision_id) REFERENCES public.decision_events(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_decision_events_decision_ts ON public.decision_events(decision_ts);
CREATE INDEX IF NOT EXISTS idx_decision_events_symbol ON public.decision_events(symbol);
CREATE INDEX IF NOT EXISTS idx_decision_outcomes_decision_id ON public.decision_outcomes(decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_outcomes_horizon ON public.decision_outcomes(horizon);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_symbol_ts ON public.price_snapshots(symbol, ts);

-- Unschedule any existing decision evaluator cron jobs
SELECT cron.unschedule('decision-evaluator');
SELECT cron.unschedule('invoke-decision-evaluator');
SELECT cron.unschedule('decision_evaluator_job');

-- Schedule the decision evaluator to run every 5 minutes with secure authentication
DO $$
DECLARE
  cron_secret text;
BEGIN
  -- Read CRON_SECRET from vault
  SELECT decrypted_secret INTO cron_secret 
  FROM vault.decrypted_secrets 
  WHERE name = 'CRON_SECRET';
  
  IF cron_secret IS NOT NULL THEN
    PERFORM cron.schedule(
      'decision-evaluator-secure',
      '*/5 * * * *', -- every 5 minutes
      format(
        'SELECT net.http_post(
          url := ''https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/decision-evaluator'',
          headers := ''{"Content-Type": "application/json", "x-cron-secret": "%s"}''::jsonb,
          body := ''{"scheduled": true, "timestamp": "%s"}''::jsonb
        );',
        cron_secret,
        now()::text
      )
    );
  ELSE
    RAISE EXCEPTION 'CRON_SECRET not found in vault.decrypted_secrets';
  END IF;
END $$;