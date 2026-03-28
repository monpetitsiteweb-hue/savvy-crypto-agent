# Changelog — 5m Pipeline Implementation

**Date:** 2026-03-28  
**Scope:** 5m OHLCV ingestion, feature computation, lifecycle retention

## Files Modified

### 1. `supabase/functions/ohlcv-backfill/index.ts`

**Line 86 — Granularity mapping expanded**

Removed:
```ts
const granularitySeconds = granularity === '1h' ? 3600 : 86400; // Only native 1h and 24h
```

Added:
```ts
const granularityMap: Record<string, number> = { '5m': 300, '1h': 3600, '24h': 86400 };
const granularitySeconds = granularityMap[granularity] ?? 3600;
```

**Line 405 — Comment updated**

Removed: `// Ensure we have 1h data first, then synthesize 4h`  
Added: `// Synthesize 4h from 1h — not a native Coinbase granularity`

**Line 439 — Comment updated**

Removed: `// Native granularities (1h, 24h)`  
Added: `// Native granularities (5m, 1h, 24h)`

---

### 2. `supabase/functions/ohlcv-live-ingest/index.ts`

**Line 109 — Granularity mapping expanded**

Removed:
```ts
const granularitySeconds = granularity === '1h' ? 3600 : granularity === '4h' ? 14400 : 86400;
```

Added:
```ts
const granularityMap: Record<string, number> = { '5m': 300, '1h': 3600, '4h': 14400, '24h': 86400 };
const granularitySeconds = granularityMap[granularity] ?? 3600;
```

**Lines 256–259 — Feature lookback replaced with integer stepMinutes**

Removed:
```ts
// Get enough candles for EMA-200 + buffer
const step = { '1h': 1, '4h': 4, '24h': 24 }[granularity] || 1;
const lookbackCandles = Math.max(250, 168 / step);
const lookbackStart = new Date(latestTimestamp.getTime() - (lookbackCandles * step * 3600000));
```

Added:
```ts
// Get enough candles for EMA-200 + buffer — use integer stepMinutes to avoid floating-point corruption
const stepMinutes: Record<string, number> = { '5m': 5, '1h': 60, '4h': 240, '24h': 1440 };
const sm = stepMinutes[granularity] ?? 60;
const lookbackCandles = Math.max(250, Math.round(10080 / sm)); // 10080 min = 7 days
const lookbackStart = new Date(latestTimestamp.getTime() - (lookbackCandles * sm * 60000));
```

**Lines 279–283 — Window scaling replaced with integer math**

Removed:
```ts
// Scale windows by granularity
const ret_1h_window = Math.max(1, Math.floor(1 / step));
const ret_4h_window = Math.max(1, Math.floor(4 / step));
const ret_24h_window = Math.max(1, Math.floor(24 / step));
const ret_7d_window = Math.max(1, Math.floor(168 / step));
```

Added:
```ts
// Scale windows by granularity — integer minutes, zero floating-point risk
const ret_1h_window = Math.max(1, Math.round(60 / sm));
const ret_4h_window = Math.max(1, Math.round(240 / sm));
const ret_24h_window = Math.max(1, Math.round(1440 / sm));
const ret_7d_window = Math.max(1, Math.round(10080 / sm));
```

**Line 389 — Default granularities: 5m intentionally excluded**

Unchanged: `const DEFAULT_GRANULARITIES = ['1h', '4h', '24h'];`  
Rationale: 5m is triggered exclusively via dedicated pg_cron jobs with explicit `granularities=["5m"]` payloads. Keeping 5m out of defaults ensures clean rollback (disable 2 crons only), no accidental duplication from legacy call paths, and existing behavior fully unchanged.

> **History**: Initially added `'5m'` to defaults, then removed per operator review to enforce isolation.

---

### 3. `supabase/functions/features-refresh/index.ts`

**Lines 215–220 — Window scaling replaced with integer stepMinutes**

Removed:
```ts
// Scale windows by granularity for returns/volatility
const step = { '1h': 1, '4h': 4, '24h': 24 }[granularity] || 1;
const ret_1h_window = Math.max(1, Math.floor(1 / step));
const ret_4h_window = Math.max(1, Math.floor(4 / step));
const ret_24h_window = Math.max(1, Math.floor(24 / step));
const ret_7d_window = Math.max(1, Math.floor(168 / step));
```

Added:
```ts
// Scale windows by granularity — integer stepMinutes to avoid floating-point corruption
const stepMinutesMap: Record<string, number> = { '5m': 5, '1h': 60, '4h': 240, '24h': 1440 };
const sm = stepMinutesMap[granularity] ?? 60;
const ret_1h_window = Math.max(1, Math.round(60 / sm));
const ret_4h_window = Math.max(1, Math.round(240 / sm));
const ret_24h_window = Math.max(1, Math.round(1440 / sm));
const ret_7d_window = Math.max(1, Math.round(10080 / sm));
```

**Lines 191–192 — Query limit raised for 5m**

Removed: `.limit(500);`  
Added: `.limit(granularity === '5m' ? 2200 : 500); // 5m needs 2016+ candles for 7d window`

**Line 361 — Default granularities: 5m intentionally excluded**

Unchanged: `const granularitiesDefault = ["1h", "4h", "24h"];`  
Rationale: Same isolation principle as ohlcv-live-ingest — 5m runs only via its dedicated pg_cron job.

> **History**: Initially added `'5m'` to defaults, then removed per operator review.

---

### 4. `supabase/functions/price-data-lifecycle/index.ts`

**Lines 358–384 — Added 5m retention pruning step**

Removed (old Step 4 → renumbered to Step 5):
```ts
// ── STEP 4: FINAL LOG UPDATE ──
```

Added (new Step 4 before final log update):
```ts
// ── STEP 4: PRUNE 5m OHLCV + FEATURES (45-day retention) ──
// Iterates over market_ohlcv_raw and market_features_v0
// Deletes rows WHERE granularity = '5m' AND ts_utc < cutoff
// Uses bounded batches (5000 rows) via prune_5m_market_data_batch RPC
// Respects timeout guard (50s)
// Reports total 5m rows pruned in final response
```

Response payload now includes `pruned_5m` field and timeout message includes 5m prune count.

---

## Files Created

| File | Purpose |
|---|---|
| `.github/workflows/ohlcv-5m-backfill-seed.yml` | One-time manual workflow — seeds 30-day 5m backfill in 4 sequential symbol batches |
| `docs/changelog-5m-pipeline-implementation-2026-03-28.md` | This file |

## Files Deleted

None.

## Database Changes (Migrations)

### RPC Function Created
```sql
CREATE OR REPLACE FUNCTION public.prune_5m_market_data_batch(
  p_table TEXT,          -- 'market_ohlcv_raw' or 'market_features_v0' only
  p_cutoff TIMESTAMPTZ,  -- rows with ts_utc < this are deleted
  p_batch_size INT        -- default 5000
) RETURNS INT
-- SECURITY DEFINER, uses ctid-based bounded DELETE
```

### pg_cron Jobs Created

| Job Name | Schedule | Target | Payload |
|---|---|---|---|
| `ohlcv-live-ingest-5m` | `*/5 * * * *` | `ohlcv-live-ingest` | 10 EUR symbols, granularities=["5m"] |
| `features-refresh-5m` | `1-59/5 * * * *` | `features-refresh` | 10 EUR symbols, granularities=["5m"], lookback_days=8 |

Both use vault-based credentials (`service_role_key` + `CRON_SECRET`).

## Key Design Decisions

1. **Integer stepMinutes** — `Math.round(60/5)=12` instead of `Math.floor(1/0.0833)` — eliminates floating-point corruption
2. **Retention ships with pipeline** — 45-day 5m pruning active from day one
3. **Supabase-native scheduling** — pg_cron only, no GitHub Actions for recurring 5m
4. **Query limit 2200** — supports 7d volatility window at 5m (2016 candles + buffer)

## Indexes Verified (pre-existing, no changes)

- `idx_market_ohlcv_raw_symbol_granularity_ts` on `(symbol, granularity, ts_utc DESC)`
- `idx_ohlcv_symbol_gran_ts`
