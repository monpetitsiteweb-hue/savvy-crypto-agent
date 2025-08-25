# History Blink Diagnosis Plan

## Scope
Trading history panel tabs ("Open Positions" / "Past Positions") and their data sources.

## Branch
`chore/history-blink-diagnosis`

## Constraints
- No new components, pages, or dependencies
- No behavior changes by default
- All experiments behind debug flags (default OFF)
- No regressions to existing features
- Each step is reversible

## Possible Root Causes

### 1. Unstable React Keys
**Reason**: Row keys change between renders causing rows to remount instead of update
**Files**: TradingHistory.tsx, row components
**Symptoms**: DOM elements recreated, scroll position jumps

### 2. Parent Component Remount  
**Reason**: Dynamic keys/props on parent containers cause entire lists to remount
**Files**: TradingHistory.tsx, parent components
**Symptoms**: Entire tab content flickers, lose focus/selection

### 3. Duplicate Update Sources
**Reason**: Multiple data sources (Supabase realtime + React Query + WebSocket) trigger overlapping state updates
**Files**: Data hooks, realtime subscriptions
**Symptoms**: Rapid successive renders, data "flashing"

### 4. Array/Object Identity Churn
**Reason**: Recreating arrays/objects each render even when content unchanged
**Files**: Data transformation hooks
**Symptoms**: Unnecessary child re-renders, visual stuttering

### 5. Unstable Sorting
**Reason**: Comparator function toggles or sort inputs change causing reorder flicker
**Files**: Sorting logic in data hooks
**Symptoms**: Rows jumping positions briefly

### 6. Loading/Animation Flags
**Reason**: isFetching/isLoading/skeleton states toggling rapidly causing visual blink
**Files**: UI components with loading states
**Symptoms**: Skeleton → content → skeleton flash

### 7. StrictMode (Dev Only)
**Reason**: React StrictMode double-invoking effects causing duplicate subscriptions
**Files**: Development environment only
**Symptoms**: Issue only in development, not production

## Global Debug Toggles (All Default OFF)

```env
DEBUG_HISTORY_BLINK=false           # Master switch
DBG_DISABLE_REFETCH=false          # Disable React Query refetch
DBG_DISABLE_SUPABASE=false         # Disable Supabase realtime
DBG_FREEZE_SORT=false              # Use fixed sorting comparator  
DBG_SUPPRESS_LOADING=false         # Hide loading states/animations
DBG_MEMOIZE_ROWS=false             # Wrap rows with React.memo
DBG_EQUALITY_GUARD=false           # Shallow compare arrays before updates
DBG_STRICTMODE_OFF_IN_DEV=false    # Disable StrictMode (dev builds only)
```

## Test Sequence

### Step 1: Baseline + Mount/Key Visibility
**Goal**: Detect if rows or whole lists are remounting
**Files**: `TradingHistory.tsx`, row components  
**Change**: Add console logs (DEBUG_HISTORY_BLINK gated) for:
- Tab mount/unmount counts
- Row mount/unmount counts by stable ID
- Actual keys used for each row
**Test**: Enable DEBUG_HISTORY_BLINK, reload page, scroll lists
**Confirms**: Frequent remounts = parent/key problem; Non-immutable keys = unstable key problem

### Step 2: Duplicate Update Sources Probe  
**Goal**: Identify overlapping data sources
**Files**: Data hooks (`useOpenPositions`, `usePastPositions`), realtime subscriptions
**Change**: Add timestamped logs for each state setter labeled by source + add toggle switches
**Test A**: Only DEBUG_HISTORY_BLINK ON, observe source firing patterns
**Test B**: Toggle DBG_DISABLE_REFETCH or DBG_DISABLE_SUPABASE, check if blink stops
**Confirms**: Overlapping sources = duplication issue

### Step 3: Array/Object Identity Churn Check
**Goal**: Detect unnecessary array/object recreation  
**Files**: Data transformation hooks
**Change**: Log array identity tokens + optional equality guard behind DBG_EQUALITY_GUARD
**Test**: Enable DBG_EQUALITY_GUARD, observe if blink subsides
**Confirms**: Identity churn = need to stabilize transforms

### Step 4: Sorting Stability Toggle
**Goal**: Check if sorting causes reorder flicker
**Files**: Sorting logic locations
**Change**: Add DBG_FREEZE_SORT to force fixed comparator (by ID/created_at)
**Test**: Toggle DBG_FREEZE_SORT, observe if blinking stops
**Confirms**: Sorting flicker from unstable comparator

### Step 5: Loading/Animation Flicker
**Goal**: Isolate visual loading states as cause
**Files**: Components with isLoading/isFetching/skeleton states
**Change**: Add DBG_SUPPRESS_LOADING to bypass skeletons/animations (visual only)
**Test**: Toggle DBG_SUPPRESS_LOADING, check if blink vanishes  
**Confirms**: Loading/animation layer causing perceived blink

### Step 6: Row Over-Render Due to Props Churn
**Goal**: Check if rows re-render too often despite stable data
**Files**: Row components only
**Change**: Add DBG_MEMOIZE_ROWS to wrap rows with React.memo + render count logs
**Test**: Toggle DBG_MEMOIZE_ROWS, observe render count changes
**Confirms**: Parent/prop churn causing excessive renders

### Step 7: Parent Key/Prop Audit
**Goal**: Ensure tab containers don't have dynamic keys/props
**Files**: `TradingHistory.tsx` and immediate parents
**Change**: Log any dynamic keys/props that could trigger remounts
**Test**: Observe logs during idle periods
**Confirms**: Parent remount source identified

### Step 8: Dev-Only StrictMode Check
**Goal**: Determine if issue is development-only
**Files**: Local dev configuration (not committed)
**Change**: Add local DBG_STRICTMODE_OFF_IN_DEV flag to temporarily disable StrictMode
**Test**: Run local preview with flag ON
**Confirms**: StrictMode double-invoke causing dev-only issue

## Roll-back Strategy
Each step is a single, reversible diff. All changes are gated behind debug flags that default OFF, ensuring zero impact on production behavior when flags are disabled.

## Expected Output Per Step
- Tiny diff summary
- Exact env flags to toggle  
- One-line reproduction steps
- One-sentence observation result