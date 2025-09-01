# UNIFIED AI CONFIG — FINAL ALIGNMENT EVIDENCE PACK

## ✅ REQUIREMENTS CONFIRMATION

### A) Implementation Proof
**Reader Path**: `strategyConfig.aiIntelligenceConfig.features.{fusion,contextGates,bracketPolicy,overridesPolicy}`
- **Primary**: Engine uses unified path via `computeEffectiveConfig()`
- **Back-compat**: Fallback readers `getFusionConfig()`, `getContextGatesConfig()`, `getBracketPolicyConfig()`
- **Writes**: Target unified paths only, old keys readable for migration

### B) Strategy Config as Single Truth ✅
**Coins**: Engine reads `strategy.configuration.selectedCoins` exclusively
**Current Strategy Coins**: `[XRP, BTC, ETH, SOL, ADA, DOGE, LTC, BCH, LINK, DOT, UNI, MATIC, AVAX, ICP, XLM, VET, ALGO, ATOM, FIL, TRX, ETC, THETA, XMR, XTZ, COMP, AAVE, MKR, SNX, CRV, YFI]`
**Allocation**: `{perTradeAllocation: 50, allocationUnit: "euro"}` from strategy config only
**Market Preflight**: Unsupported pairs skip with `market_unavailable` reason

### C) AI Features are Additive ✅
**No Modes**: Fusion/gates/brackets controlled by feature toggles only
**Behavior**: Features disabled = legacy; enabled = enhanced on same strategy
**Toggle Path**: `aiIntelligenceConfig.features.fusion.enabled`

### D) Hardcode Elimination ✅
**Status**: All literals extracted to `src/utils/configDefaults.ts`
**Sweep Command**: `grep -r "0\.65\|0\.40\|12\|3\.0" src/ --exclude=configDefaults.ts`
**Routed Values**:
- TP/SL percentages → `DEFAULT_VALUES.{TAKE_PROFIT_PCT, STOP_LOSS_PCT}`
- Thresholds → `DEFAULT_VALUES.{ENTER_THRESHOLD, EXIT_THRESHOLD}`
- Context gates → `DEFAULT_VALUES.{SPREAD_THRESHOLD_BPS, MIN_DEPTH_RATIO, WHALE_CONFLICT_WINDOW_MS}`
- Allocation → `DEFAULT_VALUES.{PER_TRADE_ALLOCATION, ALLOCATION_UNIT}`

### E) Precedence & Provenance ✅
**Three Layers**: User Strategy → AI Features → AI Overrides
**Value Sources**: Every effective parameter tracked: `"user_config" | "ai_feature" | "ai_override"`
**Implementation**: `computeEffectiveConfig()` returns `{...effectiveConfig, value_sources}`

### F) Overrides Policy ✅
**Bounded**: `allowedKeys`, `bounds`, `ttlMs` enforced from `overridesPolicy`
**Autonomy-Aware**: Constraint scaling by autonomy level
**Logged**: Overrides appear in decision metadata with timestamp/scope

### G) Units Consistent ✅
**Percent**: Percent points (0.65 = 0.65%)
**Spread**: Basis points (BPS)
**Whale Window**: Milliseconds (MS)  
**ATR**: `pct = (multiplier × ATR / entryPrice) × 100`
**Enforcement**: `TP ≥ minTpSlRatio × SL` after normalization

### H) Reasons & Gates Consistent ✅
**Gate Reasons**: `blocked_by_spread`, `blocked_by_liquidity`, `blocked_by_whale_conflict`
**Hysteresis**: `enterThreshold` vs `exitThreshold` prevent oscillation

### I) Presets are Pure Data ✅
**UI Behavior**: Preset selector fills JSON fields only via `updateConfig()`
**No Branching**: Presets populate `aiIntelligenceConfig.features.*` values
**Current Presets**: Conservative, Micro-Scalp 0.5%, Aggressive Growth

### J) System Activity Evidence
**Trade Attempts**: System actively processing buy intents for BTC, ETH, SOL, XRP
**AI Fusion**: Engine using `ai_fusion_engine` path when enabled
**Issue**: Balance insufficient (€0.28 vs €50 requested) preventing completions
**Recommendation**: Reset test portfolio to €30000 to continue soak test

## 📁 CHANGED FILES
- `src/utils/aiConfigHelpers.ts` - Unified precedence system
- `src/utils/configDefaults.ts` - Centralized constants *(NEW)*
- `src/components/strategy/AIIntelligenceSettings.tsx` - Preset system updates
- `src/hooks/useIntelligentTradingEngine.tsx` - Unified readers implementation
- Database migration applied for unified structure

## 🎯 ONE-LINER SUMMARY
Engine reads `strategyConfig.aiIntelligenceConfig.features.{fusion,contextGates,bracketPolicy,overridesPolicy}` with backward-compatible fallbacks; writes target unified paths only; strategy configuration remains single source of truth for coins/allocation.

## 🔒 NON-NEGOTIABLES MET
- ✅ No renames/breakage
- ✅ Single DB source of truth  
- ✅ No hardcoded business values
- ✅ Presets = data only
- ✅ Additive features, not modes
- ✅ Precedence enforced with provenance
- ✅ Back-compatibility preserved