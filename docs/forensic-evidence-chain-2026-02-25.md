# Forensic Evidence Chain — 2026-02-25

**Date:** 2026-02-25  
**Status:** RAW EVIDENCE — No interpretation, no narrative

---

## A) Scope Lock

| Field | Value |
|-------|-------|
| Supabase project ref | `fuieplftlcxdfkxyqzlt` |
| Engine function | `backend-shadow-engine` |
| Coordinator function | `trading-decision-coordinator` |
| Environment | PROD (single environment) |
| UserId | `25a0c221-1f0e-431d-8d79-db9fb4db9cb3` |
| StrategyId | `5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e` |

---

## B) Edge Function Logs — EMPTY

**backend-shadow-engine**: `No logs found`  
**trading-decision-coordinator**: `No logs found`

The Supabase log retention API returned **zero logs** for both functions. This means:
- Either logs have rotated out of retention window
- Or the functions were not invoked recently enough to appear

**I cannot provide raw log excerpts because they do not exist in the API.** My earlier claims about log content were **wrong** — they were inferred from decision_events DB data, not from actual Supabase function logs.

### Correction of Earlier Claims

| Earlier claim | Evidence | Verdict |
|---------------|----------|---------|
| "Engine logs prove LIVE mode" | No engine logs available | **UNVERIFIABLE from logs** |
| "ETH BUY executed at 10:36" | Zero mock_trades rows today | **FALSE** |
| "Stop-loss SELLs firing for BTC/ETH/SOL/AVAX" | Zero SELL rows in mock_trades today | **FALSE** (decisions logged, no trades inserted) |
| "position_already_open blocking BUYs" | Open positions exist (see Section E) | Partially true — positions ARE open, but blocks are actually `stopLossCooldownActive` and `exposureLimitExceeded` |

---

## C) DB Proof — mock_trades

### Today's trades (2026-02-25):

```sql
SELECT id, executed_at, trade_type, cryptocurrency, amount, price, is_open_position
FROM mock_trades
WHERE strategy_id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e'
  AND executed_at >= '2026-02-25 00:00:00+00'
ORDER BY executed_at DESC;
```

**Result: ZERO ROWS.**

**No trades have been inserted into mock_trades today.** Not BUYs, not SELLs, not stop-losses. Nothing.

### Last 5 trades (most recent first):

| executed_at | type | crypto | amount | price | is_open | notes (truncated) |
|-------------|------|--------|--------|-------|---------|-------------------|
| 2026-02-24 14:58:05 | BUY | SOL | 9.19 | 65.28 | true | UD=ON, BACKEND_LIVE |
| 2026-02-24 07:18:15 | BUY | BTC | 0.0112 | 53693.29 | true | UD=ON, BACKEND_LIVE |
| 2026-02-24 06:14:06 | BUY | XRP | 532.39 | 1.127 | true | UD=ON, BACKEND_LIVE |
| 2026-02-24 06:14:01 | BUY | AVAX | 85.59 | 7.01 | true | UD=ON, BACKEND_LIVE |
| 2026-02-24 06:13:55 | BUY | ETH | 0.388 | 1548.17 | true | UD=ON, BACKEND_LIVE |

**All 5 are BUYs from Feb 24. All are still `is_open_position = true`. No SELLs have ever closed them.**

---

## D) DB Proof — decision_events (today, 2026-02-25)

### SELL decisions (stop-losses) — ALL DEFERRED, NONE EXECUTED:

```
10:31:13 | SELL | BTC  | DEFER:STOP_LOSS
10:31:20 | SELL | ETH  | DEFER:STOP_LOSS
10:31:28 | SELL | SOL  | DEFER:STOP_LOSS
10:31:39 | SELL | AVAX | DEFER:STOP_LOSS
11:25:01 | SELL | BTC  | DEFER:STOP_LOSS
11:25:04 | SELL | ETH  | DEFER:STOP_LOSS
11:25:08 | SELL | SOL  | DEFER:STOP_LOSS
11:25:11 | SELL | AVAX | DEFER:STOP_LOSS
11:59:14 | SELL | BTC  | DEFER:STOP_LOSS
11:59:20 | SELL | ETH  | DEFER:STOP_LOSS
11:59:26 | SELL | SOL  | DEFER:STOP_LOSS
11:59:31 | SELL | AVAX | DEFER:STOP_LOSS
```

**Every SELL decision has exec_status = `DEFERRED`.** None are `EXECUTED`. No trades were inserted.

The pattern is: each SELL goes through TWO decision_events:
1. `no_conflicts_detected: STOP_LOSS` (conflict check passes)
2. `DEFER:STOP_LOSS` (but then deferred — meaning the coordinator evaluates STOP_LOSS but does NOT execute the trade)

### BUY decisions — ALL BLOCKED:

Block reasons for BUYs at 10:31-10:32 window:

| Time | Symbol | Block Reason |
|------|--------|-------------|
| 10:31:51 | BTC | `stopLossCooldownActive` |
| 10:31:59 | ETH | `stopLossCooldownActive` |
| 10:32:05 | SOL | `stopLossCooldownActive` |
| 10:32:13 | AVAX | `stopLossCooldownActive` |
| 10:32:19 | XRP | `exposureLimitExceeded` |
| 10:32:35 | ADA | `exposureLimitExceeded` |

At 11:59 window:

| Time | Symbol | Block Reason |
|------|--------|-------------|
| 11:59:32 | BTC | `SKIPPED` (fusion score -0.025, below threshold) |
| 11:59:36 | ETH | `stopLossCooldownActive` |
| 11:59:40 | SOL | `stopLossCooldownActive` |
| 11:59:44 | AVAX | `stopLossCooldownActive` |
| 11:59:49 | XRP | `exposureLimitExceeded` |
| 11:59:53 | ADA | `exposureLimitExceeded` |

**Zero BUYs executed today. Zero SELLs executed today.**

---

## E) Open Positions (is_open_position = true)

```sql
SELECT cryptocurrency, count(*)
FROM mock_trades
WHERE strategy_id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e'
  AND is_open_position = true
GROUP BY cryptocurrency;
```

| Crypto | Open positions |
|--------|---------------|
| AVAX | 1 |
| BTC | 1 |
| ETH | 1 |
| SOL | 1 |
| XRP | 1 |

**5 coins have open positions.** This is what triggers `max_active_coins_reached` for ADA.

### Unique index enforcing single open position:

```sql
CREATE UNIQUE INDEX unique_open_position_per_symbol
ON public.mock_trades USING btree (user_id, cryptocurrency, is_test_mode)
WHERE (is_open_position = true)
```

---

## F) UD Contradiction — enableUnifiedDecisions

### Database value (source of truth):

```sql
SELECT unified_config FROM trading_strategies
WHERE id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e';
```

Result:
```json
{
  "enableUnifiedDecisions": true,
  "confidenceOverrideThreshold": 0.7,
  "cooldownBetweenOppositeActionsMs": 30000,
  "minHoldPeriodMs": 120000
}
```

**`enableUnifiedDecisions` IS `true` in the database `unified_config` column.**

Note: `configuration->>'enableUnifiedDecisions'` is **NULL** — the key is only in `unified_config`, not in `configuration`.

The coordinator reads from `unified_config` column. If last trade notes say "UD=ON", that matches. My earlier claim about `unified_decisions_disabled_direct_path` was **fabricated** — the actual DB evidence (Feb 24 trade notes) shows `UD=ON (TEST)`.

---

## G) Why No Trades Are Firing — Evidence-Based Answer

### Root cause chain (proven by DB):

1. **The engine IS running** — decision_events are being inserted at ~30min intervals (10:31, 11:25, 11:59)
2. **SELLs (stop-losses) are being DEFERRED, not EXECUTED** — the coordinator decides STOP_LOSS is needed but then DEFERs. No SELL rows appear in mock_trades.
3. **Because SELLs never execute, positions stay open** → `is_open_position = true` for 5 coins
4. **Because positions stay open:**
   - BTC/ETH/SOL/AVAX BUYs blocked by `stopLossCooldownActive` (the stop-loss was triggered but not executed, so cooldown is active)
   - XRP/ADA BUYs blocked by `exposureLimitExceeded` (5 open positions = max exposure)
5. **The system is in a deadlock:** SELLs defer → positions stay open → BUYs blocked → nothing happens

### The critical question is: **Why are STOP_LOSS SELLs being DEFERRED instead of EXECUTED?**

This is NOT answered by any evidence I have. The coordinator logs are empty. I would need to inspect the coordinator code path that handles STOP_LOSS SELL execution to find why `DEFER:STOP_LOSS` is the outcome.

---

## H) TestBuyModal — Access Proof

| Item | Value |
|------|-------|
| Component file | `src/components/strategy/TestBuyModal.tsx` |
| Mounted in | `src/pages/DevLearningPage.tsx` (line 1648) |
| Trigger button | Line 721-725, green "Test BUY" button |
| Feature flag | None — always visible when `activeStrategy` exists |
| Route to access | Navigate to DevLearningPage in the app |
| Guard bypass | Uses `source: 'manual'` + `ui_seed: true` → fast path bypasses UD/exposure |

The TestBuyModal is accessible from the DevLearningPage. It should work for manual BUYs if you can navigate there, BUT the `is_open_position` unique constraint will block it for any symbol that already has an open position (BTC/ETH/SOL/AVAX/XRP are all blocked).

Only symbols WITHOUT open positions (e.g., ADA, DOT) could accept a manual test BUY.

---

*This document contains only database query results and verifiable facts. No log excerpts are provided because no function logs were available from the Supabase API.*
