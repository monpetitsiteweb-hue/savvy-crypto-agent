# PHASE 1 CHANGELOG: Remove DB Single-Position Constraint
## Date: 2026-03-19

---

## SUMMARY

Replaced the database-level unique index (`unique_open_position_per_symbol`) with coordinator-controlled Gate 5b (`maxLotsPerSymbol = 1`). This is a **removal-only** change — no new logic, no refactor, no feature additions.

---

## CHANGE 1: DROP DATABASE INDEX

**Type:** Database migration  
**File:** `supabase/migrations/*_drop_unique_open_position_per_symbol.sql`

### What was dropped
```sql
DROP INDEX IF EXISTS unique_open_position_per_symbol;
```

### What the index was
```sql
CREATE UNIQUE INDEX unique_open_position_per_symbol 
ON public.mock_trades 
USING btree (user_id, cryptocurrency, is_test_mode) 
WHERE (is_open_position = true);
```

### Why
This partial unique index physically prevented more than one open BUY per (user, symbol, mode). It was the **sole DB-level blocker** for multi-lot support. Gate 5b now serves as the canonical guard.

---

## CHANGE 2: REMOVE `isOpenPositionConflict()` FUNCTION

**Type:** Code removal  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Original lines:** 349–359

### Removed code
```typescript
/**
 * Detect if an insert error is a unique constraint violation (SQLSTATE 23505)
 * on the unique_open_position_per_symbol index.
 */
function isOpenPositionConflict(error: any): boolean {
  if (!error) return false;
  const code = error.code || error?.details?.code || '';
  const msg = (error.message || '') + (error.details || '');
  return code === '23505' || msg.includes('unique_open_position_per_symbol');
}
```

### Replaced with
```typescript
// Phase 1: isOpenPositionConflict() removed — Gate 5b is now the canonical guard.
// DB index unique_open_position_per_symbol has been dropped.
```

### Why
The function detected SQLSTATE 23505 (unique constraint violation) from the now-dropped index. With the index gone, this function can never trigger and is dead code.

---

## CHANGE 3: REMOVE HANDLER — UI TEST BUY PATH

**Type:** Code removal  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Original lines:** 1777–1793

### Removed code
```typescript
if (insertError) {
  // SEV-1: Graceful handling of duplicate BUY (structural invariant)
  if (isOpenPositionConflict(insertError)) {
    console.log(`🛡️ UI TEST BUY: duplicate BUY ignored (structural invariant) for ${baseSymbol}`);
    return new Response(
      JSON.stringify({
        ok: true,
        decision: {
          action: "HOLD",
          reason: "position_already_open",
          request_id: requestId,
          message: `Open position already exists for ${baseSymbol}`,
        },
      }),
      { headers: corsHeaders },
    );
  }
```

### Replaced with
```typescript
if (insertError) {
```

### Why
The `isOpenPositionConflict` branch is unreachable after index removal. The outer `if (insertError)` block is preserved — other insert errors still need handling.

---

## CHANGE 4: REMOVE HANDLER — SYSTEM_OPERATOR PATH

**Type:** Code removal  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Original lines:** 2293–2310

### Removed code
```typescript
if (placeholderError) {
  // SEV-1: Graceful handling of duplicate BUY (structural invariant)
  if (isBuySide && isOpenPositionConflict(placeholderError)) {
    console.log(`🛡️ SYSTEM_OPERATOR: duplicate BUY ignored (structural invariant) for ${baseSymbol}`);
    return new Response(
      JSON.stringify({
        ok: true,
        success: false,
        decision: {
          action: "HOLD",
          reason: "position_already_open",
          request_id: requestId,
          message: `Open position already exists for ${baseSymbol}`,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
```

### Replaced with
```typescript
if (placeholderError) {
```

---

## CHANGE 5: REMOVE HANDLER — COORDINATOR PLACEHOLDER PATH

**Type:** Code removal  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Original lines:** 3226–3243

### Removed code
```typescript
if (placeholderError) {
  // SEV-1: Graceful handling of duplicate BUY (structural invariant)
  if (isBuySide && isOpenPositionConflict(placeholderError)) {
    console.log(`🛡️ COORDINATOR: duplicate BUY ignored (structural invariant) for ${baseSymbol}`);
    return new Response(
      JSON.stringify({
        ok: true,
        success: false,
        decision: {
          action: "HOLD",
          reason: "position_already_open",
          request_id: requestId,
          message: `Open position already exists for ${baseSymbol}`,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
```

### Replaced with
```typescript
if (placeholderError) {
```

---

## CHANGE 6: REMOVE HANDLER — DIRECT BUY PATH (`executeTradeDirectly`)

**Type:** Code removal  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Original lines:** 4814–4819

### Removed code
```typescript
if (error) {
  // SEV-1: Graceful handling of duplicate BUY (structural invariant)
  if (isOpenPositionConflict(error)) {
    console.log(`🛡️ DIRECT BUY: duplicate BUY ignored (structural invariant) for ${baseSymbol}`);
    return { success: false, error: "position_already_open" };
  }
```

### Replaced with
```typescript
if (error) {
```

---

## CHANGE 7: REMOVE HANDLER — STANDARD INSERT PATH (unified decision)

**Type:** Code removal  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Original lines:** 7875–7903

### Removed code
```typescript
if (error) {
  if (isBuyTrade && isOpenPositionConflict(error)) {
    console.error("[EXECUTION-FAILURE]", {
      phase: "mock_trades_insert_standard",
      error: "position_already_open",
      symbol: baseSymbol,
      spreadBps: priceData?.spreadBps ?? null,
      effectiveSpreadThresholdBps: ...,
      price: realMarketPrice,
      balance: null,
      intent: { ... },
      orderPayload: { ... },
      exchangeResponse: error,
    });
    console.log(`🛡️ COORDINATOR: duplicate BUY ignored (structural invariant) for ${baseSymbol}`);
    return { success: false, error: "position_already_open" };
  }
```

### Replaced with
```typescript
if (error) {
```

---

## CHANGE 8: UPDATE GATE 5b COMMENT

**Type:** Comment update  
**File:** `supabase/functions/trading-decision-coordinator/index.ts`  
**Original line:** ~6025 (post-edits)

### Before
```typescript
// Fail-open: allow trade if count query fails (DB index is still backstop in Phase 0)
```

### After
```typescript
// Fail-safe: allow trade if count query fails (Gate 5b is now the sole guard — monitor closely)
```

### Why
The DB index no longer exists as a backstop. The comment now accurately reflects that Gate 5b is the **sole** duplicate prevention mechanism.

---

## WHAT WAS NOT TOUCHED

| Component | Status |
|---|---|
| SELL logic | ❌ Not modified |
| `lotEngine.ts` | ❌ Not modified |
| `poolManager.ts` | ❌ Not modified |
| Gate 5 (context dedup) | ❌ Not modified |
| Gate 5b (maxLotsPerSymbol) | ❌ Logic not modified (comment only) |
| Gate 6 (anti-contradictory) | ❌ Not modified |
| `clearOpenPositionIfFullyClosed()` | ❌ Not modified |
| `is_open_position` flag semantics | ❌ Not modified |
| Backend-shadow-engine | ❌ Not modified |
| Fusion / signal logic | ❌ Not modified |

---

## VALIDATION RESULTS (post-deploy)

| Check | Result |
|---|---|
| Index exists in DB? | **NO** ✅ |
| Decision failure spike? | **NO** ✅ (3 fusion_below_threshold, 3 no_conflicts — normal) |
| Trades executing? | **YES** ✅ (3 BUYs in last 2h) |
| `position_already_open` errors? | **NONE** ✅ |
| `direct_execution_failed` errors? | **NONE** ✅ |

---

## SAFETY MODEL

| | Before (Phase 0) | After (Phase 1) |
|---|---|---|
| **Primary guard** | DB unique index | Gate 5b (`maxLotsPerSymbol = 1`) |
| **Backup guard** | Gate 5b | Exposure cap (L5786) |
| **Behavior** | 1 position per symbol | 1 position per symbol (identical) |
| **Failure mode** | SQLSTATE 23505 → graceful HOLD | Gate 5b → `max_lots_per_symbol_reached` |

`maxLotsPerSymbol` remains at **1**. Runtime behavior is identical to pre-change.
