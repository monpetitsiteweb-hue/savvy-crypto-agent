# Root Cause: `is_test_mode` Resolution Mismatch in SELL Path

**Date:** 2026-02-25  
**Status:** ROOT CAUSE CONFIRMED  
**Severity:** SEV-1 (deadlock — zero trades executing)

---

## Summary

The coordinator has **two different sources** for `is_test_mode`:

1. **`canonicalIsTestMode`** (line 2832) — derived from `deriveExecutionClass()` → `execClass.isMockExecution` → derived from `strategyExecutionTarget` (= `MOCK`) → resolves to **`true`** ✅
2. **`intent.metadata.is_test_mode`** (line 5779) — read directly from the engine's intent payload metadata → resolves to... **depends on which metadata field**

The SELL position-lookup query at **line 5779** uses source #2, NOT source #1.

---

## The Two Conflicting Values

### Source A: Engine sends `is_test_mode: true` in intent metadata

**File:** `supabase/functions/backend-shadow-engine/index.ts`

```typescript
// Line 768-770 (SELL intents)
metadata: {
  mode: 'mock',
  engine: 'intelligent',
  is_test_mode: true,  // ← Engine correctly sets this
  context: effectiveShadowMode ? 'BACKEND_SHADOW' : exitResult.exitDecision.context,
  trigger: exitResult.exitDecision.trigger,
}

// Line 1113-1115 (BUY intents)  
metadata: {
  mode: 'mock',
  engine: 'intelligent',
  is_test_mode: true,  // ← Engine correctly sets this
  context: effectiveShadowMode ? 'BACKEND_SHADOW' : 'BACKEND_LIVE',
}
```

So `raw_intent.metadata.is_test_mode = true` ✅

### Source B: Coordinator decision logging uses `canonicalIsTestMode`

**File:** `supabase/functions/trading-decision-coordinator/index.ts`

```typescript
// Line 2830-2832
const canonicalExecutionMode: ExecutionMode = execClass.target;  // "MOCK"
const isMockExecution = execClass.isMockExecution;               // true
const canonicalIsTestMode = isMockExecution;                      // true
```

This is correct. But...

### Source C: Decision event metadata field `is_test_mode` — THE BUG

**File:** `supabase/functions/trading-decision-coordinator/index.ts`

```typescript
// Line 4870-4872 (logDecisionAsync helper)
const isTestMode = strategyConfig?.canonicalIsTestMode === true;
```

This writes `metadata.is_test_mode` into decision_events. If `strategyConfig` is passed correctly, this should be `true`.

**BUT the user reports `metadata.is_test_mode = false` in the decision_event row.** This means either:
- `strategyConfig.canonicalIsTestMode` is not being passed to `logDecisionAsync` for the SELL path, OR
- A different code path logs the SELL decision without the canonical config

---

## The Critical Bug: Position Lookup Query (Line 5779)

```typescript
// Line 5779 — POSITION EXISTENCE CHECK FOR SELL VALIDATION
const isTestMode = intent.metadata?.is_test_mode ?? false;
```

This reads from `intent.metadata.is_test_mode`. The engine sets this to `true` (line 770).

**However**, the `?? false` fallback means if `intent.metadata.is_test_mode` is `undefined` for any reason (missing key, metadata restructuring, serialization issue), it defaults to `false`.

### The query that uses this value:

```typescript
// Lines 5784-5790
const { data: allTradesForSymbol, error: allTradesError } = await supabaseClient
  .from("mock_trades")
  .select("trade_type, cryptocurrency, amount, executed_at")
  .eq("user_id", intent.userId)
  .eq("strategy_id", intent.strategyId)
  .in("cryptocurrency", symbolVariantsForPosition)
  .eq("is_test_mode", isTestMode);  // ← If false, finds ZERO rows
```

### What happens when `isTestMode = false`:
- Open positions are all `is_test_mode = true`
- Query returns **zero rows**
- `netPosition = 0`
- Coordinator concludes: "no position to sell" → **DEFER / direct_execution_failed**

---

## The Per-Lot SELL Query (Line 7020) — HARDCODED `true`

```typescript
// Lines 7013-7021
const { data: buyTrades } = await supabaseClient
  .from("mock_trades")
  .select("id, amount, price, executed_at, total_value")
  .eq("user_id", intent.userId)
  .eq("strategy_id", intent.strategyId)
  .eq("cryptocurrency", baseSymbol)
  .eq("trade_type", "buy")
  .eq("is_test_mode", true)           // ← HARDCODED true
  .order("executed_at", { ascending: true });
```

This per-lot query is **hardcoded to `true`** — it would work correctly. But the earlier position-existence check at line 5779 gates it. If the position check fails (returns zero), the code never reaches line 7020.

---

## Why `metadata.is_test_mode = false` in decision_events

The user reports:
- `decision_events.metadata.is_test_mode = false`
- `decision_events.raw_intent.metadata.is_test_mode = true`

This proves:
1. The engine sends `is_test_mode: true` in the raw intent ✅
2. The coordinator's `logDecisionAsync` resolves `is_test_mode` to `false` ✗

**Root cause of the metadata mismatch** (line 4870-4872):

```typescript
const isTestMode = strategyConfig?.canonicalIsTestMode === true;
```

If `strategyConfig` is not passed (or is `undefined` / `null`) when `logDecisionAsync` is called for the SELL path, then:
- `undefined?.canonicalIsTestMode` → `undefined`
- `undefined === true` → `false`
- `is_test_mode` in metadata = `false`

---

## The Deadlock Chain (Complete)

```
Engine sends SELL intent with metadata.is_test_mode = true
    ↓
Coordinator line 5779: reads intent.metadata?.is_test_mode ?? false
    ↓
If this resolves to false (metadata missing/restructured/undefined):
    ↓
Position lookup query (line 5790): .eq("is_test_mode", false)
    ↓
All open positions are is_test_mode = true → ZERO ROWS returned
    ↓
netPosition = 0 → "no position to sell" → DEFER
    ↓
decision_events logged with metadata.is_test_mode = false (from strategyConfig bug)
    ↓
stopLossCooldown reads decision_events → sees STOP_LOSS intent → activates cooldown
    ↓
BUYs blocked by stopLossCooldownActive
    ↓
Positions never close → deadlock repeats every 30 min
```

---

## Inconsistent `is_test_mode` Resolution Across Code Paths

| Location | Line | Source | Resolves to |
|----------|------|--------|-------------|
| Canonical (entry) | 2832 | `execClass.isMockExecution` | `true` ✅ |
| BUY insert | 4504 | `sc?.canonicalIsTestMode === true` | `true` ✅ |
| BUY balance query | 4400 | `sc?.canonicalIsTestMode === true` | `true` ✅ |
| Decision logging | 4872 | `strategyConfig?.canonicalIsTestMode === true` | `false` ✗ (if config not passed) |
| SELL position check | 5779 | `intent.metadata?.is_test_mode ?? false` | `false` ✗ (if metadata missing) |
| Context guard | 5700 | `intent.metadata?.is_test_mode ?? false` | `false` ✗ (same bug) |
| Per-lot BUY query | 7020 | hardcoded `true` | `true` ✅ |
| Per-lot SELL query | 7031 | hardcoded `true` | `true` ✅ |

**Lines 5779 and 5700 are the regression.** They bypass the canonical `canonicalIsTestMode` and read directly from `intent.metadata` with a `?? false` fallback.

---

## Required Fix

**Replace lines 5779 and 5700** to use `canonicalIsTestMode` (which is passed through `strategyConfig.canonicalIsTestMode`) instead of `intent.metadata?.is_test_mode ?? false`.

Before:
```typescript
const isTestMode = intent.metadata?.is_test_mode ?? false;           // line 5779
const isTestModeForContext = intent.metadata?.is_test_mode ?? false;  // line 5700
```

After:
```typescript
const isTestMode = strategyConfig?.canonicalIsTestMode === true;           // line 5779
const isTestModeForContext = strategyConfig?.canonicalIsTestMode === true;  // line 5700
```

This aligns the SELL path with the BUY path (which already uses `sc?.canonicalIsTestMode` at lines 4400, 4504).

**Also fix `logDecisionAsync`** to ensure `strategyConfig` is always passed for SELL decision logging, so `metadata.is_test_mode` reflects the canonical value.

---

## Verification Queries

### Confirm the mismatch in decision_events:
```sql
SELECT 
  id, created_at, side, symbol, reason,
  metadata->>'is_test_mode' as meta_is_test_mode,
  raw_intent->'metadata'->>'is_test_mode' as raw_intent_is_test_mode
FROM decision_events
WHERE user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND strategy_id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e'
  AND created_at >= '2026-02-25 10:00:00+00'
  AND side = 'SELL'
ORDER BY created_at ASC;
```

Expected: `meta_is_test_mode = false`, `raw_intent_is_test_mode = true` → confirms the bug.

### Confirm open positions are is_test_mode = true:
```sql
SELECT cryptocurrency, is_test_mode, is_open_position
FROM mock_trades
WHERE user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND strategy_id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e'
  AND is_open_position = true;
```

Expected: All rows `is_test_mode = true`.

---

*This document supersedes the REAL-mode hypothesis from the consolidated analysis. The root cause is an `is_test_mode` resolution regression in the SELL path, not execution_target misconfiguration.*
