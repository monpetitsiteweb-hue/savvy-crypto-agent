-- Create admin-only RPC to reset learning loop data for a specified user
CREATE OR REPLACE FUNCTION public.admin_reset_learning_loop(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_outcomes integer;
  deleted_suggestions integer;
  deleted_metrics integer;
  deleted_events integer;
  deleted_logs integer;
BEGIN
  -- Check admin permission
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Delete in dependency order (child tables first)
  DELETE FROM public.decision_outcomes WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_outcomes = ROW_COUNT;

  DELETE FROM public.calibration_suggestions WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_suggestions = ROW_COUNT;

  DELETE FROM public.calibration_metrics WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_metrics = ROW_COUNT;

  DELETE FROM public.decision_events WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_events = ROW_COUNT;

  DELETE FROM public.trade_decisions_log WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_logs = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', jsonb_build_object(
      'decision_events', deleted_events,
      'decision_outcomes', deleted_outcomes,
      'calibration_metrics', deleted_metrics,
      'calibration_suggestions', deleted_suggestions,
      'trade_decisions_log', deleted_logs
    ),
    'user_id', p_user_id
  );
END;
$$;

-- Grant execute to authenticated users (function checks admin role internally)
GRANT EXECUTE ON FUNCTION public.admin_reset_learning_loop(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_reset_learning_loop(uuid) IS 'Admin-only: Resets all learning loop data (decision events, outcomes, calibration metrics/suggestions, decision logs) for a specified user. Does not touch mock trades, strategies, or market data.';