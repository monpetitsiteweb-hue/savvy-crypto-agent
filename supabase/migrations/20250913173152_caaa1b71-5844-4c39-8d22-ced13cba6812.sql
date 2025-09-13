-- Phase 1: Learning Loop - Decision Events & Outcomes with security fixes
-- 0) Ensure pgcrypto for gen_random_uuid (idempotent)
create extension if not exists pgcrypto;

-- 1.1 decision_events table
create table if not exists decision_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null,
  symbol text not null,                 -- BASE (e.g., BTC)
  side text not null check (side in ('BUY','SELL','HOLD','DEFER')),
  source text not null,                 -- 'automated' | 'manual' - constraint added below
  confidence numeric,                   -- 0..100 or 0..1 (use what coordinator outputs)
  reason text,
  expected_pnl_pct numeric,             -- AI expectation at decision time (pct)
  tp_pct numeric,                       -- TP used by policy at decision time (pct, may be null)
  sl_pct numeric,                       -- SL used by policy at decision time (pct, may be null)
  entry_price numeric,                  -- price at decision time (pair-resolved)
  qty_suggested numeric,                -- suggested or used qty (if applicable)
  decision_ts timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- execution link (if an order happened from this decision)
  trade_id uuid null,

  -- json payloads for audit/debug
  metadata jsonb default '{}',
  raw_intent jsonb default '{}'
);

alter table decision_events enable row level security;

create index if not exists idx_decision_events_user_ts on decision_events (user_id, decision_ts desc);
create index if not exists idx_decision_events_symbol_ts on decision_events (symbol, decision_ts desc);

create policy "user can read own decision_events"
  on decision_events for select
  using (user_id = auth.uid());

-- 1.2 decision_outcomes table
create table if not exists decision_outcomes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references decision_events(id) on delete cascade,
  user_id uuid not null,               -- denormalized for RLS/index
  symbol text not null,                -- BASE
  horizon text not null check (horizon in ('15m','1h','4h','24h')),

  -- outcome metrics (pct, signed from decision perspective)
  mfe_pct numeric,                     -- Max Favorable Excursion
  mae_pct numeric,                     -- Max Adverse Excursion
  realized_pnl_pct numeric,            -- if trade executed; else null

  -- flags
  hit_tp boolean,
  hit_sl boolean,
  missed_opportunity boolean,          -- e.g., HOLD/DEFER but MFE >= tp_pct
  expectation_error_pct numeric,       -- realized_pnl_pct - expected_pnl_pct

  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table decision_outcomes enable row level security;

create index if not exists idx_outcomes_user_symbol on decision_outcomes (user_id, symbol, evaluated_at desc);
create index if not exists idx_outcomes_decision on decision_outcomes (decision_id);

create policy "user can read own decision_outcomes"
  on decision_outcomes for select
  using (user_id = auth.uid());

-- Fix 1: Unique guard - exactly one outcome per (decision_id, horizon)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'decision_outcomes_decision_horizon_key'
  ) then
    alter table public.decision_outcomes
      add constraint decision_outcomes_decision_horizon_key
      unique (decision_id, horizon);
  end if;
end
$$;

-- Fix 2: Constrain decision_events.source
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'decision_events_source_ck'
  ) then
    alter table public.decision_events
      add constraint decision_events_source_ck
      check (source in ('automated','manual'));
  end if;
end
$$;

-- Fix 3: Helper RPC with safety LIMIT
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
as $$
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
    from public.decision_outcomes do
    where do.decision_id = de.id
      and do.horizon = horizon_key
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

-- Lock down RPC security
revoke all on function public.get_pending_decisions_for_horizon(text) from public, anon, authenticated;
grant execute on function public.get_pending_decisions_for_horizon(text) to service_role;

comment on function public.get_pending_decisions_for_horizon(text)
  is 'Server-only: used by evaluator. Executes with service_role; not callable by clients.';