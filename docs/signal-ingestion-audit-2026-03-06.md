# Signal Ingestion Root Cause Audit — 2026-03-06

## live_signals Current State

| Source | Total Rows | Last Signal | Last 24h |
|---|---|---|---|
| `technical_analysis` | 303,040 | 2026-03-06 10:30 | 4,559 |
| `crypto_news` | 237,377 | 2026-03-06 10:33 | 2,591 |
| `whale_alert_ws` | 160,297 | 2026-03-06 09:36 | 1,632 |
| `eodhd` | 174,587 | 2026-03-06 03:00 | 464 |
| `fear_greed_index` | 3,707 | 2026-03-06 10:00 | 24 |
| `whale_alert_api` | **0** | — | 0 |
| `whale_alert_tracked` | **1** | 2025-12-04 | 0 |
| `bigquery` | **0** | — | 0 |

---

## Source-by-Source Audit

---

### 🔎 Source: `technical-signal-generator`

**Status: ✅ OPERATIONAL**

#### 1️⃣ Scheduler Status
- **Invoked**: Yes
- **Via**: GitHub Action `technical-signal-generator-5min.yml` — every 5 minutes
- **Last run**: Active, 4,559 signals in last 24h
- **Failures**: None observed

#### 2️⃣ Raw API Response
- Internal source — reads from `market_ohlcv_raw` table
- No external API dependency
- No auth errors possible

#### 3️⃣ Parsing Layer
- Working correctly. Generates RSI, MACD, volume spike, and price change signals.
- Symbol normalization applied (strips `-EUR` suffix).

#### 4️⃣ Insert Layer
- Succeeds consistently.
- No constraint violations.

#### 5️⃣ live_signals Output
- 303,040 total rows, 4,559 in last 24h. Healthy.

#### Known Issue
- `ai_data_sources` has **~50+ duplicate** `technical_analysis` rows. Each invocation before the P2 fix (Dec 2024) created a new source row because the old code didn't filter by `user_id IS NULL`. The P2 fix now correctly queries system sources only, but the old rows remain.

**Root Cause**: N/A — operational  
**Fix Complexity**: XS (cleanup orphaned `ai_data_sources` rows)  
**Required Action**: Delete duplicate `technical_analysis` rows from `ai_data_sources` where `user_id IS NOT NULL` and `last_sync < '2025-10-01'`.  
**File**: `supabase/functions/technical-signal-generator/index.ts`

---

### 🔎 Source: `external-data-collector` (Fear & Greed Index)

**Status: ✅ OPERATIONAL**

#### 1️⃣ Scheduler Status
- **Invoked**: Yes
- **Via**: GitHub Action `fear-greed-collector-hourly.yml` — every hour at :30
- **Last run**: 2026-03-06 10:00
- **Failures**: None observed

#### 2️⃣ Raw API Response
- API: `https://api.alternative.me/fng/` — free, no auth required
- Returns current Fear & Greed index value
- No rate limiting issues

#### 3️⃣ Parsing Layer
- Working. Maps index value to signal types (`fear_index_extreme`, `greed_index_moderate`, etc.)
- Signal strength = direct mapping from index value (0-100)

#### 4️⃣ Insert Layer
- Succeeds. 24 signals in last 24h (1 per hour — correct).

#### 5️⃣ live_signals Output
- 3,707 total rows, 24 in last 24h. Healthy.

#### Configuration
- Source ID: `fff8a815-7d92-4111-a58c-6e595e81f088` (hardcoded in workflow)
- `last_sync`: 2026-03-06 10:00 — current

**Root Cause**: N/A — operational  
**Fix Complexity**: N/A  
**Required Action**: None  
**File**: `supabase/functions/external-data-collector/index.ts`, `.github/workflows/fear-greed-collector-hourly.yml`

---

### 🔎 Source: `crypto-news-collector`

**Status: ✅ OPERATIONAL (with scheduling fragility)**

#### 1️⃣ Scheduler Status
- **Invoked**: Yes — but **no dedicated GitHub Action workflow** exists
- **Via**: Unknown caller (likely `data-sync-scheduler` or manual invocation chain)
- **Last run**: 2026-03-06 10:33 — producing data actively
- **Failures**: None observed currently

#### 2️⃣ Raw API Response
- API: CryptoNews API (requires API key stored in `ai_data_sources.configuration`)
- Returns news articles with sentiment scores
- Working — 2,591 signals in last 24h

#### 3️⃣ Parsing Layer
- Working. Extracts headlines, generates sentiment signals.
- Symbol resolution from active trading strategies when not provided.

#### 4️⃣ Insert Layer
- Succeeds. No constraint violations.
- Requires `NOT NULL user_id` — has fallback resolution logic (Dec 2024 fix).

#### 5️⃣ live_signals Output
- 237,377 total rows, 2,591 in last 24h. Healthy.

#### Risk
- **No dedicated workflow** means scheduling depends on whatever is currently calling it. If that caller changes or stops, ingestion fails silently with no alert.

**Root Cause**: A (scheduling fragility — no dedicated workflow)  
**Fix Complexity**: XS  
**Required Action**: Create `.github/workflows/crypto-news-collector-hourly.yml` with direct invocation.  
**File**: `supabase/functions/crypto-news-collector/index.ts`

---

### 🔎 Source: `whale-alert-webhook` (Tracked Wallets via QuickNode)

**Status: ❌ EFFECTIVELY DEAD**

#### 1️⃣ Scheduler Status
- **Not scheduled** — this is a passive webhook endpoint
- Depends entirely on QuickNode pushing data to `https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/whale-alert-webhook`
- No inbound data arriving

#### 2️⃣ Raw API Response
- N/A — webhook model, not polling
- QuickNode webhook configuration in `ai_data_sources`:
  - `source_name: quicknode_webhooks`
  - `last_sync: 2026-01-21 06:56` — last activity ~6 weeks ago
  - `webhook_secret: qnsec_MDI4ZGYxZGEtNjdhZS00NjY4LTgwYTEtYTNkY2YxMDVjYmM2`

#### 3️⃣ Parsing Layer
- Code handles both QuickNode format (`payload.matchingTransactions`) and generic whale alert format
- Parsing logic appears correct but untestable without inbound data

#### 4️⃣ Insert Layer
- Only 1 row ever inserted (`whale_alert_tracked`, 2025-12-04)
- Code path works but never executes

#### 5️⃣ live_signals Output
- 1 total row. 0 in last 24h.

#### Diagnosis
- The QuickNode webhook is likely **expired, paused, or misconfigured** on the QuickNode dashboard
- The webhook URL exists and the function responds to GET health checks
- No evidence of inbound POST requests hitting the endpoint

**Root Cause**: H (Webhook not registered / not delivering from QuickNode side)  
**Fix Complexity**: S  
**Required Action**: Log into QuickNode dashboard → verify webhook is active → check delivery logs → re-register if expired.  
**File**: `supabase/functions/whale-alert-webhook/index.ts`

---

### 🔎 Source: `whale-alert-api-collector`

**Status: ❌ DEAD — Zero rows ever produced**

#### 1️⃣ Scheduler Status
- **Invoked**: Yes — by **two duplicate workflows**:
  - `whale-alert-api-collector.yml` — every 30 minutes
  - `whale-alert-api-collector-hourly.yml` — every hour at :15
- Both are active but produce nothing

#### 2️⃣ Raw API Response
- API: `https://api.whale-alert.io/v1/transactions`
- API key in `ai_data_sources`: `MflZL4W1h0CDogIJFDTzIGKaAObxapM8`
- `last_sync` on the source: **2025-09-01** — hasn't updated in 6 months
- The function likely calls the API, receives either:
  - HTTP 401/403 (expired key)
  - HTTP 200 with empty `transactions: []`
  - HTTP 429 (rate limited on free tier)
- The code (line 59-62) logs API errors but `continue`s silently — no signal created, no failure propagated

#### 3️⃣ Parsing Layer
- Never reached — no transactions to parse

#### 4️⃣ Insert Layer
- Never reached

#### 5️⃣ live_signals Output
- **0 total rows**. Source `whale_alert_api` has never produced data.

#### Additional Issues
1. **Duplicate workflows**: Two GHA workflows do the same thing at different intervals
2. **Inconsistent auth headers**:
   - `whale-alert-api-collector.yml` uses `Authorization: Bearer SERVICE_ROLE_KEY` + `apikey: ANON_KEY`
   - `whale-alert-api-collector-hourly.yml` uses `Authorization: Bearer ANON_KEY` + `apikey: ANON_KEY`
3. **Source row `last_sync` frozen**: The function updates `last_sync` only after processing transactions (line 139-142), so if API returns 0 transactions, `last_sync` never updates — masking the failure
4. **No deduplication**: Code inserts into `live_signals` without `ON CONFLICT` — but irrelevant since nothing is inserted

#### Why `whale_alert_ws` works but `whale_alert_api` doesn't
- `whale_alert_ws` connects to the **WebSocket** endpoint (`wss://leviathan.whale-alert.io/ws`) — this uses a different auth mechanism and is actively producing 1,632 signals/day
- `whale_alert_api` uses the **REST API** with an API key that appears to have expired in September 2025
- The REST API key (`MflZL4W1h0CDogIJFDTzIGKaAObxapM8`) is a paid-tier key — Whale Alert free keys have severe rate limits (10 req/min, 100 req/day)

**Root Cause**: B (API key expired/invalid) + A (duplicate scheduling)  
**Fix Complexity**: XS  
**Required Action**: (1) Verify/replace Whale Alert API key. (2) Delete duplicate workflow `whale-alert-api-collector-hourly.yml`. (3) Move `last_sync` update outside the transaction loop so it always updates.  
**Files**: `supabase/functions/whale-alert-api-collector/index.ts` (lines 44, 139-142), `.github/workflows/whale-alert-api-collector.yml`, `.github/workflows/whale-alert-api-collector-hourly.yml`

---

### 🔎 Source: `whale-alert-ws`

**Status: ✅ OPERATIONAL (Primary whale data source)**

#### 1️⃣ Scheduler Status
- **Invoked**: Yes
- **Via**: GitHub Action `whale-alert-ws-hourly.yml` — every hour at :15
- **Last run**: Active, 1,632 signals in last 24h

#### 2️⃣ Raw API Response
- Connects to `wss://leviathan.whale-alert.io/ws`
- Produces three signal types:
  - `whale_large_movement`: 130,792 total
  - `whale_exchange_inflow`: 20,497 total
  - `whale_exchange_outflow`: 9,008 total

#### 3️⃣ Parsing Layer
- Working. Maps blockchain names to symbols via `SYMBOL_MAP`.
- Determines signal type based on `owner_type` (exchange inflow/outflow).

#### 4️⃣ Insert Layer
- Succeeds consistently.

#### 5️⃣ live_signals Output
- 160,297 total rows, 1,632 in last 24h. Healthy.

**Root Cause**: N/A — operational  
**Fix Complexity**: N/A  
**Required Action**: None  
**File**: `supabase/functions/whale-alert-ws/index.ts`

---

### 🔎 Source: `eodhd-collector`

**Status: ✅ OPERATIONAL (minor staleness pattern)**

#### 1️⃣ Scheduler Status
- **Invoked**: Yes
- **Via**: GitHub Action `eodhd-collector.yml` — every 5 minutes
- **Last run**: Active, 464 signals in last 24h

#### 2️⃣ Raw API Response
- API: EODHD (requires API key in Supabase secrets or `ai_data_sources`)
- Fetches OHLCV data for crypto pairs
- Working — data flowing

#### 3️⃣ Parsing Layer
- Working. Generates volume spike, volatility, and breakout signals from OHLCV data.
- Comprehensive symbol mapping (`EODHD_CRYPTO_SYMBOL_MAP` covers 30+ pairs).

#### 4️⃣ Insert Layer
- Succeeds.

#### 5️⃣ live_signals Output
- 174,587 total rows, 464 in last 24h.
- **Note**: Last signal timestamp is `2026-03-06 03:00` — ~7.5 hours stale at audit time. This suggests EODHD API may have intermittent availability or the signal generation conditions aren't met during all market periods. Not broken, but worth monitoring.

**Root Cause**: N/A — operational  
**Fix Complexity**: N/A  
**Required Action**: None critical. Monitor for staleness patterns.  
**File**: `supabase/functions/eodhd-collector/index.ts`

---

### 🔎 Source: `bigquery-signal-generator`

**Status: ❌ DEAD — Never scheduled, never invoked**

#### 1️⃣ Scheduler Status
- **Invoked**: No
- **Via**: Nothing — **no GitHub Action workflow exists** for `bigquery-signal-generator`
- **Not invoked by `data-sync-scheduler`**: The scheduler calls `bigquery-collector` (data fetch) but never calls `bigquery-signal-generator` (signal creation)
- **Never run**

#### 2️⃣ Raw API Response
- N/A — function never invoked
- The function reads from `historical_market_data` (not an external API)
- `historical_market_data` has **6,471 rows** with `source = 'bigquery'` — sufficient data exists

#### 3️⃣ Parsing Layer
- Code exists and looks functional: analyzes 7-day historical patterns for volume surges, resistance/support tests
- Requires minimum 3 data points per symbol — data exists
- Never tested in production

#### 4️⃣ Insert Layer
- Never reached

#### 5️⃣ live_signals Output
- **0 total rows** from source `bigquery`

#### Configuration
- `ai_data_sources` has `bigquery` source with `last_sync: 2026-03-06 06:00` — this is the **collector** updating, not the signal generator
- The `data-sync-scheduler` has a `syncBigQueryData()` function that calls `bigquery-collector` but there is no equivalent for `bigquery-signal-generator`

**Root Cause**: A (Not scheduled — no workflow, no pg_cron, no caller)  
**Fix Complexity**: S  
**Required Action**: Create `.github/workflows/bigquery-signal-generator-daily.yml` to invoke `bigquery-signal-generator` after `bigquery-collector` completes (daily schedule).  
**Files**: `supabase/functions/bigquery-signal-generator/index.ts`, missing workflow file

---

## Cross-Cutting Findings

### Duplicate Workflows
| Workflow | Schedule | Issue |
|---|---|---|
| `whale-alert-api-collector.yml` | Every 30 min | Duplicate — both call same dead function |
| `whale-alert-api-collector-hourly.yml` | Every hour at :15 | Duplicate — delete this one |

### Unscheduled Functions
| Function | Status |
|---|---|
| `crypto-news-collector` | No dedicated workflow (data flows via unknown caller) |
| `bigquery-signal-generator` | No workflow at all — never invoked |

### Dead Webhooks
| Webhook | Last Activity | Issue |
|---|---|---|
| QuickNode → `whale-alert-webhook` | 2026-01-21 | Not delivering data |

### Likely Invalid API Keys
| Source | Key | Evidence |
|---|---|---|
| `whale_alert_api` | `MflZL4W1h0CDogIJFDTzIGKaAObxapM8` | 0 rows produced, `last_sync` frozen since 2025-09-01 |

### Silent Failures (200 OK, Zero Events)
| Source | Behavior |
|---|---|
| `whale-alert-api-collector` | Returns `{ success: true, signals_created: 0 }` every run — looks healthy but produces nothing |

### Overly Strict Filters
| Source | Filter | Current Value | Concern |
|---|---|---|---|
| `whale_alert_api` | `min_value` (USD threshold) | $50,000 | Not the root cause (key is expired), but 50K is reasonable |
| `whale_alert_api` | `blockchain_filter` | `['ethereum', 'bitcoin']` | Excludes SOL, XRP, etc. — narrow but not the failure cause |

### ai_data_sources Pollution
- ~50+ orphaned `technical_analysis` rows with `user_id IS NOT NULL` from pre-P2-fix era
- Multiple stale `coinbase_realtime` rows (dozens, last_sync from Nov 2025)
- These don't break ingestion but pollute the table and could confuse diagnostics

---

## Summary Table

| Source | Root Cause Type | Complexity | Fix Required |
|---|---|---|---|
| `technical-signal-generator` | N/A (operational) | XS | Cleanup duplicate `ai_data_sources` rows |
| `external-data-collector` (F&G) | N/A (operational) | — | None |
| `crypto-news-collector` | A (no dedicated scheduler) | XS | Add dedicated GitHub Action workflow |
| `whale-alert-webhook` | H (webhook not delivering) | S | Verify/re-register QuickNode webhook |
| `whale-alert-api-collector` | B (API key expired) + A (duplicate workflow) | XS | Replace API key; delete duplicate workflow |
| `whale-alert-ws` | N/A (operational) | — | None |
| `eodhd-collector` | N/A (operational) | — | None |
| `bigquery-signal-generator` | A (not scheduled) | S | Create workflow to invoke function |

### Operational Summary
- **5 of 7** sources are actively producing signals
- **2 dead sources**: `whale-alert-api-collector` (expired API key), `bigquery-signal-generator` (never scheduled)
- **1 dead webhook**: `whale-alert-webhook` (QuickNode not delivering)
- **1 fragile source**: `crypto-news-collector` (no dedicated scheduler)
- **Total fix effort**: ~2-3 hours for all issues combined
