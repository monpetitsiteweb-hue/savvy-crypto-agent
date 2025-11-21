# Test script for strategy-optimizer-agent-v1 Edge Function
# Usage: .\test-strategy-optimizer-agent-v1.ps1

param(
    [string]$ProjectId = "fuieplftlcxdfkxyqzlt",
    [string]$ServiceKey = "",
    [string]$SuggestionId = ""
)

if ([string]::IsNullOrEmpty($ServiceKey)) {
    Write-Host "ERROR: ServiceKey is required" -ForegroundColor Red
    Write-Host "Usage: .\test-strategy-optimizer-agent-v1.ps1 -ServiceKey <key> -SuggestionId <uuid>" -ForegroundColor Yellow
    exit 1
}

if ([string]::IsNullOrEmpty($SuggestionId)) {
    Write-Host "ERROR: SuggestionId is required" -ForegroundColor Red
    Write-Host "Usage: .\test-strategy-optimizer-agent-v1.ps1 -ServiceKey <key> -SuggestionId <uuid>" -ForegroundColor Yellow
    exit 1
}

$Url = "https://$ProjectId.supabase.co/functions/v1/strategy-optimizer-agent-v1"

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Testing strategy-optimizer-agent-v1" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Project:     $ProjectId" -ForegroundColor White
Write-Host "Endpoint:    $Url" -ForegroundColor White
Write-Host "SuggestionId: $SuggestionId" -ForegroundColor White
Write-Host ""

$Body = @{
    suggestion_id = $SuggestionId
} | ConvertTo-Json -Compress

Write-Host "Request Body:" -ForegroundColor Yellow
Write-Host $Body -ForegroundColor Gray
Write-Host ""

$Headers = @{
    "Authorization" = "Bearer $ServiceKey"
    "Content-Type"  = "application/json"
}

try {
    Write-Host "Calling Edge Function..." -ForegroundColor Yellow
    $Response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers -Body $Body
    
    Write-Host ""
    Write-Host "SUCCESS!" -ForegroundColor Green
    Write-Host "=========" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "Full Response:" -ForegroundColor Cyan
    $Response | ConvertTo-Json -Depth 10
    Write-Host ""
    
    if ($Response.ok -eq $true -and $Response.suggestion) {
        Write-Host "Key Fields:" -ForegroundColor Cyan
        Write-Host "  Suggested Value:      $($Response.suggestion.suggested_value)" -ForegroundColor White
        Write-Host "  Expected Impact (%):  $($Response.suggestion.expected_impact_pct)" -ForegroundColor White
        Write-Host "  Status:               $($Response.suggestion.status)" -ForegroundColor White
        Write-Host ""
        Write-Host "Reason:" -ForegroundColor Cyan
        Write-Host "  $($Response.suggestion.reason)" -ForegroundColor Gray
        Write-Host ""
    } elseif ($Response.ok -eq $false) {
        Write-Host "Not OK - Reason: $($Response.reason)" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host ""
    Write-Host "ERROR!" -ForegroundColor Red
    Write-Host "======" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host ""
        Write-Host "Response Body:" -ForegroundColor Yellow
        Write-Host $responseBody -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
