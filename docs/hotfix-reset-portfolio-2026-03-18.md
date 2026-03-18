# Hotfix: Reset Portfolio Not Deleting Trades — 2026-03-18

## Summary

`reset_portfolio_capital(uuid, boolean)` was missing `DELETE FROM mock_trades`, so clicking "Reset Portfolio" reset the cash balance but left all test trades intact.

## Root Cause

Two overloads of `reset_portfolio_capital` exist in the database:

1. **`(uuid, numeric)`** — OLD overload from migration `20251213103641`. Deletes mock_trades + resets portfolio_capital.
2. **`(uuid, boolean)`** — NEW overload from migration `20260204160501`. Only resets portfolio_capital. **Missing mock_trades deletion.**

The frontend calls `supabase.rpc('reset_portfolio_capital', { p_user_id, p_is_test_mode: true })`, which matches the `(uuid, boolean)` overload — the one **without** trade deletion.

## Fix

Added `DELETE FROM mock_trades WHERE user_id = p_user_id AND is_test_mode = true` to the `(uuid, boolean)` overload.

### File Modified

**Database function: `public.reset_portfolio_capital(uuid, boolean)`**

### Lines Added (inside function body, before portfolio_capital reset)

```sql
-- 1. DELETE all test-mode trades for the user (HARD RESET)
DELETE FROM public.mock_trades
WHERE user_id = p_user_id
  AND is_test_mode = true;

GET DIAGNOSTICS deleted_trades = ROW_COUNT;
```

### Return value updated

```sql
-- Added deleted_trades to response
RETURN jsonb_build_object(
  'success', true,
  'mode', 'test',
  'deleted_trades', deleted_trades,
  'starting_capital_eur', 30000,
  'cash_balance_eur', 30000
);
```

## No Frontend Changes

No code changes were needed. The frontend already calls the correct RPC.

## Classification

- **Bug** ❌ — Regression introduced when `(uuid, boolean)` overload was created without carrying over the trade deletion logic from the `(uuid, numeric)` overload.
