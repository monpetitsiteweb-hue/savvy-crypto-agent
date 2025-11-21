param(
  [Parameter(Mandatory=$true)]
  [string]$ProjectId,
  
  [Parameter(Mandatory=$true)]
  [string]$ServiceKey,
  
  [Parameter(Mandatory=$true)]
  [string]$SuggestionId
)

$url = "https://$ProjectId.supabase.co/functions/v1/strategy-optimizer-autotune-v1"

$headers = @{
  "Authorization" = "Bearer $ServiceKey"
  "Content-Type"  = "application/json"
  "apikey"        = $ServiceKey
}

$body = @{
  suggestion_id = $SuggestionId
} | ConvertTo-Json

Write-Host "📤 Calling strategy-optimizer-autotune-v1..." -ForegroundColor Cyan
Write-Host "URL: $url" -ForegroundColor Gray
Write-Host "Suggestion ID: $SuggestionId" -ForegroundColor Gray
Write-Host ""

try {
  $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body -ContentType "application/json"
  
  Write-Host "✅ Response received:" -ForegroundColor Green
  Write-Host ($response | ConvertTo-Json -Depth 10)
  Write-Host ""
  
  if ($response.ok) {
    Write-Host "🎯 Auto-tune SUCCESS" -ForegroundColor Green
    Write-Host ""
    
    if ($response.strategy_parameters) {
      Write-Host "📊 Strategy Parameters Updated:" -ForegroundColor Yellow
      Write-Host "  Symbol: $($response.strategy_parameters.symbol)" -ForegroundColor White
      Write-Host "  Min Confidence: $($response.strategy_parameters.min_confidence)" -ForegroundColor Cyan
      Write-Host "  Optimization Iteration: $($response.strategy_parameters.optimization_iteration)" -ForegroundColor Cyan
      Write-Host "  Last Updated By: $($response.strategy_parameters.last_updated_by)" -ForegroundColor White
      Write-Host "  Last Optimizer Run: $($response.strategy_parameters.last_optimizer_run_at)" -ForegroundColor White
      
      if ($response.strategy_parameters.metadata.optimizer_history) {
        $history = $response.strategy_parameters.metadata.optimizer_history
        $latestEntry = $history[-1]
        Write-Host ""
        Write-Host "📈 Latest History Entry:" -ForegroundColor Yellow
        Write-Host "  Old Value: $($latestEntry.old)" -ForegroundColor Red
        Write-Host "  New Value: $($latestEntry.new)" -ForegroundColor Green
        Write-Host "  Expected Impact: $($latestEntry.expected_impact)%" -ForegroundColor Cyan
        Write-Host "  Timestamp: $($latestEntry.timestamp)" -ForegroundColor White
      }
    }
    
    Write-Host ""
    
    if ($response.suggestion) {
      Write-Host "📝 Suggestion Status:" -ForegroundColor Yellow
      Write-Host "  ID: $($response.suggestion.id)" -ForegroundColor White
      Write-Host "  Status: $($response.suggestion.status)" -ForegroundColor Green
      Write-Host "  Applied At: $($response.suggestion.applied_at)" -ForegroundColor White
      Write-Host "  Applied By: $($response.suggestion.applied_by)" -ForegroundColor White
    }
    
  } else {
    Write-Host "⚠️ Auto-tune returned OK=false" -ForegroundColor Yellow
    Write-Host "Reason: $($response.reason)" -ForegroundColor Red
    
    if ($response.details) {
      Write-Host ""
      Write-Host "Details:" -ForegroundColor Yellow
      Write-Host ($response.details | ConvertTo-Json -Depth 5)
    }
  }
  
} catch {
  Write-Host "❌ Error calling function:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  
  if ($_.ErrorDetails.Message) {
    Write-Host ""
    Write-Host "Error details:" -ForegroundColor Yellow
    Write-Host $_.ErrorDetails.Message
  }
}
