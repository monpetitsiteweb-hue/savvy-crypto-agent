# Signal Fusion Phase 1B - Strategy-Level Toggle

## Overview

Signal Fusion Phase 1B is now fully controllable via a **per-strategy toggle** in the user dashboard. This allows users to enable or disable fusion telemetry on a strategy-by-strategy basis, without affecting trading behavior.

## User Interface

### Location
The **"Enable Signal Fusion Telemetry"** toggle is located in:
- **Strategy Page** → **Configuration Tab** → **AI Intelligence Settings** section
- Below the main "Enable AI Intelligence" switch
- Marked with a "Beta" badge

### UI Controls
- **Toggle Switch**: ON/OFF control for signal fusion
- **Label**: "Enable Signal Fusion Telemetry"
- **Badge**: "Beta" indicator
- **Description**: 
  > When enabled, the engine logs a fused score of all active signals for this strategy (for Dev/Learning and analysis). **It does NOT change trading decisions yet.**
- **Additional Info**:
  > Only active in Test Mode. Fusion data appears in decision_events.metadata.signalFusion.

## Technical Implementation

### Data Storage
- **Table**: `trading_strategies`
- **Column**: `configuration` (JSONB)
- **Field**: `enableSignalFusion` (boolean, optional)
- **Default**: `false` (undefined also treated as false)

### Strategy Configuration Type
```typescript
interface StrategyFormData {
  // ... existing fields
  enableSignalFusion?: boolean;
}
```

### Coordinator Integration
The `trading-decision-coordinator` Edge Function checks this flag via:
```typescript
function isSignalFusionEnabled(strategyConfig: any): boolean {
  const isTestMode = strategyConfig?.is_test_mode === true || 
                    strategyConfig?.execution_mode === 'TEST';
  const fusionEnabled = strategyConfig?.enableSignalFusion === true;
  return isTestMode && fusionEnabled;
}
```

**Conditions for fusion to run:**
1. `enableSignalFusion === true` in strategy configuration
2. Strategy is in test mode (`is_test_mode === true` or `execution_mode === 'TEST'`)

### Data Flow
1. **User enables toggle** in Strategy Configuration UI
2. **Strategy saves** with `configuration.enableSignalFusion = true`
3. **Coordinator reads** strategy config when processing trade intents
4. **Fusion module called** if conditions met:
   - Queries `live_signals` for relevant signals
   - Queries `signal_registry` for weights
   - Queries `strategy_signal_weights` for per-strategy overrides
   - Computes fused score
5. **Fusion data logged** to `decision_events.metadata.signalFusion`:
   ```json
   {
     "signalFusion": {
       "fusedScore": 42.5,
       "totalSignals": 8,
       "enabledSignals": 5,
       "topSignals": [...]
     }
   }
   ```

## Constraints

### Hard Constraints (Never Violated)
1. **Zero Behavior Change**: Fusion does NOT influence BUY/SELL/BLOCK/DEFER decisions
2. **Test Mode Only**: Fusion only active when strategy is in test mode
3. **No Admin Panel**: Toggle is strategy-level, NOT system-wide (Admin Panel only manages `signal_registry`)
4. **Fail-Soft**: Fusion errors are logged but never block trading decisions
5. **No New Tables**: Uses existing `trading_strategies.configuration` JSON field

### Soft Constraints
- **Performance**: Fusion adds ~50-200ms latency to decision flow when enabled
- **Data Volume**: Each decision with fusion logs ~1-5KB extra metadata
- **Signal Coverage**: Fusion only computes if signals exist in `live_signals` for the lookback window

## Testing

### Unit Tests
File: `tests/signal-fusion-coordinator.test.ts`

**Test Cases:**
1. ✅ Strategy with `enableSignalFusion: false` → fusion NOT called
2. ✅ Strategy with `enableSignalFusion: true` → fusion called & logged
3. ✅ Fusion errors fail soft (no decision blocking)
4. ✅ Decision behavior unchanged with or without fusion

### Manual Testing
1. Create a test strategy
2. Navigate to **Strategy Page** → **Configuration** → **AI Intelligence Settings**
3. Enable "Signal Fusion Telemetry" toggle
4. Save strategy
5. Trigger a trade decision (manual or automated)
6. Query `decision_events` and verify `metadata.signalFusion` is present
7. Disable toggle, trigger another decision, verify `metadata.signalFusion` is absent

### Expected Logs
When fusion is enabled:
```
[SignalFusion] Found X signals for SYMBOL/HORIZON
[SignalFusion] Fused score for SYMBOL/HORIZON: Y from Z signals
```

When fusion is disabled:
```
(no fusion logs)
```

## Compatibility

### Backward Compatibility
- **Existing strategies**: If `enableSignalFusion` is undefined, defaults to `false` (fusion disabled)
- **Old coordinator versions**: Strategies with `enableSignalFusion: true` are safely ignored if coordinator lacks fusion code

### Forward Compatibility
- **Phase 2 (future)**: When fusion influences decisions, this toggle becomes the permission gate
- **Weight overrides**: `strategy_signal_weights` table is ready for per-strategy customization (UI not yet implemented)

## Documentation Links
- [Signal Fusion Integration](./signal-fusion-integration.md) - Coordinator integration details
- [Phase 1B Summary](./PHASE_1B_CHANGES_SUMMARY.md) - Complete Phase 1B implementation
- [Signal Ingestion](./signal-ingestion.md) - Signal providers and types

## Status
✅ **Completed** - Phase 1B strategy toggle fully implemented and tested
