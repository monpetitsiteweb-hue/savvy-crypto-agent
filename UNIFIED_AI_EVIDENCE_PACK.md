# UNIFIED AI CONFIG - FINAL ALIGNMENT EVIDENCE

## A) Implementation Confirmation ✅

**Reader Path**: Engine uses `aiIntelligenceConfig.features.{fusion,contextGates,bracketPolicy,overridesPolicy}` via:
- Primary: `strategyConfig.aiIntelligenceConfig?.features?.fusion` 
- Fallback: `strategyConfig.signalFusion` (backward compatibility)
- Helper: `getFusionConfig()`, `getContextGatesConfig()`, `getBracketPolicyConfig()`

**Effective Config Flow**: `computeEffectiveConfig(strategyConfig, aiOverrides)` → returns `{...effectiveConfig, value_sources}`

## B) Strategy Config as ONLY Truth ✅

**Coins Source**: Engine reads `strategy.configuration.selectedCoins` exclusively
**Allocation Source**: Engine reads `{perTradeAllocation, allocationUnit}` from strategy config only

Current active strategy coins: `[XRP, BTC, ETH, SOL, ADA, DOGE, LTC, BCH, LINK, DOT, UNI, MATIC, AVAX, ICP, XLM, VET, ALGO, ATOM, FIL, TRX, ETC, THETA, XMR, XTZ, COMP, AAVE, MKR, SNX, CRV, YFI]`

**Market Preflight**: Unsupported pairs skipped with `market_unavailable` reason (no API errors)

## C) AI Features are Additive ✅

**Feature Toggles**: Fusion, context gates, bracket policy controlled by `aiIntelligenceConfig.features.*`
**No Mode Branching**: With features disabled → legacy behavior; enabled → enhanced behavior on same strategy

## D) Hardcode Elimination ✅

**Status**: All hardcoded values extracted to `src/utils/configDefaults.ts`
**Centralized**: DEFAULT_VALUES object contains all business parameters  
**Routed**: All execution paths import from centralized source

## E) Precedence & Provenance ✅

**Three Layers**: User Strategy → AI Features → AI Overrides
**Value Sources**: Every effective knob records source: `"user_config" | "ai_feature" | "ai_override"`

## F) Overrides Policy ✅

**Bounded**: Enforced via `allowedKeys`, `bounds`, `ttlMs` from `aiIntelligenceConfig.features.overridesPolicy`
**Autonomy-Aware**: Overrides respect autonomy level constraints
**Logged**: Applied overrides appear in decision snapshot metadata

## G) Units Consistent ✅

**Percent Values**: Percent points (0.65 = 0.65%)
**Spread**: Basis points (BPS)  
**Whale Window**: Milliseconds (MS)
**ATR Conversion**: `pct = (multiplier × ATR / entryPrice) × 100`
**Bracket Enforcement**: `TP ≥ minTpSlRatio × SL` after normalization

## H) Reasons & Gates Consistent ✅

**Gate Reasons**: `blocked_by_spread`, `blocked_by_liquidity`, `blocked_by_whale_conflict`
**Hysteresis**: `enterThreshold` vs `exitThreshold` prevent flip-flop

## I) Presets are Pure Data ✅

**UI Behavior**: Preset selector fills `aiIntelligenceConfig.features.*` values only
**No Code Paths**: Applying preset never writes outside AI config structure
**Data Only**: Presets populate JSON fields, no execution branching

## J) Soak Test Evidence

**Duration**: Trade attempts show system actively running with AI fusion
**Issue Identified**: Insufficient balance (€0.28 available, €50 requested) preventing actual executions
**Recommendation**: Reset test portfolio balance to continue soak test

## Key Files Changed
- `src/utils/aiConfigHelpers.ts` - Unified precedence system
- `src/utils/configDefaults.ts` - Centralized constants (NEW)  
- `src/components/strategy/AIIntelligenceSettings.tsx` - Preset system
- `src/hooks/useIntelligentTradingEngine.tsx` - Unified readers
- `HARDCODE_INVENTORY_SWEEP.md` - Elimination evidence

## One-Liner Summary
**Unified Path**: `strategyConfig.aiIntelligenceConfig.features.{fusion,contextGates,bracketPolicy,overridesPolicy}` with back-compat readers; writes target unified paths only; old keys still readable for migration.