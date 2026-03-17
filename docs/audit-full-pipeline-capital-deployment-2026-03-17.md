# Full Trade Pipeline & Capital Deployment Audit
**Date**: 2026-03-17  
**Scope**: Capital deployment, BUY blocking, position model, guard logic, config vs reality  
**Method**: Code inspection + SQL evidence (no speculation)

---

## A. Capital Constraint Diagnosis

### Runtime Configuration (from DB — `trading_strategies`)

| Config Key | DB Value |
|---|---|
| `perTradeAllocation` | **€1,000** |
| `maxActiveCoins` | **10** |
| `maxWalletExposure` | **80%** |
| `riskManagement.maxWalletExposure` | **100%** |
| `walletValueEUR` | **€30,000** |
| `selectedCoins` | BTC, ETH, SOL, AVAX, XRP, ADA (6) |

### Derived Limits (from `detectConflicts()` L5766-5792)

```
maxWalletExposurePct = min(80, 100) = 80%
maxWalletExposureEUR = 30000 × 0.80 = €24,000
maxActiveCoins = 10
maxExposurePerCoinEUR = €24,000 / 10 = €2,400
perTradeAllocation = €1,000
```

### Theoretical Max Deployable

```
Coins available = 6 (selectedCoins)
Max per coin = €2,400
Theoretical max = 6 × €2,400 = €14,400 (48% of portfolio)
```

But with `perTradeAllocation = €1,000` and **1 position per symbol** (see Section C):

```
Actual max = 6 coins × €1,000 = €6,000 (20% of portfolio)
```

### Current State

| Metric | Value |
|---|---|
| Starting Capital | €30,000.00 |
| Cash Balance | €25,594.45 |
| Capital Deployed (cash delta) | **~€4,405.55** |
| Open Positions | 6 |
| Position Values | BTC €600, ETH €600, SOL €600, XRP €600, ADA €1,000, AVAX €1,000 |
| Total Deployed | **€4,400** (14.7%) |

### Primary Binding Constraint

**The system deploys exactly 1 BUY per symbol, then blocks all subsequent BUYs via the `unique_open_position_per_symbol` DB index.** With 6 coins × 1 trade each at €600-€1,000, max deployment is ~€4,400-€6,000.

The `maxActiveCoins=10` and `maxWalletExposure=80%` are **NOT binding**. The binding constraint is the **1-position-per-symbol invariant**.

---

## B. BUY Blocking Breakdown (Last 48h)

| Category | Count | % | Blocking Capital? |
|---|---|---|---|
| **PASSED_GUARDS** | 131 | 44.6% | No (approved) |
| **EXECUTION_FAILED** | 44 | 15.0% | ⚠️ Yes — passed guards but failed at execution |
| **SIGNAL_ALIGNMENT** | 36 | 12.2% | Yes — trend/momentum thresholds |
| **FUSION_BELOW_THRESHOLD** | 28 | 9.5% | Yes — score < enter threshold |
| **MAX_ACTIVE_COINS** | 28 | 9.5% | Yes — but only if ≥10 coins (currently 6, so this fires on **existing position** when coin already has slot) |
| **EXPOSURE_LIMIT** | 26 | 8.8% | Yes — wallet or per-coin cap |
| **SL_COOLDOWN** | 1 | 0.3% | Minimal |

### Key Insight

**131 BUY decisions (44.6%) passed all guards** but only **8 produced trades** (7 days). The gap is the **`position_already_open` structural invariant** — the DB unique index rejects the INSERT silently, and the coordinator returns `position_already_open` or logs it as `direct_execution_failed`.

The 44 `EXECUTION_FAILED` decisions are largely these duplicate BUY rejections at the DB layer.

### What Actually Blocks Capital Scaling

| Blocker | Impact | Root Cause |
|---|---|---|
| **1 position per symbol** | PRIMARY | DB unique index `unique_open_position_per_symbol` |
| **Only 6 coins configured** | SECONDARY | `selectedCoins` has 6 entries |
| **No pyramiding execution** | TERTIARY | Even though pyramiding context model exists in code, the DB index physically prevents it |

---

## C. Position Model (DEFINITIVE ANSWER)

### Answer: **A) 1 position per symbol (enforced at DB level)**

### Evidence

#### 1. Database Constraint (authoritative)

```sql
CREATE UNIQUE INDEX unique_open_position_per_symbol 
ON public.mock_trades 
USING btree (user_id, cryptocurrency, is_test_mode) 
WHERE (is_open_position = true);
```

This index **physically prevents** two rows with `is_open_position = true` for the same `(user_id, cryptocurrency, is_test_mode)`.

#### 2. Coordinator Code (3 separate blocking paths)

**Path A — UI Test BUY (L1778-1794):**
```typescript
if (isOpenPositionConflict(insertError)) {
  return { reason: "position_already_open" };
}
```

**Path B — REAL/Onchain BUY (L3226-3242):**
```typescript
if (isBuySide && isOpenPositionConflict(placeholderError)) {
  return { reason: "position_already_open" };
}
```

**Path C — UD=ON Mock BUY (L7892-7917):**
```typescript
if (isOpenPositionConflict(error)) {
  return { success: false, error: "position_already_open" };
}
```

#### 3. Pyramiding Context Model — Exists in Theory, Blocked in Practice

The codebase contains `CONTEXT_DUPLICATE_EPSILON_PCT` and pyramiding entry-context logic, but the DB unique index makes it impossible to create a second open BUY for the same symbol. **Pyramiding is architecturally defined but structurally blocked.**

#### 4. Current Data Confirms

```
ADA:  1 open position
AVAX: 1 open position  
BTC:  1 open position
ETH:  1 open position
SOL:  1 open position
XRP:  1 open position
```

---

## D. Guard Constraints Summary

### BUY Decision Guard Chain (in execution order)

Guard evaluation happens in `detectConflicts()` (L5630–5900+):

| Order | Guard | Location | Can Block Capital? | Currently Binding? |
|---|---|---|---|---|
| 1 | **SELL-side position check** | L6151-6210 | N/A (SELL only) | N/A |
| 2 | **Exposure query** | L5660-5732 | Indirect | No |
| 3 | **Global wallet exposure** | L5766-5772 | Yes | No (€4.4k << €24k cap) |
| 4 | **Max active coins** | L5776-5782 | Yes | No (6 < 10) |
| 5 | **Per-symbol exposure** | L5786-5791 | Yes | No (€1k < €2.4k cap) |
| 6 | **SL cooldown** | L5810-5853 | Yes | Minimal (1 hit) |
| 7 | **Signal alignment** | L5855-5903 | Yes | **YES — 12.2% blocked** |
| 8 | **DB unique index** | INSERT time | **YES** | **YES — PRIMARY BLOCKER** |

### Guard Dependencies

| Guard | Depends On |
|---|---|
| Wallet exposure | Portfolio-level (all symbols) |
| Max active coins | Portfolio-level (unique symbol count) |
| Per-symbol exposure | Symbol-specific |
| SL cooldown | Symbol + time |
| Signal alignment | Signal scores in metadata |
| DB unique index | Symbol (per user/mode) |

---

## E. Config vs Reality Mismatches

| Config Says | Reality | Mismatch? |
|---|---|---|
| `maxActiveCoins = 10` | Only 6 coins in `selectedCoins` → max 6 used | ⚠️ Config allows 10, but only 6 coins exist |
| `maxWalletExposure = 80%` (€24k) | Only €4.4k deployed (18% of allowed) | ✅ Not binding, but vastly underutilized |
| `perTradeAllocation = €1,000` | BTC/ETH/SOL/XRP positions = €600 (legacy), ADA/AVAX = €1,000 (post-update) | ⚠️ Legacy positions at old €600 value |
| Pyramiding model exists in code | DB unique index blocks it | 🔴 **Architectural contradiction** |
| Config implies scaling (10 coins, 80% exposure) | 1 trade per coin caps at 6 × €1,000 = €6,000 (20%) | 🔴 **System cannot reach configured exposure** |

---

## F. Recommendations

### Safe Config Changes (no code changes needed)

| Change | Effect | Risk |
|---|---|---|
| Add more coins to `selectedCoins` (e.g., DOT, LINK, BCH, LTC) | More slots → more capital deployed | Low — coins already have market data |
| Increase `perTradeAllocation` to €2,000-€4,000 | Larger single positions | Medium — more per-trade risk |

### Architectural Changes Required (code changes needed)

| Change | Effect | Risk | Complexity |
|---|---|---|---|
| **Remove/modify `unique_open_position_per_symbol` index** | Enable pyramiding (multiple trades per symbol) | HIGH — requires position tracking redesign | HIGH |
| **Implement DCA/pyramiding execution path** | Allow adding to existing positions | Medium — context model already exists | MEDIUM |
| **Dynamic trade sizing (% of available capital)** | Scales with portfolio | Low | LOW |

### Root Cause Summary

```
WHY only €4.4k deployed on €30k portfolio?

1. DB unique index: 1 position per symbol (HARD BLOCK)
2. Only 6 coins configured
3. 1 × €600-€1,000 per coin = €4,400 max
4. maxActiveCoins=10, maxWalletExposure=80% are NOT binding
5. The binding constraint is the STRUCTURAL 1-per-symbol invariant
6. Pyramiding code exists but is physically blocked by the DB index
```

---

## Appendix: SQL Evidence

### Open Positions
```
ADA:  1 open, €1,000 (4008 units)
AVAX: 1 open, €1,000 (112 units)
BTC:  1 open, €600 (0.00958 units)
ETH:  1 open, €600 (0.326 units)
SOL:  1 open, €600 (7.783 units)
XRP:  1 open, €600 (484.8 units)
```

### Portfolio Capital
```
starting_capital_eur: €30,000
cash_balance_eur:     €25,594.45
reserved_eur:         €0.00
```

### SELL Decisions (last 48h)
```
DEFER:TAKE_PROFIT          29
DEFER:SELL_TRAILING_RUNNER  18
DEFER:STOP_LOSS              7
no_conflicts_detected (TP)   6
no_conflicts_detected (TR)   6
no_conflicts_detected (SL)   1
```

### Executed Trades (last 7d)
```
BUY:  ADA ×2, AVAX ×2, BTC ×1, ETH ×1, SOL ×1, XRP ×1 = 8 trades
SELL: ADA ×1 (€991.63), AVAX ×1 (€602.82) = 2 trades
```
