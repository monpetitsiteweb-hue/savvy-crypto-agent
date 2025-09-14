-- Phase 1 Learning Loop — integrity, perf, secure scheduling

-- 1) De-dup: keep newest per (decision_id, horizon)
DELETE FROM public.decision_outcomes o
USING public.decision_outcomes newer
WHERE o.decision_id = newer.decision_id
  AND o.horizon = newer.horizon
  AND o.created_at < newer.created_at;

-- 2) Remove orphans
DELETE FROM public.decision_outcomes
WHERE decision_id NOT IN (SELECT id FROM public.decision_events);

-- 3) Constraints (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'decision_outcomes_decision_id_horizon_key'
  ) THEN
    ALTER TABLE public.decision_outcomes
      ADD CONSTRAINT decision_outcomes_decision_id_horizon_key
      UNIQUE (decision_id, horizon);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'decision_outcomes_decision_id_fkey'
  ) THEN
    ALTER TABLE public.decision_outcomes
      ADD CONSTRAINT decision_outcomes_decision_id_fkey
      FOREIGN KEY (decision_id) REFERENCES public.decision_events(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4) Performance indexes used by UI + evaluator
CREATE INDEX IF NOT EXISTS idx_decision_events_user_ts
  ON public.decision_events (user_id, decision_ts DESC);

CREATE INDEX IF NOT EXISTS idx_decision_outcomes_user_evaluated
  ON public.decision_outcomes (user_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_symbol_ts
  ON public.price_snapshots (symbol, ts);

-- 5) Safely unschedule any prior evaluator jobs
DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('decision-evaluator');          EXCEPTION WHEN OTHERS THEN END;
  BEGIN PERFORM cron.unschedule('invoke-decision-evaluator');   EXCEPTION WHEN OTHERS THEN END;
  BEGIN PERFORM cron.unschedule('decision_evaluator_job');      EXCEPTION WHEN OTHERS THEN END;
  BEGIN PERFORM cron.unschedule('decision-evaluator-secure');   EXCEPTION WHEN OTHERS THEN END;
END $$;

-- 6) Schedule evaluator every 5 min — fetch CRON_SECRET at runtime (not stored in job)
SELECT cron.schedule(
  'decision-evaluator-secure',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/decision-evaluator',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := jsonb_build_object('scheduled', true, 'timestamp', now())
  );
  $$
);