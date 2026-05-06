CREATE OR REPLACE FUNCTION public.archive_failed_attempts(p_dry_run boolean DEFAULT true)
RETURNS TABLE(rows_archived integer, p1_count integer, p2_count integer, run_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_p1     integer := 0;
  v_p2     integer := 0;
  v_total  integer := 0;
  v_cols   text;
  v_cols_prefixed text;
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
      COUNT(*) FILTER (WHERE reason = 'P1_failed_attempt')::int,
      COUNT(*) FILTER (WHERE reason = 'P2_stale_pending_no_tx')::int,
      COUNT(*) FILTER (WHERE reason IS NOT NULL)::int
      INTO v_p1, v_p2, v_total
    FROM eligible;

    INSERT INTO public.archive_run_log(id, run_kind, finished_at, rows_affected, dry_run, details)
      VALUES (v_run_id, 'archive_failed_attempts', now(), v_total, true,
              jsonb_build_object('p1', v_p1, 'p2', v_p2));

    RETURN QUERY SELECT v_total, v_p1, v_p2, v_run_id;
    RETURN;
  END IF;

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
         string_agg('m.' || quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols, v_cols_prefixed
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'mock_trades';

  CREATE TEMP TABLE IF NOT EXISTS _archive_workset (
    run_id uuid, id uuid, reason text
  ) ON COMMIT DROP;

  INSERT INTO _archive_workset (run_id, id, reason)
  SELECT v_run_id, m.id,
    CASE
      WHEN execution_source = 'onchain_failed'
           AND COALESCE(execution_ts, executed_at) < now() - interval '1 hour'
        THEN 'P1_failed_attempt'
      WHEN execution_source = 'onchain_pending'
           AND tx_hash IS NULL
           AND execution_confirmed = false
           AND COALESCE(execution_ts, executed_at) < now() - interval '7 days'
        THEN 'P2_stale_pending_no_tx'
    END
  FROM public.mock_trades m
  WHERE m.is_archived = false
    AND COALESCE(m.is_test_mode, false) = false;

  DELETE FROM _archive_workset WHERE run_id = v_run_id AND reason IS NULL;

  EXECUTE format($q$
    INSERT INTO public.mock_trade_attempts_failed (%s, archived_at, archive_reason, archived_by_run)
    SELECT %s, now(), w.reason, %L::uuid
      FROM public.mock_trades m
      JOIN _archive_workset w ON w.id = m.id AND w.run_id = %L::uuid
  $q$, v_cols, v_cols_prefixed, v_run_id, v_run_id);

  GET DIAGNOSTICS v_total = ROW_COUNT;

  UPDATE public.mock_trades
     SET is_archived = true
   WHERE id IN (SELECT id FROM _archive_workset WHERE run_id = v_run_id);

  SELECT COUNT(*) FILTER (WHERE reason = 'P1_failed_attempt')::int,
         COUNT(*) FILTER (WHERE reason = 'P2_stale_pending_no_tx')::int
    INTO v_p1, v_p2
  FROM _archive_workset
  WHERE run_id = v_run_id;

  INSERT INTO public.archive_run_log(id, run_kind, finished_at, rows_affected, dry_run, details)
    VALUES (v_run_id, 'archive_failed_attempts', now(), v_total, false,
            jsonb_build_object('p1', v_p1, 'p2', v_p2));

  RETURN QUERY SELECT v_total, v_p1, v_p2, v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_failed_attempts(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_failed_attempts(boolean) TO service_role;