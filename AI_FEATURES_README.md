# AI Features: Unified Intelligence Configuration

## Overview

The AI Features system provides a unified approach to intelligent trading decisions through three-layer configuration precedence. This replaces the previous "ScalpSmart" system with a more flexible, preset-based approach.

## Three-Layer Precedence System

### 1. User Strategy Config (Baseline)
- Base configuration set by the user in their strategy
- Fields: `takeProfitPercentage`, `stopLossPercentage`, `perTradeAllocation`, etc.
- Always present, provides fallback values

### 2. AI Features (If Enabled)
- Advanced AI capabilities configured in `aiIntelligenceConfig.features`
- Overrides user config when enabled
- Features include: Signal Fusion, Context Gates, Bracket Policy

### 3. AI Overrides (Scoped + Time-Limited)
- Temporary AI adjustments within guardrails
- Must be in `allowedKeys` and within `bounds`
- Expires after `ttlMs` (default 15 minutes)
- Highest precedence when active

## Configuration Structure

```typescript
aiIntelligenceConfig: {
  enableAIOverride: boolean,
  autonomy: { level: 0-100 },
  features: {
    // Signal Fusion (formerly ScalpSmart core)
    fusion: {
      enabled: boolean,
      weights: { trend, volatility, momentum, whale, sentiment },
      enterThreshold: number,    // Hysteresis entry
      exitThreshold: number,     // Hysteresis exit
      conflictPenalty: number
    },
    
    // Context Gates (market filters)
    contextGates: {
      spreadThresholdBps: number,      // Max spread to allow trades
      minDepthRatio: number,           // Min order book depth
      whaleConflictWindowMs: number    // Whale activity lookback
    },
    
    // Bracket Policy (risk management)
    bracketPolicy: {
      atrScaled: boolean,
      stopLossPctWhenNotAtr: number,
      trailBufferPct: number,
      enforceRiskReward: boolean,
      minTpSlRatio: number,
      atrMultipliers: { tp, sl }
    },
    
    // AI Override Guardrails
    overridesPolicy: {
      allowedKeys: string[],           // Which params AI can change
      bounds: {
        slPct: [min, max],            // Stop loss limits
        tpOverSlMin: number           // Min TP/SL ratio
      },
      ttlMs: number                   // Override expiration
    }
  }
}
```

## Presets System

Presets are **UI convenience only** - they fill configuration fields but create no code paths:

- **Conservative**: Fusion disabled, tight spreads, high depth requirements
- **Micro-Scalp 0.5%**: Fusion enabled, balanced weights, 0.65/0.35 thresholds (formerly "ScalpSmart")
- **Aggressive Growth**: Fusion enabled, trend-heavy weights, looser thresholds

Selecting a preset simply populates the configuration fields above. No engine branching occurs.

## Value Source Tracking

Every decision snapshot includes `value_sources` showing where each parameter came from:

```typescript
value_sources: {
  tpPct: "user_config" | "ai_feature" | "ai_override",
  slPct: "ai_feature",                    // From bracketPolicy
  enterThreshold: "ai_override",          // Temporary AI adjustment
  exitThreshold: "ai_feature",            // From fusion config
  spreadThresholdBps: "ai_feature",       // From contextGates
  minDepthRatio: "ai_feature",
  whaleConflictWindowMs: "user_config"    // Fallback to user setting
}
```

## Migration from ScalpSmart

### Before (Hardcoded Branching)
```typescript
const isScalpSmart = config.signalFusion?.enabled === true;
if (isScalpSmart) {
  // Special ScalpSmart logic
} else {
  // Legacy logic
}
```

### After (Feature-Based)
```typescript
const { isAIFusionEnabled, computeEffectiveConfig } = await import('@/utils/aiConfigHelpers');
const isAIEnabled = isAIFusionEnabled(config);
const effectiveConfig = computeEffectiveConfig(config, aiOverrides);

// Use effectiveConfig values - no branching needed
const threshold = side === 'BUY' ? effectiveConfig.enterThreshold : effectiveConfig.exitThreshold;
```

## Backward Compatibility

- Old `signalFusion`, `contextGates`, `brackets` keys still work
- Helper functions provide fallback reads: `getFusionConfig()`, `getContextGatesConfig()`, etc.
- Migration utility moves old config to new structure: `migrateToUnifiedConfig()`
- Engine reads both old and new paths; writes only new paths

## Benefits

1. **Single Source of Truth**: All configuration in database, no hardcoded literals
2. **No Mode Names**: "ScalpSmart" becomes just a preset name, not a code path  
3. **Flexible Precedence**: User → AI Features → AI Overrides with guardrails
4. **Value Transparency**: Every parameter shows its source in decision logs
5. **Preset Flexibility**: Easy to add new presets without code changes
6. **AI Safety**: Overrides are bounded, time-limited, and auditable

## Usage Example

```typescript
// In trading engine
const effectiveConfig = computeEffectiveConfig(strategy.configuration, aiOverrides);

// Use effective values (no branching)
const shouldEnter = signalScore >= effectiveConfig.enterThreshold;
const isSpreadOk = currentSpread <= effectiveConfig.spreadThresholdBps;
const stopLoss = effectiveConfig.slPct;

// Log decision with sources
await logDecisionSnapshot(strategy, symbol, side, fusionResult, decision, reason, brackets, {
  value_sources: effectiveConfig.value_sources,
  effective_config: effectiveConfig
});
```