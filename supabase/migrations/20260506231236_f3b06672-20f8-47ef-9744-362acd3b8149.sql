DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.archive_failed_attempts(false);
  RAISE NOTICE 'ARCHIVE_RESULT rows_archived=% p1=% p2=% run_id=%',
    r.rows_archived, r.p1_count, r.p2_count, r.run_id;
END $$;