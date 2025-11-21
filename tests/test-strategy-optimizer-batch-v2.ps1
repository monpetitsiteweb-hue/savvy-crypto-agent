param(
    [Parameter(Mandatory=$true)]
    [string]$ServiceKey,
    
    [string]$ProjectId = "fuieplftlcxdfkxyqzlt",
    [string]$UserId = "25a0c221-1f0e-431d-8d79-db9fb4db9cb3",
    [string]$StrategyId = "5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e",
    [string[]]$Symbols = @(),
    [string[]]$SuggestionTypes = @("confidence_threshold", "tp_pct", "sl_pct", "technical_weight", "ai_weight"),
    [string]$Horizon = "4h",
    [string]$TimeWindow = "30"
)

$ErrorActionPreference = 'Stop'

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Strategy Optimizer Batch V2 Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Build URL
$Url = "https://$ProjectId.supabase.co/functions/v1/strategy-optimizer-batch-v2"
Write-Host "URL: $Url" -ForegroundColor Yellow
Write-Host ""

# Build headers
$Headers = @{
    "Authorization" = "Bearer $ServiceKey"
    "apikey"        = $ServiceKey
    "Content-Type"  = "application/json"
}

# Build body
$Body = @{
    user_id          = $UserId
    strategy_id      = $StrategyId
    horizon          = $Horizon
    time_window      = $TimeWindow
    suggestion_types = $SuggestionTypes
}

# Only include symbols if provided
if ($Symbols.Count -gt 0) {
    $Body['symbols'] = $Symbols
    Write-Host "Symbols: $($Symbols -join ', ')" -ForegroundColor Green
} else {
    Write-Host "Symbols: (will be derived from calibration_metrics)" -ForegroundColor Gray
}

Write-Host "Suggestion Types: $($SuggestionTypes -join ', ')" -ForegroundColor Green
Write-Host "Horizon: $Horizon" -ForegroundColor Green
Write-Host "Time Window: ${TimeWindow}d" -ForegroundColor Green
Write-Host ""

$BodyJson = $Body | ConvertTo-Json -Depth 10
Write-Host "Request Body:" -ForegroundColor Yellow
Write-Host $BodyJson -ForegroundColor Gray
Write-Host ""

try {
    Write-Host "Calling strategy-optimizer-batch-v2..." -ForegroundColor Cyan
    $Response = Invoke-RestMethod -Uri $Url -Method POST -Headers $Headers -Body $BodyJson

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Response Received" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""

    $ResponseJson = $Response | ConvertTo-Json -Depth 10
    Write-Host $ResponseJson -ForegroundColor Gray
    Write-Host ""

    if ($Response.ok -eq $true) {
        Write-Host "✅ Batch optimization completed successfully" -ForegroundColor Green
        Write-Host ""
        Write-Host "Summary:" -ForegroundColor Cyan
        Write-Host "  User ID: $($Response.user_id)" -ForegroundColor White
        Write-Host "  Strategy ID: $($Response.strategy_id)" -ForegroundColor White
        Write-Host "  Horizon: $($Response.horizon)" -ForegroundColor White
        Write-Host "  Time Window: $($Response.time_window)" -ForegroundColor White
        Write-Host "  Symbols Count: $($Response.symbols_count)" -ForegroundColor White
        Write-Host "  Results Count: $($Response.results.Count)" -ForegroundColor White
        Write-Host ""

        # Count statuses
        $applied = ($Response.results | Where-Object { $_.status -eq 'applied' }).Count
        $notEligible = ($Response.results | Where-Object { $_.status -eq 'not_eligible' }).Count
        $errors = ($Response.results | Where-Object { $_.status -like 'error*' }).Count

        Write-Host "Status Breakdown:" -ForegroundColor Cyan
        Write-Host "  Applied: $applied" -ForegroundColor Green
        Write-Host "  Not Eligible (Manual Review): $notEligible" -ForegroundColor Yellow
        Write-Host "  Errors: $errors" -ForegroundColor Red
        Write-Host ""

        # Display results table
        Write-Host "Detailed Results:" -ForegroundColor Cyan
        Write-Host ""
        
        $tableData = $Response.results | Select-Object `
            symbol, 
            suggestion_type, 
            status, 
            @{Name='prev_value'; Expression={if ($_.prev_value) { [math]::Round($_.prev_value, 4) } else { '-' }}}, 
            @{Name='new_value'; Expression={if ($_.new_value) { [math]::Round($_.new_value, 4) } else { '-' }}}, 
            @{Name='expected_impact'; Expression={if ($_.expected_impact_pct) { [math]::Round($_.expected_impact_pct, 2) } else { '-' }}}, 
            reason
        
        $tableData | Format-Table -AutoSize -Wrap

        Write-Host ""
        Write-Host "✅ Test completed successfully" -ForegroundColor Green
    } else {
        Write-Host "❌ Batch optimization failed" -ForegroundColor Red
        Write-Host "Reason: $($Response.reason)" -ForegroundColor Red
        if ($Response.error) {
            Write-Host "Error: $($Response.error)" -ForegroundColor Red
        }
        exit 1
    }

} catch {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "Error" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Exception Message: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        Write-Host ""
        Write-Host "Response Body:" -ForegroundColor Red
        Write-Host $errorBody -ForegroundColor Gray
    }
    
    exit 1
}
