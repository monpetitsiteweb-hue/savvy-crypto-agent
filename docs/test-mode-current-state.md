# Test Mode Current State - Reconnaissance

## Current Implementation Status

### 1. UI Toggle Location

**Component**: `src/components/Header.tsx`
- **Lines 108-118 (Desktop)** and **Lines 253-263 (Mobile)**
- Uses `useTestMode` hook from `src/hooks/useTestMode.tsx`
- Displays as "TEST MODE" (orange) vs "LIVE MODE" (gray)
- Toggle is always visible in the app header

### 2. State Management

**Hook**: `src/hooks/useTestMode.tsx`
- **Storage**: localStorage key `'global-test-mode'`
- **Type**: Boolean (true/false)
- **Provider**: `TestModeProvider` wraps the app in `src/App.tsx`
- **Methods**: 
  - `testMode` (getter)
  - `setTestMode(enabled: boolean)` (setter)
  - `toggleTestMode()` (toggle)

### 3. Current Persistence

❌ **NOT persisted to strategy config**
- The toggle value is stored ONLY in localStorage
- It is NOT written to `trading_strategies.configuration`
- It is NOT synced with any backend table

### 4. Coordinator Integration

**File**: `supabase/functions/trading-decision-coordinator/index.ts`

**Current checks**:
- Line 2322: `const isTestMode = intent.metadata?.mode === 'mock' || effectiveConfig?.is_test_mode;`
- Line 203-208: `isSignalFusionEnabled` checks `strategyConfig?.is_test_mode === true` OR `strategyConfig?.execution_mode === 'TEST'`
- Line 1449: Reads `EXECUTION_MODE` env var (defaults to "TEST")

**Usage**:
- Used for bypassing balance checks (line 2323-2325)
- NOT logged to decision_events.metadata currently

### 5. Current Gap: No Connection

**The Problem**:
1. User toggles TEST MODE in UI Header → stored in localStorage
2. Strategy config DOES NOT have `is_test_mode` flag
3. Coordinator TRIES to read `effectiveConfig?.is_test_mode` but it doesn't exist
4. Result: Coordinator always sees `is_test_mode = undefined` → defaults to REAL mode
5. `decision_events.metadata` does NOT contain `is_test_mode` field

### 6. Related Tables

**`trading_strategies`**:
- `configuration` column (JSONB) - where `is_test_mode` should live
- Currently contains: `enableSignalFusion`, `aiIntelligenceConfig`, etc.
- Does NOT currently have `is_test_mode`

**`decision_events`**:
- `metadata` column (JSONB) - where test mode should be logged
- Currently contains: `action`, `rawIntent`, `unifiedConfig`, `signalFusion`, `confidence_source`, etc.
- Does NOT currently have `is_test_mode`

### 7. Components Using Test Mode

Multiple components read testMode from useTestMode:
- `DashboardPanel.tsx`
- `DebugPanel.tsx`
- `MergedPortfolioDisplay.tsx`
- `PerformanceOverview.tsx`
- `StrategyConfig.tsx`
- `TradingHistory.tsx`
- And ~10 more

**Current behavior**: These components use `testMode` for UI logic (filtering mock vs real trades, showing badges, etc.)

## What Needs to Happen

1. **Strategy Config**: Add `is_test_mode?: boolean` to strategy configuration JSON
2. **UI Toggle**: Move/duplicate toggle to Strategy Configuration page (user-level)
3. **Coordinator**: Read `is_test_mode` from strategy config and log it to metadata
4. **Decision Events**: Include `is_test_mode` in metadata for learning loop
5. **Global Toggle**: Keep header toggle as UI convenience, sync with active strategy

## Risk Assessment

✅ **Low Risk**: Adding `is_test_mode` to configuration is additive (optional field)
✅ **Low Risk**: Coordinator already checks for `is_test_mode`, just currently undefined
⚠️ **Medium Risk**: Need to sync header toggle with strategy-level flag to avoid confusion
