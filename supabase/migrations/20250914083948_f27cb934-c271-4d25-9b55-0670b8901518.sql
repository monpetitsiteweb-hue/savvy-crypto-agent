-- Phase 1: Learning Loop - Decision Events & Outcomes with security fixes
create extension if not exists pgcrypto;

-- =========================================
-- decision_events
-- =========================================
create table if not exists public.decision_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null,
  symbol text not null,
  side text not null check (side in ('BUY','SELL','HOLD','DEFER')),
  source text not null, -- constrained below
  confidence numeric,
  reason text,
  expected_pnl_pct numeric,
  tp_pct numeric,
  sl_pct numeric,
  entry_price numeric,
  qty_suggested numeric,
  decision_ts timestamptz not null default now(),
  created_at timestamptz not null default now(),
  trade_id uuid null,
  metadata jsonb default '{}',
  raw_intent jsonb default '{}'
);

alter table public.decision_events enable row level security;
create index if not exists idx_decision_events_user_ts   on public.decision_events (user_id, decision_ts desc);
create index if not exists idx_decision_events_symbol_ts on public.decision_events (symbol, decision_ts desc);

create policy "user can read own decision_events"
  on public.decision_events for select
  using (user_id = auth.uid());

-- =========================================
-- decision_outcomes
-- =========================================
create table if not exists public.decision_outcomes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decision_events(id) on delete cascade,
  user_id uuid not null,
  symbol text not null,
  horizon text not null check (horizon in ('15m','1h','4h','24h')),
  mfe_pct numeric,
  mae_pct numeric,
  realized_pnl_pct numeric,
  hit_tp boolean,
  hit_sl boolean,
  missed_opportunity boolean,
  expectation_error_pct numeric,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.decision_outcomes enable row level security;
create index if not exists idx_outcomes_user_symbol on public.decision_outcomes (user_id, symbol, evaluated_at desc);
create index if not exists idx_outcomes_decision   on public.decision_outcomes (decision_id);

create policy "user can read own decision_outcomes"
  on public.decision_outcomes for select
  using (user_id = auth.uid());

-- =========================================
-- Guards & constraints (idempotent)
-- =========================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'decision_outcomes_decision_horizon_key'
  ) then
    alter table public.decision_outcomes
      add constraint decision_outcomes_decision_horizon_key unique (decision_id, horizon);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'decision_events_source_ck'
  ) then
    alter table public.decision_events
      add constraint decision_events_source_ck check (source in ('automated','manual'));
  end if;
end $$;

-- =========================================
-- Helper RPC (server-only) with LIMIT
-- =========================================
create or replace function public.get_pending_decisions_for_horizon(horizon_key text)
returns table (
  id uuid,
  user_id uuid,
  symbol text,
  side text,
  decision_ts timestamptz,
  entry_price numeric,
  tp_pct numeric,
  sl_pct numeric,
  expected_pnl_pct numeric
)
language sql
security definer
set search_path = public
as $func$
  select 
    de.id,
    de.user_id,
    de.symbol,
    de.side,
    de.decision_ts,
    de.entry_price,
    de.tp_pct,
    de.sl_pct,
    de.expected_pnl_pct
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
$func$;

revoke all on function public.get_pending_decisions_for_horizon(text) from public, anon, authenticated;
grant execute on function public.get_pending_decisions_for_horizon(text) to service_role;
comment on function public.get_pending_decisions_for_horizon(text)
  is 'Server-only: used by evaluator. Executes with service_role; not callable by clients.';