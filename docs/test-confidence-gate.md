# Confidence Gate Testing

## Overview
This document provides manual test cases to verify the confidence gate implementation in the trading-decision-coordinator.

## Prerequisites
- Supabase Project ID: `fuieplftlcxdfkxyqzlt`
- User JWT token (authenticated)
- Base URL: `https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/trading-decision-coordinator`

## Test Configuration
- Default confidence threshold: 60% (0.6 as fraction)
- Can be overridden via `strategy.configuration.aiIntelligenceConfig.aiConfidenceThreshold`

---

## Test Case 1: Above Threshold (Should Pass)

**Objective**: Verify that high-confidence decisions pass through the confidence gate.

### PowerShell Script
```powershell
$supabaseUrl = "https://fuieplftlcxdfkxyqzlt.supabase.co"
$functionPath = "/functions/v1/trading-decision-coordinator"
$userJWT = "YOUR_USER_JWT_HERE"

$headers = @{
    "Authorization" = "Bearer $userJWT"
    "apikey" = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"
    "Content-Type" = "application/json"
}

$body = @{
    userId = "25a0c221-1f0e-431d-8d79-db9fb4db9cb3"
    strategyId = "5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e"
    symbol = "BTC-EUR"
    side = "BUY"
    source = "automated"
    confidence = 0.9  # 90% - above 60% threshold
    reason = "test_high_confidence"
    qtySuggested = 0.001
    metadata = @{
        mode = "mock"
    }
} | ConvertTo-Json

Write-Host "Testing HIGH confidence (0.9) - should PASS gate" -ForegroundColor Cyan
$response = Invoke-RestMethod -Uri "$supabaseUrl$functionPath" -Method POST -Headers $headers -Body $body
$response | ConvertTo-Json -Depth 5
```

### Expected Result
- `decision.action`: Should be `BUY` or proceed to next gates (NOT `HOLD`)
- `decision.reason`: Should NOT be `confidence_below_threshold`
- Logs should show: `[coordinator] Effective confidence (fraction): 0.9`
- `decision_events` row should have:
  - `confidence`: ~0.9
  - `tp_pct`, `sl_pct` from effective config
  - Normal reason (not confidence-related)

---

## Test Case 2: Below Threshold (Should Block)

**Objective**: Verify that low-confidence decisions are blocked by the confidence gate.

### PowerShell Script
```powershell
$supabaseUrl = "https://fuieplftlcxdfkxyqzlt.supabase.co"
$functionPath = "/functions/v1/trading-decision-coordinator"
$userJWT = "YOUR_USER_JWT_HERE"

$headers = @{
    "Authorization" = "Bearer $userJWT"
    "apikey" = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"
    "Content-Type" = "application/json"
}

$body = @{
    userId = "25a0c221-1f0e-431d-8d79-db9fb4db9cb3"
    strategyId = "5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e"
    symbol = "BTC-EUR"
    side = "BUY"
    source = "automated"
    confidence = 0.3  # 30% - below 60% threshold
    reason = "test_low_confidence"
    qtySuggested = 0.001
    metadata = @{
        mode = "mock"
    }
} | ConvertTo-Json

Write-Host "Testing LOW confidence (0.3) - should BLOCK" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$supabaseUrl$functionPath" -Method POST -Headers $headers -Body $body
$response | ConvertTo-Json -Depth 5
```

### Expected Result
- `decision.action`: `HOLD`
- `decision.reason`: `confidence_below_threshold`
- Logs should show:
  - `[coordinator] Effective confidence (fraction): 0.3`
  - `[coordinator] 🚫 Decision blocked by confidence gate`
- `decision_events` row should have:
  - `confidence`: ~0.3
  - `tp_pct`, `sl_pct` from effective config (still logged correctly)
  - `reason`: Contains `signal_too_weak` or `confidence_below_threshold`
  - `metadata.profitAnalysis`: Should contain `effectiveConfidence` and `confidenceThreshold`

---

## Test Case 3: Confidence in 0-100 Format (Should Normalize)

**Objective**: Verify that confidence values in 0-100 format are correctly normalized to 0-1.

### PowerShell Script
```powershell
# ... same headers as above ...

$body = @{
    userId = "25a0c221-1f0e-431d-8d79-db9fb4db9cb3"
    strategyId = "5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e"
    symbol = "ETH-EUR"
    side = "BUY"
    source = "automated"
    confidence = 30  # 30 (0-100 format) - should normalize to 0.3
    reason = "test_confidence_normalization"
    qtySuggested = 0.01
    metadata = @{
        mode = "mock"
    }
} | ConvertTo-Json

Write-Host "Testing confidence=30 (0-100 format) - should normalize to 0.3 and BLOCK" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$supabaseUrl$functionPath" -Method POST -Headers $headers -Body $body
$response | ConvertTo-Json -Depth 5
```

### Expected Result
- `decision.action`: `HOLD`
- `decision.reason`: `confidence_below_threshold`
- Logs should show: `[coordinator] Effective confidence (fraction): 0.3`
- `decision_events` row should have `confidence`: ~0.3 (normalized)

---

## Verification SQL Queries

### Check Decision Events Logged
```sql
SELECT 
  symbol,
  side,
  confidence,
  tp_pct,
  sl_pct,
  reason,
  metadata->>'action' as action,
  created_at
FROM decision_events
WHERE user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC
LIMIT 10;
```

### Verify Confidence Gate Metadata
```sql
SELECT 
  symbol,
  side,
  confidence,
  metadata->'profitAnalysis'->>'effectiveConfidence' as effective_conf,
  metadata->'profitAnalysis'->>'confidenceThreshold' as threshold,
  reason
FROM decision_events
WHERE user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND reason LIKE '%confidence%'
ORDER BY created_at DESC;
```

---

## Success Criteria

✅ **Pass**: 
- High confidence (≥ 0.6) → Decision proceeds normally
- Low confidence (< 0.6) → Decision blocked with `HOLD` action and `confidence_below_threshold` reason
- All `decision_events` rows have `confidence` stored as fraction (0-1)
- Effective TP/SL/min_conf values are logged correctly
- Confidence gate logs are clear and informative

❌ **Fail**:
- Any confidence-related errors or crashes
- Incorrect normalization (0-100 not converted to 0-1)
- Missing `decision_events` rows for confidence-blocked decisions
- Incorrect effective config values in `decision_events`
