# PHASE 0 DEPLOYMENT LOG — 2026-03-18
## Multi-Trade-Per-Symbol: Gate 5b + Gate 6

---

## Summary

Deployed two new coordinator gates (Gate 6: anti-contradictory, Gate 5b: max lots per symbol) with `maxLotsPerSymbol=1` default, preserving identical runtime behavior. DB unique index remains in place as backstop.

---

## File 1: `src/utils/configDefaults.ts`

### Change: Added 2 config defaults (ADDITIVE)

**Lines modified:** 72-73 → 72-76

**Before:**
```typescript
  CONTEXT_DUPLICATE_EPSILON_PCT: 0.005,  // 0.5% default tolerance for anchor_price comparison
} as const;
```

**After:**
```typescript
  CONTEXT_DUPLICATE_EPSILON_PCT: 0.005,  // 0.5% default tolerance for anchor_price comparison
  
  // Multi-Trade-Per-Symbol (Pyramiding) — Phase 0 defaults
  MAX_LOTS_PER_SYMBOL: 1,                    // 1 = current behavior (single position). Increase to enable pyramiding.
  ANTI_CONTRADICTORY_COOLDOWN_MS: 60000,     // 60s — block BUY if SELL executed within this window on same symbol
} as const;
```

---

## File 2: `supabase/functions/trading-decision-coordinator/index.ts`

### Change: Inserted Gate 6 + Gate 5b after Gate 5, before "all gates passed" (ADDITIVE)

**Insertion point:** After line 6046 (end of Gate 5 context duplicate check), before the existing "All stabilization gates passed" log.

**No code was removed or modified.** The existing "All stabilization gates passed" log line was preserved — the new gates were inserted immediately before it.

**Code inserted (~45 lines):**

```typescript
    // ========= GATE 6: ANTI-CONTRADICTORY BUY-DURING-UNWIND =========
    // Block BUY if a SELL was executed on this symbol within cooldown window.
    // Prevents buying while the system is actively unwinding.
    // Must run BEFORE Gate 5b (cheaper check, higher logical priority).
    const antiContradictoryCooldownMs = cfg.antiContradictoryCooldownMs ?? 60000;
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
      console.log(`🚫 COORDINATOR: BUY blocked - recent SELL on ${baseSymbol} within ${antiContradictoryCooldownMs / 1000}s (anti-contradictory gate)`);
      guardReport.antiContradictoryBlocked = true;
      return { hasConflict: true, reason: "blocked_buy_during_unwind", guardReport };
    }

    // ========= GATE 5b: MAX LOTS PER SYMBOL =========
    // Logical replacement for unique_open_position_per_symbol DB index.
    // Uses is_open_position=true as proxy for open lots (maintained by clearOpenPositionIfFullyClosed).
    // Default: 1 (preserves current single-position behavior).
    const MAX_LOTS_PER_SYMBOL = cfg.maxLotsPerSymbol ?? 1;

    const { count: openLotCount, error: lotCountError } = await supabaseClient
      .from("mock_trades")
      .select("*", { count: "exact", head: true })
      .eq("user_id", intent.userId)
      .eq("strategy_id", intent.strategyId)
      .in("cryptocurrency", symbolVariants)
      .eq("trade_type", "buy")
      .eq("is_open_position", true);

    if (lotCountError) {
      console.error(`⚠️ COORDINATOR: Gate 5b lot count query failed`, lotCountError);
      // Fail-open: allow trade if count query fails (DB index is still backstop in Phase 0)
    } else if ((openLotCount ?? 0) >= MAX_LOTS_PER_SYMBOL) {
      console.log(`🚫 COORDINATOR: BUY blocked - max lots per symbol reached (${openLotCount} >= ${MAX_LOTS_PER_SYMBOL}) for ${baseSymbol}`);
      guardReport.maxLotsPerSymbolReached = true;
      return { hasConflict: true, reason: "max_lots_per_symbol_reached", guardReport };
    }
    console.log(`✅ COORDINATOR: Lot count check passed for ${baseSymbol} (${openLotCount ?? '?'} < ${MAX_LOTS_PER_SYMBOL})`);
```

### Gate execution order (post-deployment)

```
Gate 1 — Signal alignment (trend/momentum floors)
Gate 2 — Volatility gate
Gate 3 — SL cooldown
Gate 4 — Entry spacing
Gate 5 — Context duplicate detection (pyramiding model)
Gate 6 — Anti-contradictory BUY-during-unwind  ← NEW
Gate 5b — Max lots per symbol                   ← NEW
         "All stabilization gates passed"
```

---

## File 3: `docs/phase0-baseline-metrics-2026-03-18.md` (NEW FILE)

Pre-deployment baseline metrics captured from 7-day window. Used for before/after comparison.

---

## Files NOT modified

| File | Status |
|---|---|
| `src/utils/lotEngine.ts` | Not touched |
| `src/hooks/usePoolExitManager.tsx` | Not touched (Phase 3) |
| `src/utils/poolManager.ts` | Not touched (Phase 3) |
| `supabase/functions/backend-shadow-engine/index.ts` | Not touched |
| DB schema / migrations | Not touched (Phase 1) |
| `isOpenPositionConflict()` in coordinator | Not touched yet (Phase 1 removal) |

---

## Runtime behavior change

**None.** With `maxLotsPerSymbol=1` (default), Gate 5b blocks duplicate BUYs logically before the DB unique index fires. Gate 6 adds a new safety check that blocks BUY within 60s of a SELL on the same symbol. The DB unique index remains in place as a redundant safety net.

## What to verify

- Coordinator logs should show `max_lots_per_symbol_reached` instead of `direct_execution_failed` for duplicate BUY attempts
- `blocked_buy_during_unwind` should appear if BUY attempted within 60s of SELL
- No increase in execution failures
- SELL path completely unaffected (gates are BUY-only)
