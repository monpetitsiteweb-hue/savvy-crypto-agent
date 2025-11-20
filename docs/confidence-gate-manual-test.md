# Confidence Gate Manual Test Plan

## Context
The confidence gate now has error handling to prevent `internal_error` responses during manual testing. This test plan verifies the gate works correctly with curl calls.

## Prerequisites
- Supabase Project ID: `fuieplftlcxdfkxyqzlt`
- User JWT token (authenticated)
- Base URL: `https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/trading-decision-coordinator`
- Default confidence threshold: 60% (0.6 as fraction)

---

## Test 1: High Confidence (Should Pass Gate)

**PowerShell:**
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

**Expected Result:**
- ✅ `decision.action`: Should be `BUY` or proceed to next gates (NOT `HOLD`)
- ✅ `decision.reason`: Should NOT be `confidence_below_threshold`
- ✅ NO `internal_error` in response
- ✅ Logs should show: `[coordinator] Effective confidence (fraction): 0.9`

---

## Test 2: Low Confidence (Should Block)

**PowerShell:**
```powershell
# ... same headers as above ...

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

**Expected Result:**
- ✅ `decision.action`: `HOLD`
- ✅ `decision.reason`: `confidence_below_threshold`
- ✅ NO `internal_error` in response
- ✅ Logs should show:
  - `[coordinator] Effective confidence (fraction): 0.3`
  - `[coordinator] 🚫 Decision blocked by confidence gate`

---

## Test 3: Malformed Confidence (Error Recovery)

**PowerShell:**
```powershell
# ... same headers as above ...

$body = @{
    userId = "25a0c221-1f0e-431d-8d79-db9fb4db9cb3"
    strategyId = "5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e"
    symbol = "ETH-EUR"
    side = "BUY"
    source = "automated"
    confidence = "invalid"  # Intentionally malformed
    reason = "test_error_recovery"
    qtySuggested = 0.01
    metadata = @{
        mode = "mock"
    }
} | ConvertTo-Json

Write-Host "Testing MALFORMED confidence - should return HOLD gracefully" -ForegroundColor Magenta
$response = Invoke-RestMethod -Uri "$supabaseUrl$functionPath" -Method POST -Headers $headers -Body $body
$response | ConvertTo-Json -Depth 5
```

**Expected Result:**
- ✅ `decision.action`: `HOLD`
- ✅ `decision.reason`: `confidence_below_threshold`
- ✅ NO `internal_error` in response
- ✅ Logs should show: `[coordinator] ⚠️ Confidence gate failure:`

---

## Verification for Automated Flows

**Check that automated flows still work:**
```sql
SELECT 
  symbol,
  side,
  confidence,
  reason,
  metadata->>'action' as action,
  created_at
FROM decision_events
WHERE user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
  AND created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected:**
- ✅ Rows with `reason` like `signal_too_weak: Signal: rsi_oversold_bullish, ...` should still appear
- ✅ `confidence` values should be normalized fractions (0-1 range)
- ✅ No disruption to automated trading engine flow

---

## Success Criteria

✅ **Pass**: 
- Manual curl calls with high/low confidence return meaningful responses (no `internal_error`)
- Low confidence returns `HOLD` with `confidence_below_threshold`
- High confidence proceeds normally
- Automated flows continue to work without disruption
- Error logs are visible in edge function logs when confidence gate fails

❌ **Fail**:
- Any `internal_error` responses from manual tests
- Confidence gate not blocking low confidence decisions
- Automated flows disrupted or missing `decision_events` rows
