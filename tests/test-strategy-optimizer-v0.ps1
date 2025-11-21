# Test script for strategy-optimizer-v0 Edge Function
# Usage: .\tests\test-strategy-optimizer-v0.ps1

param(
    [string]$ProjectId = "fuieplftlcxdfkxyqzlt",
    [string]$ServiceKey = $env:SUPABASE_SERVICE_ROLE_KEY,
    [string]$UserId = "25a0c221-1f0e-431d-8d79-db9fb4db9cb3",
    [string]$StrategyId = "",  # Fill with your strategy_id
    [string]$Symbol = "SOL",
    [string]$Horizon = "24h",
    [string]$TimeWindow = "30"
)

$ErrorActionPreference = "Stop"

# Construct the endpoint URL
$url = "https://${ProjectId}.supabase.co/functions/v1/strategy-optimizer-v0"

# Prepare headers
$headers = @{
    "Authorization" = "Bearer $ServiceKey"
    "apikey" = $ServiceKey
    "Content-Type" = "application/json"
}

# Prepare request body
$body = @{
    user_id = $UserId
    strategy_id = $StrategyId
    symbol = $Symbol
    horizon = $Horizon
    time_window = $TimeWindow
} | ConvertTo-Json

Write-Host "🚀 Testing strategy-optimizer-v0..." -ForegroundColor Cyan
Write-Host "URL: $url" -ForegroundColor Gray
Write-Host "Body: $body" -ForegroundColor Gray
Write-Host ""

try {
    # Make the POST request
    $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
    
    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 10)
    
    if ($response.ok -eq $true) {
        Write-Host ""
        Write-Host "📊 Suggestion created:" -ForegroundColor Green
        Write-Host "  ID: $($response.suggestion.id)" -ForegroundColor Yellow
        Write-Host "  Type: $($response.suggestion.suggestion_type)" -ForegroundColor Yellow
        Write-Host "  Status: $($response.suggestion.status)" -ForegroundColor Yellow
        Write-Host "  Confidence: $($response.suggestion.confidence_score)" -ForegroundColor Yellow
        Write-Host "  Sample Size: $($response.suggestion.sample_size)" -ForegroundColor Yellow
        Write-Host "  Reason: $($response.suggestion.reason)" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "❌ Error occurred:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.ErrorDetails.Message) {
        Write-Host "Details:" -ForegroundColor Red
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
    
    exit 1
}
