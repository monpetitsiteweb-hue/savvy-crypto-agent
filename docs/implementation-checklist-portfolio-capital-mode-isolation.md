# Implementation Checklist: portfolio_capital Mode Isolation

> **STATUS**: DRAFT — Awaiting "GO" approval  
> **CREATED**: 2026-02-04  
> **PURPOSE**: Add `is_test_mode` to `portfolio_capital` for TEST/REAL isolation

---

## 1. Pre-Migration Safety Checks

| Check | Command / Action | Expected Result |
|-------|------------------|-----------------|
| 1.1 | `SELECT COUNT(*) FROM portfolio_capital;` | Note row count for rollback verification |
| 1.2 | `SELECT user_id, starting_capital_eur, cash_balance_eur FROM portfolio_capital LIMIT 10;` | Snapshot existing data |
| 1.3 | Verify no active trades in progress | Check `execution_jobs` for `status = 'RUNNING'` |
| 1.4 | Confirm coordinator is not mid-execution | Check edge function logs for active requests |

---

## 2. Migration Order (Atomic Transaction)

### Phase 1: Schema Change (MUST be transactional)

**CRITICAL**: All schema changes MUST run inside a single transaction. If any step fails, the entire migration aborts atomically.

```sql
BEGIN;

-- Step 1: Add column with default (existing rows become TEST)
ALTER TABLE public.portfolio_capital 
ADD COLUMN is_test_mode BOOLEAN NOT NULL DEFAULT true;

-- Step 2: Drop old primary key
ALTER TABLE public.portfolio_capital 
DROP CONSTRAINT portfolio_capital_pkey;

-- Step 3: Create composite primary key
ALTER TABLE public.portfolio_capital 
ADD CONSTRAINT portfolio_capital_pkey 
PRIMARY KEY (user_id, is_test_mode);

-- Step 4: Add index for mode-scoped queries
CREATE INDEX idx_portfolio_capital_mode 
ON public.portfolio_capital(is_test_mode);

COMMIT;
```

### Phase 2: RPC Update (get_portfolio_metrics)

The RPC already accepts `p_is_test_mode` but queries `portfolio_capital` without filtering by mode.

**Current query (line 27-33):**
```sql
SELECT ... FROM portfolio_capital WHERE user_id = p_user_id;
```

**Required change:**
```sql
SELECT ... FROM portfolio_capital 
WHERE user_id = p_user_id AND is_test_mode = p_is_test_mode;
```

### Phase 3: Coordinator Queries

Files with direct `portfolio_capital` queries that need `is_test_mode` filter:

| File | Line(s) | Query Type | Required Change |
|------|---------|------------|-----------------|
| `trading-decision-coordinator/index.ts` | 448-452 | SELECT | Add `.eq("is_test_mode", isTestMode)` |
| `trading-decision-coordinator/index.ts` | 515-519 | SELECT (verify) | Add `.eq("is_test_mode", isTestMode)` |
| `trading-decision-coordinator/index.ts` | 661-664 | SELECT (verify) | Add `.eq("is_test_mode", isTestMode)` |

### Phase 4: Settlement RPCs Audit

**DEPLOY STRATEGY (Option A — Backward Compatible)**:
All RPCs will accept `p_is_test_mode DEFAULT true`. This ensures:
- Existing callers continue to work without modification
- New callers can explicitly pass the mode
- No atomic deploy coordination required between RPC/coordinator/frontend

These RPCs write to `portfolio_capital` and need mode awareness:

| RPC | Current Behavior | Required Change |
|-----|------------------|-----------------|
| `settle_buy_trade` | Writes to user's row | Add `p_is_test_mode DEFAULT true`, filter by mode |
| `settle_sell_trade` | Writes to user's row | Add `p_is_test_mode DEFAULT true`, filter by mode |
| `reset_portfolio_capital` | Deletes/resets user's row | Add `p_is_test_mode DEFAULT true`, **MUST REJECT when false** |
| `reserve_capital` | Updates reserved_eur | Add `p_is_test_mode DEFAULT true`, filter by mode |
| `release_reservation` | Updates reserved_eur | Add `p_is_test_mode DEFAULT true`, filter by mode |
| `recalculate_cash_from_trades` | Recalculates from trades | Already has `p_is_test_mode`, verify it filters `portfolio_capital` |

**HARD INVARIANT — reset_portfolio_capital**:
```sql
-- Inside reset_portfolio_capital RPC:
IF p_is_test_mode = false THEN
  RAISE EXCEPTION 'Cannot reset REAL portfolio capital programmatically';
END IF;
```
REAL capital must NEVER be reset programmatically. Only TEST mode resets are permitted.

---

## 3. Implementation Sequence

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: BACKUP                                                  │
│  - Snapshot portfolio_capital table                              │
│  - Record row count                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: SCHEMA MIGRATION                                        │
│  - Add is_test_mode column (DEFAULT true)                        │
│  - Drop old PK, create composite PK                              │
│  - Add index                                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: UPDATE get_portfolio_metrics RPC                        │
│  - Add is_test_mode filter to portfolio_capital query            │
│  - Verify return shape unchanged                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: UPDATE SETTLEMENT RPCs                                  │
│  - settle_buy_trade: add p_is_test_mode                          │
│  - settle_sell_trade: add p_is_test_mode                         │
│  - reset_portfolio_capital: add p_is_test_mode                   │
│  - reserve_capital: add p_is_test_mode                           │
│  - release_reservation: add p_is_test_mode                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: UPDATE COORDINATOR                                      │
│  - Add is_test_mode filter to all portfolio_capital queries      │
│  - Pass mode to settlement RPC calls                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 6: UPDATE FRONTEND HOOKS                                   │
│  - useMockWallet.tsx: pass testMode to reset RPC                 │
│  - usePortfolioMetrics.tsx: already passes testMode ✅            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 7: VERIFICATION                                            │
│  - Run get_portfolio_metrics(user, true) → returns TEST row      │
│  - Run get_portfolio_metrics(user, false) → returns no_row       │
│  - Verify TEST mode works exactly as before                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Rollback Plan

### If migration fails mid-execution:

```sql
-- Rollback schema changes
ALTER TABLE public.portfolio_capital DROP CONSTRAINT IF EXISTS portfolio_capital_pkey;
ALTER TABLE public.portfolio_capital DROP COLUMN IF EXISTS is_test_mode;
ALTER TABLE public.portfolio_capital ADD CONSTRAINT portfolio_capital_pkey PRIMARY KEY (user_id);
DROP INDEX IF EXISTS idx_portfolio_capital_mode;
```

### If RPCs fail after migration:

1. Restore previous RPC versions from migration history
2. Schema remains with `is_test_mode` (backward compatible since DEFAULT true)
3. All existing queries will continue to work (they just ignore the new column)

### Emergency recovery:

```sql
-- If data corruption occurs, restore from backup
TRUNCATE portfolio_capital;
INSERT INTO portfolio_capital SELECT * FROM portfolio_capital_backup_YYYYMMDD;
```

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| TEST mode regression | Low | High | Existing rows get `is_test_mode=true` by default |
| RPC signature change breaks frontend | Low | Medium | All RPCs use `DEFAULT true` (backward compatible) |
| Coordinator fails to pass mode | Medium | High | Audit all `portfolio_capital` queries |
| Rollback corrupts data | Low | Critical | Pre-migration backup required |
| REAL capital accidentally reset | Low | Critical | `reset_portfolio_capital` hard-rejects `p_is_test_mode=false` |
| REAL row created without deposit | Low | High | Verify REAL row count = 0 post-migration |

### Write Access Control (REAL rows)

All writes to `portfolio_capital WHERE is_test_mode = false` MUST originate from:
1. **Deposit settlement** (custodial deposit attribution)
2. **Trade settlement** (settle_buy_trade, settle_sell_trade via coordinator)

No other code path may write to REAL capital rows.

---

## 6. Post-Migration Verification

| Test | Expected Result |
|------|-----------------|
| `SELECT COUNT(*) FROM portfolio_capital WHERE is_test_mode = true;` | Equals pre-migration row count |
| `SELECT COUNT(*) FROM portfolio_capital WHERE is_test_mode = false;` | **0** (no REAL rows until deposit attributed) |
| Dashboard in TEST mode | Shows existing capital unchanged |
| Dashboard in REAL mode | Shows "portfolio_not_initialized" |
| Manual BUY in TEST mode | Deducts from TEST cash only |
| Reset portfolio in TEST mode | Only affects TEST row |
| `CALL reset_portfolio_capital(user_id, false)` | **ERROR: Cannot reset REAL portfolio capital** |
| Verify REAL row isolation | REAL row count remains 0 until deposit |

---

## 7. Files to Modify

### Database (via migration tool):
- [ ] `portfolio_capital` schema (add column, update PK)
- [ ] `get_portfolio_metrics` RPC
- [ ] `settle_buy_trade` RPC
- [ ] `settle_sell_trade` RPC  
- [ ] `reset_portfolio_capital` RPC
- [ ] `reserve_capital` RPC
- [ ] `release_reservation` RPC
- [ ] `recalculate_cash_from_trades` RPC (verify mode filter)

### Edge Functions:
- [ ] `supabase/functions/trading-decision-coordinator/index.ts`

### Frontend:
- [ ] `src/hooks/useMockWallet.tsx` (pass testMode to reset RPC)

---

## 8. Approval Gate

**This checklist requires explicit "GO" before execution.**

When approved:
1. Execute schema migration
2. Update RPCs in single migration
3. Deploy coordinator changes
4. Update frontend hooks
5. Run verification suite

---

## 9. Frozen Invariants (Must Not Break)

- ✅ TEST mode behavior unchanged
- ✅ Existing TEST capital rows preserved
- ✅ No FIFO logic changes
- ✅ No new ledgers introduced
- ✅ `get_portfolio_metrics` return shape unchanged
- ✅ `mock_trades` remains unified ledger
- ✅ Mode isolation via single `is_test_mode` flag
