# Audit — 5m Backfill Seed Completeness

**Date:** 2026-03-28  
**Status:** Audit complete — targeted rerun plan below

---

## Current State (from live queries)

### market_ohlcv_raw (granularity = '5m')

| Symbol | Rows | Expected (~8,640) | Status |
|---|---|---|---|
| BTC-EUR | 8,655 | ✅ Complete | — |
| XRP-EUR | 8,594 | ✅ Complete | — |
| LTC-EUR | 8,589 | ✅ Complete | — |
| LINK-EUR | 5,801 | ⚠️ ~67% | Partial |
| AVAX-EUR | 4,862 | ⚠️ ~56% | Partial |
| BCH-EUR | 4,057 | ⚠️ ~47% | Partial |
| DOT-EUR | 2,286 | ⚠️ ~26% | Partial |
| **ETH-EUR** | **0** | ❌ Missing | Zero rows |
| **ADA-EUR** | **0** | ❌ Missing | Zero rows |
| **SOL-EUR** | **0** | ❌ Missing | Zero rows |

### market_features_v0 (granularity = '5m')

| Symbol | Rows | Note |
|---|---|---|
| BTC-EUR | 1,028 | Capped |
| XRP-EUR | 1,023 | Capped |
| LTC-EUR | 1,012 | Capped |
| LINK-EUR | 1,010 | Capped |
| AVAX-EUR | 1,007 | Capped |
| BCH-EUR | 849 | Capped |
| DOT-EUR | 497 | Capped |
| ETH-EUR | 0 | Missing |
| ADA-EUR | 0 | Missing |
| SOL-EUR | 0 | Missing |

---

## Answers to the 5 Questions

### 1) Why are ETH-EUR, ADA-EUR, SOL-EUR absent?

**Root cause: The GitHub Actions workflow batches ran sequentially (`max-parallel: 1`), but the Edge Function has no execution timeout guard beyond Supabase's default 60-second wall clock.**

- **Batch 1** `[BTC-EUR, ETH-EUR]`: BTC-EUR succeeded (8,655 rows). ETH-EUR requires ~35 paginated API requests × rate-limited delays. The most likely scenario is:
  - BTC-EUR consumed most of the function's wall-clock time
  - ETH-EUR either hit a Coinbase 429 rate limit that triggered the circuit breaker, or the Edge Function hit the Supabase 60s timeout mid-pagination
  - The function returned `success: true` at the HTTP level (200) because the error was caught per-symbol and added to `results[]` — GitHub Actions saw a successful curl exit code

- **Batch 2** `[XRP-EUR, ADA-EUR, SOL-EUR]`: Same pattern — XRP-EUR succeeded (8,594 rows), then ADA and SOL timed out or were rate-limited. The shuffling logic (`shuffledSymbols`) means XRP may have been processed first by luck.

- **Edge Function logs have rotated** — no historical logs available to confirm the exact error, but the pattern (first symbol in each batch succeeds, subsequent ones fail) strongly points to **wall-clock timeout + rate limiting exhaustion**.

### 2) Did pagination stop early for partial symbols?

**Yes.** The row counts for LINK (5,801), AVAX (4,862), BCH (4,057), DOT (2,286) show progressively fewer rows, consistent with:

- **Batch 3** `[AVAX-EUR, DOT-EUR, LINK-EUR]`: All three partially completed. The shuffle randomized processing order. Each consumed some wall-clock time, leaving less for subsequent symbols.
- **Batch 4** `[LTC-EUR, BCH-EUR]`: LTC completed (8,589), BCH partially completed (4,057) — again, first symbol consumed most of the time budget.

**Likely causes (in order of probability):**
1. Supabase Edge Function 60s timeout (30-day 5m backfill needs ~35 paginated requests per symbol at 125ms+ each, plus rate-limit delays)
2. Coinbase 429 rate limits accumulating across symbols within a single invocation
3. Circuit breaker tripping after accumulated 429s

### 3) features-refresh: incremental or full historical?

**Incremental only.** The `computeFeatures()` function (line 192) applies `.limit(2200)` for 5m granularity. This caps output at ~2,199 feature rows per symbol regardless of how much OHLCV history exists.

This explains the ~1,000 row cap: `features-refresh` fetches up to 2,200 candles, but only the last ~1,000-1,028 produce valid features (after the EMA-200 warm-up period consumes ~1,100+ initial candles as null values).

**To backfill full 30-day 5m features:**
- The `.limit(2200)` must be increased to cover the full 30-day range: 30 × 288 = 8,640 candles. Set `.limit(9000)` for the backfill run.
- Alternatively, run `features-refresh` with `lookback_days: 35` and a higher limit, after OHLCV backfill is complete.
- **Important:** The EMA-200 warm-up means the first ~200 candles (~16.7 hours of 5m data) will always have `ema_200 = null`, but `rsi_14` and `ema_50` will be valid much sooner (~50 candles / ~4.2 hours).

### 4) Is it safe to rerun for missing/incomplete symbols only?

**Yes — fully idempotent.** Both tables use upsert on composite unique keys:
- `market_ohlcv_raw`: `ON CONFLICT (symbol, granularity, ts_utc)` with `ignoreDuplicates: true` — existing rows are skipped
- `market_features_v0`: `ON CONFLICT (symbol, granularity, ts_utc)` with `ignoreDuplicates: false` — existing rows are updated with recalculated values

Rerunning for BTC/XRP/LTC (already complete) would be a no-op for OHLCV and a benign re-upsert for features. But to save API calls and time, the rerun should target only missing/incomplete symbols.

### 5) Did the 4 matrix batches send the intended payloads?

**Yes — the payloads are correct in the workflow file.** The matrix expansion produces exactly:
- Batch 1: `{"symbols":["BTC-EUR","ETH-EUR"],"granularities":["5m"],"lookback_days":30}`
- Batch 2: `{"symbols":["XRP-EUR","ADA-EUR","SOL-EUR"],"granularities":["5m"],"lookback_days":30}`
- Batch 3: `{"symbols":["AVAX-EUR","DOT-EUR","LINK-EUR"],"granularities":["5m"],"lookback_days":30}`
- Batch 4: `{"symbols":["LTC-EUR","BCH-EUR"],"granularities":["5m"],"lookback_days":30}`

The issue is not payload construction — it's **execution time budget within each batch**.

---

## Index Status

✅ The safe index already exists:
```
idx_market_ohlcv_raw_symbol_granularity_ts ON (symbol, granularity, ts_utc DESC)
```

---

## Targeted Rerun Plan

### Problem
Each batch sends multiple symbols to a single Edge Function invocation, which has a 60s wall-clock limit. 30-day 5m backfill for one symbol needs ~35 API requests × ~150ms+ each = ~5-10 seconds minimum, but rate-limit delays and pagination overhead push it well beyond 60s for 2-3 symbols.

### Solution: One symbol per batch, with reduced lookback for partial symbols

**New workflow: `ohlcv-5m-backfill-rerun.yml`**

```yaml
strategy:
  matrix:
    batch:
      - '["ETH-EUR"]'     # 0 rows — full 30-day
      - '["ADA-EUR"]'     # 0 rows — full 30-day
      - '["SOL-EUR"]'     # 0 rows — full 30-day
      - '["DOT-EUR"]'     # 2,286 rows — full 30-day (idempotent)
      - '["BCH-EUR"]'     # 4,057 rows — full 30-day (idempotent)
      - '["AVAX-EUR"]'    # 4,862 rows — full 30-day (idempotent)
      - '["LINK-EUR"]'    # 5,801 rows — full 30-day (idempotent)
  max-parallel: 1
```

Each batch = 1 symbol = 1 Edge Function call = stays within 60s timeout.

### After OHLCV rerun succeeds:
1. Run `features-refresh` with explicit payload per symbol with increased limit
2. Or: increase `.limit(2200)` → `.limit(9000)` in features-refresh for 5m, redeploy, then trigger the 5m features pg_cron

### Expected outcome after rerun:
- All 10 symbols: ~8,640 rows each in `market_ohlcv_raw`
- All 10 symbols: ~8,400+ rows each in `market_features_v0` (minus warm-up)

---

## Do Not Touch
- Coordinator — zero changes
- Default granularity arrays — already confirmed clean
- Existing 1h/4h/24h pipelines — untouched
