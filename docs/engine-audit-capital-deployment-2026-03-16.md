# Trading Engine Audit — Capital Deployment Diagnostic
**Date**: 2026-03-16  
**Scope**: Decision → Execution pipeline, capital allocation, guard impact

---

## Executive Summary

The engine is **working correctly as configured**. The low capital deployment (~€2,400 of €30,000 = 8%) is **not a bug** — it is a direct consequence of two configuration values:

| Config Key | Value | Effect |
|---|---|---|
| `perTradeAllocation` | **€600** (static) | Every BUY is exactly €600 |
| `maxActiveCoins` | **4** | Max 4 unique coins can have open positions |

**Max possible deployment = 4 × €600 = €2,400** (8% of portfolio).

This is the root cause. The system cannot deploy more capital without changing these two values.

---

## 1️⃣ Portfolio Exposure Diagnostics

| Metric | Value |
|---|---|
| Starting Capital | €30,000.00 |
| Cash Balance | €27,602.82 |
| Reserved | €0.00 |
| Capital Deployed | ~€2,397.18 (cash delta) |
| Open Positions | 4 |
| Closed Positions | 1 (AVAX, sold) |
| Avg Position Size | €600.00 (exact) |
| **Exposure %** | **~8.0%** |
| Max Wallet Exposure Config | 80% (€24,000) |
| Utilization of Max Exposure | 10% of allowed |

### Open Positions

| Coin | Qty | Entry Price | Invested |
|---|---|---|---|
| BTC | 0.00958124 | €62,622.35 | €600.00 |
| ETH | 0.32597889 | €1,840.61 | €600.00 |
| SOL | 7.78311065 | €77.09 | €600.00 |
| XRP | 484.84848485 | €1.2375 | €600.00 |

**1 closed trade**: AVAX (70.5 units @ €8.51 = €600.00, now closed).

---

## 2️⃣ Trade Size Explanation

**All 5 trades are exactly €600.00.**

This is **static sizing** driven by:

```
File: trading_strategies.configuration
Key:  perTradeAllocation = 600
Key:  allocationUnit = "euro"
```

The coordinator computes `qty_suggested = perTradeAllocation / marketPrice`:
- BTC: 600 / 62622.35 = 0.00958
- ETH: 600 / 1840.61 = 0.3259
- SOL: 600 / 77.09 = 7.783
- XRP: 600 / 1.2375 = 484.85

**No dynamic sizing is applied.** The €600 comes directly from strategy config, not from any percentage-of-portfolio calculation.

---

## 3️⃣ Guard Blocking Statistics (Last 30 Days)

| Guard Category | Count | Impact |
|---|---|---|
| ✅ no_conflicts (passed) | 109 | Allowed through guards |
| 🔴 direct_execution_failed | 44 | Passed guards but execution failed |
| 🔴 max_active_coins_reached | 28 | **Blocked — 4-coin cap hit** |
| 🔴 exposureLimitExceeded | 26 | **Blocked — exposure cap hit** |
| 🟡 signalAlignmentFailed | 18 | Blocked by signal alignment |
| 🟡 blocked_by_signal_alignment | 18 | Blocked by signal alignment |

### Analysis

- **max_active_coins_reached (28)**: The 4-coin cap is the **primary bottleneck**. Once BTC, ETH, SOL, XRP filled slots, no new coins (AVAX, ADA) can enter.
- **exposureLimitExceeded (26)**: Per-coin exposure cap. With `maxWalletExposure=80%` and `maxActiveCoins=4`, each coin gets max €6,000. But since positions are only €600, this likely fires when combined with the coin cap.
- **direct_execution_failed (44)**: 🔴 **This is an anomaly.** 44 decisions passed all guards but failed at execution. This needs investigation — likely coordinator returning errors during the execution step.

---

## 4️⃣ Decision → Trade Conversion Rate

| Metric | Count |
|---|---|
| Total Decisions (30d) | 338 |
| BUY Decisions | 243 |
| Executed BUY Trades | 5 |
| **BUY Conversion Rate** | **2.06%** |
| SELL Decisions | 25 |
| Executed SELL Trades | 0 |

### Funnel Breakdown (243 BUY decisions):

```
243 BUY decisions
 ├── 109 passed guards (no_conflicts)
 │    ├── 5 executed successfully ✅
 │    └── 104 ORPHAN DECISIONS ⚠️ (passed guards, no trade)
 ├── 44 direct_execution_failed
 ├── 28 max_active_coins_reached
 ├── 26 exposureLimitExceeded
 └── 36 signal alignment failures
```

### 🔴 Critical Finding: 104 Orphan Decisions

**104 BUY decisions passed all guards (`no_conflicts_detected`) but have `trade_id = NULL`.**

These represent decisions that the coordinator approved but never resulted in a trade. Possible causes:
1. Coordinator returned success but backend didn't execute
2. Execution attempt failed silently
3. The `no_conflicts_detected` reason was logged before execution, and execution failed without updating the decision

This is the **largest leak** in the pipeline and explains the low conversion rate.

---

## 5️⃣ Position Limits Configuration

| Limit | Configured Value | Current State | Binding? |
|---|---|---|---|
| `maxActiveCoins` | **4** | 4 coins open | ✅ **YES — AT LIMIT** |
| `maxWalletExposure` | 80% (€24,000) | €2,400 deployed | No |
| `riskManagement.maxWalletExposure` | 100% | N/A (min with above = 80%) | No |
| `perTradeAllocation` | €600 | All trades = €600 | Static cap |
| `selectedCoins` | 6 coins | 4 used, 2 blocked | Limited by maxActiveCoins |
| Hard max trade size | €1,000 | €600 per trade | Not binding |

**The binding constraint is `maxActiveCoins = 4` combined with `perTradeAllocation = 600`.**

Since the system does not pyramid (add to existing positions), max deployment = 4 × 600 = €2,400.

---

## 6️⃣ Hidden Failures Detected

### A. 104 Orphan Decisions (CRITICAL)
- 104 BUY decisions passed guards but produced no trade
- These need investigation in coordinator logs

### B. 44 Direct Execution Failures (HIGH)
- Decisions flagged as `DEFER:direct_execution_failed`
- Suggests the coordinator's execution path is failing after approval

### C. 0 Executed SELL Trades (MEDIUM)
- 25 SELL decisions, 0 executions
- Open positions are not being exited — either TP/SL not hit, or sell execution is also failing

### D. `execution_status` = NULL on Executed Trades (LOW)
- All 5 executed trades have `exec_status = NULL` in metadata
- The `buildDecisionMetadata` helper should be setting this to `EXECUTED`

---

## 7️⃣ Root Cause Analysis

### Why only €2,400 deployed out of €30,000?

```
Root Cause Chain:
1. perTradeAllocation = €600 (static, not % of portfolio)
2. maxActiveCoins = 4 (hard cap on unique coins)
3. No pyramiding (system opens 1 position per coin)
4. Max deployment = 4 × €600 = €2,400
5. Once 4 coins filled → ALL subsequent BUYs blocked by max_active_coins
6. Additionally: 104 approved decisions never executed (pipeline leak)
```

### Configuration Origin

```
File: trading_strategies table
Strategy: "High Risk Momentum Trader" (5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e)
Test Mode: true

Relevant config keys:
  configuration.perTradeAllocation = 600
  configuration.allocationUnit = "euro"
  configuration.maxActiveCoins = 4
  configuration.maxWalletExposure = 80
  configuration.walletValueEUR = 30000
  configuration.selectedCoins = ["BTC", "ETH", "SOL", "AVAX", "XRP", "ADA"]
```

---

## 8️⃣ Recommendations

### To increase capital deployment:

| Change | Effect | Risk |
|---|---|---|
| Increase `perTradeAllocation` to €1,500-€3,000 | Larger positions | Higher per-trade risk |
| Increase `maxActiveCoins` to 6 (match selectedCoins) | Use all 6 coins | More diversified |
| Enable pyramiding (multiple entries per coin) | DCA into existing positions | Concentration risk |
| Switch to dynamic sizing (% of portfolio) | Scales with capital | Requires code change |

### Recommended immediate config change:
```
maxActiveCoins: 6  (match the 6 selected coins)
perTradeAllocation: 1500  (or dynamic % of remaining capital)
```

This would allow: 6 × €1,500 = €9,000 initial deployment (30% of portfolio).

### To fix pipeline leaks:

1. **Investigate 104 orphan decisions** — check coordinator edge function logs for errors during execution
2. **Investigate 44 direct_execution_failed** — likely coordinator returning errors
3. **Fix exec_status = NULL** — ensure `buildDecisionMetadata` runs on all executed trades
4. **Investigate 0 SELL executions** — verify exit logic is reaching the coordinator

---

## Verification Queries

```sql
-- Orphan decisions (passed guards, no trade)
SELECT id, symbol, reason, created_at, metadata
FROM decision_events
WHERE side = 'BUY' AND trade_id IS NULL
  AND reason ILIKE '%no_conflicts_detected%'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- Execution failures
SELECT id, symbol, reason, created_at, metadata
FROM decision_events
WHERE side = 'BUY'
  AND reason ILIKE '%direct_execution_failed%'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- SELL decision details
SELECT id, symbol, reason, trade_id, created_at, metadata
FROM decision_events
WHERE side = 'SELL'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```
