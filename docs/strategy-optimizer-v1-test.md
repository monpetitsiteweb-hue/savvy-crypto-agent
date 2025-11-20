# Strategy Optimizer V1 - Manual Test Guide

## Overview

The `strategy-optimizer-v1` Edge Function applies rule-based optimization to `min_confidence` values in `strategy_parameters` based on 30-day calibration metrics.

## Rules

- **Min samples**: 30 (rows with fewer samples are skipped)
- **Delta**: ±0.05 per adjustment
- **Bounds**: 0.30 ≤ min_confidence ≤ 0.90
- **Logic**:
  - If `avg_win_rate < 45%`: increase `min_confidence` by 0.05
  - If `avg_win_rate > 60%`: decrease `min_confidence` by 0.05
  - Otherwise: no change

## Prerequisites

1. **Project ID**: `fuieplftlcxdfkxyqzlt`
2. **Anon Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8`
3. **User JWT**: Obtain from your authenticated session (see example below)

## PowerShell Test Script

### Step 1: Set Variables

```powershell
$ProjectId = "fuieplftlcxdfkxyqzlt"
$AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"
$UserJWT = "YOUR_USER_JWT_HERE"  # Replace with actual JWT from authenticated session
```

### Step 2: Invoke the Optimizer

```powershell
$Url = "https://$ProjectId.supabase.co/functions/v1/strategy-optimizer-v1"

$Headers = @{
    "Authorization" = "Bearer $UserJWT"
    "apikey"        = $AnonKey
    "Content-Type"  = "application/json"
}

try {
    $Response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers
    Write-Host "✅ Success!" -ForegroundColor Green
    $Response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Error:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) {
        $_.ErrorDetails.Message | ConvertFrom-Json | ConvertTo-Json -Depth 10
    }
}
```

## Expected Response (Success)

```json
{
  "status": "ok",
  "user_id": "25a0c221-1f0e-431d-8d79-db9fb4db9cb3",
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "updated_rows": [
    {
      "strategy_id": "some-strategy-id",
      "symbol": "SOL",
      "prev_min_confidence": 0.65,
      "new_min_confidence": 0.70,
      "avg_win_rate_pct": 41.2,
      "total_sample_count": 160
    }
  ]
}
```

## Expected Response (No Updates)

```json
{
  "status": "ok",
  "user_id": "25a0c221-1f0e-431d-8d79-db9fb4db9cb3",
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "updated_rows": []
}
```

## Verification Query

Check what was updated in `strategy_parameters`:

```sql
SELECT 
  symbol,
  min_confidence,
  optimization_iteration,
  last_optimizer_run_at,
  last_updated_by,
  metadata->'last_rule_optimizer_v1' as optimizer_metadata
FROM strategy_parameters
WHERE user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND last_updated_by = 'rule_optimizer_v1'
ORDER BY last_optimizer_run_at DESC
LIMIT 10;
```

## Troubleshooting

### 401 Unauthorized

- Verify your JWT is valid and not expired
- Ensure you're passing the JWT in the `Authorization: Bearer <token>` header

### 500 Error

- Check Supabase function logs for details
- Verify `calibration_metrics` table has data with `window_days = 30`
- Verify `strategy_parameters` table exists and has rows for your user

### No Updates

This is normal if:
- No metric groups have ≥30 samples
- Win rates are between 45-60% (no change needed)
- Calculated changes are <0.0001 (too small to persist)

## Notes

- This function only updates existing `strategy_parameters` rows; it does not create new ones
- The function processes only 30-day metrics (`window_days = 30`)
- All horizons are aggregated together for each (strategy_id, symbol) pair
- Changes are logged in `metadata.last_rule_optimizer_v1` for audit trail
