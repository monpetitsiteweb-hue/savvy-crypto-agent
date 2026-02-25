# FULL `is_test_mode` & EXECUTION MODE AUDIT

**Date:** 2026-02-25  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Status:** DETERMINISTIC CODE AUDIT — NO FIXES

---

## PART 1 — ALL EXECUTION MODE SOURCES

### 1.1 Canonical Entry Point (Lines 2828–2832)

```typescript
// Line 2828
type ExecutionMode = "REAL" | "MOCK";
// Line 2830
const canonicalExecutionMode: ExecutionMode = execClass.target;
// Line 2831
const isMockExecution = execClass.isMockExecution;
// Line 2832
const canonicalIsTestMode = isMockExecution; // Alias for passing to sub-functions
```

**Resolves to:** `true` (strategy `execution_target = MOCK`)  
**Used for:** Passing to sub-functions via `strategyConfig`

---

### 1.2 Passing to UD=OFF Path (Line 3622)

```typescript
const executionResult = await executeTradeDirectly(
  supabaseClient,
  intent,
  { ...strategy.configuration, canonicalExecutionMode, canonicalIsTestMode }, // ← Spreads into config
  requestId,
);
```

**Used for:** `sc.canonicalIsTestMode` inside `executeTradeDirectly`

---

### 1.3 Passing to UD=ON Path (Line 3973)

```typescript
const decision = await executeWithMinimalLock(
  supabaseClient,
  intent,
  unifiedConfig,
  { ...strategy.configuration, canonicalExecutionMode, canonicalIsTestMode }, // ← Spreads into config
  requestId,
);
```

**Used for:** `strategyConfig.canonicalIsTestMode` inside `executeWithMinimalLock` → `executeTradeOrder`

---

### 1.4 BUY Balance Query — UD=OFF (Line 4400)

```typescript
.eq("is_test_mode", sc?.canonicalIsTestMode === true);
```

**Source:** `sc.canonicalIsTestMode` (canonical)  
**Resolves to:** `true` ✅  
**Used for:** Balance query

---

### 1.5 SELL Insert — UD=OFF (Line 4504)

```typescript
is_test_mode: sc?.canonicalIsTestMode === true,
```

**Source:** `sc.canonicalIsTestMode` (canonical)  
**Resolves to:** `true` ✅  
**Used for:** Insert

---

### 1.6 BUY Insert — UD=OFF (Line 4639)

```typescript
is_test_mode: sc?.canonicalIsTestMode === true,
```

**Source:** `sc.canonicalIsTestMode` (canonical)  
**Resolves to:** `true` ✅  
**Used for:** Insert

---

### 1.7 logDecisionAsync — metadata.is_test_mode (Line 4872)

```typescript
const isTestMode = strategyConfig?.canonicalIsTestMode === true;
```

**Source:** `strategyConfig.canonicalIsTestMode` (canonical)  
**Resolves to:** `true` IF `strategyConfig` is passed correctly; `false` if `strategyConfig` is `undefined`  
**Used for:** Logging (writes `metadata.is_test_mode` into `decision_events`)

---

### 1.8 Context Guard — ⚠️ BUG (Line 5700)

```typescript
const isTestModeForContext = intent.metadata?.is_test_mode ?? false;
```

**Source:** `intent.metadata.is_test_mode` (raw intent metadata) with `?? false` fallback  
**Resolves to:** Depends on engine payload. If `undefined` → `false` ✗  
**Used for:** Context duplicate guard query (`.eq("is_test_mode", isTestModeForContext)` at line 5718)

---

### 1.9 Position Existence Check — ⚠️ BUG (Line 5779)

```typescript
const isTestMode = intent.metadata?.is_test_mode ?? false;
```

**Source:** `intent.metadata.is_test_mode` (raw intent metadata) with `?? false` fallback  
**Resolves to:** Depends on engine payload. If `undefined` → `false` ✗  
**Used for:** Position lookup query (`.eq("is_test_mode", isTestMode)` at line 5790)

---

### 1.10 Recent Trades Cooldown Query (Line 5831)

```typescript
.eq("is_test_mode", isTestMode)
```

**Source:** Same `isTestMode` from line 5779  
**Resolves to:** Same incorrect value as 1.9  
**Used for:** Cooldown window trade lookup

---

### 1.11 executeWithMinimalLock — localIsMockExecution (Line 6008)

```typescript
const localIsMockExecution = strategyConfig?.canonicalIsTestMode === true;
```

**Source:** `strategyConfig.canonicalIsTestMode` (canonical)  
**Resolves to:** `true` ✅  
**Used for:** Spread gate bypass, mode branching

---

### 1.12 executeTradeOrder — BUY Balance (Line 6648–6655)

```typescript
const canonicalIsTestMode = strategyConfig?.canonicalIsTestMode === true;
// ...
.eq("is_test_mode", canonicalIsTestMode);
```

**Source:** `strategyConfig.canonicalIsTestMode` (canonical)  
**Resolves to:** `true` ✅  
**Used for:** Balance query

---

### 1.13 executeTradeOrder — SELL Branch D Lot Query (Lines 7020–7031)

```typescript
.eq("is_test_mode", true)   // Line 7020 — HARDCODED
// ...
.eq("is_test_mode", true);  // Line 7031 — HARDCODED
```

**Source:** Hardcoded `true`  
**Resolves to:** `true` ✅  
**Used for:** Per-lot BUY/SELL trade queries (BUT gated by line 5779 — never reached if position check fails)

---

### 1.14 executeTradeOrder — SELL Insert (Line 7367)

```typescript
is_test_mode: localIsMockExecution, // Use canonical execution mode
```

**Source:** `localIsMockExecution` from line 6572 (`strategyConfig?.canonicalIsTestMode === true`)  
**Resolves to:** `true` ✅  
**Used for:** Insert

---

### 1.15 logDecisionAsync — DEFER call from UD=OFF Failure (Line 3663–3673)

```typescript
logDecisionAsync(
  supabaseClient,
  intent,
  "DEFER",
  "direct_execution_failed",
  unifiedConfig,
  requestId,
  undefined,
  undefined,
  priceForLog,
  strategy.configuration,  // ← RAW strategy config, NOT { ...config, canonicalIsTestMode }
);
```

**Source:** `strategy.configuration` — does NOT contain `canonicalIsTestMode`  
**Effect:** `strategyConfig?.canonicalIsTestMode === true` → `undefined === true` → `false`  
**Writes:** `metadata.is_test_mode = false` in decision_events ✗

---

### 1.16 logDecisionAsync — SUCCESS call from UD=OFF (Line 3631–3641)

```typescript
logDecisionAsync(
  supabaseClient,
  intent,
  intent.side,
  "unified_decisions_disabled_direct_path",
  unifiedConfig,
  requestId,
  undefined,
  executionResult.tradeId,
  executionResult.executed_price,
  strategy.configuration,  // ← RAW strategy config, NOT { ...config, canonicalIsTestMode }
);
```

**Source:** `strategy.configuration` — does NOT contain `canonicalIsTestMode`  
**Effect:** Same bug — `metadata.is_test_mode = false` in decision_events ✗

---

### 1.17 logDecisionAsync — SUCCESS call from UD=ON (Line 6234–6244)

```typescript
const logResult = await logDecisionAsync(
  supabaseClient,
  intent,
  intent.side,
  "no_conflicts_detected",
  config,
  requestId,
  undefined,
  executionResult.tradeId,
  executionResult.executed_price,
  executionResult.effectiveConfig || strategyConfig,  // ← strategyConfig has canonicalIsTestMode
);
```

**Source:** `strategyConfig` (which was passed `{ ...strategy.configuration, canonicalExecutionMode, canonicalIsTestMode }` at line 3973)  
**Resolves to:** `true` ✅ (if effectiveConfig preserves it — see 1.18)

---

### 1.18 executeTradeOrder — effectiveConfig construction (Lines 6585–6602)

```typescript
let effectiveConfig = {
  ...strategyConfig,  // ← Spreads strategyConfig which includes canonicalIsTestMode
  takeProfitPercentage: canonical.takeProfitPercentage,
  // ...
};

if (params) {
  effectiveConfig = {
    ...effectiveConfig,  // ← Still has canonicalIsTestMode from spread
    // ...overrides
  };
}
```

**Source:** `strategyConfig` spread preserves `canonicalIsTestMode`  
**Resolves to:** `true` ✅

---

## PART 2 — SELL STOP_LOSS PATH TRACE (UD=ON)

### Linear Execution Trace

```
Step 1 → Line 3973 → executeWithMinimalLock called with strategyConfig = { ...strategy.configuration, canonicalExecutionMode, canonicalIsTestMode }
Step 2 → Line 5779 → const isTestMode = intent.metadata?.is_test_mode ?? false    ← ⚠️ BUG: reads from intent metadata
Step 3 → Line 5784-5790 → Position existence query:
         .eq("user_id", intent.userId)
         .eq("strategy_id", intent.strategyId)
         .in("cryptocurrency", symbolVariantsForPosition)
         .eq("is_test_mode", isTestMode)    ← Filters by FALSE if metadata missing
Step 4 → Line 5800 → netPosition = calculateNetPositionForSymbol(allTrades, baseSymbol)
         → If isTestMode=false, allTrades=[] → netPosition=0
Step 5 → Line 5831 → Recent trades query ALSO uses same isTestMode (false) → finds zero
Step 6 → Line 5863-5869 → SELL validation: if (netPosition <= 0) →
Step 7 → Line 5889 → return { hasConflict: true, reason: "no_position_found" }
Step 8 → (back in executeWithMinimalLock) → conflict detected → gate blocks execution
         → returns DEFER/BLOCK before reaching executeTradeOrder
Step 9 → Line 6264-6266 → (if execution was reached and failed):
         return { action: "DEFER", reason: "direct_execution_failed" }
```

### The Exact Position Lookup Query (Lines 5784–5790)

```typescript
const { data: allTradesForSymbol, error: allTradesError } = await supabaseClient
  .from("mock_trades")
  .select("trade_type, cryptocurrency, amount, executed_at")
  .eq("user_id", intent.userId)
  .eq("strategy_id", intent.strategyId)
  .in("cryptocurrency", symbolVariantsForPosition)
  .eq("is_test_mode", isTestMode);  // ← isTestMode from line 5779
```

### The SELL Insert (never reached) — Lines 7358–7394

```typescript
{
  // ...
  is_test_mode: localIsMockExecution,  // ← canonical, correct
  // ...
}
```

### Early Returns in SELL Path

| Line | Condition | Return |
|------|-----------|--------|
| 5889 | `netPosition <= 0` | `{ hasConflict: true, reason: "no_position_found" }` |
| 5909 | `minHoldPeriodMs === undefined` | `{ hasConflict: true, reason: "blocked_missing_config:minHoldPeriodMs" }` |
| 5923 | `timeSinceBuy < minHoldPeriodMs` | `{ hasConflict: true, reason: "hold_min_period_not_met" }` |
| 5951 | `timeSinceOpposite < cooldownRequired` | `{ hasConflict: true, reason: "blocked_by_cooldown" }` |

---

## PART 3 — BUY PATH TRACE (FOR COMPARISON)

### UD=OFF Path (executeTradeDirectly)

```
Step 1 → Line 4400 → .eq("is_test_mode", sc?.canonicalIsTestMode === true)    ← CANONICAL ✅
Step 2 → Line 4639 → is_test_mode: sc?.canonicalIsTestMode === true            ← CANONICAL ✅
```

### UD=ON Path (executeTradeOrder)

```
Step 1 → Line 6648 → const canonicalIsTestMode = strategyConfig?.canonicalIsTestMode === true  ← CANONICAL ✅
Step 2 → Line 6655 → .eq("is_test_mode", canonicalIsTestMode)                 ← CANONICAL ✅
Step 3 → Line 6690 → if (strategyConfig?.canonicalIsTestMode === true)         ← CANONICAL ✅
```

### BUY uses `canonicalIsTestMode` for ALL operations: balance query, insert, mode bypass. ✅

### SELL position check uses `intent.metadata?.is_test_mode ?? false`. ✗

---

## PART 4 — DECISION LOGGING PATH

### 4.1 logDecisionAsync Signature (Line 4793–4809)

```typescript
async function logDecisionAsync(
  supabaseClient: any,
  intent: TradeIntent,
  action: DecisionAction,
  reason: Reason,
  unifiedConfig: UnifiedConfig,
  requestId: string,
  profitMetadata?: any,
  tradeId?: string,
  executionPrice?: number,
  strategyConfig?: any,        // ← 10th parameter
  confidenceConfig?: { ... },
)
```

### 4.2 How metadata.is_test_mode Is Computed (Line 4872)

```typescript
const isTestMode = strategyConfig?.canonicalIsTestMode === true;
```

If `strategyConfig` is `undefined` → `undefined?.canonicalIsTestMode` → `undefined` → `undefined === true` → `false`.
If `strategyConfig` is `strategy.configuration` (raw) → does not have `canonicalIsTestMode` → same result: `false`.

### 4.3 UD=OFF DEFER Call (Line 3663–3673) — SELL STOP_LOSS Path

```typescript
logDecisionAsync(
  supabaseClient,        // 1
  intent,                // 2
  "DEFER",               // 3
  "direct_execution_failed", // 4
  unifiedConfig,         // 5
  requestId,             // 6
  undefined,             // 7 profitMetadata
  undefined,             // 8 tradeId
  priceForLog,           // 9 executionPrice
  strategy.configuration, // 10 strategyConfig ← RAW CONFIG — NO canonicalIsTestMode
);
```

**Result:** `strategyConfig.canonicalIsTestMode` → `undefined` → `isTestMode = false`  
**Writes:** `metadata.is_test_mode = false` ✗

### 4.4 UD=OFF SUCCESS Call (Line 3631–3641)

```typescript
logDecisionAsync(
  supabaseClient,        // 1
  intent,                // 2
  intent.side,           // 3
  "unified_decisions_disabled_direct_path", // 4
  unifiedConfig,         // 5
  requestId,             // 6
  undefined,             // 7
  executionResult.tradeId, // 8
  executionResult.executed_price, // 9
  strategy.configuration, // 10 ← RAW CONFIG — NO canonicalIsTestMode
);
```

**Result:** Same bug — `metadata.is_test_mode = false` ✗

### 4.5 UD=ON SUCCESS Call (Line 6234–6244)

```typescript
const logResult = await logDecisionAsync(
  supabaseClient,
  intent,
  intent.side,
  "no_conflicts_detected",
  config,
  requestId,
  undefined,
  executionResult.tradeId,
  executionResult.executed_price,
  executionResult.effectiveConfig || strategyConfig, // ← Has canonicalIsTestMode from spread
);
```

**Result:** `strategyConfig` has `canonicalIsTestMode = true` → `isTestMode = true` ✅

### 4.6 Why metadata.is_test_mode = false While raw_intent.metadata.is_test_mode = true

1. `raw_intent` is stored as a copy of the full `intent` object — engine sets `metadata.is_test_mode = true` ✅
2. `metadata.is_test_mode` in the decision_event is computed at line 4872 from `strategyConfig?.canonicalIsTestMode`
3. For UD=OFF DEFER path (line 3673), `strategyConfig = strategy.configuration` (raw DB config, no `canonicalIsTestMode`)
4. Therefore `strategyConfig?.canonicalIsTestMode === true` → `false`
5. The decision_event is written with `metadata.is_test_mode = false` ✗

---

## PART 5 — `?? false` FAIL-SAFE AUDIT

### All instances of `?? false` in execution mode logic:

| Line | Code | Can Flip MOCK → false? |
|------|------|----------------------|
| 5700 | `const isTestModeForContext = intent.metadata?.is_test_mode ?? false;` | **YES** — if `intent.metadata.is_test_mode` is `undefined`, resolves to `false` instead of canonical `true` |
| 5779 | `const isTestMode = intent.metadata?.is_test_mode ?? false;` | **YES** — same bug. Used for position lookup query at line 5790 |
| 6754 | `system_operator_mode: intent.metadata?.system_operator_mode ?? false,` | No — not execution mode related |
| 6755 | `position_management: intent.metadata?.position_management ?? false,` | No — not execution mode related |

**Only lines 5700 and 5779 are dangerous.** Both bypass the canonical `canonicalIsTestMode` and read from raw intent metadata with a `false` fallback.

---

## PART 6 — CONSISTENCY MATRIX

| Stage | Variable Used | Source | Line | Resolved Value (MOCK strategy) | Consistent? |
|-------|--------------|--------|------|-------------------------------|-------------|
| **Entry (canonical)** | `canonicalIsTestMode` | `execClass.isMockExecution` | 2832 | `true` | ✅ |
| **BUY balance (UD=OFF)** | `sc?.canonicalIsTestMode === true` | strategyConfig spread | 4400 | `true` | ✅ |
| **BUY insert (UD=OFF)** | `sc?.canonicalIsTestMode === true` | strategyConfig spread | 4639 | `true` | ✅ |
| **BUY balance (UD=ON)** | `canonicalIsTestMode` | `strategyConfig?.canonicalIsTestMode === true` | 6655 | `true` | ✅ |
| **BUY mode bypass (UD=ON)** | `strategyConfig?.canonicalIsTestMode === true` | strategyConfig spread | 6690 | `true` | ✅ |
| **Context guard** | `intent.metadata?.is_test_mode ?? false` | raw intent metadata | 5700 | **`false`** ⚠️ | ❌ |
| **SELL position check** | `intent.metadata?.is_test_mode ?? false` | raw intent metadata | 5779 | **`false`** ⚠️ | ❌ |
| **SELL cooldown query** | `isTestMode` (from line 5779) | raw intent metadata | 5831 | **`false`** ⚠️ | ❌ |
| **SELL lot query (Branch D)** | hardcoded `true` | literal | 7020 | `true` | ✅ |
| **SELL insert (UD=OFF)** | `sc?.canonicalIsTestMode === true` | strategyConfig spread | 4504 | `true` | ✅ |
| **SELL insert (UD=ON)** | `localIsMockExecution` | `strategyConfig?.canonicalIsTestMode === true` | 7367 | `true` | ✅ |
| **Decision logging (UD=ON success)** | `strategyConfig?.canonicalIsTestMode === true` | strategyConfig spread | 4872 | `true` | ✅ |
| **Decision logging (UD=OFF DEFER)** | `strategyConfig?.canonicalIsTestMode === true` | `strategy.configuration` (raw) | 4872 via 3673 | **`false`** ⚠️ | ❌ |
| **Decision logging (UD=OFF success)** | `strategyConfig?.canonicalIsTestMode === true` | `strategy.configuration` (raw) | 4872 via 3641 | **`false`** ⚠️ | ❌ |
| **clearOpenPosition (UD=OFF)** | `sc?.canonicalIsTestMode === true` | strategyConfig spread | 4611 | `true` | ✅ |

---

## PART 7 — FINAL VERDICT

### Confirmed from code:

1. **SELL path uses `intent.metadata?.is_test_mode ?? false` at line 5779.** This is the position existence check. If `intent.metadata.is_test_mode` is `undefined` or missing, it resolves to `false`. ✅ CONFIRMED.

2. **BUY path uses canonical mode (`strategyConfig?.canonicalIsTestMode === true`) at lines 4400, 4639, 6648, 6655, 6690.** ✅ CONFIRMED.

3. **Metadata mismatch is reproducible from code.** The UD=OFF `logDecisionAsync` calls at lines 3641 and 3673 pass `strategy.configuration` (raw) as `strategyConfig`, which does not contain `canonicalIsTestMode`. Therefore `strategyConfig?.canonicalIsTestMode === true` → `false`. This writes `metadata.is_test_mode = false` into `decision_events` while `raw_intent.metadata.is_test_mode = true` (from engine). ✅ CONFIRMED.

4. **SELL can fail due to mode mismatch.** When `isTestMode = false` (line 5779), the position lookup query at line 5790 filters `.eq("is_test_mode", false)`. All open positions have `is_test_mode = true`. The query returns zero rows. `netPosition = 0`. Line 5869: `netPosition <= 0` → returns `{ hasConflict: true, reason: "no_position_found" }`. The SELL is blocked before reaching `executeTradeOrder`. ✅ CONFIRMED.

### Bugs identified (4 total):

| # | Line | Bug | Severity |
|---|------|-----|----------|
| 1 | 5779 | Position check uses `intent.metadata?.is_test_mode ?? false` instead of canonical | **SEV-1** (deadlock) |
| 2 | 5700 | Context guard uses `intent.metadata?.is_test_mode ?? false` instead of canonical | SEV-2 (wrong filter) |
| 3 | 3673 | `logDecisionAsync` DEFER call passes `strategy.configuration` (raw) missing `canonicalIsTestMode` | SEV-2 (metadata corruption) |
| 4 | 3641 | `logDecisionAsync` SUCCESS call passes `strategy.configuration` (raw) missing `canonicalIsTestMode` | SEV-2 (metadata corruption) |

### No contradictions found. The hypothesis is fully confirmed by code.
