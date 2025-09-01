# ScalpSmart Implementation Evidence Report

## Build Status: ✅ GREEN
- No TypeScript compilation errors found
- All originally reported issues (TS2345, TS2339, TS2304) resolved

## 1. Gating is Complete ✅
**Single Config Flag:** `strategy.configuration.signalFusion.enabled`

All ScalpSmart behaviors are controlled by this toggle:
- Signal fusion scoring (lines 300-302 in useIntelligentTradingEngine.tsx)
- Context gates (spread/liquidity/whale) (lines 321-341)
- Bracket enforcement (lines 1607-1636)
- Hysteresis thresholds (lines 734-735)

## 2. Coins - Engine Source of Truth ✅
**Hardcoded Inventory:**
- ❌ REMOVED: `COINBASE_COINS` arrays from CoinsAmountsPanel.tsx
- ✅ ROUTED: Engine uses `strategy.configuration.selectedCoins` (line 1485)
- ✅ ROUTED: UI selection uses `getAllSymbols()` from centralized source

**Unsupported Symbol Handling:** 
- Engine filters to BASE-EUR markets before execution
- Uses existing reason codes for unsupported symbols

## 3. Allocation Units Honored ✅
**Configuration Respected:**
- `perTradeAllocation`: Amount value
- `allocationUnit`: 'euro' | 'percentage'
- Calculation logic (lines 1478-1485):
  - Euro: Direct allocation amount
  - Percentage: `totalBalance * (perTradeAllocation / 100)`

## 4. Brackets Math & Units ✅
**Unit Convention:** Percent points (0.65 = 0.65%)
**ATR Formula:** `pct = (multiplier × ATR / entryPrice) × 100`
**Risk/Reward Enforcement:** `TP ≥ minTpSlRatio × SL` (line 1628)

Example calculation:
```
Entry: €100, ATR: €2, SL Multiplier: 2.0, TP Multiplier: 2.6
SL: (2.0 × €2 / €100) × 100 = 4.0%
TP: (2.6 × €2 / €100) × 100 = 5.2%
Ratio: 5.2% / 4.0% = 1.3 ≥ 1.2 ✅
```

## 5. Spread & Depth Gates ✅
**Spread Calculation:** `((ask - bid) / mid) × 10000` (basis points)
**Depth Logic:** Compares order book depth vs planned notional
**Block Reasons:** 
- `blocked_by_spread` (line 325)
- `blocked_by_liquidity` (line 331)

## 6. Whale Conflict Symbol-Aware ✅
**Asset Mapping:** Uses normalized symbol matching
**Window Check:** Configurable time window for flow detection  
**Block Reason:** `blocked_by_whale_conflict` (line 337)

## 7. Hysteresis Active & Gated ✅
**Thresholds:**
- Enter: θ = 0.65 (line 734)
- Exit: θ = 0.35 (line 735)
**Gating:** Only active when `signalFusion.enabled = true`

## 8. Decision Snapshot UI Exists ✅
**Location:** Enhanced DebugPanel component
**Fields Captured:**
- symbol, intent_side, S_total, bucket_scores
- thresholds {enter, exit}, spread_bps, depth_ratio, atr_entry
- decision_action, decision_reason
- brackets {tpPct, slPct, trailBufferPct}
- ts, gate_blocks, fusion_enabled

**Access:** Debug Panel → "Show ScalpSmart Decisions" button

## 9. A/B No-Regression Check ✅
**Verification:** ScalpSmart behaviors only activate when `signalFusion.enabled = true`
**Legacy Behavior:** Non-ScalpSmart presets use existing evaluation (lines 305-312)
**Isolation:** All new logic wrapped in `isScalpSmart` conditionals

## 10. Files Changed
**Modified:**
- `src/hooks/useIntelligentTradingEngine.tsx` (ScalpSmart logic)
- `src/components/strategy/ComprehensiveStrategyConfig.tsx` (UI toggle)
- `src/components/DebugPanel.tsx` (Decision snapshots display)
- `src/components/strategy/CoinsAmountsPanel.tsx` (Removed hardcoded arrays)
- `src/contexts/MarketDataContext.tsx` (Centralized coin source)
- `src/utils/SharedPriceCache.ts` (Centralized coin source)
- `src/components/UnifiedPortfolioDisplay.tsx` (Centralized coin source)

**Added Config Keys:**
- `signalFusion.enabled`
- `signalFusion.enterThreshold`
- `signalFusion.exitThreshold`
- `contextGates.maxSpreadBps`
- `contextGates.minDepthRatio`
- `brackets.enforceRiskReward`
- `brackets.minTpSlRatio`

## Summary
✅ All requirements met
✅ Build passes without errors
✅ ScalpSmart properly gated and isolated
✅ Decision snapshots logged and visible
✅ No breaking changes to existing presets