-- enums as CHECKs (portable)
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- inputs
  chain_id int not null,
  base text not null,
  quote text not null,
  side text not null check (side in ('SELL','BUY')),
  amount numeric not null,
  slippage_bps int not null default 50 check (slippage_bps >= 0),
  provider text not null default '0x' check (provider in ('0x')),
  mode text not null default 'build' check (mode in ('build','send')),
  simulate_only boolean not null default false,

  -- taker as hex string 0x + 40 hex chars
  taker text,
  constraint taker_is_evm_addr check (
    taker is null or taker ~ '^0x[0-9a-fA-F]{40}$'
  ),

  -- quote snapshot
  price numeric,
  min_out text,
  gas_quote numeric,
  raw_quote jsonb,

  -- execution
  status text not null default 'built'
    check (status in ('built','submitted','mined','failed','simulate_revert')),
  tx_hash text,
  tx_payload jsonb,
  receipts jsonb,

  -- accounting
  effective_price numeric,
  gas_wei numeric,
  total_network_fee text,
  notes text
);

create table if not exists public.trade_events (
  id bigserial primary key,
  trade_id uuid not null references public.trades(id) on delete cascade,
  created_at timestamptz not null default now(),
  phase text not null,    -- quote|simulate|approve|submit|mined|error
  severity text not null default 'info' check (severity in ('info','warn','error')),
  payload jsonb
);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists trg_trades_updated_at on public.trades;
create trigger trg_trades_updated_at
before update on public.trades
for each row execute function public.set_updated_at();

-- Indexes
create index if not exists trades_created_at on public.trades (created_at desc);
create index if not exists trades_status_idx  on public.trades (status);
create index if not exists trades_taker_created_idx on public.trades (taker, created_at desc);
create unique index if not exists trades_tx_hash_uidx on public.trades (tx_hash) where tx_hash is not null;

create index if not exists trade_events_trade_created on public.trade_events (trade_id, created_at);

-- RLS: lock down by default (service_role does not use RLS)
alter table public.trades enable row level security;
alter table public.trade_events enable row level security;