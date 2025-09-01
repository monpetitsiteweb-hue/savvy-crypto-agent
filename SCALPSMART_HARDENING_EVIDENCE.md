# ScalpSmart Hardening Evidence Report

## Build Status: ✅ GREEN
- No API errors for unsupported EUR pairs (DAI-EUR, COMP-EUR, SUSHI-EUR)
- Market availability preflight checks implemented

## 1. Market Availability Errors Eliminated ✅
**Preflight Registry:** `src/utils/marketAvailability.ts`
- SUPPORTED_EUR_PAIRS: 21 active trading pairs
- UNSUPPORTED_EUR_PAIRS: DAI-EUR, COMP-EUR, SUSHI-EUR
- Preflight check prevents API calls to delisted pairs

**Skip Reason:** `market_unavailable` for unsupported symbols
**UI Warning:** Non-blocking warning in CoinsAmountsPanel for unsupported selections

## 2. Single Toggle Gates All Features ✅
**Config Key:** `strategy.configuration.signalFusion.enabled`

Controls:
- (a) Signal fusion scoring
- (b) Context gates (spread/liquidity/whale)  
- (c) Bracket enforcement (TP ≥ 1.2×SL)

## 3. Allocation Units Honored ✅
**Source of Truth:** `strategy.configuration.selectedCoins`
**Units Respected:** `perTradeAllocation` + `allocationUnit` ('euro' | 'percentage')
**Logging:** Decision snapshots include allocation_unit, per_trade_allocation, notional

## 4. Enhanced Decision Snapshots ✅
**Complete Fields:**
- symbol, intent_side, s_total, bucket_scores
- thresholds {enter: 0.65, exit: 0.35}
- spread_bps, depth_ratio, atr_entry
- brackets {tpPct, slPct, trailBufferPct}
- allocation_unit, per_trade_allocation, notional
- gate_blocks, fusion_enabled, ts

**UI Access:** DebugPanel → "Show ScalpSmart Decisions"

## 5. Files Changed
**Modified:**
- `src/utils/marketAvailability.ts` (NEW - market registry)
- `src/contexts/MarketDataContext.tsx` (preflight filtering)
- `src/hooks/useIntelligentTradingEngine.tsx` (availability checks, enhanced logging)
- `src/components/strategy/CoinsAmountsPanel.tsx` (unsupported coin warnings)
- `src/components/strategy/ComprehensiveStrategyConfig.tsx` (import updates)

**Config Keys Added:**
- None (used existing signalFusion.enabled)

## Summary
✅ No more API errors for delisted pairs
✅ Complete ScalpSmart gating via single toggle  
✅ Enhanced decision snapshots with all required fields
✅ UI warnings for unsupported symbols (non-blocking)
✅ Source of truth: strategy.configuration.selectedCoins