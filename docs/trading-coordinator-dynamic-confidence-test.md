# Trading Coordinator - Dynamic Confidence Integration Test

## Overview
The `trading-decision-coordinator` now reads `min_confidence` thresholds dynamically from `strategy_parameters` instead of using only hardcoded config values.

## Prerequisites
- User JWT token
- Anon key
- Valid strategy_id and user_id
- Existing decision-making flow (automated-trading-engine or manual triggers)

## Test Steps

### 1. Manually Set Dynamic Threshold

Set a custom `min_confidence` for SOL (or your test symbol):

```sql
-- Update strategy_parameters with a high confidence threshold (0.80)
UPDATE public.strategy_parameters
SET 
  min_confidence = '0.80', 
  last_updated_by = 'manual',
  updated_at = now()
WHERE 
  user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND strategy_id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e'
  AND symbol = 'SOL';

-- If no row exists, insert one:
INSERT INTO public.strategy_parameters (
  user_id, strategy_id, symbol, min_confidence, last_updated_by
) VALUES (
  '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
  '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e',
  'SOL',
  '0.80',
  'manual'
);
```

### 2. Trigger a Decision for SOL

You can trigger a decision using:
- The `automated-trading-engine` (generates BUY/SELL signals)
- A manual test via the UI or API

**Example: Trigger via UI**
- Navigate to your strategy page
- Ensure SOL is being monitored
- Wait for an automated signal or manually trigger a trade

**Example: Direct POST to coordinator (if testing directly)**
```powershell
$ProjectId = "fuieplftlcxdfkxyqzlt"
$AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"
$UserJWT = "YOUR_USER_JWT_HERE"

$Url = "https://$ProjectId.supabase.co/functions/v1/trading-decision-coordinator"
$Headers = @{
  "Authorization" = "Bearer $UserJWT"
  "apikey" = $AnonKey
  "Content-Type" = "application/json"
}

$Body = @{
  userId = "25a0c221-1f0e-431d-8d79-db9fb4db9cb3"
  strategyId = "5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e"
  symbol = "SOL"
  side = "BUY"
  source = "intelligent"
  confidence = 0.75
} | ConvertTo-Json

$Response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers -Body $Body
$Response | ConvertTo-Json -Depth 5
```

### 3. Verify in Logs

Check the Edge Function logs for `trading-decision-coordinator`:
- Look for `[coordinator] Confidence gate:` log entries
- Verify `source: 'strategy_parameters'` and `optimizer: 'manual'`
- Confirm the threshold used is `0.80` (from your SQL update)

**Example log output:**
```
[coordinator] Confidence gate: {
  threshold: 0.8,
  effectiveConfidence: 0.75,
  source: 'strategy_parameters',
  optimizer: 'manual'
}
[coordinator] 🚫 Decision blocked by confidence gate
```

### 4. Verify in decision_events

Query `decision_events` to confirm the confidence source is logged:

```sql
SELECT 
  id,
  symbol,
  side,
  confidence,
  metadata->>'confidence_source' AS confidence_source,
  metadata->>'confidence_optimizer' AS confidence_optimizer,
  metadata->>'effective_min_confidence' AS effective_min_conf,
  created_at
FROM public.decision_events
WHERE 
  user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND strategy_id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e'
  AND symbol = 'SOL'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected output:**
- `confidence_source`: `"strategy_parameters"`
- `confidence_optimizer`: `"manual"`
- `effective_min_conf`: `"0.8"` (or the value you set)

### 5. Test with Different Confidence Values

Update `min_confidence` to different values and observe behavior:

**Test A: Lower threshold (0.35) - Should allow more trades**
```sql
UPDATE public.strategy_parameters
SET min_confidence = '0.35', last_updated_by = 'manual_test_a'
WHERE user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND strategy_id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e'
  AND symbol = 'SOL';
```

Trigger a decision with `confidence: 0.60` → Should PASS gate.

**Test B: Higher threshold (0.85) - Should block more trades**
```sql
UPDATE public.strategy_parameters
SET min_confidence = '0.85', last_updated_by = 'manual_test_b'
WHERE user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND strategy_id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e'
  AND symbol = 'SOL';
```

Trigger a decision with `confidence: 0.75` → Should BLOCK (confidence too low).

### 6. Test AI Optimizer Integration

After running `ai-strategy-optimizer`:

```sql
-- Check if AI optimizer has updated min_confidence
SELECT 
  symbol,
  min_confidence,
  last_updated_by,
  optimization_iteration,
  metadata->'last_ai_optimizer_v1'->>'run_at' AS last_ai_run,
  metadata->'last_ai_optimizer_v1'->>'new_min_confidence' AS ai_new_conf
FROM public.strategy_parameters
WHERE user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND strategy_id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e';
```

Trigger a new decision and verify:
- Logs show `optimizer: 'ai_optimizer_v1'`
- `confidence_optimizer_metadata` includes `run_id` and `run_at`

### 7. Test Fallback Behavior

Delete or null the `strategy_parameters` row:

```sql
UPDATE public.strategy_parameters
SET min_confidence = NULL
WHERE user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND strategy_id = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e'
  AND symbol = 'SOL';
```

Trigger a decision → Should fall back to default threshold from strategy config (e.g., 0.60 or 0.70).

Check logs:
```
[coordinator] No strategy_parameters row or null min_confidence for SOL, using base: 0.6
```

Verify in `decision_events`:
- `confidence_source`: `"default"`
- `confidence_optimizer`: `null`

## Success Criteria

✅ Dynamic `min_confidence` from `strategy_parameters` is used when available  
✅ Falls back to config-based threshold when no row exists  
✅ Confidence gate correctly blocks/allows decisions based on dynamic threshold  
✅ `decision_events` logs include `confidence_source` and `confidence_optimizer`  
✅ Edge Function logs show threshold source and optimizer info  
✅ AI and rule-based optimizer metadata is correctly surfaced  

## Troubleshooting

**Issue: Confidence gate still using old threshold**
- Verify `strategy_parameters` row exists for correct `(user_id, strategy_id, symbol)`
- Check logs for `"Using dynamic min_confidence for SOL: ..."` message
- Ensure symbol normalization is consistent (e.g., "SOL" not "SOL-EUR")

**Issue: `confidence_source` is always "default"**
- Check RLS policies on `strategy_parameters` table
- Verify `user_id` in `strategy_parameters` matches authenticated user
- Ensure `min_confidence` is not `NULL` in the database

**Issue: Optimizer metadata not appearing**
- Run `ai-strategy-optimizer` or `strategy-optimizer-v1` first
- Verify `metadata` column contains `last_ai_optimizer_v1` or `last_rule_optimizer_v1` keys
- Check that `getEffectiveMinConfidenceForDecision` is extracting metadata correctly
