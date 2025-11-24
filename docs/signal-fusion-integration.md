# Signal Fusion Integration Guide

## Overview
Signal Fusion computes a single weighted score from multiple live market signals to enhance trading decisions.

## Architecture

### Tables
1. **`signal_registry`**: Global registry of all signal types with default weights
2. **`strategy_signal_weights`**: Per-strategy weight overrides
3. **`live_signals`**: Ingested signals from various providers

### Module
`src/engine/signalFusion.ts` - Core fusion logic

## How It Works

### 1. Signal Collection
For a given (symbol, horizon), the fusion module:
- Queries `live_signals` for recent signals within the lookback window
- Includes both symbol-specific signals AND market-wide signals (symbol='ALL')
- Lookback windows by horizon:
  - 15m: 30 minutes
  - 1h: 2 hours
  - 4h: 8 hours
  - 24h: 48 hours

### 2. Weight Resolution
For each signal:
- Checks if signal type is enabled in `signal_registry`
- Gets `default_weight` from registry
- Checks for per-strategy override in `strategy_signal_weights`
- Uses override weight if present, otherwise uses default

### 3. Score Computation
- Normalizes `signal_strength` (0-100) to (0-1)
- Applies direction multiplier based on `direction_hint`:
  - `bullish`: +1 (positive contribution)
  - `bearish`: -1 (negative contribution)
  - `symmetric`/`contextual`: +1 (keep as-is)
- Contribution = normalizedStrength × weight × directionMultiplier
- `fusedScore` = sum of all contributions × 20, capped at [-100, +100]

### 4. Output
Returns:
```typescript
{
  fusedScore: number,        // -100 to +100
  details: SignalDetail[],   // Breakdown per signal
  totalSignals: number,      // Count of raw signals found
  enabledSignals: number     // Count of signals used
}
```

## Integration with Trading Coordinator

### Phase 1B: Strategy-Level Toggle (READ-ONLY MODE)

Signal Fusion is controlled via a **per-strategy toggle** in the Strategy Configuration UI. When enabled, the coordinator computes and logs fusion scores WITHOUT changing trading behavior.

#### User Toggle Location
**Strategy Page** → **Configuration Tab** → **AI Intelligence Settings** → **Enable Signal Fusion Telemetry**

#### Configuration Storage
```json
// trading_strategies.configuration
{
  "enableSignalFusion": true,
  // ... other strategy settings
}
```

#### Coordinator Check
The coordinator uses `isSignalFusionEnabled()` to determine if fusion should run:
```typescript
function isSignalFusionEnabled(strategyConfig: any): boolean {
  const isTestMode = strategyConfig?.is_test_mode === true || 
                    strategyConfig?.execution_mode === 'TEST';
  const fusionEnabled = strategyConfig?.enableSignalFusion === true;
  return isTestMode && fusionEnabled;
}
```

**Requirements**:
1. `enableSignalFusion: true` in strategy configuration
2. Strategy in test mode

**Default**: Fusion OFF (undefined or false)

#### Data Flow
1. User enables toggle in Strategy UI
2. Configuration saved to `trading_strategies.configuration.enableSignalFusion`
3. Coordinator reads strategy config when processing intents
4. If enabled: computes fusion score, logs to `decision_events.metadata.signalFusion`
5. If disabled: skips fusion entirely (no DB calls, no metadata)

#### Logged Data Structure
When fusion is enabled, `decision_events.metadata.signalFusion` contains:
```json
{
  "fusedScore": 42.5,
  "totalSignals": 8,
  "enabledSignals": 5,
  "topSignals": [
    { "type": "ma_cross_bullish", "contribution": "12.5" },
    { "type": "rsi_oversold_bullish", "contribution": "8.2" }
  ]
}
```

### Phase 1: Feature Flag (DEPRECATED - use strategy toggle instead)
Add to strategy configuration:
```json
{
  "enableSignalFusion": true,
  "is_test_mode": true
}
```

### Phase 2: Coordinator Integration (REFERENCE - already implemented)
In `supabase/functions/trading-decision-coordinator/index.ts`:

```typescript
import { computeFusedSignalScore } from './signalFusion';

// ... in decision evaluation logic ...

// Check if signal fusion is enabled
const enableFusion = config?.enableSignalFusion === true && 
                     config?.is_test_mode === true;

let fusedSignalData = null;
if (enableFusion) {
  try {
    const fusionResult = await computeFusedSignalScore({
      userId: intent.userId,
      strategyId: intent.strategyId,
      symbol: intent.symbol,
      horizon: intent.metadata?.horizon || '1h',
      now: new Date()
    });
    
    fusedSignalData = {
      score: fusionResult.fusedScore,
      signalCount: fusionResult.enabledSignals,
      topSignals: fusionResult.details
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 5)
        .map(d => ({
          type: d.signalType,
          contribution: d.contribution.toFixed(2)
        }))
    };
    
    console.log(`[Coordinator] Fused signal score for ${intent.symbol}: ${fusionResult.fusedScore.toFixed(2)}`);
  } catch (err) {
    console.error('[Coordinator] Signal fusion failed, continuing with default logic:', err);
  }
}

// Attach to decision log metadata
const decisionMetadata = {
  ...existingMetadata,
  signalFusion: fusedSignalData
};

// Future: Use fusedScore to enhance confidence or adjust decision gates
// For Phase 1, we just log it for correlation analysis
```

### Phase 3: Decision Gate Enhancement (Future)
Potential uses of `fusedScore`:
- Boost confidence when fusedScore aligns with intent direction
- Block trades when fusedScore strongly contradicts intent
- Adjust TP/SL levels based on signal strength
- Create a "signal disagreement" gate for high-divergence scenarios

## Testing

### Manual Test Steps

1. **Insert test signals**:
```sql
-- Bullish signal for BTC
INSERT INTO public.live_signals (user_id, source_id, symbol, signal_type, signal_strength, source, timestamp)
VALUES (
  '<your-user-id>',
  '<your-strategy-id>',
  'BTC',
  'ma_cross_bullish',
  85,
  'manual_test',
  now()
);

-- Bearish signal for BTC
INSERT INTO public.live_signals (user_id, source_id, symbol, signal_type, signal_strength, source, timestamp)
VALUES (
  '<your-user-id>',
  '<your-strategy-id>',
  'BTC',
  'rsi_overbought_bearish',
  70,
  'manual_test',
  now()
);
```

2. **Call fusion function** (from UI or direct test):
```typescript
const result = await computeFusedSignalScore({
  userId: '<your-user-id>',
  strategyId: '<your-strategy-id>',
  symbol: 'BTC',
  horizon: '1h'
});

console.log('Fused Score:', result.fusedScore);
console.log('Signal Details:', result.details);
```

3. **Verify registry**:
- Check Admin > Signal Registry tab
- Verify signal types are listed
- Test editing weights and toggling enabled status

4. **Test strategy overrides**:
```sql
INSERT INTO public.strategy_signal_weights (strategy_id, signal_key, weight, is_enabled)
VALUES (
  '<your-strategy-id>',
  'ma_cross_bullish',
  2.5,  -- Override default weight
  true
);
```

5. **Verify fusion respects override**:
- Re-run computeFusedSignalScore
- Check that appliedWeight = 2.5 in details

### Automated Test Suite
Run: `npm test tests/signal-fusion.test.ts`

## Current Limitations

1. **Not Yet Used in Decisions**: Signal fusion is computed but not yet influencing coordinator gates
2. **No Calibration**: Weights are not yet auto-tuned based on performance
3. **Simple Normalization**: All signals treated as 0-100 scale
4. **No Time Decay**: Older signals within window have same weight as fresh signals
5. **No Signal Correlation**: Redundant signals from same provider treated independently

## Next Steps (Phase 2)

1. Wire `fusedScore` into coordinator confidence boost/penalty logic
2. Add calibration loop to tune signal weights based on realized outcomes
3. Implement signal deduplication and correlation analysis
4. Add time-decay factors for older signals
5. Create strategy-level UI for customizing signal weights
