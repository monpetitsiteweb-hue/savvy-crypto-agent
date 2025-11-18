-- Drop and recreate get_pending_decisions_for_horizon to include metadata and raw_intent
DROP FUNCTION IF EXISTS public.get_pending_decisions_for_horizon(text);

CREATE FUNCTION public.get_pending_decisions_for_horizon(horizon_key text)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  symbol text,
  side text,
  decision_ts timestamp with time zone,
  entry_price numeric,
  tp_pct numeric,
  sl_pct numeric,
  expected_pnl_pct numeric,
  metadata jsonb,
  raw_intent jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select 
    de.id,
    de.user_id,
    de.symbol,
    de.side,
    de.decision_ts,
    de.entry_price,
    de.tp_pct,
    de.sl_pct,
    de.expected_pnl_pct,
    de.metadata,
    de.raw_intent
  from public.decision_events de
  where not exists (
    select 1
    from public.decision_outcomes outcomes
    where outcomes.decision_id = de.id
      and outcomes.horizon = horizon_key
  )
  and de.decision_ts + (
    case horizon_key
      when '15m' then interval '15 minutes'
      when '1h'  then interval '1 hour'
      when '4h'  then interval '4 hours'
      when '24h' then interval '24 hours'
      else interval '1 hour'
    end
  ) <= now()
  order by de.decision_ts asc
  limit 100;
$$;