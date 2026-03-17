# FEASIBILITY ASSESSMENT: Multi-Trade-Per-Symbol (Pyramiding/Pooling)
## Minimal-Change Architecture Plan — 2026-03-17

---

## PART 1 — CANONICAL SOURCE OF TRUTH PER CONCERN

| Concern | Existing Components | Canonical Source | Redundant/Conflicting | Action |
|---|---|---|---|---|
| **Lot / FIFO accounting** | `lotEngine.ts` (frontend), coordinator per-lot SELL logic (L4680, L7694) | **`lotEngine.ts`** — already reconstructs N lots from `mock_trades` via `original_trade_id` linkage | `poolManager.ts::allocateFillProRata()` — duplicates FIFO with different algorithm | Remove `allocateFillProRata` from poolManager; lotEngine is canonical |
| **Pooled symbol state** | `lotEngine.ts::calculatePooledSummary()`, `poolManager.ts::buildCoinPoolView()`, `coin_pool_states` table | **`lotEngine.ts::calculatePooledSummary()`** — derives from trade rows, no stale state | `poolManager.ts::buildCoinPoolView()` — parallel calculation, different interface | Remove `buildCoinPoolView`; lotEngine summary is canonical |
| **Exit management (TP/SL/trailing/runner)** | `backend-shadow-engine` (L1486–1671), `usePoolExitManager.tsx` (client-side), `coin_pool_states` (DB) | **`backend-shadow-engine`** — server-side, already handles TP, SL, trailing runner with `coin_pool_states` persistence | `usePoolExitManager.tsx` — duplicates exit logic client-side; unreliable for production | Deprecate `usePoolExitManager.tsx`; backend engine is canonical |
| **Duplicate-entry / pyramiding control** | Coordinator Gate 5 (L5957–6046), DB `unique_open_position_per_symbol` index | **Coordinator Gate 5** — context-based duplicate detection already supports pyramiding (same symbol, different context = ALLOWED) | DB unique index — contradicts Gate 5 by physically blocking all multi-entry | Modify index (see Part 3) |
| **Anti-contradictory order prevention** | Coordinator cooldown (L6106–6117), pool SELL precedence (L6126–6140), entry spacing Gate 4 (L5918–5955) | **Coordinator gates** — cooldown + spacing already prevent BUY during active SELL window | `usePoolExitManager.tsx::guardNoBuy()` — client-side guard, bypassed by backend | Remove client guard; coordinator gates are canonical |
| **Trade→decision ML attribution** | `decision_events` → `decision_snapshots` → `decision_outcomes`, `original_trade_id` on SELLs | **Existing lineage chain** — already supports per-lot linkage via `original_trade_id` in sell rows | None — no conflicts | Keep as-is |
| **Open/closed position state** | `is_open_position` flag (binary per-row), `clearOpenPositionIfFullyClosed()` (L367–420) | **Net position calculation** — coordinator already computes net from Σbuys-Σsells (L6083) | `is_open_position` flag — binary toggle, designed for 1-position model | Redefine semantics (see Part 3) |
| **Net exposure calculation** | Coordinator exposure check (L5661–5797), uses Σbuys-Σsells per symbol | **Coordinator exposure check** — already computes net qty × avg price per symbol, supports N lots implicitly | None | Keep as-is |

---

## PART 2 — CAN WE EVOLVE WITHOUT A NEW LAYER?

### Answer: **YES, WITH CONDITIONS**

**Why YES:**
1. **`lotEngine.ts`** already reconstructs N open lots per symbol, computes FIFO, partial sells, pooled summaries, selective TP, and full-flush SL. It is structurally multi-lot-ready.
2. **Coordinator Gate 5** already implements context-based pyramiding: same symbol + different `entry_context` = ALLOWED. The logic is complete.
3. **Coordinator SELL path** (both UD=ON at L7694 and UD=OFF at L4680) already inserts per-lot SELL rows with `original_trade_id` linkage and pro-rata P&L. Multi-lot SELL is structurally ready.
4. **Coordinator exposure check** (L5661–5797) already computes per-symbol and total exposure from net quantities. Adding a second lot per symbol is arithmetically handled — it simply increases `currentSymbolExposure` and checks against `maxExposurePerCoinEUR`.
5. **`backend-shadow-engine`** already evaluates exits at the symbol level (pooled P&L), and uses `coin_pool_states` for runner state. It doesn't care how many lots constitute the position.
6. **`decision_events` / `decision_snapshots` / `decision_outcomes`** chain is lot-agnostic — each decision is a standalone row. Multiple BUY decisions per symbol don't break the schema.

**What blocks it today:**
1. **DB unique index** `unique_open_position_per_symbol` physically prevents >1 open BUY per (user, symbol, mode).
2. **`is_open_position` flag semantics** are binary — `clearOpenPositionIfFullyClosed()` clears ALL BUY rows when net=0, which is correct for multi-lot, but `is_open_position=true` is set per BUY row, causing the unique index violation.
3. **`usePoolExitManager.tsx`** runs client-side and duplicates server-side exit logic — this is not a blocker but a complexity/reliability risk.

---

## PART 3 — MINIMAL SAFE CHANGE SET

### Change 1: Replace DB unique index with a CHECK-style limit

| Attribute | Value |
|---|---|
| **What** | Drop `unique_open_position_per_symbol`, replace with coordinator-level max-lots-per-symbol check |
| **Where** | DB migration + coordinator Gate 5 area |
| **Why** | The unique index is THE physical blocker. Gate 5 + exposure check already provide logical gating. |
| **Type** | Removal + minor additive |
| **Complexity** | Reduces (removes a contradiction) |
| **Runtime behavior** | BUY inserts no longer fail with 23505 when position exists |
| **Risk** | MEDIUM — removes final safety net; mitigated by Gate 5 + exposure caps |

**Specific change:**
```sql
DROP INDEX IF EXISTS unique_open_position_per_symbol;
```

**Add to coordinator** (in Gate 5 area, ~L5957):
```typescript
// Gate 5b: Max lots per symbol
const MAX_LOTS_PER_SYMBOL = cfg.maxLotsPerSymbol ?? 3;
const openLotsForSymbol = (openBuysWithContext || []).filter(buy => {
  // check if lot is still open (remaining > 0)
  // ... reuse existing open-lot check from Gate 5
}).length;
if (openLotsForSymbol >= MAX_LOTS_PER_SYMBOL) {
  return { hasConflict: true, reason: "max_lots_per_symbol_reached", guardReport };
}
```

### Change 2: Redefine `is_open_position` semantics

| Attribute | Value |
|---|---|
| **What** | Keep `is_open_position=true` on each BUY row; `clearOpenPositionIfFullyClosed()` already handles clearing when net=0 |
| **Where** | No code change needed — current logic is already correct for multi-lot |
| **Why** | `clearOpenPositionIfFullyClosed()` (L367–420) computes net from ALL buys/sells; only clears when net≤ε. This already works for N lots. |
| **Type** | No change — semantic re-interpretation only |
| **Complexity** | No change |
| **Runtime behavior** | No change — flag already correctly tracks "at least one lot open" |
| **Risk** | LOW |

**Evidence:** `clearOpenPositionIfFullyClosed()` at L391–397:
```typescript
for (const t of trades) {
  if (t.trade_type === "buy") sumBuys += Number(t.amount);
  else if (t.trade_type === "sell") sumSells += Number(t.amount);
}
const netPosition = sumBuys - sumSells;
if (netPosition <= 0.00000001) { // Clear ALL is_open_position flags }
```
This is already multi-lot safe. If 3 lots exist and only 1 is sold, net > 0, flags remain.

### Change 3: Add anti-contradictory gate (BUY blocked during active unwind)

| Attribute | Value |
|---|---|
| **What** | Block BUY on symbol if a SELL was executed in the last N seconds (already partially exists via entry spacing Gate 4) |
| **Where** | Coordinator, enhance Gate 4 or add Gate 6 |
| **Why** | Prevents BUY while system is actively selling same symbol |
| **Type** | Minor additive |
| **Complexity** | Minimal increase |
| **Runtime behavior** | Additional BUY blocking during unwind |
| **Risk** | LOW |

**Current partial coverage:** Gate 4 (minEntrySpacingMs at L5918) already blocks rapid re-entry on the same symbol. For multi-lot, this needs awareness of recent SELLs too:
```typescript
// Gate 6: Anti-contradictory — block BUY if recent SELL on same symbol
const recentSellCutoff = new Date(Date.now() - (cfg.antiContradictoryCooldownMs ?? 60000)).toISOString();
const { data: recentSells } = await supabaseClient
  .from("mock_trades")
  .select("id")
  .eq("user_id", intent.userId)
  .eq("strategy_id", intent.strategyId)
  .in("cryptocurrency", symbolVariants)
  .eq("trade_type", "sell")
  .gte("executed_at", recentSellCutoff)
  .limit(1);
if (recentSells?.length > 0) {
  return { hasConflict: true, reason: "blocked_buy_during_unwind", guardReport };
}
```

### Change 4: Deprecate `usePoolExitManager.tsx`

| Attribute | Value |
|---|---|
| **What** | Disable or remove client-side pool exit hook |
| **Where** | `src/hooks/usePoolExitManager.tsx` |
| **Why** | `backend-shadow-engine` already handles all exit logic (TP, SL, trailing runner) server-side. Client hook is a duplicate with worse reliability. |
| **Type** | Removal |
| **Complexity** | Reduces |
| **Runtime behavior** | No change — backend engine is already authoritative |
| **Risk** | LOW — verify backend engine covers all exit paths first |

### Change 5: Deprecate `poolManager.ts` (mostly)

| Attribute | Value |
|---|---|
| **What** | Remove `buildCoinPoolView()`, `allocateFillProRata()`, `shouldTriggerSecure()`, `shouldArmRunner()`, `nextTrailingStop()`, `shouldTriggerTrailingStop()` — all duplicated by backend-shadow-engine + lotEngine |
| **Where** | `src/utils/poolManager.ts` |
| **Why** | These functions duplicate logic in `lotEngine.ts` (lot reconstruction, pooled summary) and `backend-shadow-engine` (exit evaluation, runner state). |
| **Type** | Removal |
| **Complexity** | Reduces significantly |
| **Runtime behavior** | No change — only `usePoolExitManager` calls these, which is also deprecated |
| **Risk** | LOW |

**Keep from poolManager.ts:** Only `PoolConfig` interface type if needed by UI configuration panel.

---

## PART 4 — WHAT ALREADY SOLVES EACH PROBLEM

| Problem | Already Solved? | Where? | Fully/Partially? | Reuse Directly? |
|---|---|---|---|---|
| Multiple lots per symbol accounting | YES | `lotEngine.ts::reconstructOpenLots()` — groups by symbol, tracks per-lot remaining | FULLY | YES |
| Partial sells | YES | `lotEngine.ts::buildSellOrdersForLots()` — FIFO distribution; coordinator L4680/L7694 — per-lot SELL row insert | FULLY | YES |
| Pooled PnL | YES | `lotEngine.ts::calculatePooledUnrealizedPnl()` — aggregates across N lots | FULLY | YES |
| Per-lot TP logic | YES | `lotEngine.ts::buildSelectiveTpSellOrders()` — filters by per-lot pnl threshold + age | FULLY | YES |
| Full-flush SL logic | YES | `lotEngine.ts::buildFullFlushSellOrders()` — closes all lots FIFO | FULLY | YES |
| Duplicate-entry protection | YES | Coordinator Gate 5 (L5957–6046) — context-based epsilon check on open lots | FULLY | YES |
| Same-symbol anti-contradiction | PARTIAL | Coordinator Gate 4 (entry spacing) blocks rapid same-symbol BUYs; cooldown blocks BUY after recent SELL | PARTIAL — needs SELL→BUY anti-contradiction gate | Add Gate 6 (Change 3) |
| Pool state persistence | YES | `coin_pool_states` table + `backend-shadow-engine` runner state helpers (L1674–1799) | FULLY | YES |
| Backend-safe exit logic | YES | `backend-shadow-engine` evaluates TP/SL/trailing for each symbol server-side, emits SELL intents to coordinator | FULLY | YES |
| ML attribution | YES | `decision_events` → `decision_snapshots` → `decision_outcomes`; SELL rows have `original_trade_id` | FULLY | YES |

---

## PART 5 — WHAT TO REMOVE / MERGE / DEPRECATE

| Component | Keep | Merge | Remove | Deprecate | Why |
|---|---|---|---|---|---|
| `lotEngine.ts` | ✅ | — | — | — | Canonical FIFO/lot engine, multi-lot ready |
| `poolManager.ts` interfaces (`PoolConfig`) | ✅ | — | — | — | Used by UI config panel |
| `poolManager.ts` functions (build/trigger/allocate) | — | — | ✅ | — | Duplicated by lotEngine + backend-shadow-engine |
| `poolManager.ts` DB functions (load/upsert) | — | — | ✅ | — | Backend-shadow-engine manages coin_pool_states directly |
| `poolManager.ts` SymbolMutex | — | — | ✅ | — | Client-side mutex; server uses DB-level concurrency |
| `usePoolExitManager.tsx` | — | — | — | ✅ | Client-side exit logic; backend-shadow-engine is authoritative |
| `coin_pool_states` table | ✅ | — | — | — | Used by backend-shadow-engine for runner state |
| `backend-shadow-engine` exit logic | ✅ | — | — | — | Server-side canonical exit evaluator |
| Coordinator Gate 5 (context dedup) | ✅ | — | — | — | Already supports pyramiding model |
| Coordinator exposure check (L5661) | ✅ | — | — | — | Already multi-lot aware (net qty) |
| `clearOpenPositionIfFullyClosed()` | ✅ | — | — | — | Already multi-lot safe |
| `isOpenPositionConflict()` handler | — | — | ✅ | — | No longer needed after index removal |
| DB `unique_open_position_per_symbol` index | — | — | ✅ | — | THE physical blocker |

---

## PART 6 — RISK ANALYSIS

| Failure Mode | Severity | Likelihood | Mitigation | Already Mitigated? |
|---|---|---|---|---|
| **Runaway BUYs** — without DB index, system buys same coin endlessly | HIGH | LOW | Gate 5 (context dedup) + new Gate 5b (maxLotsPerSymbol) + exposure cap (L5786) | PARTIAL — Gate 5 exists; need Gate 5b |
| **FIFO P&L corruption** — partial sell on wrong lot | HIGH | VERY LOW | lotEngine already FIFO-sorts by entry date; coordinator uses `original_trade_id` linkage | YES — fully mitigated |
| **Contradictory BUY+SELL** — BUY issued while SELL executing | MEDIUM | LOW | Gate 4 (entry spacing) + new Gate 6 (anti-contradiction cooldown) | PARTIAL — need Gate 6 |
| **is_open_position flag drift** — flag not cleared correctly with N lots | MEDIUM | VERY LOW | `clearOpenPositionIfFullyClosed()` already uses net position, not per-row logic | YES — fully mitigated |
| **Exposure overshoot** — N lots exceed per-coin cap | MEDIUM | LOW | Coordinator exposure check (L5786) already checks `currentSymbolExposure + tradeValueEUR > maxExposurePerCoinEUR` | YES — fully mitigated |
| **Backend exit on partial position** — runner trailing stop sells entire pooled position when only 1 lot should close | LOW | MEDIUM | Backend engine uses pooled PnL for exit decision, but coordinator SELL uses per-lot SELL orders from lotEngine | YES — coordinator decomposes into per-lot SELLs |
| **Decision outcome attribution** — can't attribute outcomes to specific lot entry | LOW | LOW | `decision_events.trade_id` links to specific BUY trade row; outcomes link via `decision_id` | YES — already per-decision |
| **Historical analytics break** — existing dashboards assume 1 position/symbol | LOW | MEDIUM | lotEngine `calculatePooledSummary()` provides backward-compatible aggregated view | PARTIAL — UI may need adaptation |
| **DB unique constraint violation handling** — code expects 23505, removed | LOW | LOW | Remove `isOpenPositionConflict()` handler; coordinator no longer relies on it | Cleanup task |

---

## PART 7 — IMPLEMENTATION ORDER

### Phase 0: Safety & Observability (no behavior change)
1. **Add `maxLotsPerSymbol` config key** to strategy configuration defaults (default: 1, preserving current behavior)
2. **Add Gate 5b** (max lots per symbol check) in coordinator — evaluated BEFORE index removal
3. **Add Gate 6** (anti-contradictory BUY-during-SELL-unwind) in coordinator
4. **Verify**: Deploy coordinator, confirm all existing BUYs still pass/fail identically with `maxLotsPerSymbol=1`

### Phase 1: Remove physical blocker (controlled)
5. **Drop `unique_open_position_per_symbol` index** via migration
6. **Remove `isOpenPositionConflict()` handler** and graceful 23505 handling from coordinator (4 locations)
7. **Verify**: Run same BUY with `maxLotsPerSymbol=1` — should be blocked by Gate 5b, not DB. Run with `maxLotsPerSymbol=2` — should allow second entry with different context.

### Phase 2: Cleanup (reduce complexity)
8. **Deprecate `usePoolExitManager.tsx`** — disable the interval, keep the file for reference
9. **Remove pool-logic functions from `poolManager.ts`** — keep only `PoolConfig` interface
10. **Verify**: Backend engine still handles all exits; no client-side exit activity in logs

### Phase 3: Enable (gradual rollout)
11. **Set `maxLotsPerSymbol=2`** in strategy config for test mode
12. **Monitor**: Verify that second lot entries produce correct per-lot SELLs, correct `original_trade_id` linkage, correct realized P&L
13. **If stable**: Increase to `maxLotsPerSymbol=3`

---

## PART 8 — TEST / VALIDATION PLAN

| Step | Validation |
|---|---|
| Gate 5b added | With `maxLotsPerSymbol=1`: BUY on symbol with open position → blocked reason `max_lots_per_symbol_reached`. Identical to current behavior. |
| Gate 6 added | BUY on symbol within 60s of SELL → blocked reason `blocked_buy_during_unwind` |
| Index dropped | Insert two BUY rows for same (user, symbol, mode) with `is_open_position=true` → both succeed |
| Second lot entry | BUY with different `entry_context` on symbol with 1 open lot → passes Gate 5 + 5b (maxLots=2), creates second lot |
| Duplicate context blocked | BUY with SAME `entry_context` on symbol with open lot → blocked by Gate 5 (existing behavior preserved) |
| SELL on multi-lot | Backend engine triggers SELL → coordinator reconstructs lots via lotEngine → inserts N per-lot SELL rows with correct `original_trade_id` |
| Partial SELL | Selective TP closes only profitable lot(s), remaining lots stay open |
| Full flush SL | SL trigger → all lots closed FIFO |
| `clearOpenPositionIfFullyClosed` | After partial SELL: net > 0 → flags remain. After full flush: net ≤ ε → all flags cleared |
| Realized P&L | Each SELL row: `realized_pnl = (sell_amount / original_purchase_amount) * original_purchase_value` subtracted from exit value — verify pro-rata |
| No partial-sell PnL corruption | Regression: SELL 50% of lot → `realized_pnl` based on pro-rata cost basis, NOT full cost |
| Exposure cap respected | 2 lots × €1000 = €2000 per symbol; 3rd lot blocked by `maxExposurePerCoinEUR` |
| ML attribution | Each BUY creates independent `decision_event`; each SELL references `original_trade_id`; `decision_outcomes` unaffected |
| No contradictory orders | BUY attempted within 60s of SELL → blocked by Gate 6 |

---

## PART 9 — FINAL DECISION

### **A. SAFE TO EVOLVE WITH MINIMAL CHANGE**

**Justification:**
- The lot engine, coordinator SELL path, exposure checks, context duplicate detection, backend exit engine, and ML lineage chain are ALL already multi-lot ready.
- The ONLY physical blocker is the DB unique index.
- The ONLY missing safety gates are maxLotsPerSymbol (trivial) and anti-contradictory cooldown (minor).
- The ONLY required cleanup is removing duplicated client-side pool logic.

### What can be reused directly
- `lotEngine.ts` — all functions (FIFO, partial sells, pooled summary, selective TP, full flush SL)
- Coordinator Gate 5 — context-based pyramiding
- Coordinator exposure check — per-symbol and total caps
- `backend-shadow-engine` — exit evaluation + runner state
- `clearOpenPositionIfFullyClosed()` — multi-lot safe
- `coin_pool_states` — runner state persistence
- `decision_events` / `snapshots` / `outcomes` chain

### What must be modified
- Coordinator: Add Gate 5b (maxLotsPerSymbol) — ~15 lines
- Coordinator: Add Gate 6 (anti-contradictory) — ~15 lines
- DB: Drop `unique_open_position_per_symbol` index — 1 migration
- Coordinator: Remove 4 `isOpenPositionConflict()` handler blocks — deletion only

### What must be removed or merged
- `poolManager.ts` functions (build/trigger/allocate/mutex) — dead code when `usePoolExitManager` is deprecated
- `usePoolExitManager.tsx` — client-side exit logic, replaced by backend engine

### Smallest safe path
1. Add Gate 5b + 6 → deploy → verify no behavior change
2. Drop index → verify Gate 5b blocks correctly
3. Set `maxLotsPerSymbol=2` in test → monitor
4. Remove dead pool code

### What absolutely must NOT be done
- Do NOT create a new pool abstraction or sidecar engine
- Do NOT add another lot engine or FIFO implementation
- Do NOT move exit logic back to the frontend
- Do NOT remove `is_open_position` flag entirely (it's still useful for quick queries)
- Do NOT drop the index without Gate 5b in place first
- Do NOT enable multi-lot in production without test-mode validation
