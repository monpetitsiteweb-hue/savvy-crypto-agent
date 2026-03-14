# Clean Data Reset & Safe Data Export — Runbook

> **Created**: 2026-03-14  
> **Purpose**: Reset trading system DB to day-0, preserving system config and admin user.  
> **Admin user**: `mon.petit.site.web@gmail.com` (`25a0c221-1f0e-431d-8d79-db9fb4db9cb3`)

---

## Pre-Reset Inventory (row counts at time of audit)

| Table | Rows | Category |
|-------|------|----------|
| decision_events | 153,862 | Pipeline — TRUNCATE |
| decision_snapshots | 7,604 | Pipeline — TRUNCATE |
| decision_outcomes | 53,461 | Pipeline — TRUNCATE |
| live_signals | 668,694 | Pipeline — TRUNCATE |
| trade_decisions_log | 75,203 | Pipeline — TRUNCATE |
| mock_trades | 27,830 | Trading — TRUNCATE |
| trades | 63 | Trading — TRUNCATE |
| trade_events | 114 | Trading — TRUNCATE |
| real_trades | 7 | Trading — TRUNCATE |
| execution_circuit_breakers | 3 | Execution — TRUNCATE |
| execution_jobs | 0 | Execution — TRUNCATE |
| execution_locks | 0 | Execution — TRUNCATE |
| execution_holds | 8 | Execution — TRUNCATE |
| execution_quality_log | 1 | Execution — TRUNCATE |
| coin_pool_states | 52 | Execution — TRUNCATE |
| crypto_news | 10,734 | Market data — TRUNCATE |
| whale_signal_events | 43 | Market data — TRUNCATE |
| calibration_metrics | 396 | Analytics — TRUNCATE |
| calibration_suggestions | 0 | Analytics — TRUNCATE |
| strategy_performance | 140 | Analytics — TRUNCATE |
| signal_source_health | 7 | Analytics — TRUNCATE |
| ai_learning_metrics | 0 | Analytics — TRUNCATE |
| ai_knowledge_base | 0 | Analytics — TRUNCATE |
| ai_category_performance | 0 | Analytics — TRUNCATE |
| conversation_history | 2,450 | User data — TRUNCATE |
| portfolio_capital | 8 | User data — DELETE non-admin |
| profiles | 7 | User data — DELETE non-admin |
| user_roles | 7 | User data — DELETE non-admin |
| user_coinbase_connections | 10 | User data — DELETE non-admin |
| user_onboarding_status | 8 | User data — DELETE non-admin |
| user_external_addresses | 1 | User data — DELETE non-admin |
| deposit_attributions | 1 | User data — TRUNCATE |
| security_audit_log | 120 | Audit — TRUNCATE |
| withdrawal_audit_log | 5 | Audit — TRUNCATE |
| decision_events_backup_all | 27,655 | Backup — TRUNCATE |
| decision_events_backup_legacy | 27,633 | Backup — TRUNCATE |
| decision_events_legacy | 44,573 | Backup — TRUNCATE |
| mock_trades_backup_202602_fifo_fix | 5,543 | Backup — TRUNCATE |
| mock_trades_fix_audit | 0 | Backup — TRUNCATE |

### Tables NOT touched (system config / infrastructure)

| Table | Rows | Reason |
|-------|------|--------|
| trading_strategies | — | Engine config |
| strategy_parameters | — | Engine config |
| strategy_signal_weights | — | Engine config |
| signal_registry | — | Engine config |
| llm_configurations | — | AI config |
| coinbase_oauth_credentials | — | Auth config |
| coinbase_sandbox_credentials | — | Auth config |
| ai_data_categories | — | Category definitions |
| ai_data_sources | — | Source definitions |
| data_sources | — | Source definitions |
| knowledge_documents | — | Knowledge base structure |
| knowledge_embeddings | — | Knowledge base structure |
| historical_market_data | 6,471 | Engine data source (BigQuery signals, AI learning) |
| external_market_data | 5,289 | Engine data source (AI learning, category context) |
| price_data | 2,630,885 | Engine data source (technical indicators, candles) |
| price_snapshots | 41,295 | Canonical price source (PnL, decisions, price-proxy) |
| market_data_health | — | Health tracking config |
| market_features_v0 | — | Feature store (reusable) |
| market_ohlcv_raw | — | Raw candles (reusable) |
| execution_wallets | — | Wallet infrastructure |
| execution_wallets_old | — | Wallet infrastructure |
| execution_wallet_secrets | — | Wallet secrets (NEVER touch) |
| execution_wallet_secrets_old | — | Wallet secrets (NEVER touch) |
| transfer_allowlist | — | Security config |
| mock_coverage | — | Config |

### Views (no action needed — auto-reflect underlying tables)

- `execution_quality_metrics_24h`, `execution_quality_onchain_24h`
- `past_positions_view`, `real_positions_view`, `real_trade_history_view`
- `strategy_open_positions`, `user_connections_safe`, `user_wallet_info`
- `v_decision_mix_24h`, `v_decisions_timeseries_24h`, `v_defer_health_15m`
- `v_internal_errors_1h`, `v_unexpected_reasons_24h`, `vw_trade_decision_linkage_60m`
- `price_data_with_indicators`

---

## STEP 1 — Export Last 48h Clean Dataset

Run these queries in the [Supabase SQL Editor](https://supabase.com/dashboard/project/fuieplftlcxdfkxyqzlt/sql/new) and export each result as CSV.

### 1a. Decision Events (anchor)

```sql
-- EXPORT: clean_baseline_48h/decision_events.csv
SELECT *
FROM decision_events
WHERE decision_ts >= NOW() - INTERVAL '48 hours'
ORDER BY decision_ts;
```

### 1b. Decision Snapshots (linked to anchor)

```sql
-- EXPORT: clean_baseline_48h/decision_snapshots.csv
SELECT s.*
FROM decision_snapshots s
WHERE s.decision_id IN (
  SELECT id FROM decision_events
  WHERE decision_ts >= NOW() - INTERVAL '48 hours'
)
ORDER BY s.created_at;
```

### 1c. Decision Outcomes (linked to anchor)

```sql
-- EXPORT: clean_baseline_48h/decision_outcomes.csv
SELECT o.*
FROM decision_outcomes o
WHERE o.decision_id IN (
  SELECT id FROM decision_events
  WHERE decision_ts >= NOW() - INTERVAL '48 hours'
)
ORDER BY o.evaluated_at;
```

### 1d. Live Signals (time-correlated window)

```sql
-- EXPORT: clean_baseline_48h/live_signals.csv
WITH anchor_window AS (
  SELECT
    MIN(decision_ts) - INTERVAL '10 minutes' AS start_ts,
    MAX(decision_ts) AS end_ts
  FROM decision_events
  WHERE decision_ts >= NOW() - INTERVAL '48 hours'
)
SELECT ls.*
FROM live_signals ls, anchor_window aw
WHERE ls.timestamp BETWEEN aw.start_ts AND aw.end_ts
ORDER BY ls.timestamp;
```

---

## STEP 2 — Export Full Historical Backup (OPTIONAL)

> **Note**: This step is optional. The 48h clean dataset from Step 1 is the primary deliverable.
> Step 2 provides a full historical backup for offline analytics only.
> If you skip it, the reset in Step 3 is still safe — the engine does not depend on this data.

⚠️ **Timeout safety**: These tables are large. Use `LIMIT` to avoid Supabase SQL Editor timeouts.
Run each query separately and export as CSV.

```sql
-- EXPORT: historical_backup/decision_events_full.csv
-- decision_events has ~154k rows — export in batches if needed
SELECT * FROM decision_events ORDER BY decision_ts LIMIT 200000;

-- EXPORT: historical_backup/decision_outcomes_full.csv
-- decision_outcomes has ~53k rows
SELECT * FROM decision_outcomes ORDER BY evaluated_at LIMIT 200000;
```

If either query times out, reduce the LIMIT or split with offset:
```sql
-- Batch 1
SELECT * FROM decision_events ORDER BY decision_ts LIMIT 100000 OFFSET 0;
-- Batch 2
SELECT * FROM decision_events ORDER BY decision_ts LIMIT 100000 OFFSET 100000;
```

---

## STEP 3 — Database Reset (TRUNCATE operational data)

**Run as a single transaction.** Order matters due to foreign key constraints (`decision_outcomes` → `decision_events`, `decision_snapshots` → `decision_events`).

```sql
-- ============================================================
-- STEP 3: TRUNCATE ALL RUNTIME DATA
-- Run in Supabase SQL Editor with service role
-- ============================================================

-- Timeout guards: prevent hanging if a running job holds a lock
SET lock_timeout = '10s';
SET statement_timeout = '5min';

BEGIN;

-- 3a. Decision pipeline (CASCADE handles FK deps)
TRUNCATE TABLE
  decision_outcomes,
  decision_snapshots,
  decision_events
RESTART IDENTITY CASCADE;

-- 3b. Signals
TRUNCATE TABLE live_signals RESTART IDENTITY CASCADE;
TRUNCATE TABLE trade_decisions_log RESTART IDENTITY CASCADE;

-- 3c. Trading runtime
TRUNCATE TABLE mock_trades RESTART IDENTITY CASCADE;
TRUNCATE TABLE trades RESTART IDENTITY CASCADE;
TRUNCATE TABLE trade_events RESTART IDENTITY CASCADE;
TRUNCATE TABLE real_trades RESTART IDENTITY CASCADE;

-- 3d. Execution runtime
TRUNCATE TABLE execution_circuit_breakers RESTART IDENTITY CASCADE;
TRUNCATE TABLE execution_jobs RESTART IDENTITY CASCADE;
TRUNCATE TABLE execution_locks RESTART IDENTITY CASCADE;
TRUNCATE TABLE execution_holds RESTART IDENTITY CASCADE;
TRUNCATE TABLE execution_quality_log RESTART IDENTITY CASCADE;
TRUNCATE TABLE coin_pool_states RESTART IDENTITY CASCADE;

-- 3e. Market signal events (NOT price_data, price_snapshots,
--      historical_market_data, external_market_data — engine depends on these)
TRUNCATE TABLE crypto_news RESTART IDENTITY CASCADE;
TRUNCATE TABLE whale_signal_events RESTART IDENTITY CASCADE;

-- 3f. Analytics / learning
TRUNCATE TABLE calibration_metrics RESTART IDENTITY CASCADE;
TRUNCATE TABLE calibration_suggestions RESTART IDENTITY CASCADE;
TRUNCATE TABLE strategy_performance RESTART IDENTITY CASCADE;
TRUNCATE TABLE signal_source_health RESTART IDENTITY CASCADE;
TRUNCATE TABLE ai_learning_metrics RESTART IDENTITY CASCADE;
TRUNCATE TABLE ai_knowledge_base RESTART IDENTITY CASCADE;
TRUNCATE TABLE ai_category_performance RESTART IDENTITY CASCADE;

-- 3g. User runtime data
TRUNCATE TABLE conversation_history RESTART IDENTITY CASCADE;
TRUNCATE TABLE deposit_attributions RESTART IDENTITY CASCADE;
TRUNCATE TABLE security_audit_log RESTART IDENTITY CASCADE;
TRUNCATE TABLE withdrawal_audit_log RESTART IDENTITY CASCADE;

-- 3h. Old backup tables (no longer needed post-export)
TRUNCATE TABLE decision_events_backup_all RESTART IDENTITY CASCADE;
TRUNCATE TABLE decision_events_backup_legacy RESTART IDENTITY CASCADE;
TRUNCATE TABLE decision_events_legacy RESTART IDENTITY CASCADE;
TRUNCATE TABLE mock_trades_backup_202602_fifo_fix RESTART IDENTITY CASCADE;
TRUNCATE TABLE mock_trades_fix_audit RESTART IDENTITY CASCADE;

COMMIT;

-- ============================================================
-- PRESERVED MARKET DATA TABLES (engine dependencies):
-- ============================================================
-- price_data          → technical-signal-generator, automated-trading-engine
-- price_snapshots     → price-proxy (canonical reader), trading-decision-coordinator, PnL engine
-- historical_market_data → bigquery-signal-generator, ai-learning-engine
-- external_market_data   → ai-learning-engine (category context)
--
-- These are NOT runtime state — they are reusable market history
-- that the engine reads for indicator computation and signal generation.
-- Truncating them would cause engine failures until data is re-ingested.
```

---

## STEP 4 — Delete Non-Admin Users

Admin user to **PRESERVE**:
- **Email**: `mon.petit.site.web@gmail.com`
- **ID**: `25a0c221-1f0e-431d-8d79-db9fb4db9cb3`

Users to **DELETE** (7 non-admin users):

| Email | ID |
|-------|-----|
| kuh49105@laoia.com | 3fbb4455-8616-41b0-95bb-148d90b17820 |
| josesiriutz@gmail.com | 738ed635-b4d3-4791-bbdb-ac062ff7c5b2 |
| robsiriutz@gmail.com | fd9ab68d-c2ce-4403-8d1b-1c58debe8957 |
| johann.baraut@uptimi.fr | c8900748-b8b9-4927-be73-fe4b88ef2dd9 |
| joseluis.isturiz972@gmail.com | f7be722b-d31b-414d-969c-a1aec0a8a487 |
| casiriutz@gmail.com | 4dfd3131-8753-4607-83c4-da457d6918ae |
| carlos.isturiz.cv@gmail.com | 3dc9783f-1a3a-4dd6-9c80-ee0de17e86c1 |

### 4a. Clean user-linked tables (run BEFORE deleting auth users)

```sql
-- Delete non-admin user data from tables that reference user_id
-- Admin ID: 25a0c221-1f0e-431d-8d79-db9fb4db9cb3

DELETE FROM user_roles
WHERE user_id != '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';

DELETE FROM profiles
WHERE id != '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';

DELETE FROM portfolio_capital
WHERE user_id != '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';

DELETE FROM user_coinbase_connections
WHERE user_id != '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';

DELETE FROM user_onboarding_status
WHERE user_id != '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';

DELETE FROM user_external_addresses
WHERE user_id != '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';
```

### 4b. Delete auth users via Edge Function

Cannot delete from `auth.users` directly. Use the existing `admin-delete-user` Edge Function for each non-admin user.

Call from the **Admin Panel → Customers tab** or via cURL:

```bash
# Repeat for each non-admin user ID listed above
curl -X POST \
  'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/admin-delete-user' \
  -H "Authorization: Bearer ${ADMIN_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -d '{"userId": "<USER_ID>"}'
```

User IDs to delete:
```
3fbb4455-8616-41b0-95bb-148d90b17820
738ed635-b4d3-4791-bbdb-ac062ff7c5b2
fd9ab68d-c2ce-4403-8d1b-1c58debe8957
c8900748-b8b9-4927-be73-fe4b88ef2dd9
f7be722b-d31b-414d-969c-a1aec0a8a487
4dfd3131-8753-4607-83c4-da457d6918ae
3dc9783f-1a3a-4dd6-9c80-ee0de17e86c1
```

---

## STEP 5 — Verify Clean State

```sql
-- All should return 0
SELECT 'decision_events' AS tbl, COUNT(*) FROM decision_events
UNION ALL SELECT 'decision_snapshots', COUNT(*) FROM decision_snapshots
UNION ALL SELECT 'decision_outcomes', COUNT(*) FROM decision_outcomes
UNION ALL SELECT 'live_signals', COUNT(*) FROM live_signals
UNION ALL SELECT 'mock_trades', COUNT(*) FROM mock_trades
UNION ALL SELECT 'trades', COUNT(*) FROM trades
UNION ALL SELECT 'real_trades', COUNT(*) FROM real_trades
UNION ALL SELECT 'trade_events', COUNT(*) FROM trade_events
UNION ALL SELECT 'trade_decisions_log', COUNT(*) FROM trade_decisions_log
UNION ALL SELECT 'execution_circuit_breakers', COUNT(*) FROM execution_circuit_breakers
UNION ALL SELECT 'coin_pool_states', COUNT(*) FROM coin_pool_states
UNION ALL SELECT 'calibration_metrics', COUNT(*) FROM calibration_metrics
UNION ALL SELECT 'crypto_news', COUNT(*) FROM crypto_news
UNION ALL SELECT 'conversation_history', COUNT(*) FROM conversation_history;

-- Market data tables should be NON-ZERO (preserved)
SELECT 'price_data' AS tbl, COUNT(*) FROM price_data
UNION ALL SELECT 'price_snapshots', COUNT(*) FROM price_snapshots
UNION ALL SELECT 'historical_market_data', COUNT(*) FROM historical_market_data
UNION ALL SELECT 'external_market_data', COUNT(*) FROM external_market_data;
-- Expected: non-zero (engine depends on these)

-- Admin user preserved
SELECT id, email FROM auth.users;
-- Expected: exactly 1 row → mon.petit.site.web@gmail.com

-- Admin role preserved
SELECT * FROM user_roles;
-- Expected: exactly 1 row → admin role for admin user

-- Config tables intact
SELECT COUNT(*) AS strategies FROM trading_strategies;
SELECT COUNT(*) AS signal_registry FROM signal_registry;
SELECT COUNT(*) AS strategy_params FROM strategy_parameters;
-- Expected: non-zero (unchanged from before reset)
```

---

## STEP 6 — Engine Restart & Lineage Verification

After reset, restart the trading engine. Wait for at least one decision cycle, then verify:

```sql
-- Verify new decisions are being written with full lineage
SELECT
  e.id AS event_id,
  e.decision_ts,
  e.symbol,
  e.side,
  s.id AS snapshot_id,
  s.signal_breakdown_json->>'fusion_version' AS fusion_version,
  s.signal_breakdown_json->'signals_used' AS signals_used,
  s.signal_breakdown_json->'source_contributions' AS source_contributions
FROM decision_events e
LEFT JOIN decision_snapshots s ON s.decision_id = e.id
ORDER BY e.decision_ts DESC
LIMIT 10;

-- Verify outcomes will link correctly (may need to wait for evaluator)
SELECT
  e.id,
  s.decision_id AS snapshot_linked,
  o.decision_id AS outcome_linked
FROM decision_events e
LEFT JOIN decision_snapshots s ON s.decision_id = e.id
LEFT JOIN decision_outcomes o ON o.decision_id = e.id
ORDER BY e.decision_ts DESC
LIMIT 10;
```

---

## Execution Order Summary

| Step | Action | Destructive? |
|------|--------|-------------|
| 1 | Export 48h clean dataset (4 CSVs) | No |
| 2 | Export full historical backup (2 CSVs) | No |
| 3 | TRUNCATE 31 runtime tables (4 market data tables preserved) | **Yes** |
| 4a | DELETE non-admin rows from user tables | **Yes** |
| 4b | Delete non-admin auth users via Edge Function | **Yes** |
| 5 | Run verification queries | No |
| 6 | Restart engine, verify lineage | No |

---

## Confirmation Checklist

- [ ] 48h export completed (4 CSV files)
- [ ] Historical backup completed (2 CSV files)
- [ ] 31 runtime tables truncated
- [ ] 4 market data tables preserved (price_data, price_snapshots, historical_market_data, external_market_data)
- [ ] 7 non-admin users deleted from auth.users
- [ ] Non-admin user data cleaned from user tables
- [ ] Admin user `mon.petit.site.web@gmail.com` preserved
- [ ] Admin role preserved in user_roles
- [ ] Config tables (strategies, signal_registry, etc.) untouched
- [ ] Wallet/secrets tables untouched
- [ ] Edge functions untouched
- [ ] Engine restarted and producing new decisions
- [ ] New decisions have signal lineage (signals_used, source_contributions)
- [ ] Pipeline: decision_events → decision_snapshots → decision_outcomes all linking
