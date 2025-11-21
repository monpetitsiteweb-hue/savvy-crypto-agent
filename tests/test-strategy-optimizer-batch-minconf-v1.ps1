param(
  [Parameter(Mandatory=$true)]
  [string]$ServiceKey,
  
  [string]$ProjectId = "fuieplftlcxdfkxyqzlt",
  [string]$UserId = "25a0c221-1f0e-431d-8d79-db9fb4db9cb3",
  [string]$StrategyId = "5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e",
  [string[]]$Symbols = @()
)

$ErrorActionPreference = "Stop"

# Construct URL
$Url = "https://$ProjectId.supabase.co/functions/v1/strategy-optimizer-batch-minconf-v1"

# Prepare headers
$Headers = @{
  "Authorization" = "Bearer $ServiceKey"
  "apikey"        = $ServiceKey
  "Content-Type"  = "application/json"
}

# Prepare body
$Body = @{
  user_id      = $UserId
  strategy_id  = $StrategyId
  horizon      = "24h"
  time_window  = "30"
}

# Only include symbols if provided
if ($Symbols.Count -gt 0) {
  $Body.symbols = $Symbols
  Write-Host "Using provided symbols: $($Symbols -join ', ')" -ForegroundColor Cyan
} else {
  Write-Host "No symbols provided - will derive from calibration_metrics" -ForegroundColor Cyan
}

$BodyJson = $Body | ConvertTo-Json -Compress

Write-Host "`n=== Calling strategy-optimizer-batch-minconf-v1 ===" -ForegroundColor Green
Write-Host "URL: $Url"
Write-Host "Body: $BodyJson"
Write-Host ""

try {
  $Response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers -Body $BodyJson
  
  Write-Host "=== Response ===" -ForegroundColor Green
  Write-Host ($Response | ConvertTo-Json -Depth 10)
  Write-Host ""
  
  if ($Response.ok -eq $true) {
    Write-Host "=== Summary ===" -ForegroundColor Green
    Write-Host "User ID: $($Response.user_id)"
    Write-Host "Strategy ID: $($Response.strategy_id)"
    Write-Host "Horizon: $($Response.horizon)"
    Write-Host "Time Window: $($Response.time_window)"
    Write-Host "Symbols Processed: $($Response.symbols_count)"
    Write-Host ""
    
    Write-Host "=== Results by Symbol ===" -ForegroundColor Yellow
    foreach ($result in $Response.results) {
      Write-Host "`nSymbol: $($result.symbol)" -ForegroundColor Cyan
      Write-Host "  Status: $($result.status)"
      
      if ($result.status -eq "applied") {
        Write-Host "  Suggestion ID: $($result.suggestion_id)"
        Write-Host "  Previous min_confidence: $($result.prev_min_confidence)"
        Write-Host "  New min_confidence: $($result.new_min_confidence)" -ForegroundColor Green
        Write-Host "  Expected Impact %: $($result.expected_impact_pct)"
      } else {
        Write-Host "  Reason: $($result.reason)" -ForegroundColor Red
      }
    }
    
    # Count successes and failures
    $Applied = ($Response.results | Where-Object { $_.status -eq "applied" }).Count
    $Errors = ($Response.results | Where-Object { $_.status -ne "applied" }).Count
    
    Write-Host "`n=== Final Count ===" -ForegroundColor Green
    Write-Host "Successfully Applied: $Applied" -ForegroundColor Green
    Write-Host "Errors: $Errors" -ForegroundColor $(if ($Errors -gt 0) { "Red" } else { "Green" })
    
  } else {
    Write-Host "Batch optimization failed!" -ForegroundColor Red
    Write-Host "Reason: $($Response.reason)"
  }
  
} catch {
  Write-Host "Error calling function!" -ForegroundColor Red
  Write-Host $_.Exception.Message
  
  if ($_.ErrorDetails.Message) {
    Write-Host "Error details:" -ForegroundColor Red
    Write-Host $_.ErrorDetails.Message
  }
  
  exit 1
}
