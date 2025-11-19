# Test Strategy Optimizer - Propose Action
# Analyzes metrics and proposes parameter adjustments (dry-run, no DB writes)

param(
    [string]$ProjectId = "fuieplftlcxdfkxyqzlt",
    [string]$AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8",
    [string]$UserJWT = "eyJhbGciOiJIUzI1NiIsImtpZCI6IkdkZmlpck5OS2hTSlc0ZnYiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2Z1aWVwbGZ0bGN4ZGZreHlxemx0LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIyNWEwYzIyMS0xZjBlLTQzMWQtOGQ3OS1kYjlmYjRkYjljYjMiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzYzNTg2NjUyLCJpYXQiOjE3NjM1ODMwNTIsImVtYWlsIjoibW9uLnBldGl0LnNpdGUud2ViQGdtYWlsLmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZ29vZ2xlIiwicHJvdmlkZXJzIjpbImdvb2dsZSJdfSwidXNlcl9tZXRhZGF0YSI6eyJhdmF0YXJfdXJsIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvQUNnOG9jTExJOEczazZ6YTNHaHFEWEp1aEZhYmdIbDFlRW1qZEJZQ09NZHlQZlpQNmVuZ2taZz1zOTYtYyIsImVtYWlsIjoibW9uLnBldGl0LnNpdGUud2ViQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJmdWxsX25hbWUiOiJDYXJsb3MgSXN0dXJpeiIsImlzcyI6Imh0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbSIsIm5hbWUiOiJDYXJsb3MgSXN0dXJpeiIsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwicGljdHVyZSI6Imh0dHBzOi8vbGgzLmdvb2dsZXVzZXJjb250ZW50LmNvbS9hL0FDZzhvY0xMSThHM2s2emEzR2hxRFhKdWhGYWJnSGwxZUVtamRCWUNPTWR5UGZaUDZlbmdrWmc9czk2LWMiLCJwcm92aWRlcl9pZCI6IjExNjEyODg4Mzc5MTM4NjQ1NDI5NSIsInN1YiI6IjExNjEyODg4Mzc5MTM4NjQ1NDI5NSJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6Im9hdXRoIiwidGltZXN0YW1wIjoxNzYyMDkxMjAwfV0sInNlc3Npb25faWQiOiI4MjdlZWVkOC04OTUyLTQ3MzQtOWRiOS00NWQ4MWU2ZWExZjMiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.CMuJgq1xAnlwsAhP2TjzCEC8ri147rG_SBL13MfIAHA",
    [string]$StrategyId = "5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e"
)

$ErrorActionPreference = "Stop"

$url = "https://$ProjectId.supabase.co/functions/v1/strategy-optimizer"

$headers = @{
    "Authorization" = "Bearer $UserJWT"
    "apikey" = $AnonKey
    "Content-Type" = "application/json"
}

$body = @{
    action = "propose"
    strategyId = $StrategyId
} | ConvertTo-Json

Write-Host "🎯 Testing strategy-optimizer PROPOSE action..." -ForegroundColor Cyan
Write-Host "URL: $url" -ForegroundColor Gray
Write-Host "Strategy ID: $StrategyId" -ForegroundColor Gray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
    
    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Proposed Parameter Adjustments:" -ForegroundColor Yellow
    $response | ConvertTo-Json -Depth 10
    
} catch {
    Write-Host "❌ Error:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) {
        Write-Host "Details:" -ForegroundColor Yellow
        $_.ErrorDetails.Message
    }
    exit 1
}
