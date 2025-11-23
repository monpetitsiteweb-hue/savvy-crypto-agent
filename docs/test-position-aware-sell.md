# Test Scenario: Position-Aware SELL Refactoring

## Overview
This document describes how to test the refactored SELL decision logic that now supports position-aware sells (per position_id), pool exits, and legacy symbol-level logic.

## Changes Summary

### New Helper Function
- `getPositionRemainingForId()`: Queries specific position by ID and calculates remaining quantity after partial sells

### Four-Way SELL Branching
The coordinator now routes SELL intents into four distinct branches:

1. **Branch A - Position-Managed** (`position_management: true` + `position_id` present)
   - Uses per-position logic instead of symbol-level FIFO
   - Checks specific position's remaining quantity
   - Blocks with clear reasons if position closed or quantity exceeded

2. **Branch B - Pool Exit** (`source === "pool"`)
   - Computes symbol-level FIFO for P&L tracking
   - Bypasses coverage enforcement (pool manager handles validation)
   - Preserves existing pool behavior

3. **Branch C - Manual Sell** (`context === "MANUAL"` + `originalTradeId`)
   - Existing behavior preserved
   - Computes FIFO but bypasses coverage enforcement

4. **Branch D - Legacy Symbol-Level** (default fallback)
   - Existing behavior preserved
   - Enforces symbol-level coverage gate

## Test Scenarios

### Scenario 1: Position-Managed SELL (Position Open, Within Size)

**Setup:**
1. Create a BUY trade for XRP-EUR (e.g., 200 XRP at €2.50)
2. Capture the trade ID (this becomes the position_id)

**Execute:**
Send a SELL intent with:
```json
{
  "userId": "<your-user-id>",
  "strategyId": "<strategy-id>",
  "symbol": "XRP-EUR",
  "side": "SELL",
  "source": "automated",
  "confidence": 0.95,
  "qtySuggested": 100,
  "metadata": {
    "position_management": true,
    "position_id": "<the-buy-trade-id>",
    "entry_price": 2.50,
    "current_price": 1.70
  }
}
```

**Expected Result:**
- Logs show: `[Coordinator][SELL] Branch selection` with `branch: 'position'`
- Logs show: `[Coordinator][SELL][Position] Position check` with `isOpen: true`, `remainingQty: 200`
- Trade executes successfully (qty ≤ remainingQty)
- `decision_events.metadata.positionExit` contains:
  - `isPositionManaged: true`
  - `position_id: <id>`
  - `requested_qty: 100`
  - `remaining_position_qty: 200`
  - `is_open: true`

### Scenario 2: Position-Managed SELL (Position Already Closed)

**Setup:**
1. Use a position_id that has already been fully sold

**Execute:**
Same intent as Scenario 1 but with a closed position_id

**Expected Result:**
- Logs show: `branch: 'position'`
- Logs show: `🚫 COORDINATOR: Position <id> is not open or fully closed`
- Returns: `{ success: false, error: 'blocked_no_open_position_for_position_id' }`
- `decision_events.reason` contains: `no_position_found`
- `decision_events.metadata.positionExit.is_open: false`

### Scenario 3: Position-Managed SELL (Quantity Exceeds Position)

**Setup:**
1. Create a BUY for 100 XRP
2. Try to SELL 200 XRP from that position_id

**Execute:**
Intent with `qtySuggested: 200` but position only has 100

**Expected Result:**
- Logs show: `🚫 COORDINATOR: Requested qty 200 exceeds position size 100`
- Returns: `{ success: false, error: 'blocked_quantity_exceeds_position_size' }`
- `decision_events.metadata.positionExit` shows the mismatch

### Scenario 4: Pool Exit SELL

**Setup:**
1. Enable pool management in strategy
2. Create multiple BUY trades for SOL-EUR
3. Trigger pool exit (secure or runner)

**Execute:**
Pool manager emits intent with:
```json
{
  "source": "pool",
  "side": "SELL",
  "symbol": "SOL-EUR",
  ...
}
```

**Expected Result:**
- Logs show: `branch: 'pool'`
- Logs show: `[Coordinator][SELL][Pool] Processing pool exit SELL`
- FIFO fields computed for P&L tracking
- No coverage gate blocks the trade
- Pool behavior unchanged

### Scenario 5: Legacy Symbol-Level SELL

**Setup:**
1. Send a SELL intent without `position_management`, without `source: "pool"`, and without manual context

**Execute:**
```json
{
  "source": "automated",
  "side": "SELL",
  "symbol": "BTC-EUR",
  "qtySuggested": 0.5,
  ...
}
```

**Expected Result:**
- Logs show: `branch: 'symbol'`
- Logs show: `🔒 COORDINATOR: Standard SELL - ENFORCING symbol-level coverage gate`
- Symbol-level FIFO computation runs
- Coverage gate enforced (blocks if insufficient)
- Existing behavior preserved

## Verification Checklist

After deploying changes:

- [ ] Position-managed sells with valid position_id execute successfully
- [ ] Position-managed sells with closed position_id are blocked with clear reason
- [ ] Position-managed sells exceeding position size are blocked
- [ ] Pool exits continue to work as before
- [ ] Manual sells continue to work as before
- [ ] Legacy automated sells continue to work as before
- [ ] Logs clearly show which branch was taken for each SELL
- [ ] `decision_events` metadata is truthful about what was checked
- [ ] No "remaining_fifo: 0" errors for position-managed sells with valid positions

## Key Log Patterns to Look For

**Branch Detection:**
```
[Coordinator][SELL] Branch selection { isPositionManaged: true, isPoolExit: false, isManualSell: false, branch: 'position' }
```

**Position Check:**
```
[Coordinator][SELL][Position] Position check { position_id: '...', requestedQty: 100, remainingQty: 200, isOpen: true }
```

**Success:**
```
[Coordinator][SELL][Position] Using position FIFO fields { original_purchase_amount: 200, ... }
```

**Blocked:**
```
🚫 COORDINATOR: Position <id> is not open or fully closed
🚫 COORDINATOR: Requested qty 200 exceeds position size 100
```
