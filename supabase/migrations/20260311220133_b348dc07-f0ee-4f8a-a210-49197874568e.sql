
-- PL/pgSQL function for chunked dedup of live_signals.
-- Processes one batch at a time: finds duplicates, deletes them, returns count.
-- Safe to call repeatedly until it returns 0.
CREATE OR REPLACE FUNCTION public.dedup_live_signals_batch(
  p_batch_size INT DEFAULT 1000,
  p_dry_run BOOLEAN DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '55s'
AS $$
DECLARE
  v_deleted INT := 0;
  v_scanned INT := 0;
  v_dup_ids uuid[];
BEGIN
  -- Find duplicate IDs to delete (keep newest created_at per group)
  -- Uses a subquery that limits the scan scope
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY source, signal_type, symbol, "timestamp"
             ORDER BY created_at DESC
           ) AS rn
    FROM public.live_signals
    -- Limit scan to a manageable set by using ctid range
    WHERE ctid = ANY (
      ARRAY(
        SELECT ctid FROM public.live_signals LIMIT (p_batch_size * 5)
      )
    )
  )
  SELECT ARRAY_AGG(id) INTO v_dup_ids
  FROM ranked
  WHERE rn > 1;

  v_scanned := p_batch_size * 5;

  IF v_dup_ids IS NULL OR array_length(v_dup_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('deleted', 0, 'scanned', v_scanned, 'dry_run', p_dry_run);
  END IF;

  IF NOT p_dry_run THEN
    DELETE FROM public.live_signals WHERE id = ANY(v_dup_ids);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  ELSE
    v_deleted := array_length(v_dup_ids, 1);
  END IF;

  RETURN jsonb_build_object(
    'deleted', v_deleted,
    'scanned', v_scanned,
    'dry_run', p_dry_run
  );
END;
$$;
