INSERT INTO public.decision_snapshots (
  decision_id, user_id, strategy_id, symbol, side, timestamp_utc,
  decision_result, decision_reason, schema_version, snapshot_type,
  guard_states_json
)
SELECT
  de.id,
  de.user_id,
  de.strategy_id,
  de.symbol,
  de.side,
  de.created_at,
  SPLIT_PART(de.reason, ':', 1),
  de.reason,
  'v1_backfill',
  CASE WHEN de.side = 'SELL' THEN 'EXIT' ELSE 'ENTRY' END,
  jsonb_build_object(
    'action', SPLIT_PART(de.reason, ':', 1),
    'reason', de.reason,
    'source', 'backfill_migration_20260327',
    'original_source', de.source
  )
FROM public.decision_events de
LEFT JOIN public.decision_snapshots ds ON ds.decision_id = de.id
WHERE ds.id IS NULL
AND de.created_at < '2026-03-27 23:15:00';