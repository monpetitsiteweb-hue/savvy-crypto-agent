-- 1. is_archived flag
ALTER TABLE public.mock_trades
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_mock_trades_is_archived_false
  ON public.mock_trades (is_archived)
  WHERE is_archived = false;

-- 2. Archive table mirror + indexes + RLS
CREATE TABLE IF NOT EXISTS public.mock_trade_attempts_failed
  (LIKE public.mock_trades INCLUDING ALL);

ALTER TABLE public.mock_trade_attempts_failed
  ADD COLUMN IF NOT EXISTS archived_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archive_reason   text        NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS archived_by_run  uuid;

CREATE INDEX IF NOT EXISTS idx_mtaf_user_id        ON public.mock_trade_attempts_failed (user_id);
CREATE INDEX IF NOT EXISTS idx_mtaf_original_trade ON public.mock_trade_attempts_failed (original_trade_id);
CREATE INDEX IF NOT EXISTS idx_mtaf_archived_at    ON public.mock_trade_attempts_failed (archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_mtaf_archive_reason ON public.mock_trade_attempts_failed (archive_reason);

ALTER TABLE public.mock_trade_attempts_failed ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access mtaf" ON public.mock_trade_attempts_failed;
CREATE POLICY "Service role full access mtaf"
  ON public.mock_trade_attempts_failed
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users read own archived attempts" ON public.mock_trade_attempts_failed;
CREATE POLICY "Users read own archived attempts"
  ON public.mock_trade_attempts_failed
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 3. archive_run_log (admin-only SELECT)
CREATE TABLE IF NOT EXISTS public.archive_run_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_kind      text        NOT NULL,
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  rows_affected integer     NOT NULL DEFAULT 0,
  dry_run       boolean     NOT NULL DEFAULT false,
  details       jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_arl_run_kind_time
  ON public.archive_run_log (run_kind, triggered_at DESC);

ALTER TABLE public.archive_run_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access arl" ON public.archive_run_log;
CREATE POLICY "Service role full access arl"
  ON public.archive_run_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins read archive_run_log" ON public.archive_run_log;
CREATE POLICY "Admins read archive_run_log"
  ON public.archive_run_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 4. Views (explicit columns in UNION)
CREATE OR REPLACE VIEW public.mock_trades_active_v AS
  SELECT * FROM public.mock_trades WHERE is_archived = false;

CREATE OR REPLACE VIEW public.mock_trades_archive_v AS
  SELECT * FROM public.mock_trade_attempts_failed;

DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'mock_trades';

  EXECUTE format($v$
    CREATE OR REPLACE VIEW public.mock_trades_with_archive_v AS
      SELECT %s, 'mock_trades'::text AS _source FROM public.mock_trades
      UNION ALL
      SELECT %s, 'mock_trade_attempts_failed'::text AS _source
        FROM public.mock_trade_attempts_failed
  $v$, cols, cols);
END $$;

-- 5. archive_failed_attempts (CTE, deterministic)
CREATE OR REPLACE FUNCTION public.archive_failed_attempts(p_dry_run boolean DEFAULT true)
RETURNS TABLE(rows_archived integer, p1_count integer, p2_count integer, run_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_p1     integer := 0;
  v_p2     integer := 0;
  v_total  integer := 0;
BEGIN
  IF p_dry_run THEN
    WITH eligible AS (
      SELECT id,
        CASE
          WHEN execution_source = 'onchain_failed'
               AND COALESCE(execution_ts, executed_at) < now() - interval '1 hour'
            THEN 'P1_failed_attempt'
          WHEN execution_source = 'onchain_pending'
               AND tx_hash IS NULL
               AND execution_confirmed = false
               AND COALESCE(execution_ts, executed_at) < now() - interval '7 days'
            THEN 'P2_stale_pending_no_tx'
        END AS reason
      FROM public.mock_trades
      WHERE is_archived = false
        AND COALESCE(is_test_mode, false) = false
    )
    SELECT
      COUNT(*) FILTER (WHERE reason = 'P1_failed_attempt'),
      COUNT(*) FILTER (WHERE reason = 'P2_stale_pending_no_tx'),
      COUNT(*) FILTER (WHERE reason IS NOT NULL)
      INTO v_p1, v_p2, v_total
    FROM eligible;

    INSERT INTO public.archive_run_log(id, run_kind, finished_at, rows_affected, dry_run, details)
      VALUES (v_run_id, 'archive_failed_attempts', now(), v_total, true,
              jsonb_build_object('p1', v_p1, 'p2', v_p2));

    RETURN QUERY SELECT v_total, v_p1, v_p2, v_run_id;
    RETURN;
  END IF;

  WITH eligible AS (
    SELECT m.*,
      CASE
        WHEN execution_source = 'onchain_failed'
             AND COALESCE(execution_ts, executed_at) < now() - interval '1 hour'
          THEN 'P1_failed_attempt'
        WHEN execution_source = 'onchain_pending'
             AND tx_hash IS NULL
             AND execution_confirmed = false
             AND COALESCE(execution_ts, executed_at) < now() - interval '7 days'
          THEN 'P2_stale_pending_no_tx'
      END AS reason
    FROM public.mock_trades m
    WHERE is_archived = false
      AND COALESCE(is_test_mode, false) = false
  ),
  picked AS (
    SELECT * FROM eligible WHERE reason IS NOT NULL
  ),
  inserted AS (
    INSERT INTO public.mock_trade_attempts_failed
    SELECT p.*, now() AS archived_at, p.reason AS archive_reason, v_run_id AS archived_by_run
    FROM picked p
    RETURNING id, archive_reason
  ),
  flagged AS (
    UPDATE public.mock_trades
       SET is_archived = true
     WHERE id IN (SELECT id FROM inserted)
    RETURNING id
  )
  SELECT
    (SELECT COUNT(*) FROM inserted WHERE archive_reason = 'P1_failed_attempt'),
    (SELECT COUNT(*) FROM inserted WHERE archive_reason = 'P2_stale_pending_no_tx'),
    (SELECT COUNT(*) FROM flagged)
    INTO v_p1, v_p2, v_total;

  INSERT INTO public.archive_run_log(id, run_kind, finished_at, rows_affected, dry_run, details)
    VALUES (v_run_id, 'archive_failed_attempts', now(), v_total, false,
            jsonb_build_object('p1', v_p1, 'p2', v_p2));

  RETURN QUERY SELECT v_total, v_p1, v_p2, v_run_id;
END;
$$;

-- 6. unarchive_for_late_settlement
CREATE OR REPLACE FUNCTION public.unarchive_for_late_settlement(p_trade_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.mock_trade_attempts_failed WHERE id = p_trade_id)
    INTO v_exists;
  IF NOT v_exists THEN RETURN false; END IF;

  UPDATE public.mock_trades SET is_archived = false WHERE id = p_trade_id;
  DELETE FROM public.mock_trade_attempts_failed WHERE id = p_trade_id;

  INSERT INTO public.archive_run_log(run_kind, finished_at, rows_affected, dry_run, details)
    VALUES ('unarchive_for_late_settlement', now(), 1, false,
            jsonb_build_object('trade_id', p_trade_id));
  RETURN true;
END;
$$;

-- 7. pg_cron daily archival at 03:00 UTC
DO $$
BEGIN
  PERFORM cron.unschedule('mock-trades-archive-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'mock-trades-archive-daily',
  '0 3 * * *',
  $cron$ SELECT public.archive_failed_attempts(false); $cron$
);