# Hotfix: `sc` undefined in executeTradeOrder() — 2026-03-18

## Summary

One-line surgical fix to resolve **critical SELL execution failure** caused by `ReferenceError: sc is not defined` in the UD=ON SELL path.

## File Modified

**`supabase/functions/trading-decision-coordinator/index.ts`**

### Line 7075

**Removed:**
```javascript
        strategyExecutionTarget: sc?.canonicalExecutionMode || 'MOCK',
```

**Added:**
```javascript
        strategyExecutionTarget: strategyConfig?.canonicalExecutionMode || 'MOCK',
```

### Context (lines 7070–7078, after fix)

```javascript
      // Phase 2: Use deriveExecutionClass for system operator detection
      // Deprecated: Direct flag check `intent.source === "manual" && intent.metadata?.system_operator_mode === true`
      const sellExecClass = deriveExecutionClass({
        source: intent.source,
        metadata: intent.metadata,
        strategyExecutionTarget: strategyConfig?.canonicalExecutionMode || 'MOCK',  // ← FIXED
      });
      // These trades bypass coverage entirely (real on-chain tokens from SYSTEM wallet via BOT_ADDRESS)
      const isSystemOperatorMode = sellExecClass.isSystemOperator;
```

## Root Cause

- `sc` was declared at line 4419 inside `executeTradeDirectly()` (UD=OFF path)
- `executeTradeOrder()` (UD=ON path) has no `sc` variable in scope
- `strategyConfig` is the correct in-scope variable carrying the same data
- JavaScript optional chaining (`?.`) does NOT prevent `ReferenceError` on undeclared variables

## Impact

- **Before fix:** Every SELL intent crashed with `tp_execution_failed`. Zero SELLs executed for 48h+.
- **After fix:** SELL execution resumes normally through TP, SL, and trailing exit paths.

## No Other Changes

- No logic changes
- No refactoring
- No formatting changes
- Only the single variable name was replaced
