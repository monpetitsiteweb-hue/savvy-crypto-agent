# Test script for strategy-optimizer-agent Edge Function
# Usage: .\tests\test-strategy-optimizer-agent.ps1

param(
    [string]$ProjectId = "fuieplftlcxdfkxyqzlt",
    [string]$ServiceKey = $env:SUPABASE_SERVICE_ROLE_KEY
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrEmpty($ServiceKey)) {
    Write-Host "ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable not set" -ForegroundColor Red
    Write-Host "Set it with: `$env:SUPABASE_SERVICE_ROLE_KEY = 'your-service-role-key'" -ForegroundColor Yellow
    exit 1
}

# Construct the endpoint URL
$url = "https://${ProjectId}.supabase.co/functions/v1/strategy-optimizer-agent"

# Prepare headers
$headers = @{
    "Authorization" = "Bearer $ServiceKey"
    "apikey" = $ServiceKey
    "Content-Type" = "application/json"
}

# Empty body (function will process all metrics)
$body = @{} | ConvertTo-Json

Write-Host "🚀 Testing strategy-optimizer-agent..." -ForegroundColor Cyan
Write-Host "URL: $url" -ForegroundColor Gray
Write-Host ""

try {
    # Make the POST request
    $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
    
    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 10)
    
    if ($response.ok -eq $true) {
        Write-Host ""
        Write-Host "📊 Summary:" -ForegroundColor Green
        Write-Host "  Processed: $($response.processed_rows)" -ForegroundColor Yellow
        Write-Host "  Created: $($response.created)" -ForegroundColor Yellow
        Write-Host "  Updated: $($response.updated)" -ForegroundColor Yellow
        Write-Host "  Skipped: $($response.skipped)" -ForegroundColor Yellow
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
