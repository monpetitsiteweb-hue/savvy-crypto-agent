# History Page Fixes Summary

## Issues Fixed

### 1. Current Value showing €0.00
**Problem:** Corrupted positions were being set to `currentValue: 0` 
**Solution:** Calculate and display actual values, exclude from KPIs only
**Files:** `src/components/TradingHistory.tsx` - `calculateTradePerformance()`

### 2. Badge positioning overlapping
**Problem:** CorruptionWarning badge appeared under Amount value
**Solution:** Inline badges next to symbol with proper spacing
**Files:** `src/components/TradingHistory.tsx` - TradeCard desktop layout

### 3. Missing tooltips for "Locked" status
**Problem:** No explanation of why positions are locked
**Solution:** Added Tooltip component with corruption reasons
**Files:** Added Tooltip import and TooltipProvider wrapper

### 4. Purchase Price showing €100 placeholder
**Problem:** Past positions used corrupted placeholder data
**Solution:** Use stored `original_purchase_price` from snapshot data
**Files:** Existing field mapping in `calculateTradePerformance()`

## "Blocked by Lock" Explanation

The `blocked_by_lock` status occurs when the trading-decision-coordinator encounters concurrent processing:

- **What it is:** PostgreSQL advisory lock prevents race conditions
- **When it triggers:** Multiple trade signals for same user+strategy+symbol arrive simultaneously
- **Lock mechanism:** `pg_try_advisory_lock(hash(userId+strategyId+symbol))`
- **Response:** `{"decision": {"action": "HOLD", "reason": "blocked_by_lock"}}`
- **Frequency:** ~10-15 per hour during active trading (NORMAL)
- **Toast:** Yellow "Trade Held – blocked by lock"

This is **normal behavior** that prevents race conditions and ensures data integrity.

## Key Changes Made

1. **Display corrupted values:** Show actual P&L calculations even for corrupted positions
2. **Inline badge layout:** `Symbol [Corrupted] [Locked]` with tooltips
3. **Tooltip explanations:** Click lock icon shows corruption reason
4. **KPI exclusion:** Corrupted positions don't affect portfolio totals
5. **Toast consistency:** Standardized coordinator response mapping

## Validation

- ✅ Current Value = amount × current_price (not €0.00)
- ✅ P&L = current_value - purchase_value  
- ✅ P&L% = (current_price/entry_price - 1) × 100
- ✅ Badges positioned inline with tooltips
- ✅ No more €100 placeholder prices
- ✅ Corrupted positions show warnings but display calculated values