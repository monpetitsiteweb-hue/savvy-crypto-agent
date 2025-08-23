-- Enable pgcrypto for UUIDs
create extension if not exists pgcrypto;

-- 1) Tag corrupted trades (non-destructive)
alter table public.mock_trades
  add column if not exists is_corrupted boolean not null default false,
  add column if not exists integrity_reason text;

update public.mock_trades
set is_corrupted = true,
    integrity_reason = coalesce(integrity_reason, 'entry_price_placeholder_100')
where price = 100 and total_value > 0;

-- 2) Audit table for deterministic fixes
create table if not exists public.mock_trades_fix_audit (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null,
  user_id uuid,
  strategy_id uuid,
  symbol text,
  old_price numeric(38,18),
  new_price numeric(38,18),
  old_amount numeric(38,18),
  new_amount numeric(38,18),
  reason text not null,
  source text not null,              -- e.g. 'snapshot_1m', 'fills_join'
  created_at timestamptz not null default now()
);

alter table public.mock_trades_fix_audit enable row level security;
create policy "own_fix_audit_read"
  on public.mock_trades_fix_audit for select
  using (user_id = auth.uid());
create index if not exists idx_fix_audit_trade on public.mock_trades_fix_audit(trade_id);

-- 3) Authoritative price snapshots table (deterministic source of truth)
create table if not exists public.price_snapshots (
  symbol text not null,
  ts timestamptz not null,
  price numeric(38,18) not null,
  primary key (symbol, ts)
);

alter table public.price_snapshots enable row level security;
create policy "snapshots_read"
  on public.price_snapshots for select using (true);
create index if not exists idx_snapshots_symbol_time on public.price_snapshots(symbol, ts);