-- 0) Ensure pgcrypto for gen_random_uuid()
create extension if not exists pgcrypto;

-- 1) Table
create table if not exists public.coin_pool_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null,
  symbol text not null,

  -- minimal persisted state
  secure_target_qty numeric(38,18) not null default 0,
  secure_filled_qty numeric(38,18) not null default 0,
  runner_remaining_qty numeric(38,18) not null default 0,

  is_armed boolean not null default false,
  high_water_price numeric(38,18),
  last_trailing_stop_price numeric(38,18),

  config_snapshot jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- uniqueness per user/strategy/symbol
  constraint coin_pool_states_user_strategy_symbol_uk
    unique (user_id, strategy_id, symbol),

  -- safety checks
  constraint coin_pool_qty_nonneg_chk
    check (
      secure_target_qty >= 0
      and secure_filled_qty >= 0
      and runner_remaining_qty >= 0
    ),
  constraint coin_pool_price_nonneg_chk
    check (
      (high_water_price is null or high_water_price >= 0)
      and (last_trailing_stop_price is null or last_trailing_stop_price >= 0)
    )
);

-- 2) Row Level Security
alter table public.coin_pool_states enable row level security;

-- 2a) RLS policies (explicit and safe)
-- SELECT: user can read their own rows
create policy "select_own_coin_pool_states"
on public.coin_pool_states
for select
using (user_id = auth.uid());

-- INSERT: user can insert rows only for themselves
create policy "insert_own_coin_pool_states"
on public.coin_pool_states
for insert
with check (user_id = auth.uid());

-- UPDATE: user can update only their own rows
create policy "update_own_coin_pool_states"
on public.coin_pool_states
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- DELETE: user can delete only their own rows
create policy "delete_own_coin_pool_states"
on public.coin_pool_states
for delete
using (user_id = auth.uid());

-- 3) Lookup index
create index if not exists idx_coin_pool_states_lookup
  on public.coin_pool_states (user_id, strategy_id, symbol);

-- 4) updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists trg_coin_pool_states_updated_at
  on public.coin_pool_states;

create trigger trg_coin_pool_states_updated_at
before update on public.coin_pool_states
for each row
execute function public.set_updated_at();