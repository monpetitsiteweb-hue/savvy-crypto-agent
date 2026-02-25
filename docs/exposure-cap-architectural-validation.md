# Exposure Cap Architectural Validation (NO CODE CHANGES)

## 1️⃣ ARCHITECTURE CONFIRMATION

### Is `detectConflicts()` the ONLY place where exposure is enforced?

**YES — CONFIRMED.**

All three exposure guards exist exclusively inside `detectConflicts()` (lines 5384–5486):

| Guard | Line | Condition |
|---|---|---|
| `maxWalletExposure` | 5456 | `totalExposureEUR + tradeValueEUR > maxWalletExposureEUR` |
| `maxActiveCoins` | 5466 | `uniqueCoinsWithExposure >= maxActiveCoins` |
| `maxExposurePerCoin` | 5475 | `currentSymbolExposure + tradeValueEUR > maxExposurePerCoinEUR` |

### Is there ANY exposure guard inside execution functions?

| Function | Exposure Check? | Evidence |
|---|---|---|
| `executeTradeDirectly()` (line 4262) | ❌ NO | Only checks: balance (line 4422), hold period (line 4331), price freshness (line 4367), spread (line 4375) |
| `executeTradeOrder()` | ❌ NO | UD=ON path — relies on `detectConflicts()` being called before it |
| Balance check in `executeTradeDirectly()` | ⚠️ PARTIAL | Line 4422: `availableEur < tradeAllocation` — this is a **cash balance** check, NOT an exposure cap. With 30,000€ starting balance and 600€ trades, this wouldn't trigger until ~50 trades (30,000/600). But 142 × 600 = 85,200€ which exceeds 30k — so either the balance calc has a bug, or `perTradeAllocation` is being read differently. |

### Explicit confirmation:

**When UD=OFF, zero exposure logic runs.** The code at line 3612-3614 is unambiguous:

```typescript
if (!unifiedConfig.enableUnifiedDecisions) {
  console.log("🎯 UD_MODE=OFF → DIRECT EXECUTION: bypassing all locks and conflict detection");
  const executionResult = await executeTradeDirectly(...);
```

`detectConflicts()` is NEVER called. The only call site is line 3913, which is inside the UD=ON branch (line 3692+).

---

## 2️⃣ ORIGINAL DESIGN INTENT

### Was UD designed to control conflict resolution only, or also risk governance?

**Answer: B — Both, but unintentionally.**

Evidence:
- The exposure checks were added as "PHASE 5" (line 5349 comment: `PHASE 5: Also includes exposure-based risk limits`) — this was bolted onto `detectConflicts()` as an incremental addition
- The function name `detectConflicts` implies conflict resolution (HOLD/DEFER between competing intents), NOT risk governance
- The exposure code was placed inside `detectConflicts()` for convenience — there was no architectural decision to couple risk governance to UD mode

### Was it intentional that disabling UD disables risk caps?

**NO — this was an unintentional side effect.**

Evidence:
- The UD=OFF bypass comment says "bypassing all locks and **conflict detection**" — it does not mention "bypassing risk governance"
- The `executeTradeDirectly()` function has its own safety gates (hold period, price freshness, spread) — showing the intent was for UD=OFF to still have protections
- The legacy `automated-trading-engine` had its own exposure checks (confirmed in previous analysis) — the migration consolidated them into `detectConflicts()` without realizing UD=OFF would bypass them

### During migration from engine to coordinator:

Exposure caps were **meant to be always-on**. The legacy engine enforced them independently. Placing them inside `detectConflicts()` was an architectural mistake — it accidentally coupled always-on risk governance to an optional feature flag.

---

## 3️⃣ CORRECT RISK LAYER LOCATION

### Option A — Inside `detectConflicts()` (current)

| Pros | Cons |
|---|---|
| Already implemented | Bypassed when UD=OFF |
| Co-located with other gates | Name implies conflict detection, not risk governance |
| | Couples risk to feature flag |

**Verdict: WRONG LOCATION**

### Option B — Before UD branching (inline in main handler)

| Pros | Cons |
|---|---|
| Runs regardless of UD mode | Adds complexity to already-large main handler |
| Simple to implement | Risk logic mixed with routing logic |
| No structural refactor needed | Hard to unit test in isolation |

**Verdict: QUICK FIX, NOT CLEAN**

### Option C — Inside execution layer (`executeTradeDirectly` / `executeTradeOrder`)

| Pros | Cons |
|---|---|
| Last line of defense | Duplicated in two functions |
| Defense-in-depth | Execution layer should be dumb (just execute) |
| | Violates separation of concerns |

**Verdict: WRONG — execution should not make risk decisions**

### Option D — Separate `enforceRiskGuards()` function called before both UD paths

| Pros | Cons |
|---|---|
| Clean separation: risk ≠ conflict ≠ execution | Requires extracting code from `detectConflicts()` |
| Always-on regardless of UD mode | One more function call in the flow |
| Independently testable | |
| Name clearly communicates intent | |
| Follows architecture: Intent → **Risk** → Routing → Execution | |

**Verdict: CORRECT ARCHITECTURAL SOLUTION**

---

## 4️⃣ REFACTOR IMPACT MAP (NO CHANGES)

### Files requiring modification:

| File | Change | Risk |
|---|---|---|
| `supabase/functions/trading-decision-coordinator/index.ts` | Extract exposure logic from `detectConflicts()` into `enforceRiskGuards()`. Call it at ~line 3594 (before UD branch at 3612). | LOW — pure code extraction |
| `src/utils/exposureCalculator.ts` | No change needed — this is frontend advisory code, not coordinator enforcement | NONE |

### DB schema changes required?

**NO.** The exposure logic reads from `mock_trades` and `strategy.configuration`. No new tables or columns needed.

### Impact on existing behavior:

| Concern | Impact |
|---|---|
| **Idempotency** | NONE — risk guard is stateless (reads current exposure, makes pass/fail decision) |
| **Manual trades** | Must decide: should manual trades also be exposure-gated? Currently manual trades go through same coordinator. If `enforceRiskGuards()` is called before UD branch, manual trades would also be capped. This may be desired or may need a manual override flag. |
| **TP/SL bypass logic** | NONE — TP/SL are SELL operations. Exposure guards only apply to BUY side (line 5384: `if (intent.side === "BUY")`) |
| **`is_test_mode` separation** | See Section 5 below |
| **Existing logging** | NONE — `logDecisionAsync` is called after the guard decision, not inside it |

---

## 5️⃣ `is_test_mode` ISOLATION GAP

### Does the exposure query filter by `is_test_mode`?

**NO — CONFIRMED MISSING.**

Evidence from lines 5397-5403:

```typescript
const { data: allTrades } = await supabaseClient
  .from("mock_trades")
  .select("cryptocurrency, amount, price, trade_type")
  .eq("user_id", intent.userId)
  .eq("strategy_id", intent.strategyId)
  .in("trade_type", ["buy", "sell"])
  .order("executed_at", { ascending: false });
```

No `.eq("is_test_mode", ...)` filter exists.

### Contrast with `executeTradeDirectly()` balance check:

Line 4400 DOES filter correctly:
```typescript
.eq("is_test_mode", sc?.canonicalIsTestMode === true)
```

### Consequences of missing filter:

1. If a user has BOTH real and test trades, exposure is computed across both — real trades would count toward test mode caps and vice versa
2. A user with 20k€ real exposure + 10k€ test exposure would see 30k€ total, potentially blocking test trades that should be independent
3. Currently this is not a live issue because only test mode is active, but it becomes a **regression risk** when real trading is enabled

---

## 6️⃣ ARCHITECTURAL DIAGRAMS

### Current Execution Flow (BROKEN)

```
Intent arrives
       │
       ▼
  Resolve strategy + config
       │
       ▼
  State/Policy enforcement (SELL gating)
       │
       ▼
  Read unified_config
       │
       ├─── UD=OFF ──────────────────────────────┐
       │                                          │
       ▼                                          ▼
  UD=ON branch                          executeTradeDirectly()
       │                                    │
       ▼                                    ├── Hold period check
  Manual quarantine check                   ├── Price freshness check
       │                                    ├── Spread check
       ▼                                    ├── Balance check
  Circuit breaker check                     ├── NO exposure check  ← BUG
       │                                    └── Insert mock_trade
       ▼                                         │
  detectConflicts()                              ▼
       │                                     EXECUTED (no cap)
       ├── Exposure guards (3 checks)
       ├── Cooldown check
       ├── Hold period check
       ├── Stop-loss cooldown
       ├── Signal alignment
       ├── Volatility check
       ├── Entry spacing
       └── Duplicate context
       │
       ▼
  executeTradeOrder()
       │
       ▼
  EXECUTED (with caps)
```

### Proposed Clean Separation Model

```
Intent arrives
       │
       ▼
  Resolve strategy + config
       │
       ▼
  State/Policy enforcement (SELL gating)
       │
       ▼
  ┌─────────────────────────────────────┐
  │  enforceRiskGuards()  [ALWAYS-ON]   │
  │                                     │
  │  ├── Global wallet exposure check   │
  │  ├── Max active coins check         │
  │  ├── Per-symbol exposure check      │
  │  ├── is_test_mode isolation         │
  │  └── Returns: PASS or BLOCK+reason  │
  └─────────────────────────────────────┘
       │
       ├── BLOCKED → Return DEFER + guardReport
       │
       ▼ PASSED
  Read unified_config
       │
       ├─── UD=OFF ──────────────┐
       │                          │
       ▼                          ▼
  UD=ON branch            executeTradeDirectly()
       │                    (execution only)
       ▼
  detectConflicts()
  (conflict resolution ONLY:
   cooldown, hold period,
   signal alignment, etc.)
       │
       ▼
  executeTradeOrder()
```

### Risk of Regression if Refactor is Applied

| Risk | Severity | Mitigation |
|---|---|---|
| Manual trades blocked by exposure cap | MEDIUM | Add `source === 'manual'` bypass option in `enforceRiskGuards()`, or accept that manual trades should also respect caps |
| TP/SL exits blocked | ZERO | Exposure only checks `intent.side === 'BUY'` |
| Double-counting if `detectConflicts()` exposure code not removed | LOW | Must delete exposure section from `detectConflicts()` after extraction |
| Test/real mode cross-contamination during refactor | MEDIUM | Must add `is_test_mode` filter in the new function from day one |
| Existing UD=ON strategies see different behavior | ZERO | Same logic, just called earlier in the flow |
| `perTradeAllocation` vs `eurAmount` mismatch | LOW | `enforceRiskGuards()` should use the same `perTradeAllocation` from config, not intent metadata |

---

## SUMMARY

**Root cause**: Exposure caps were accidentally coupled to Unified Decisions by placing them inside `detectConflicts()`, which is only called on the UD=ON path. When UD=OFF, the coordinator jumps directly to `executeTradeDirectly()`, which has balance checks but zero exposure checks. This allowed 142 BUYs to pass uncapped.

**Correct fix location**: Option D — a dedicated `enforceRiskGuards()` function called BEFORE the UD branch point, with `is_test_mode` isolation added.

**No code has been written. No files have been modified.**
