-- Fix get_pending_decisions_for_horizon to immediately evaluate test/mock mode decisions
-- without waiting for the horizon to elapse

CREATE OR REPLACE FUNCTION public.get_pending_decisions_for_horizon(horizon_key text)
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
AS $function$
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
  -- For test/mock mode: evaluate immediately without waiting for horizon
  -- For live mode: wait for horizon to elapse
  and (
    -- Test/mock mode: check both metadata and raw_intent
    (de.metadata->>'mode' = 'mock' 
     OR de.raw_intent->'metadata'->>'mode' = 'mock'
     OR de.metadata->>'is_test_mode' = 'true'
     OR de.raw_intent->'metadata'->>'is_test_mode' = 'true')
    OR
    -- Live mode: require horizon to have elapsed
    (de.decision_ts + (
      case horizon_key
        when '15m' then interval '15 minutes'
        when '1h'  then interval '1 hour'
        when '4h'  then interval '4 hours'
        when '24h' then interval '24 hours'
        else interval '1 hour'
      end
    ) <= now())
  )
  order by de.decision_ts desc
  limit 100;
$function$;