# AI Optimization Loop - Implementation Complete ✅

## Overview
The agentic strategy layer is now implemented, enabling automated optimization of trading parameters while maintaining strict safety controls and TEST/LIVE separation.

---

## Architecture

### 1. Database: `strategy_parameters` Table
**Purpose**: Stores dynamic trading parameters optimized by the AI loop

**Schema**:
- `tp_pct` (Take Profit %) - Constrained: 0.3% to 50%
- `sl_pct` (Stop Loss %) - Constrained: 0.1% to 15%
- `min_confidence` - Constrained: 0.1 to 0.90
- `technical_weight`, `ai_weight` - Signal weights (0 to 1)
- `last_optimizer_run_at` - Tracks 24h update cooldown
- `optimization_iteration` - Audit counter
- `metadata` - Stores optimizer reasoning

**Safety Constraints** (enforced at DB level):
```sql
CHECK (tp_pct >= 0.3 AND tp_pct <= 50)
CHECK (sl_pct >= 0.1 AND sl_pct <= 15)
CHECK (min_confidence >= 0.1 AND min_confidence <= 0.90)
```

---

### 2. Edge Function: `/strategy-optimizer`
**Purpose**: Reads calibration metrics and proposes parameter adjustments

**Actions**:
- `evaluate`: Fetch TEST-only calibration metrics
- `propose`: Generate optimization proposals based on metrics
- `apply`: Write validated parameters to DB

**Safety Rules** (enforced in code):
- Max ±10% change per iteration
- Max 1 update per 24h per symbol
- Validates all proposals against safety constraints

**Example Request**:
```json
{
  "action": "propose",
  "userId": "xxx",
  "strategyId": "xxx",
  "symbol": "BTC"
}
```

**Decision Rules**:
1. Win rate > 60% + TP hit rate < 30% → Increase TP
2. Win rate < 40% + SL hit rate > 30% → Tighten SL
3. Median PnL < 0% → Increase confidence threshold
4. Median PnL > 1% → Relax confidence threshold

---

### 3. Trading Coordinator Integration
**Changes**:
- Loads `strategy_parameters` per symbol (overrides hard-coded config)
- Stores `execution_mode` in `decision_events.metadata`
- Branches execution: TEST → `mock_trades`, LIVE → `trades` (TODO)
- Applies parameters identically in both modes

**Execution Mode Flow**:
```typescript
const executionMode = Deno.env.get("EXECUTION_MODE") || "TEST";

// Load optimized parameters
const params = await loadStrategyParameters(supabase, strategyId, symbol);

// Apply parameters (same for TEST and LIVE)
const tp = params?.tp_pct || 1.5;
const sl = params?.sl_pct || 0.8;

// Log decision with execution_mode
await logDecisionAsync(..., { execution_mode: executionMode });

// Branch execution path
if (executionMode === "TEST") {
  await supabase.from('mock_trades').insert({ ...trade, is_test_mode: true });
} else if (executionMode === "LIVE") {
  // TODO: Real exchange integration
  throw new Error('LIVE mode not yet enabled');
}
```

---

## TEST vs LIVE Tracking

### Primary Source: `decision_events.metadata->>'execution_mode'`
- Stored at decision time
- Values: `"TEST"` | `"LIVE"`

### Secondary Source: `mock_trades.is_test_mode`
- Boolean flag for trade records
- Useful for joins and filtering

### Optimizer Behavior:
- **Default**: Uses TEST-only metrics
- **Query**: Filters by `metadata->>'execution_mode' = 'TEST'`
- **Never**: Modifies execution mode or enables LIVE

---

## Usage

### 1. Generate Proposals
```bash
curl -X POST https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/strategy-optimizer \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "propose",
    "userId": "xxx",
    "strategyId": "xxx",
    "symbol": "BTC"
  }'
```

### 2. Apply Proposal (Manual Review Required)
```bash
curl -X POST https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/strategy-optimizer \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "apply",
    "userId": "xxx",
    "strategyId": "xxx",
    "proposal": {
      "symbol": "BTC",
      "tp_pct": 1.65,
      "sl_pct": 0.72,
      "min_confidence": 0.65,
      "reason": "High win rate, low TP hits → Increase TP"
    }
  }'
```

### 3. Switch to LIVE Mode (Manual Control Only)
```bash
# Set environment variable in Supabase secrets
EXECUTION_MODE=LIVE  # Default is TEST
```

**⚠️ CRITICAL**: LIVE mode execution is currently disabled for safety. Real exchange integration must be implemented before enabling.

---

## Safety Mechanisms

### DB-Level Constraints ✅
- TP: 0.3% - 50%
- SL: 0.1% - 15%
- Confidence: 0.1 - 0.90

### Code-Level Validation ✅
- Max ±10% change per iteration
- 24h cooldown per symbol
- Validates all proposals before apply

### Manual Controls ✅
- Optimizer **never** enables LIVE mode
- Optimizer **never** modifies execution mode
- LIVE switch is explicit user action only

### Rollback Options
```sql
-- View current parameters
SELECT * FROM strategy_parameters WHERE strategy_id = 'xxx';

-- Manual rollback
UPDATE strategy_parameters 
SET tp_pct = 1.5, sl_pct = 0.8 
WHERE strategy_id = 'xxx' AND symbol = 'BTC';

-- Delete optimizer parameters (revert to defaults)
DELETE FROM strategy_parameters WHERE strategy_id = 'xxx';
```

---

## Status

✅ **Phase 1**: Database schema created
✅ **Phase 2**: Execution mode tracking in coordinator
✅ **Phase 3**: `strategy-optimizer` Edge Function created
✅ **Phase 4**: Coordinator loads `strategy_parameters`
✅ **Phase 5**: Execution mode branching implemented

🔒 **LIVE Mode**: Disabled for safety (requires exchange API integration)
🎯 **Optimizer**: Reads TEST-only metrics, proposes safe adjustments
🔐 **Safety**: All constraints enforced at DB + code level

---

## Next Steps

1. **Test the optimizer**:
   - Run `evaluate` to verify TEST metrics are fetched
   - Run `propose` to generate first optimization
   - Review proposal, then `apply` manually

2. **Monitor learning loop**:
   - Verify `decision_events` has `execution_mode` in metadata
   - Verify `mock_trades` has `is_test_mode = true`
   - Run `calibration-aggregator` to update metrics

3. **Future: Enable LIVE mode**:
   - Implement real exchange API integration
   - Add exchange connector to coordinator
   - Set `EXECUTION_MODE=LIVE` secret
   - Test with small amounts first

---

## Logs to Check

**Coordinator logs**:
```
[coordinator] Using optimized parameters for BTC: TP=1.65%, SL=0.72%, confidence=0.65
[coordinator] EXECUTION_MODE=TEST for BUY BTC
[coordinator] TEST MODE: Writing to mock_trades (is_test_mode=true)
```

**Optimizer logs**:
```
[optimizer] EVALUATE: Found X TEST-mode metrics
[optimizer] PROPOSE: Generated X proposals
[optimizer] APPLY: Successfully updated parameters for BTC
```
