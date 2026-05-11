CREATE OR REPLACE FUNCTION public.archive_failed_attempts(p_dry_run boolean DEFAULT true)
 RETURNS TABLE(rows_archived integer, p1_count integer, p2_count integer, run_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
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
      SELECT m.id,
        CASE
          WHEN m.execution_source = 'onchain_failed'
               AND COALESCE(m.execution_ts, m.executed_at) < now() - interval '1 hour'
            THEN 'P1_failed_attempt'
          WHEN m.execution_source = 'onchain_pending'
               AND m.tx_hash IS NULL
               AND m.execution_confirmed = false
               AND COALESCE(m.execution_ts, m.executed_at) < now() - interval '7 days'
            THEN 'P2_stale_pending_no_tx'
        END AS reason
      FROM public.mock_trades AS m
      WHERE m.is_archived = false
        AND COALESCE(m.is_test_mode, false) = false
        AND NOT EXISTS (
          SELECT 1 FROM public.mock_trades s
          WHERE s.original_trade_id = m.id
            AND s.is_archived = false
            AND s.trade_type = 'sell'
        )
    )
    SELECT
      COUNT(*) FILTER (WHERE eligible.reason = 'P1_failed_attempt')::int,
      COUNT(*) FILTER (WHERE eligible.reason = 'P2_stale_pending_no_tx')::int,
      COUNT(*) FILTER (WHERE eligible.reason IS NOT NULL)::int
      INTO v_p1, v_p2, v_total
    FROM eligible;

    INSERT INTO public.archive_run_log(id, run_kind, finished_at, rows_affected, dry_run, details)
      VALUES (v_run_id, 'archive_failed_attempts', now(), v_total, true,
              jsonb_build_object('p1', v_p1, 'p2', v_p2));

    RETURN QUERY SELECT v_total, v_p1, v_p2, v_run_id;
    RETURN;
  END IF;

  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
         string_agg('m.' || quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_cols, v_cols_prefixed
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name   = 'mock_trades';

  CREATE TEMP TABLE IF NOT EXISTS _archive_workset (
    run_id uuid, id uuid, reason text
  ) ON COMMIT DROP;

  INSERT INTO _archive_workset (run_id, id, reason)
  SELECT v_run_id, m.id,
    CASE
      WHEN m.execution_source = 'onchain_failed'
           AND COALESCE(m.execution_ts, m.executed_at) < now() - interval '1 hour'
        THEN 'P1_failed_attempt'
      WHEN m.execution_source = 'onchain_pending'
           AND m.tx_hash IS NULL
           AND m.execution_confirmed = false
           AND COALESCE(m.execution_ts, m.executed_at) < now() - interval '7 days'
        THEN 'P2_stale_pending_no_tx'
    END
  FROM public.mock_trades AS m
  WHERE m.is_archived = false
    AND COALESCE(m.is_test_mode, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.mock_trades s
      WHERE s.original_trade_id = m.id
        AND s.is_archived = false
        AND s.trade_type = 'sell'
    );

  DELETE FROM _archive_workset AS w
   WHERE w.run_id = v_run_id
     AND w.reason IS NULL;

  EXECUTE format($q$
    INSERT INTO public.mock_trade_attempts_failed (%s, archived_at, archive_reason, archived_by_run)
    SELECT %s, now(), w.reason, %L::uuid
      FROM public.mock_trades AS m
      JOIN _archive_workset AS w
        ON w.id = m.id
       AND w.run_id = %L::uuid
  $q$, v_cols, v_cols_prefixed, v_run_id, v_run_id);

  GET DIAGNOSTICS v_total = ROW_COUNT;

  UPDATE public.mock_trades AS m
     SET is_archived = true
   WHERE m.id IN (
     SELECT w.id
     FROM _archive_workset AS w
     WHERE w.run_id = v_run_id
   );

  SELECT COUNT(*) FILTER (WHERE w.reason = 'P1_failed_attempt')::int,
         COUNT(*) FILTER (WHERE w.reason = 'P2_stale_pending_no_tx')::int
    INTO v_p1, v_p2
  FROM _archive_workset AS w
  WHERE w.run_id = v_run_id;

  INSERT INTO public.archive_run_log(id, run_kind, finished_at, rows_affected, dry_run, details)
    VALUES (v_run_id, 'archive_failed_attempts', now(), v_total, false,
            jsonb_build_object('p1', v_p1, 'p2', v_p2));

  RETURN QUERY SELECT v_total, v_p1, v_p2, v_run_id;
END;
$function$;