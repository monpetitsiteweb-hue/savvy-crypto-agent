# Changelog — 2026-03-16: All Code Changes

**Date:** 2026-03-16  
**Scope:** Decision logging deduplication + Exit pipeline execution fixes  
**Status:** Deployed

---

## Files Modified

### 1. `supabase/functions/trading-decision-coordinator/index.ts`

#### Change A: Remove pre-execution `logDecisionAsync` call (Decision Dedup)

**Location:** Lines ~2147–2228 (intelligent fast path)

**Before:**
```javascript
// The intelligent fast path called logDecisionAsync() BEFORE falling through
// to the execution flow, creating a decision_event with tradeId: undefined
await logDecisionAsync({
  supabaseClient: sc.supabaseClient,
  userId: sc.userId,
  strategyId: sc.strategyId,
  symbol: intent.symbol,
  side: intent.side,
  reason: `intelligent_fast_path:${fusionResult.decision}`,
  confidence: fusionResult.confidence,
  entryPrice: currentPrice,
  metadata: {
    fusion_score: fusionResult.fusionScore,
    signal_breakdown: fusionResult.signalBreakdown,
    // ... more fields
  },
  tradeId: undefined, // ← BUG: always NULL
  rawIntent: intent,
});
// Then fell through to execution, which called logDecisionAsync AGAIN with actual tradeId
```

**After:**
```javascript
// Removed the pre-execution logDecisionAsync() call entirely.
// Only the post-execution call remains (in UD=ON path at ~line 6585,
// UD=OFF path at ~line 3828), which correctly passes executionResult.tradeId.
// The pre-execution audit data is already captured in decision_snapshots.
```

**Deleted code:** The entire `logDecisionAsync(...)` block (~30 lines) in the intelligent fast path before the execution branch.

---

#### Change B: Fix `unifiedConfig` resolution path (Exit Pipeline)

**Location:** Line ~3684

**Before:**
```javascript
const unifiedConfig: UnifiedConfig = strategy.unified_config || {
    enableUnifiedDecisions: false,
    maxConcurrentDecisions: 3,
    conflictResolutionStrategy: 'conservative',
    minConfidenceThreshold: 0.5,
    decisionTimeoutMs: 30000,
    enableLockManager: true,
};
```

**After:**
```javascript
const unifiedConfig: UnifiedConfig = strategy.configuration?.unifiedConfig || {
    enableUnifiedDecisions: false,
    maxConcurrentDecisions: 3,
    conflictResolutionStrategy: 'conservative',
    minConfidenceThreshold: 0.5,
    decisionTimeoutMs: 30000,
    enableLockManager: true,
};
```

**What changed:** `strategy.unified_config` → `strategy.configuration?.unifiedConfig`  
**Why:** `unified_config` is not a column on the `trading_strategies` table. The actual config lives nested inside `strategy.configuration.unifiedConfig`. This caused the coordinator to always fall back to `enableUnifiedDecisions: false`, bypassing the UD=ON path.

---

#### Change C: Relax spread gate for SELL exits (Exit Pipeline)

**Location:** Lines ~4506–4524 (`executeTradeDirectly` function)

**Before:**
```javascript
// Phase 3: Price freshness and spread gates (for SELL operations)
if (intent.side === "SELL") {
    const spreadThresholdBps = strategy.configuration?.spreadThresholdBps ?? 50;
    if (priceData.spreadBps > spreadThresholdBps) {
        return {
            success: false,
            error: `spread_too_wide: ${priceData.spreadBps.toFixed(1)} bps > ${spreadThresholdBps} bps threshold`,
        };
    }
}
```

**After:**
```javascript
// Phase 3: Price freshness and spread gates (for SELL operations)
if (intent.side === "SELL") {
    const baseSpreadThresholdBps = strategy.configuration?.spreadThresholdBps ?? 50;
    const exitReason = intent.metadata?.exitReason || intent.metadata?.strategyTrigger || '';
    const isStopLoss = /stop.?loss|SL/i.test(exitReason);
    const isTP = /take.?profit|TP|trailing/i.test(exitReason);

    if (isStopLoss) {
        // SL exits: bypass spread gate entirely — capital protection > price efficiency
        console.log(`[SPREAD-GATE] SL exit for ${intent.symbol}: bypassing spread gate (spread=${priceData.spreadBps?.toFixed(1)} bps)`);
    } else {
        // TP/trailing exits: use 2x relaxed threshold; other SELLs: use base threshold
        const effectiveThreshold = isTP ? baseSpreadThresholdBps * 2 : baseSpreadThresholdBps;
        if (priceData.spreadBps > effectiveThreshold) {
            return {
                success: false,
                error: `spread_too_wide: ${priceData.spreadBps.toFixed(1)} bps > ${effectiveThreshold} bps threshold (type=${isTP ? 'TP/trailing' : 'other'})`,
            };
        }
        console.log(`[SPREAD-GATE] SELL ${intent.symbol}: spread=${priceData.spreadBps?.toFixed(1)} bps, threshold=${effectiveThreshold} bps (${isTP ? '2x relaxed' : 'base'})`);
    }
}
```

**Spread policy after fix:**

| Exit type | Threshold | Behavior |
|-----------|-----------|----------|
| Stop Loss (SL) | None | Bypassed entirely |
| Take Profit (TP) / Trailing | 2× base (e.g., 60 bps if base=30) | Relaxed |
| Other SELL | Base (e.g., 30 bps) | Unchanged |
| BUY | Not checked in UD=OFF path | Unchanged |

---

#### Change D: Don't fail SELL on cash ledger settlement failure (Exit Pipeline)

**Location:** Lines ~4718–4722 (inside `executeTradeDirectly`, after SELL insert)

**Before:**
```javascript
if (!settleRes?.success) {
    if (sc?.canonicalIsTestMode === true) {
        return { success: false, error: \"cash_ledger_settlement_failed\" };
    }
}
```

**After:**
```javascript
if (!settleRes?.success) {
    console.error(`[SELL-SETTLEMENT] Cash ledger settlement failed for ${intent.symbol} (trade already inserted). Logging warning, NOT blocking execution.`, {
        symbol: intent.symbol,
        tradeId: insertedTradeId,
        settleError: settleRes?.error || 'unknown',
    });
    // Do NOT return failure — the SELL trade row is already persisted.
    // Settlement failure is an operational warning, not an execution failure.
}
```

**What changed:** Removed the `return { success: false }` branch. Settlement failures are now logged as errors but the function returns success since the trade row is already inserted.

---

### 2. `supabase/functions/backend-shadow-engine/index.ts`

#### Change E: Skip ENTRY decision_events writes (Decision Dedup)

**Location:** Lines ~1140–1249 (Step 5 loop — post-coordinator decision logging)

**Before:**
```javascript
// Step 5: Log all decisions to decision_events
for (const dec of allDecisions) {
    const { error: deError } = await supabaseClient
        .from('decision_events')
        .insert({
            user_id: userId,
            strategy_id: strategyId,
            symbol: dec.symbol,
            side: dec.side,
            reason: dec.reason,
            confidence: dec.confidence,
            entry_price: dec.entryPrice,
            // ... more fields
        });
    // ...
}
```

**After:**
```javascript
// Step 5: Log decisions to decision_events
// ENTRY decisions are now logged ONLY by the coordinator (authoritative writer).
// The backend only logs EXIT/SELL decisions here.
for (const dec of allDecisions) {
    const isEntry = dec.metadata?.snapshot_type === 'ENTRY' || dec.metadata?.snapshot_source === 'coordinator';
    if (isEntry) {
        console.log(`[Step5] Skipping decision_event for ${dec.symbol} (ENTRY logged by coordinator)`);
        continue;
    }

    const { error: deError } = await supabaseClient
        .from('decision_events')
        .insert({
            user_id: userId,
            strategy_id: strategyId,
            symbol: dec.symbol,
            side: dec.side,
            reason: dec.reason,
            confidence: dec.confidence,
            entry_price: dec.entryPrice,
            // ... more fields (unchanged)
        });
    // ...
}
```

**What changed:** Added a guard at the top of the loop that skips `decision_events` inserts for ENTRY-type or coordinator-sourced decisions. EXIT/SELL logging is preserved.

---

## Files Created

### 3. `docs/exit-pipeline-forensic-audit-2026-03-16.md`

Full forensic report covering:
- Evidence that SELL decisions ARE being generated (24h window counts)
- Exit threshold configuration (TP 0.7%, SL 0.7%, trailing 1%)
- Open position status with PnL and exit trigger status
- Root cause analysis of all 3 bugs
- Recommended fixes (which were then implemented)

### 4. `docs/fix-decision-logging-dedup-2026-03-16.md`

Documentation of the decision logging deduplication fix:
- Problem: triple-logging per BUY cycle
- Changes made (coordinator pre-exec removal + backend ENTRY skip)
- Architecture after fix
- Verification queries

### 5. `docs/changelog-2026-03-16-all-fixes.md`

This file — comprehensive changelog of all code changes.

---

## Files NOT Modified

- `supabase/functions/backend-shadow-engine/index.ts` — EXIT/SELL logging path: **unchanged**
- `supabase/functions/trading-decision-coordinator/index.ts` — `logDecisionAsync` function itself: **unchanged**
- `supabase/functions/trading-decision-coordinator/index.ts` — UD=ON execution path (~line 6585): **unchanged** (already correct)
- `supabase/functions/trading-decision-coordinator/index.ts` — UD=OFF execution path (~line 3828): **unchanged** (already correct)
- `decision_snapshots` table/logic: **unchanged**
- Database schema / migrations: **no changes**

---

## Architecture After All Fixes

```
Backend Engine (5min CRON)
    ↓ evaluates entry + exit signals
    ↓ builds intent (BUY or SELL)
    ↓
Coordinator (fusion + guards + execution)
    ↓ resolves unifiedConfig from strategy.configuration.unifiedConfig  ← FIX B
    ↓ applies spread gate:
    │   SL → bypassed                                                    ← FIX C
    │   TP/trailing → 2× threshold                                      ← FIX C
    │   other SELL → base threshold                                      ← unchanged
    ↓ executes trade (insert into mock_trades/real_trades)
    ↓ settles cash ledger (failure = warning, not blocker)               ← FIX D
    ↓ writes SINGLE decision_event (with trade_id)                       ← FIX A
    ↓ writes decision_snapshot (context + explainability)
    ↓
Backend post-processing
    ↓ logs EXIT/SELL decisions only                                      ← FIX E
    ↓ skips ENTRY decision_events (coordinator is authoritative)         ← FIX E
```

---

## Verification Queries

### 1. True orphan check (expect 0 new rows)
```sql
SELECT de.id, de.symbol, de.created_at, de.reason
FROM decision_events de
JOIN decision_snapshots ds ON ds.decision_id = de.id
WHERE de.side = 'BUY'
  AND de.trade_id IS NULL
  AND ds.decision_result = 'BUY'
  AND ds.decision_reason ILIKE '%no_conflicts%'
  AND de.created_at > NOW() - INTERVAL '1 hour';
```

### 2. Triple-logging check (expect 0 rows)
```sql
SELECT symbol,
       metadata->>'backend_request_id' as req_id,
       COUNT(*) as rows_per_cycle
FROM decision_events
WHERE side = 'BUY'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY symbol, metadata->>'backend_request_id'
HAVING COUNT(*) > 1
ORDER BY MAX(created_at) DESC;
```

### 3. SELL execution check (expect SELL trades appearing)
```sql
SELECT COUNT(*) AS sell_trades_last_2h
FROM mock_trades
WHERE trade_type = 'sell'
  AND executed_at > NOW() - INTERVAL '2 hours';
```

### 4. SELL decision reasons (expect fewer DEFER:direct_execution_failed)
```sql
SELECT decision_reason, COUNT(*)
FROM decision_events
WHERE side = 'SELL'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY 2 DESC;
```
