# Test Mode Strategy Configuration

## Overview

TEST MODE is now a **per-strategy setting** stored in `trading_strategies.configuration.is_test_mode`. This ensures consistent test vs real mode behavior across the UI, backend coordinator, and learning loop.

## Architecture

### 1. Storage Location

**Table**: `trading_strategies`  
**Column**: `configuration` (JSONB)  
**Field**: `configuration.is_test_mode` (boolean)

```json
{
  "configuration": {
    "is_test_mode": true,
    "enableSignalFusion": false,
    "aiIntelligenceConfig": { ... },
    // ... other config
  }
}
```

### 2. UI Control

**Component**: `src/components/strategy/ComprehensiveStrategyConfig.tsx`  
**Section**: AI Intelligence Settings  
**Label**: "Test Mode (No Real Orders)"

The toggle:
- Default: `false` (LIVE mode)
- When `true`: Only mock trades, no real execution
- Persisted to `configuration.is_test_mode` in the database

### 3. Coordinator Integration

**File**: `supabase/functions/trading-decision-coordinator/index.ts`  
**Function**: `logDecisionAsync`

The coordinator extracts `isTestMode` from multiple sources (in priority order):

```typescript
const isTestMode = 
  strategyConfig?.configuration?.is_test_mode === true ||
  strategyConfig?.is_test_mode === true ||
  intent.metadata?.is_test_mode === true ||
  intent.metadata?.mode === 'mock';
```

**Primary source**: `strategyConfig.configuration.is_test_mode`  
**Fallbacks**: Legacy fields for backwards compatibility

### 4. Decision Events Logging

Every decision logged to `decision_events` now includes `metadata.is_test_mode`:

```json
{
  "metadata": {
    "is_test_mode": true,
    "action": "BUY",
    "unifiedConfig": { ... },
    "signalFusion": { ... },
    // ... other metadata
  }
}
```

This field is **always present** (true/false), making it simple to filter test vs real decisions in the learning loop.

### 5. Learning Loop Usage

The `decision-evaluator` and `calibration-aggregator` can now reliably distinguish test decisions:

```sql
-- Get only TEST mode decisions
SELECT * FROM decision_events
WHERE metadata->>'is_test_mode' = 'true';

-- Get only REAL mode decisions
SELECT * FROM decision_events
WHERE metadata->>'is_test_mode' = 'false'
   OR metadata->>'is_test_mode' IS NULL; -- backwards compat
```

## Migration Path

### For Existing Strategies

Strategies without `configuration.is_test_mode` will default to:
- **Coordinator**: Checks fallback fields (`intent.metadata.is_test_mode`, `intent.metadata.mode`)
- **Learning Loop**: Treats `null` as `false` (REAL mode) unless metadata indicates otherwise

### For New Strategies

All new strategies created via the UI will explicitly set `is_test_mode`:
- Default: `false` (LIVE mode)
- User can toggle at strategy creation or edit time

## UI Header Toggle

The existing **Header TEST MODE toggle** (from `useTestMode` hook) remains for convenience:
- Stored in: localStorage `global-test-mode`
- Purpose: Quick visual indicator and UI filtering for mock trades
- **Not synced** with strategy config (intentional - allows per-strategy test mode)

Users should use:
- **Header toggle**: For UI filtering and manual test trades
- **Strategy toggle**: For actual strategy execution mode

## Testing

See `tests/signal-fusion-coordinator.test.ts` for integration tests verifying:
1. `is_test_mode` is correctly extracted from strategy config
2. `decision_events.metadata.is_test_mode` is populated
3. Test mode does not affect trading logic (only metadata logging)

## Debugging

When troubleshooting test mode issues, check the coordinator logs:

```
[coordinator] logging decision with effective params {
  symbol: "BTC",
  is_test_mode: true,  // ← Look for this
  tp_pct: 1.5,
  sl_pct: 0.8,
  ...
}
```

And verify `decision_events` rows:

```sql
SELECT 
  id,
  symbol,
  side,
  metadata->>'is_test_mode' as test_mode,
  metadata->>'action' as action,
  created_at
FROM decision_events
ORDER BY created_at DESC
LIMIT 10;
```

## Best Practices

1. **Always set is_test_mode explicitly** when creating strategies
2. **Use test mode for paper trading** to validate strategies before live deployment
3. **Filter decision_events by is_test_mode** when analyzing learning loop data
4. **Keep test and live strategies separate** (don't toggle an active strategy between modes)

## Status

✅ **COMPLETE**
- Strategy config extended with `is_test_mode`
- UI toggle added to Strategy Configuration page
- Coordinator extracts and logs test mode flag
- `decision_events.metadata.is_test_mode` always populated
- Tests added for coordinator integration
