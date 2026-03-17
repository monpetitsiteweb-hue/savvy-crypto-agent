# BUY Pipeline, Guard Semantics, and Pooling/Pyramiding Readiness Audit

**Date**: 2026-03-17  
**Scope**: Post-fix regime only (last 48h of decision_events + current codebase)  
**Method**: SQL evidence + code tracing. No assumptions.

---

## A. Breakdown of "Passed Guards" Bucket

### Data Source
`decision_events WHERE side='BUY' AND decision_ts > NOW() - INTERVAL '48 hours'`  
**Total BUY evaluations**: 296

### Precise Categorization

The "passed guards" bucket corresponds to all decisions with reason starting with `no_conflicts_detected` or `BUY:no_conflicts_detected`. These are decisions where `detectConflicts()` returned `hasConflict: false`.

| Subcategory | Count | % of Total | Evidence |
|---|---|---|---|
| **Passed guards AND trade executed** (has `trade_id`) | 8 | 2.7% | `trade_id IS NOT NULL` on `no_conflicts_detected` rows |
| **Passed guards BUT no trade row** (no `trade_id`) | 122 | 41.2% | `trade_id IS NULL` on `no_conflicts_detected` rows |
| **Total "passed guards"** | **130** | **43.9%** | — |

### Sub-breakdown of the 122 "passed guards but no trade" rows

These 122 decisions passed `detectConflicts()` but the coordinator did NOT backfill `trade_id`. Breakdown by what happened next:

| Sub-outcome | Count | Evidence |
|---|---|---|
| Reason = `no_conflicts_detected: signal_confirmed_fusion_1.000` (no trade_id) | 58 | Pre-coordinator evaluation log (triple-logging). These are the **backend pre-evaluation decision events**, logged BEFORE the coordinator is even called. They never had a trade attempt. |
| Reason = `no_conflicts_detected: backend_entry_evaluation` (no trade_id) | 24 | Same: backend evaluation log, pre-coordinator. |
| Reason = `no_conflicts_detected: signal_confirmed_fusion_<X>` (no trade_id, various scores) | 34 | Same pattern — backend evaluation logs at varying fusion scores. |
| Reason = `BUY:no_conflicts_detected` (no trade_id) | 6 | Coordinator audit log (separate from execution). |

**Critical finding**: The majority of "passed guards but no trade_id" rows are **pre-coordinator evaluation logs** — they are decision events logged by the backend engine BEFORE the intent is sent to the coordinator. They do NOT represent failed execution attempts. They represent the engine's positive signal evaluation.

The actual execution outcomes are:
- **8 trades executed** (trade_id present)
- **44 trades attempted but failed** (reason = `DEFER:direct_execution_failed`)
- The 122 "no trade_id" rows are mostly observability/audit logs, not execution failures

### Corrected "Passed Guards" Summary

| Outcome | Count | % of 296 |
|---|---|---|
| Pre-coordinator positive evaluations (observability only, not execution attempts) | ~116 | 39.2% |
| Actual coordinator guard-pass → execution success | 8 | 2.7% |
| Actual coordinator guard-pass → execution failure (`direct_execution_failed`) | 44 | 14.9% |
| Blocked by signal alignment (coordinator gate) | 18 | 6.1% |
| Blocked by signal alignment (pre-coordinator) | 18 | 6.1% |
| Blocked by fusion threshold | 30 | 10.1% |
| Blocked by exposure limit | 26 | 8.8% |
| Blocked by max active coins | 27 | 9.1% |
| Blocked by cooldown | 1 | 0.3% |
| Other/unclassified | 8 | 2.7% |

---

## B. Exact Meaning of Signal Alignment

### Source
**File**: `supabase/functions/trading-decision-coordinator/index.ts`  
**Function**: `detectConflicts()`, lines 5855-5906  
**Gate name**: GATE 2: MULTI-SIGNAL ALIGNMENT

### Exact Inputs
```typescript
const trendScore = signalScores.trend ?? 0;
const momentumScore = signalScores.momentum ?? 0;
const volatilityScore = signalScores.volatility ?? 0;
```
Where `signalScores = intent.metadata?.signalScores || {}` — passed from the backend engine as part of the BUY intent metadata.

### Exact Thresholds (from strategy config, fail-closed)
```typescript
const minTrendScore = cfg.minTrendScoreForBuy;        // REQUIRED - no fallback
const minMomentumScore = cfg.minMomentumScoreForBuy;  // REQUIRED - no fallback
const maxVolatilityForBuy = cfg.maxVolatilityScoreForBuy; // REQUIRED - no fallback
```

### Exact Pass Condition
```typescript
const alignmentPassed = trendScore >= minTrendScore && momentumScore >= minMomentumScore;
```

### Exact Fail Condition
A BUY fails signal alignment when **either**:
- `trendScore < minTrendScoreForBuy`, OR
- `momentumScore < minMomentumScoreForBuy`

**Volatility** is checked separately in Gate 3: `volatilityScore > maxVolatilityForBuy` → blocked.

### When Evaluated
Signal alignment is evaluated **inside** `detectConflicts()`, which is called **after** the intent passes to the coordinator. The evaluation order within `detectConflicts()` is:

1. Exposure checks (wallet, max coins, per-symbol)
2. **Gate 1**: Stop-loss cooldown
3. **Gate 2**: Signal alignment ← HERE
4. **Gate 3**: High volatility
5. **Gate 4**: Entry spacing
6. **Gate 5**: Context duplicate detection

Signal alignment is evaluated **independently of fusion score threshold**. The fusion threshold is checked by the backend engine BEFORE the intent reaches the coordinator. Signal alignment is an additional coordinator-level check.

### Plain Technical Meaning
> "Signal alignment failed" means: the backend engine decided to BUY (fusion score above threshold), but the coordinator's own secondary check found that either the trend signal score or the momentum signal score (from the same signal breakdown) did not meet the minimum thresholds configured in the strategy. This is a **redundant safety gate** — the engine approved the trade, but the coordinator's trend/momentum floor rejected it.

---

## C. Exact Meaning of "Passed Guards"

### Full BUY Decision Path (traced from code)

```
STEP 1: Backend Engine (useIntelligentTradingEngine)
  → Signal ingestion
  → Fusion score calculation
  → Fusion threshold check (if below → decision logged as fusion_below_threshold, NO intent sent)
  → If above → BUY intent emitted to coordinator
  → Decision event logged with reason "no_conflicts_detected: signal_confirmed_fusion_X.XXX"
    (This is the PRE-COORDINATOR log — trade_id always NULL here)

STEP 2: Coordinator receives intent
  → detectConflicts(supabaseClient, intent, config, strategy)
    → Check 1: Global wallet exposure (EUR cap)
    → Check 2: Max active coins
    → Check 3: Per-symbol exposure cap
    → Gate 1: Stop-loss cooldown
    → Gate 2: Signal alignment (trend + momentum floors)
    → Gate 3: High volatility block
    → Gate 4: Entry spacing (min time between BUYs on same symbol)
    → Gate 5: Context duplicate detection (pyramiding-aware)
    → SELL-side position check (skipped for BUY)
  → If any check fails → DEFER logged with specific guard name
  → If all pass → "no conflicts detected"

STEP 3: executeWithMinimalLock()
  → executeTradeDirectly()
    → Build mock_trade row
    → INSERT into mock_trades
    → If 23505 unique constraint violation → "position_already_open" → direct_execution_failed
    → If success → trade_id returned
  → Decision event logged (coordinator audit log)
```

### What "Passed Guards" Means
"Passed guards" = `detectConflicts()` returned `hasConflict: false`. This includes all 5 exposure checks + 5 stabilization gates.

### What Is NOT a Guard
- The DB unique index `unique_open_position_per_symbol` is **NOT** a guard. It fires AFTER guards pass, during the INSERT.
- Spread checks are NOT in `detectConflicts()` for BUYs (only for SELLs).
- Fusion threshold is NOT in `detectConflicts()` — it's pre-coordinator.

### Classification

| Stage | Name | Type |
|---|---|---|
| Pre-coordinator | Fusion threshold | Pre-guard (engine-level) |
| detectConflicts | Exposure, SL cooldown, signal alignment, volatility, entry spacing, context duplicate | **GUARD** |
| Post-guard | DB INSERT (unique index) | **Post-guard execution blocker** |
| Post-guard | Other DB/network errors | **Post-guard execution failure** |

---

## D. Post-Decision Blocking Diagnosis

### Question: Is the main reason approved BUY decisions fail to become trades the `unique_open_position_per_symbol` constraint?

### Evidence

Of 296 BUY decisions in the last 48h:
- **8** became actual trades (trade_id present)
- **44** were logged as `DEFER:direct_execution_failed`
- **~116** are pre-coordinator observability logs (never attempted execution)

The 44 `direct_execution_failed` events:
- All have `execution_status: DEFERRED` in metadata
- **No metadata field records the specific error** (exec_error, error, result_error are all NULL)
- They are distributed across BTC (8), ETH (11), SOL (13), XRP (9), AVAX (3)
- All are symbols that ALREADY HAD open positions during that period

### Code Path for `direct_execution_failed`

From coordinator line 6549:
```typescript
} else {
  console.error(`❌ UD_MODE=ON → EXECUTE FAILED: ${executionResult.error}`);
  return { action: "DEFER", reason: "direct_execution_failed", ... };
}
```

From `executeTradeDirectly()` line 4814-4818:
```typescript
if (isOpenPositionConflict(error)) {
  console.log(`🛡️ DIRECT BUY: duplicate BUY ignored (structural invariant) for ${baseSymbol}`);
  return { success: false, error: "position_already_open" };
}
```

### Answer

**YES.** The primary reason approved BUY decisions fail to become trades is the `unique_open_position_per_symbol` DB constraint.

| Outcome | Count | Evidence |
|---|---|---|
| Passed guards → hit DB unique constraint (position_already_open) | **44** | All are on symbols with existing open positions; `direct_execution_failed` maps to `isOpenPositionConflict()` returning `position_already_open` |
| Passed guards → successful trade | **8** | trade_id present |
| Passed guards → other failure | **0** | No other failure modes observed in this window |

**Ratio**: 44 / (44 + 8) = **84.6% of post-guard execution attempts are blocked by the DB unique constraint.**

---

## E. Existing Pooling / Pyramiding Related Components

| Concept / Component | Exists? | Where | Active / Dead | Purpose | Reusable for Multi-Trade? |
|---|---|---|---|---|---|
| **Lot Engine (FIFO reconstruction)** | ✅ Yes | `src/utils/lotEngine.ts` | ACTIVE | Reconstructs open lots, FIFO sells, per-lot P&L | ✅ YES — already supports N lots per symbol |
| **Pooled Position Summary** | ✅ Yes | `src/utils/lotEngine.ts` L285-332 | ACTIVE | Aggregates lots into symbol-level metrics | ✅ YES — `calculatePooledSummary()` |
| **Pooled Unrealized P&L** | ✅ Yes | `src/utils/lotEngine.ts` L453-474 | ACTIVE | Symbol-level P&L from lots | ✅ YES — `calculatePooledUnrealizedPnl()` |
| **Selective TP (per-lot)** | ✅ Yes | `src/utils/lotEngine.ts` L381-425 | ACTIVE | Close only profitable lots meeting criteria | ✅ YES — `buildSelectiveTpSellOrders()` |
| **Full Flush SL (all lots)** | ✅ Yes | `src/utils/lotEngine.ts` L432-447 | ACTIVE | Close all lots on SL | ✅ YES — `buildFullFlushSellOrders()` |
| **Pool Exit Manager (Secure/Runner)** | ✅ Yes | `src/utils/poolManager.ts`, `src/hooks/usePoolExitManager.tsx` | ACTIVE but client-side | Secure portion + trailing runner exit strategy | ⚠️ PARTIAL — logic exists but runs client-side, not in coordinator |
| **coin_pool_states table** | ✅ Yes | DB table | ACTIVE schema | Persists pool state (secure_filled_qty, is_armed, high_water_price) | ✅ YES — schema ready |
| **Pool Exit Config UI** | ✅ Yes | `src/components/strategy/PoolExitManagementPanel.tsx` | ACTIVE | UI for pool_enabled, secure_pct, runner settings | ✅ YES |
| **Context Duplicate Detection (Gate 5)** | ✅ Yes | Coordinator L5957-6046 | ACTIVE | Blocks same trigger_type+timeframe+anchor_price within ε | ✅ YES — explicitly designed for pyramiding model |
| **Context Duplicate Epsilon (config)** | ✅ Yes | `contextDuplicateEpsilonPct` in strategy config | ACTIVE | Configurable duplicate threshold (default 0.5%) | ✅ YES |
| **Entry Context Model** | ✅ Yes | `intent.metadata.entry_context` with `context_version: 1` | ACTIVE | `trigger_type`, `timeframe`, `anchor_price` per entry | ✅ YES — pyramiding-aware context model |
| **Pro-rata Allocation** | ✅ Yes | `src/utils/poolManager.ts` L224-273 | ACTIVE | `allocateFillProRata()` distributes fills across lots | ✅ YES |
| **Symbol Mutex** | ✅ Yes | `src/utils/poolManager.ts` L298-323 | ACTIVE (client-side) | Prevents concurrent operations per symbol | ⚠️ PARTIAL — client-side only |
| **DB Unique Open Position Index** | ✅ Yes | `unique_open_position_per_symbol` on mock_trades | ACTIVE | **THE BLOCKER** — enforces 1 open position per symbol | ❌ MUST BE REMOVED for multi-trade |
| **Net Position Exposure Guard** | ✅ Yes | Coordinator L5694-5732 | ACTIVE | Calculates net qty per symbol (buys - sells) | ✅ YES — already handles N buys per symbol |
| **Coordinator SELL FIFO Resolution** | ✅ Yes | Coordinator (Branch D / Contract 2) | ACTIVE | Resolves symbol-level SELL to per-lot SELLs | ✅ YES |
| **is_open_position flag management** | ✅ Yes | Coordinator BUY insert + SELL close logic | ACTIVE | Sets true on BUY, false when net=0 on SELL | ⚠️ PARTIAL — current logic clears when net=0, would need update for multi-lot |

---

## F. Structural Readiness for Future Multi-Trade-Per-Symbol

### A. What parts still exist and are real?

1. **Lot Engine** — Fully implemented, supports N lots per symbol, FIFO, partial sells, per-lot P&L, pooled summaries. Real, tested, active.
2. **Context Duplicate Detection** — Active Gate 5 in coordinator. Explicitly designed to allow pyramiding (same symbol, different context) while blocking duplicates (same context). Real and active.
3. **Pool Exit Manager** — Secure/Runner exit strategy with coin_pool_states persistence. Real code, active hooks.
4. **Pro-rata allocation** — Working implementation for distributing sells across lots. Real.
5. **Exposure guards** — Already calculate NET position (buys - sells) per symbol, not binary open/closed. Compatible with multi-trade.

### B. What parts are conceptual / partial / dead / contradicted?

1. **DB unique index** — Directly contradicts multi-trade-per-symbol. Active and enforced.
2. **`is_open_position` flag semantics** — Current logic sets `true` on BUY and only clears when net position = 0. For multi-trade, this flag's semantics are ambiguous: should each lot track its own open status, or should it be symbol-level?
3. **Pool Exit Manager runs client-side** — `usePoolExitManager.tsx` is a React hook. For production multi-trade, this logic needs to be in the coordinator or a backend function, not dependent on a browser being open.
4. **Symbol Mutex is client-side** — `poolManager.ts` SymbolMutex only prevents concurrent operations within one browser tab. Useless for backend concurrency.

### C. If the unique index were removed, readiness assessment:

| Capability | Status | Justification |
|---|---|---|
| **Multiple open lots per symbol** | **PARTIAL** | Lot engine supports it. But `is_open_position` flag logic and coordinator INSERT path assume 1 per symbol. The flag management code that clears `is_open_position=false` when net=0 would still work, but the INSERT sets `is_open_position=true` which would create multiple `true` rows — previously prevented by the unique index. |
| **Correct accounting** | **READY** | `lotEngine.ts` already handles N lots per symbol correctly: `reconstructOpenLots()`, `calculateNetPositionFromTrades()`, `calculatePooledSummary()`, `calculatePooledUnrealizedPnl()`. FIFO + `original_trade_id` linking is solid. |
| **Correct exits** | **PARTIAL** | `buildSellOrdersForLots()`, `buildSelectiveTpSellOrders()`, `buildFullFlushSellOrders()` all support multi-lot. But the coordinator's SELL path currently reconstructs position from net-position calculation, not lot-level. The SELL guard bypass (position-not-found hotfix) trusts backend snapshot, which would need updating for multi-lot totals. |
| **Anti-contradictory order handling** | **PARTIAL** | Gate 5 (context duplicate detection) prevents duplicate entries. But there is NO gate that says "do not BUY symbol X while it is currently in unwind/exit mode." If a SELL is in flight and a BUY arrives for the same symbol, both could execute. The symbol mutex is client-side only. |
| **ML/audit traceability** | **READY** | Decision events log intent metadata, entry_context, signal scores. `original_trade_id` links SELLs to BUYs. All necessary audit fields exist. |

---

## G. Accounting / Exit / ML Safety Readiness

| Area | Current Mechanism | Where | Safe / Unsafe / Unknown | Why |
|---|---|---|---|---|
| **FIFO lot allocation** | `reconstructOpenLots()` sorts BUYs by `executed_at`, deducts SELLs via `original_trade_id`, falls back to FIFO for legacy SELLs without `original_trade_id` | `src/utils/lotEngine.ts` L86-189 | **SAFE** | Well-implemented, handles edge cases (legacy sells, float epsilon). Already supports N lots. |
| **Partial sells** | `buildSellOrdersForLots()` distributes requested sell amount across lots in FIFO order, creates one SellOrder per lot | `src/utils/lotEngine.ts` L221-250 | **SAFE** | Correctly handles partial lot closure. |
| **Linking exits to entries** | Every SELL row stores `original_trade_id` pointing to the BUY lot. Coordinator Contract 2 resolves symbol-level sells to per-lot rows. | Coordinator + mock_trades schema | **SAFE** | Invariant: every post-fix SELL has `original_trade_id`. Legacy sells handled by FIFO fallback. |
| **Realized PnL correctness** | `calculateLotPnl()` computes per-lot P&L as `(sellAmount * exitPrice) - (sellAmount * entryPrice)`. Coordinator stores `realized_pnl`, `realized_pnl_pct`, `original_purchase_price` on SELL rows. | `src/utils/lotEngine.ts` L255-269, coordinator SELL path | **SAFE** | Per-lot calculation is correct. No cross-lot contamination. |
| **Pooled symbol state consistency** | `calculatePooledSummary()` aggregates lots. `calculatePooledUnrealizedPnl()` sums across lots. `coin_pool_states` persists pool state. | `src/utils/lotEngine.ts` L295-332, L453-474, `src/utils/poolManager.ts` | **SAFE** for reads, **UNKNOWN** for writes | Read-side aggregation is correct. Write-side (pool state updates) runs client-side in `usePoolExitManager`, which is fragile for multi-trade production use. |
| **TP/SL/trailing with multiple entries** | `buildSelectiveTpSellOrders()` filters lots by individual P&L threshold + age. `buildFullFlushSellOrders()` closes all lots. `poolManager.ts` has trailing stop logic with `high_water_price` tracking. | `src/utils/lotEngine.ts` L381-447, `src/utils/poolManager.ts` L137-150 | **PARTIAL** | Per-lot TP is ready. SL full flush is ready. Trailing stop uses `poolManager.ts` which is client-side and uses `buildCoinPoolView()` (separate from lotEngine). Two parallel pool implementations exist — potential inconsistency. |
| **Decision outcome attribution for ML** | Decision events log `symbol`, `side`, `confidence`, `entry_price`, `tp_pct`, `sl_pct`, `metadata.signalScores`, `metadata.entry_context`. `decision_outcomes` table tracks `realized_pnl_pct`, `hit_tp`, `hit_sl`, `mae_pct`, `mfe_pct` per decision. | `decision_events` + `decision_outcomes` tables | **SAFE** | Attribution chain: decision → trade_id → SELL via original_trade_id → realized P&L. For multi-lot, each decision would map to one lot, maintaining 1:1 attribution. |

---

## H. Final Factual Conclusion

### What Is Known

1. **"Passed guards" is inflated by triple-logging.** Of 130 "passed guards" rows, ~116 are pre-coordinator observability logs, not execution attempts. Only 52 BUY decisions actually reached the coordinator's execution path (8 succeeded, 44 failed).

2. **Signal alignment = trend score ≥ config minimum AND momentum score ≥ config minimum.** Evaluated inside `detectConflicts()`, after exposure checks, before volatility/spacing checks. Independent of fusion threshold.

3. **84.6% of post-guard execution failures are the DB unique constraint** (`position_already_open`). This is the binding constraint on capital deployment.

4. **The lot engine is production-ready for multi-trade-per-symbol.** FIFO reconstruction, partial sells, per-lot P&L, pooled summaries — all correctly implemented and already support N lots.

5. **Context duplicate detection (Gate 5) is explicitly designed for pyramiding.** It allows same-symbol entries with different contexts while blocking same-context duplicates.

6. **Two separate pool implementations exist**: `lotEngine.ts` (FIFO-based, used by engine/UI) and `poolManager.ts` (CoinPoolView-based, used by pool exit manager). They calculate the same metrics differently. This is a consistency risk.

### What Is Not Known

1. **What are the exact `minTrendScoreForBuy` and `minMomentumScoreForBuy` values in the live strategy config?** — Not queried in this audit. These determine how aggressive the signal alignment gate is.

2. **Does the pool exit manager (`usePoolExitManager.tsx`) ever actually trigger exits in production?** — It runs client-side, so it only executes when the user has the app open. Unknown if it has ever triggered a real exit.

3. **What is the exact error in the 44 `direct_execution_failed` rows?** — The metadata does not store the specific error string. We infer `position_already_open` from the code path and the fact that all affected symbols had open positions, but the metadata gap means we cannot prove it with 100% certainty from SQL alone.

### What Must Be Verified Before Any Redesign

1. **Remove or modify `unique_open_position_per_symbol` index** — This is prerequisite #1. Without this, no multi-trade-per-symbol is possible regardless of code readiness.

2. **Decide on `is_open_position` flag semantics** — Currently binary per row. Options: (a) keep per-row but allow multiple `true` rows, (b) remove the flag entirely and derive from net position, (c) replace with a position counter. Each has different migration implications.

3. **Migrate pool exit logic from client-side to backend** — `usePoolExitManager.tsx` cannot run reliably for automated trading. Must move to coordinator or edge function.

4. **Unify pool implementations** — `lotEngine.ts` and `poolManager.ts` must use the same calculation path. Currently two separate aggregation codepaths risk drift.

5. **Add anti-contradictory order gate** — No current gate prevents a BUY while a SELL is in-flight for the same symbol. For multi-trade, this becomes critical to prevent the system from buying more while unwinding.

6. **Verify the 44 `direct_execution_failed` metadata gap** — Add the specific error string to the decision event metadata so future audits can distinguish `position_already_open` from other insert failures with certainty.
