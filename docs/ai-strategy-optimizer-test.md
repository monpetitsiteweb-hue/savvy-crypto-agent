# AI Strategy Optimizer Test Guide

## Overview

The `ai-strategy-optimizer` Edge Function uses OpenAI (GPT-4o-mini) to propose optimizations for trading strategy parameters, specifically `min_confidence`, based on 30-day calibration metrics.

## Authentication

This function requires user JWT authentication. You must provide:
- `Authorization: Bearer <UserJWT>` header
- `apikey: <SUPABASE_ANON_KEY>` header

## PowerShell Test Script

```powershell
# Configuration
$ProjectId = "fuieplftlcxdfkxyqzlt"
$AnonKey   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"
$UserJWT   = "<YOUR_USER_JWT_HERE>"

# API endpoint
$Url = "https://$ProjectId.supabase.co/functions/v1/ai-strategy-optimizer"

# Headers
$Headers = @{
  "Authorization" = "Bearer $UserJWT"
  "apikey"        = $AnonKey
  "Content-Type"  = "application/json"
}

# Call the function (no body required)
$Response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers

# Display results
$Response | ConvertTo-Json -Depth 10
```

## Example Success Response (With Changes)

```json
{
  "status": "ok",
  "user_id": "25a0c221-1f0e-431d-8d79-db9fb4db9cb3",
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "updated_rows": [
    {
      "strategy_id": "abc123",
      "symbol": "SOL",
      "prev_min_confidence": 0.70,
      "new_min_confidence": 0.65,
      "avg_win_rate_pct": 62.5,
      "total_sample_count": 150
    },
    {
      "strategy_id": "abc123",
      "symbol": "BTC",
      "prev_min_confidence": 0.60,
      "new_min_confidence": 0.65,
      "avg_win_rate_pct": 48.2,
      "total_sample_count": 200
    }
  ],
  "discarded_suggestions": []
}
```

## Example No-Op Response

```json
{
  "status": "ok",
  "user_id": "25a0c221-1f0e-431d-8d79-db9fb4db9cb3",
  "run_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "updated_rows": [],
  "discarded_suggestions": []
}
```

## Example Response with Discarded Suggestions

```json
{
  "status": "ok",
  "user_id": "25a0c221-1f0e-431d-8d79-db9fb4db9cb3",
  "run_id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "updated_rows": [
    {
      "strategy_id": "abc123",
      "symbol": "ETH",
      "prev_min_confidence": 0.70,
      "new_min_confidence": 0.75,
      "avg_win_rate_pct": 45.8,
      "total_sample_count": 120
    }
  ],
  "discarded_suggestions": [
    {
      "strategy_id": "abc123",
      "symbol": "XRP",
      "reason": "exceeded_max_step"
    },
    {
      "strategy_id": "abc123",
      "symbol": "ADA",
      "reason": "out_of_bounds"
    }
  ]
}
```

## Error Responses

### Unauthorized (401)
```json
{
  "status": "error",
  "message": "Unauthorized"
}
```

### OpenAI API Key Missing (500)
```json
{
  "status": "error",
  "message": "OpenAI API key not configured"
}
```

### AI Optimization Failed (500)
```json
{
  "status": "error",
  "message": "AI optimization failed",
  "details": "Failed to parse JSON from OpenAI response"
}
```

## Viewing AI Optimization Metadata

After running the optimizer, you can query the `strategy_parameters` table to see the AI's decisions:

```sql
SELECT 
  strategy_id,
  symbol,
  min_confidence,
  optimization_iteration,
  last_updated_by,
  last_optimizer_run_at,
  metadata->'last_ai_optimizer_v1' as ai_optimization_details
FROM strategy_parameters
WHERE user_id = '<YOUR_USER_ID>'
  AND last_updated_by = 'ai_optimizer_v1'
ORDER BY last_optimizer_run_at DESC;
```

The `ai_optimization_details` JSONB field contains:
- `prev_min_confidence`: Previous value
- `new_min_confidence`: New value
- `avg_win_rate_pct`: Average win rate used in decision
- `total_sample_count`: Number of samples analyzed
- `used_default_min_confidence`: Whether the previous value was a default
- `constraints`: The bounds and max step applied
- `run_id`: Unique ID for this optimization run
- `run_at`: Timestamp of the run
- `rationale`: AI's explanation for the change

## Safety Guardrails

The function enforces strict numeric bounds:

1. **Min Confidence Range**: 0.30 ≤ value ≤ 0.90
2. **Max Change Per Run**: ±0.10 (10 percentage points)
3. **Minimum Samples**: 30 samples required per (strategy_id, symbol)
4. **Code-Level Validation**: All AI suggestions are validated in code before applying

## Notes

- The function uses the same authentication pattern as `strategy-optimizer-v1`
- Only parameters with sufficient sample counts (≥30) are considered
- The AI makes conservative, incremental adjustments
- All changes are logged with full metadata for audit trails
- Failed suggestions are reported in `discarded_suggestions` array
