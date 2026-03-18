# CONTROLLED IMPLEMENTATION PLAN: Multi-Trade-Per-Symbol
## Date: 2026-03-18 | Status: READY FOR EXECUTION

---

## A. FINAL IMPLEMENTATION SCOPE

### In Scope
1. Add `maxLotsPerSymbol` config key + Gate 5b in coordinator
2. Add Gate 6 (anti-contradictory BUY-during-unwind) in coordinator
3. Drop `unique_open_position_per_symbol` DB index
4. Remove `isOpenPositionConflict()` function and all 6 catch blocks relying on it
5. Update `clearOpenPositionIfFullyClosed()` comments (logic already multi-lot safe)
6. Add `maxLotsPerSymbol` to `configDefaults.ts`
7. Deprecate `usePoolExitManager.tsx` (disable interval, keep file)
8. Remove active pool-logic functions from `poolManager.ts` (keep interfaces only)

### Explicitly Out of Scope
- No UI changes
- No ML schema changes
- No new exit strategy semantics
- No new analytics dashboards
- No strategy logic changes
- No regime/portfolio optimization
- No lotEngine.ts changes (already multi-lot ready)
- No backend-shadow-engine changes (does not reference `is_open_position`)
- No changes to `decision_events`, `decision_snapshots`, `decision_outcomes` schema

---

## B. EXACT CODE CHANGES BY FILE

### File 1: `supabase/functions/trading-decision-coordinator/index.ts`

#### Change 1a: Add Gate 5b — maxLotsPerSymbol check
- **Location**: After Gate 5 context duplicate check (~L6042, before L6048 "All stabilization gates passed")
- **Purpose**: Logical replacement for the DB unique index
- **Type**: ADDITIVE (~20 lines)
- **Runtime behavior with maxLotsPerSymbol=1**: IDENTICAL to current — blocks second BUY on same symbol
- **Risk**: LOW

**Exact code to insert after L6042:**
```typescript
// ========= GATE 5b: MAX LOTS PER SYMBOL =========
// Logical replacement for unique_open_position_per_symbol DB index.
// Default: 1 (preserves current behavior). Increase to enable pyramiding.
const MAX_LOTS_PER_SYMBOL = cfg.maxLotsPerSymbol ?? 1;

// Count open lots for this symbol (reuse openBuysWithContext if available, else query)
let openLotCount = 0;
const openBuysForLotCount = openBuysWithContext || (await (async () => {
  const { data } = await supabaseClient
    .from("mock_trades")
    .select("id, amount, original_trade_id")
    .eq("user_id", intent.userId)
    .eq("strategy_id", intent.strategyId)
    .in("cryptocurrency", symbolVariants)
    .eq("trade_type", "buy")
    .eq("is_test_mode", isTestModeForContext ?? (strategyConfig?.canonicalIsTestMode === true));
  return data || [];
})());

for (const buyTrade of openBuysForLotCount) {
  const { data: sellsForBuy } = await supabaseClient
    .from("mock_trades")
    .select("original_purchase_amount")
    .eq("original_trade_id", buyTrade.id)
    .eq("trade_type", "sell");
  const soldAmount = (sellsForBuy || []).reduce(
    (sum: number, s: any) => sum + (parseFloat(s.original_purchase_amount) || 0), 0);
  const remainingAmount = parseFloat(buyTrade.amount) - soldAmount;
  if (remainingAmount > 1e-8) openLotCount++;
}

if (openLotCount >= MAX_LOTS_PER_SYMBOL) {
  console.log(`🚫 COORDINATOR: BUY blocked - max lots per symbol reached (${openLotCount} >= ${MAX_LOTS_PER_SYMBOL})`);
  guardReport.maxLotsPerSymbolReached = true;
  return { hasConflict: true, reason: "max_lots_per_symbol_reached", guardReport };
}
console.log(`✅ COORDINATOR: Lot count check passed (${openLotCount} < ${MAX_LOTS_PER_SYMBOL})`);
```

**Note**: When Gate 5 already queried `openBuysWithContext`, this reuses that data. When Gate 5 was skipped (no `entry_context`), it queries fresh. This avoids duplicating DB calls.

#### Change 1b: Add Gate 6 — Anti-contradictory BUY-during-unwind
- **Location**: After Gate 5b, before "All stabilization gates passed" log
- **Purpose**: Block BUY if a SELL was executed on the same symbol within cooldown
- **Type**: ADDITIVE (~15 lines)
- **Runtime behavior**: NEW — blocks BUY within N seconds of a SELL. Currently there is no such gate.
- **Risk**: LOW (only adds a safety gate, never removes one)

**Exact code:**
```typescript
// ========= GATE 6: ANTI-CONTRADICTORY BUY-DURING-UNWIND =========
// Block BUY if a SELL was executed on this symbol within cooldown window.
// Prevents buying while the system is actively unwinding.
const antiContradictoryCooldownMs = cfg.antiContradictoryCooldownMs ?? 60000; // 60s default
const recentSellCutoff = new Date(Date.now() - antiContradictoryCooldownMs).toISOString();
const { data: recentSellsForAntiContra } = await supabaseClient
  .from("mock_trades")
  .select("id, executed_at")
  .eq("user_id", intent.userId)
  .eq("strategy_id", intent.strategyId)
  .in("cryptocurrency", symbolVariants)
  .eq("trade_type", "sell")
  .gte("executed_at", recentSellCutoff)
  .limit(1);

if (recentSellsForAntiContra && recentSellsForAntiContra.length > 0) {
  console.log(`🚫 COORDINATOR: BUY blocked - recent SELL on ${baseSymbol} within ${antiContradictoryCooldownMs/1000}s (anti-contradictory)`);
  guardReport.antiContradictoryBlocked = true;
  return { hasConflict: true, reason: "blocked_buy_during_unwind", guardReport };
}
```

#### Change 1c: Remove `isOpenPositionConflict()` function and all 6 handler blocks
- **Location**: L355-360 (function definition), L1778-1785, L2294-2301, L3226-3233, L4814-4820, L7889-7895
- **Purpose**: These are dead code after index removal. Keeping them would silently swallow unexpected DB errors.
- **Type**: DELETION
- **Runtime behavior**: No change — after index is dropped, SQLSTATE 23505 for this index will never fire. Removing dead handlers prevents masking of other insert errors.
- **Risk**: LOW

**Exact changes:**
- Delete `isOpenPositionConflict()` function (L355-360)
- At each of the 6 call sites, remove the `if (isOpenPositionConflict(error))` branch. Keep the surrounding error handling intact — just remove the specific 23505/unique_open_position_per_symbol special case.

#### Change 1d: Update comments on `clearOpenPositionIfFullyClosed()`
- **Location**: L346-349, L362-366
- **Purpose**: Update comments to reflect multi-lot semantics
- **Type**: Comment-only
- **Runtime behavior**: NONE
- **Risk**: NONE

**Current comment**: "Ensures only ONE open position per (user, symbol, is_test_mode) via DB unique index"
**New comment**: "Manages is_open_position flag lifecycle. Clears all BUY flags when net position reaches zero. Supports multiple open lots — flag is per-BUY-row, cleared only when ALL lots for a symbol are fully closed."

### File 2: `src/utils/configDefaults.ts`

- **Purpose**: Add `maxLotsPerSymbol` and `antiContradictoryCooldownMs` defaults
- **Type**: ADDITIVE (2 lines)
- **Runtime behavior with default values**: IDENTICAL to current
- **Risk**: NONE

**Add to `DEFAULT_VALUES`:**
```typescript
MAX_LOTS_PER_SYMBOL: 1,                    // 1 = current behavior. Increase for pyramiding.
ANTI_CONTRADICTORY_COOLDOWN_MS: 60000,      // 60s default
```

### File 3: `src/hooks/usePoolExitManager.tsx`

- **Purpose**: Deprecate client-side pool exit logic
- **Type**: DEPRECATION (disable interval, keep file for reference)
- **Runtime behavior**: Pool exit interval stops running on frontend. Backend-shadow-engine continues handling exits server-side (already does).
- **Risk**: LOW — must verify backend engine covers all exit paths first

**Change**: Add early return in `processAllPools` to disable processing:
```typescript
// DEPRECATED: Pool exit logic moved to backend-shadow-engine.
// This hook is retained for reference only.
const processAllPools = async () => {
  console.log('[DEPRECATED] usePoolExitManager: client-side pool exits disabled, backend-shadow-engine is authoritative');
  return;
};
```

### File 4: `src/utils/poolManager.ts`

- **Purpose**: Remove redundant pool-logic functions
- **Type**: DELETION (keep only `PoolConfig`, `Trade`, `CoinPoolView`, `PoolState` interfaces + `roundToTick`)
- **Runtime behavior**: No change — only `usePoolExitManager` calls these, which is deprecated
- **Risk**: LOW

**Functions to remove**: `buildCoinPoolView`, `shouldTriggerSecure`, `shouldArmRunner`, `shouldTriggerTrailingStop`, `nextTrailingStop`, `computeSecureTargetQty`, `loadPoolState`, `upsertPoolState`, `initializePoolState`, `allocateFillProRata`, `symbolMutex`

**Keep**: `PoolConfig`, `CoinPoolView`, `PoolState`, `Trade`, `AllocationRecord` interfaces + `roundToTick` utility

### File 5: `src/utils/poolExitTests.ts`

- **Purpose**: This file imports from `poolManager.ts` — must be updated or removed
- **Type**: DELETION or update imports
- **Risk**: NONE (test utility)

### File 6: `src/hooks/useIntelligentTradingEngine.tsx`

- **Purpose**: Update to reflect deprecated `usePoolExitManager`
- **Type**: Minor update — keep import, the hook still initializes but does nothing (returns immediately)
- **Runtime behavior**: No pool exit processing from frontend
- **Risk**: NONE

### Files Inspected — No Change Required

| File | Status |
|---|---|
| `src/utils/lotEngine.ts` | **Inspected, no change required** — already supports multi-lot FIFO, partial sells, pooled summaries |
| `supabase/functions/backend-shadow-engine/index.ts` | **Inspected, no change required** — does not reference `is_open_position`, uses `coin_pool_states` for runner state, evaluates exits at symbol level |
| `src/integrations/supabase/types.ts` | **Read-only, cannot change** — `is_open_position` remains in schema, auto-generated |
| All frontend components | **No frontend code queries `is_open_position`** — verified via search. No UI changes needed. |
| `decision_events` / `decision_snapshots` / `decision_outcomes` | **No schema changes** — lineage chain unaffected |

---

## C. EXACT DB MIGRATION PLAN

### Migration 1: Drop `unique_open_position_per_symbol` index

**Prerequisites:**
1. Gate 5b MUST be deployed and validated with `maxLotsPerSymbol=1` BEFORE this migration
2. Gate 6 MUST be deployed BEFORE this migration

**Exact SQL:**
```sql
-- Migration: Drop unique_open_position_per_symbol index
-- PREREQUISITE: Coordinator Gate 5b (maxLotsPerSymbol) must be deployed first
-- REVERSIBLE: Yes — index can be recreated
-- RISK: MEDIUM — removes final physical blocker; mitigated by Gate 5b

DROP INDEX IF EXISTS public.unique_open_position_per_symbol;
```

**Post-migration verification SQL:**
```sql
-- Verify index no longer exists
SELECT indexname FROM pg_indexes 
WHERE tablename = 'mock_trades' 
AND indexname = 'unique_open_position_per_symbol';
-- Expected: 0 rows

-- Verify is_open_position column still exists (it should)
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'mock_trades' AND column_name = 'is_open_position';
-- Expected: 1 row, boolean

-- Verify current open positions (baseline snapshot)
SELECT user_id, cryptocurrency, is_test_mode, COUNT(*) as open_count
FROM mock_trades
WHERE is_open_position = true AND trade_type = 'buy'
GROUP BY user_id, cryptocurrency, is_test_mode
HAVING COUNT(*) > 1;
-- Expected: 0 rows (no multi-lot positions should exist yet)
```

**Rollback SQL:**
```sql
-- Recreate the unique index
CREATE UNIQUE INDEX unique_open_position_per_symbol
ON public.mock_trades (user_id, cryptocurrency, is_test_mode)
WHERE (is_open_position = true);
```

**⚠️ Rollback caveat**: If any second-lot BUY rows exist with `is_open_position=true`, the index recreation will FAIL with a uniqueness violation. In that case, you must first close the second lots:
```sql
-- Emergency: find and clear second-lot open flags before re-indexing
-- This is a DATA operation, not a schema change
WITH ranked AS (
  SELECT id, 
    ROW_NUMBER() OVER (PARTITION BY user_id, cryptocurrency, is_test_mode ORDER BY executed_at ASC) as rn
  FROM mock_trades
  WHERE is_open_position = true AND trade_type = 'buy'
)
UPDATE mock_trades SET is_open_position = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
```

### Dependency check: What else depends on this index?

| Dependency Type | Depends on Index? | Evidence |
|---|---|---|
| **Coordinator `isOpenPositionConflict()`** | YES — handles 23505 from this index | Will be removed in same deployment |
| **RLS policies** | NO — no RLS policy references this index | Verified: no RLS on `mock_trades` references `is_open_position` |
| **Triggers** | NO — no triggers depend on this index | |
| **Views** | NO | |
| **Frontend queries** | NO — no frontend `.ts/.tsx` file queries `is_open_position` | Verified via search |
| **Backend-shadow-engine** | NO — does not reference `is_open_position` | Verified via search |
| **`clearOpenPositionIfFullyClosed()`** | Uses `is_open_position` column but NOT the index | Already multi-lot safe |

---

## D. ROLLOUT PHASES

### Phase 0 — Safety Scaffolding (NO BEHAVIOR CHANGE)

**Tasks:**
1. Add `MAX_LOTS_PER_SYMBOL: 1` and `ANTI_CONTRADICTORY_COOLDOWN_MS: 60000` to `configDefaults.ts`
2. Add Gate 5b (`maxLotsPerSymbol` check) to coordinator — AFTER Gate 5, BEFORE "all gates passed"
3. Add Gate 6 (anti-contradictory) to coordinator — AFTER Gate 5b
4. Deploy coordinator

**Affected files:**
- `src/utils/configDefaults.ts`
- `supabase/functions/trading-decision-coordinator/index.ts`

**Expected runtime behavior:**
- IDENTICAL to current. Gate 5b blocks at `openLotCount >= 1` (same as DB index). Gate 6 is new but only adds safety.
- DB index is still in place as a redundant safety net.

**Evidence to collect before Phase 1:**
- ✅ Coordinator logs show `max_lots_per_symbol_reached` as the block reason (NOT `position_already_open` from DB)
- ✅ No new `direct_execution_failed` errors
- ✅ SELL path unaffected (Gate 5b and 6 are BUY-only)
- ✅ Existing open positions unaffected
- Wait minimum: **24-48 hours of clean operation**

### Phase 1 — Remove Physical Blocker (CONTROLLED)

**Prerequisite:** Phase 0 validated for ≥24h with zero regressions.

**Tasks:**
1. Run DB migration: `DROP INDEX IF EXISTS public.unique_open_position_per_symbol`
2. Remove `isOpenPositionConflict()` function from coordinator
3. Remove all 6 `isOpenPositionConflict(error)` handler blocks from coordinator
4. Update `clearOpenPositionIfFullyClosed()` comments
5. Deploy coordinator

**Affected files:**
- DB migration
- `supabase/functions/trading-decision-coordinator/index.ts`

**Expected runtime behavior:**
- IDENTICAL to Phase 0. `maxLotsPerSymbol=1` still blocks second lots logically.
- Difference: block reason is `max_lots_per_symbol_reached` (Gate 5b), not DB 23505.
- `clearOpenPositionIfFullyClosed()` continues working identically.

**Evidence to collect before Phase 2:**
- ✅ Zero `23505` errors in coordinator logs (index is gone, no violations)
- ✅ `max_lots_per_symbol_reached` appears in decision_events for duplicate BUY attempts
- ✅ All SELLs continue functioning
- ✅ `clearOpenPositionIfFullyClosed()` still clears flags correctly
- ✅ No accidental second-lot insertions (verify with SQL)
- Wait minimum: **24-48 hours**

### Phase 2 — Controlled Test-Mode Enablement

**Prerequisite:** Phase 1 validated for ≥24h.

**Tasks:**
1. Set `maxLotsPerSymbol: 2` in the admin strategy configuration (test mode only, via DB update)
2. Monitor second-lot BUY flow end-to-end

**Affected files:**
- Strategy configuration in DB (data update, not schema change)

**Expected runtime behavior:**
- Second BUY on same symbol with DIFFERENT `entry_context` → ALLOWED
- Second BUY with SAME `entry_context` → BLOCKED by Gate 5 (context dedup)
- Third BUY → BLOCKED by Gate 5b (`openLotCount >= 2`)
- Exposure cap still enforced (per-symbol and total)
- SELL → per-lot resolution via existing coordinator SELL path + lotEngine
- `clearOpenPositionIfFullyClosed()` only clears flags when ALL lots fully closed

**Evidence to collect:**
- ✅ Second lot BUY inserts successfully with `is_open_position=true`
- ✅ Both lots visible in `mock_trades` with correct amounts/prices
- ✅ Subsequent SELL correctly links via `original_trade_id` to specific lot
- ✅ Partial SELL uses pro-rata cost basis (no regression of accounting bug)
- ✅ Full flush closes all lots, `clearOpenPositionIfFullyClosed()` clears all flags
- ✅ `decision_events` has separate entries for each BUY decision
- ✅ Exposure check correctly counts both lots in `totalExposureEUR`
- ✅ Gate 6 blocks BUY within 60s of SELL on same symbol

### Phase 3 — Cleanup / Deprecation

**Prerequisite:** Phase 2 validated.

**Tasks:**
1. Deprecate `usePoolExitManager.tsx` (disable interval)
2. Remove redundant functions from `poolManager.ts`
3. Update `poolExitTests.ts` imports or remove file
4. Update `useIntelligentTradingEngine.tsx` if needed

**Affected files:**
- `src/hooks/usePoolExitManager.tsx`
- `src/utils/poolManager.ts`
- `src/utils/poolExitTests.ts`
- `src/hooks/useIntelligentTradingEngine.tsx`

**Expected runtime behavior:**
- No client-side pool exit processing
- Backend-shadow-engine continues handling all exits
- No functional change to trading behavior

---

## E. VALIDATION PLAN AFTER EACH PHASE

### Phase 0 Validation

**1. Code-level:**
- Coordinator deploys without errors
- Gate 5b log line appears: `max_lots_per_symbol_reached` for duplicate BUY attempts

**2. DB validation:**
```sql
-- Baseline: Current open positions (should be unchanged)
SELECT cryptocurrency, COUNT(*) 
FROM mock_trades 
WHERE is_open_position = true AND trade_type = 'buy' AND is_test_mode = true
GROUP BY cryptocurrency;
```

**3. Runtime validation:**
```sql
-- Check decision_events for new gate reasons
SELECT reason, COUNT(*) 
FROM decision_events 
WHERE side = 'buy' 
AND created_at > NOW() - INTERVAL '24 hours'
AND (reason ILIKE '%max_lots%' OR reason ILIKE '%contradictory%' OR reason ILIKE '%unwind%')
GROUP BY reason;
```

**4. Regression:**
```sql
-- No new execution failures
SELECT COUNT(*) FROM decision_events 
WHERE side = 'buy' 
AND reason = 'direct_execution_failed' 
AND created_at > NOW() - INTERVAL '24 hours';
-- Expected: 0 or same as baseline
```

### Phase 1 Validation

**1. Index removed:**
```sql
SELECT indexname FROM pg_indexes 
WHERE tablename = 'mock_trades' AND indexname = 'unique_open_position_per_symbol';
-- Expected: 0 rows
```

**2. No 23505 errors:**
Check coordinator edge function logs for any `23505` or `unique_open_position_per_symbol` strings. Expected: NONE.

**3. Position integrity unchanged:**
```sql
-- Verify no accidental multi-lot insertion
SELECT user_id, cryptocurrency, is_test_mode, COUNT(*) as open_count
FROM mock_trades
WHERE is_open_position = true AND trade_type = 'buy'
GROUP BY user_id, cryptocurrency, is_test_mode
HAVING COUNT(*) > 1;
-- Expected: 0 rows (maxLotsPerSymbol still = 1)
```

**4. SELL still works:**
```sql
-- Recent SELLs should have original_trade_id set
SELECT id, cryptocurrency, original_trade_id, realized_pnl
FROM mock_trades
WHERE trade_type = 'sell' AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC LIMIT 5;
```

### Phase 2 Validation

**1. Multi-lot insertion works:**
```sql
-- After enabling maxLotsPerSymbol=2, check for multi-lot positions
SELECT user_id, cryptocurrency, is_test_mode, COUNT(*) as open_count
FROM mock_trades
WHERE is_open_position = true AND trade_type = 'buy' AND is_test_mode = true
GROUP BY user_id, cryptocurrency, is_test_mode;
-- At least one row with open_count = 2
```

**2. SELL linkage correct:**
```sql
-- Verify SELL rows link to specific BUY lots
SELECT s.id as sell_id, s.original_trade_id, s.realized_pnl,
       b.id as buy_id, b.amount as buy_amount, b.price as buy_price
FROM mock_trades s
JOIN mock_trades b ON s.original_trade_id = b.id
WHERE s.trade_type = 'sell' AND s.is_test_mode = true
AND s.created_at > NOW() - INTERVAL '24 hours'
ORDER BY s.created_at DESC LIMIT 10;
```

**3. Pro-rata PnL not regressed:**
```sql
-- For any partial sell, verify realized_pnl uses pro-rata cost basis
SELECT s.id, s.amount as sell_amount, 
       s.original_purchase_amount, s.original_purchase_value,
       s.exit_value, s.realized_pnl,
       -- Expected: realized_pnl ≈ exit_value - (sell_amount/original_purchase_amount * original_purchase_value)
       s.exit_value - (s.amount / NULLIF(s.original_purchase_amount, 0) * s.original_purchase_value) as expected_pnl
FROM mock_trades s
WHERE s.trade_type = 'sell' AND s.is_test_mode = true
AND s.created_at > NOW() - INTERVAL '24 hours'
AND s.original_purchase_amount > 0;
```

**4. clearOpenPositionIfFullyClosed works with N lots:**
```sql
-- After a full flush: no open flags should remain
-- After a partial sell of one lot: flags should remain for remaining lots
SELECT m.cryptocurrency,
       SUM(CASE WHEN trade_type = 'buy' THEN amount ELSE 0 END) as total_bought,
       SUM(CASE WHEN trade_type = 'sell' THEN amount ELSE 0 END) as total_sold,
       SUM(CASE WHEN trade_type = 'buy' AND is_open_position = true THEN 1 ELSE 0 END) as open_flags,
       SUM(CASE WHEN trade_type = 'buy' THEN amount ELSE 0 END) - 
       SUM(CASE WHEN trade_type = 'sell' THEN amount ELSE 0 END) as net_position
FROM mock_trades m
WHERE is_test_mode = true
GROUP BY cryptocurrency
HAVING SUM(CASE WHEN trade_type = 'buy' AND is_open_position = true THEN 1 ELSE 0 END) > 0;
-- Verify: open_flags > 0 IFF net_position > 0.00000001
```

**5. Exposure cap respected:**
```sql
-- Verify total exposure doesn't exceed wallet cap
-- (This is a spot check — coordinator logs are primary evidence)
SELECT cryptocurrency, 
       SUM(CASE WHEN trade_type = 'buy' THEN amount * price ELSE 0 END) -
       SUM(CASE WHEN trade_type = 'sell' THEN amount * price ELSE 0 END) as net_exposure_eur
FROM mock_trades
WHERE is_test_mode = true
GROUP BY cryptocurrency
HAVING SUM(CASE WHEN trade_type = 'buy' THEN amount ELSE 0 END) > 
       SUM(CASE WHEN trade_type = 'sell' THEN amount ELSE 0 END) + 0.00000001;
```

**6. No contradictory orders:**
```sql
-- Check for BUY within 60s of SELL on same symbol
SELECT b.id as buy_id, b.executed_at as buy_time,
       s.id as sell_id, s.executed_at as sell_time,
       b.cryptocurrency,
       EXTRACT(EPOCH FROM (b.executed_at::timestamp - s.executed_at::timestamp)) as seconds_apart
FROM mock_trades b
JOIN mock_trades s ON b.cryptocurrency = s.cryptocurrency 
  AND b.user_id = s.user_id AND b.is_test_mode = s.is_test_mode
WHERE b.trade_type = 'buy' AND s.trade_type = 'sell'
AND b.executed_at > s.executed_at
AND EXTRACT(EPOCH FROM (b.executed_at::timestamp - s.executed_at::timestamp)) < 60
AND b.created_at > NOW() - INTERVAL '7 days';
-- Expected: 0 rows (Gate 6 should prevent this)
```

---

## F. ROLLBACK PLAN

### Phase 0 Rollback
- **Trigger**: Gate 5b or Gate 6 incorrectly blocking legitimate trades, or SELL regression
- **Action**: Redeploy coordinator WITHOUT Gate 5b/6 (code-only rollback)
- **Data cleanup**: NONE required — no data changes in Phase 0
- **Complexity**: TRIVIAL

### Phase 1 Rollback
- **Trigger**: Unexpected behavior after index removal (e.g., accidental multi-lot insertion despite Gate 5b)
- **Action**:
  1. Verify no multi-lot `is_open_position=true` rows exist:
     ```sql
     SELECT user_id, cryptocurrency, is_test_mode, COUNT(*)
     FROM mock_trades WHERE is_open_position = true AND trade_type = 'buy'
     GROUP BY user_id, cryptocurrency, is_test_mode HAVING COUNT(*) > 1;
     ```
  2. If 0 rows: recreate index immediately
     ```sql
     CREATE UNIQUE INDEX unique_open_position_per_symbol
     ON public.mock_trades (user_id, cryptocurrency, is_test_mode)
     WHERE (is_open_position = true);
     ```
  3. If >0 rows: clear the newest lots first (see emergency SQL in section C), THEN recreate index
  4. Re-add `isOpenPositionConflict()` handler blocks to coordinator. Redeploy.
- **Data cleanup**: Only if accidental second lots were inserted (clear `is_open_position` on extras)
- **Complexity**: MODERATE

### Phase 2 Rollback
- **Trigger**: Incorrect accounting, SELL linkage errors, PnL corruption, ML lineage breakage
- **Action**:
  1. Set `maxLotsPerSymbol` back to `1` in strategy config (config-only rollback)
  2. Existing second-lot positions continue to exist and will be managed normally (SELLs still work)
  3. No new second lots will be created
- **Data cleanup**: Existing multi-lot positions can remain — they will be closed normally by the exit engine
- **Complexity**: TRIVIAL (config change only)

### Phase 3 Rollback
- **Trigger**: Discovery that backend-shadow-engine doesn't cover an exit path that `usePoolExitManager` handled
- **Action**: Re-enable `usePoolExitManager` interval (remove early return)
- **Data cleanup**: NONE
- **Complexity**: TRIVIAL

---

## G. RISK REGISTER

| # | Risk | Where | Severity | Likelihood | Prevention | Detection | Mitigation |
|---|---|---|---|---|---|---|---|
| R1 | **Gate 5b incorrectly counts lots** — open lot query misses sells or double-counts | Coordinator Gate 5b | HIGH | LOW | Reuse same lot-counting logic as Gate 5 (`original_trade_id` join) | Validate with SQL in Phase 0 | Fix query; rollback Phase 0 |
| R2 | **Hidden 1-row-per-symbol assumption in UI/analytics** | Frontend components | MEDIUM | LOW | Verified: no frontend code queries `is_open_position`. lotEngine already groups by symbol. | Manual UI inspection during Phase 2 | Fix UI queries if found; does not block Phase 0-1 |
| R3 | **Contradictory BUY+SELL on same symbol** | Coordinator BUY path | HIGH | LOW | Gate 6 (anti-contradictory cooldown) blocks BUY within 60s of SELL | Check via SQL query (Section E.6) | Increase cooldown; add coordinator-level mutex |
| R4 | **Partial-sell PnL corruption regression** | Coordinator SELL path | HIGH | VERY LOW | No changes to SELL path or PnL calculation. lotEngine unchanged. | Validate with pro-rata SQL (Section E.3) | Emergency: manual PnL recalculation |
| R5 | **`is_open_position` flag drift** — flag not cleared with N lots | `clearOpenPositionIfFullyClosed()` | MEDIUM | VERY LOW | Function already uses net position (sum buys - sum sells), not per-row logic | Validate with SQL (Section E.4) | Manual flag correction |
| R6 | **Exposure overshoot via multiple lots** | Coordinator exposure check (L5661-5797) | MEDIUM | LOW | Exposure check already computes net qty × avg price per symbol — handles N lots | Monitor `totalExposureEUR` in coordinator logs | Gate 5b limits max lots; exposure cap is independent |
| R7 | **Removing `isOpenPositionConflict()` masks other DB errors** | Coordinator insert paths | LOW | LOW | After removal, any insert error is treated as a real error (logged and returned). Currently the handler swallows 23505 silently. | Monitor coordinator error logs after Phase 1 | Re-examine error handling if new 23505s appear |
| R8 | **Dead-code removal deletes something still used** | `poolManager.ts` functions | MEDIUM | LOW | Search confirmed: only `usePoolExitManager` imports these functions. No other callers. | Build verification; grep before deletion | Re-add function if needed |
| R9 | **Backend-shadow-engine doesn't cover all exit paths** | Exit management | MEDIUM | LOW | Do NOT delete `usePoolExitManager` until Phase 2 confirms backend covers all exits | Monitor: ensure TP/SL/trailing exits fire from backend logs | Re-enable `usePoolExitManager` (Phase 3 rollback) |
| R10 | **ML/audit lineage breakage** | `decision_events` / `decision_outcomes` | MEDIUM | VERY LOW | No schema changes. Each BUY creates independent `decision_event`. Each SELL references `original_trade_id`. | Verify `decision_outcomes` linkage after Phase 2 multi-lot trades | No architectural change needed |

---

## H. FINAL GO / NO-GO RECOMMENDATION

### **GO ONLY IF PHASE 0 VALIDATES CLEANLY**

**Justification:**
1. The minimal change set is well-defined: 2 new gates + 1 index drop + dead code removal
2. Every existing component required for multi-lot (lotEngine, coordinator SELL, exposure check, clearOpenPositionIfFullyClosed, backend exit engine, ML lineage) is already structurally ready
3. Phase 0 changes ZERO runtime behavior (maxLotsPerSymbol defaults to 1) and adds safety gates
4. Each subsequent phase is independently reversible
5. No new abstractions, no new engines, no new state models

**Exact first implementation step:**
1. Add `MAX_LOTS_PER_SYMBOL: 1` and `ANTI_CONTRADICTORY_COOLDOWN_MS: 60000` to `configDefaults.ts`
2. Add Gate 5b and Gate 6 to coordinator (after Gate 5, before "all gates passed")
3. Deploy coordinator
4. Monitor for 24-48h
5. Verify Gate 5b blocks duplicate BUYs with reason `max_lots_per_symbol_reached`

**What must be validated BEFORE touching the DB:**
- Gate 5b correctly blocks second-lot BUY with `maxLotsPerSymbol=1`
- Gate 6 correctly blocks BUY within 60s of SELL
- No SELL regression
- No increase in `direct_execution_failed` events
- No change in trade execution rate or guard distribution

**What absolutely must NOT be done:**
- Do NOT drop the index before Gate 5b is deployed and validated
- Do NOT enable `maxLotsPerSymbol > 1` in production without test-mode validation
- Do NOT modify lotEngine.ts (it's already correct)
- Do NOT modify SELL path logic
- Do NOT modify backend-shadow-engine
- Do NOT create a new pool abstraction or lot engine
- Do NOT move exit logic back to the frontend
