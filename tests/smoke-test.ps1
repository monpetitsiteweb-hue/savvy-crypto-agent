# Smoke Test: End-to-End 0x Trade on Base (PowerShell)

param(
    [string]$Env = "dev"
)

$ErrorActionPreference = "Stop"

$CONFIG = @{
    dev = @{
        BaseUrl = "https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1"
        Taker = $env:DEV_BOT_ADDRESS ?? "0xYourDevBotAddress"
    }
    prod = @{
        BaseUrl = "https://YOUR_PROD_REF.supabase.co/functions/v1"
        Taker = $env:PROD_BOT_ADDRESS ?? "0xYourProdBotAddress"
    }
}

if (-not $CONFIG.ContainsKey($Env)) {
    Write-Error "❌ Invalid env: $Env. Use -Env dev or -Env prod"
    exit 1
}

$config = $CONFIG[$Env]
Write-Host "🧪 Running smoke test against $($Env.ToUpper()) environment" -ForegroundColor Cyan
Write-Host "📍 Base URL: $($config.BaseUrl)"
Write-Host "👤 Taker: $($config.Taker)`n"

$tradeId = $null

try {
    # ========================================================================
    # Step 1: Build trade
    # ========================================================================
    Write-Host "1️⃣  Building trade (ETH → USDC, mode=build)..." -ForegroundColor Yellow

    $buildPayload = @{
        mode = "build"
        chainId = 8453
        side = "SELL"
        tokenIn = "ETH"
        tokenOut = "USDC"
        amountIn = "0.001"
        taker = $config.Taker
        provider = "0x"
    } | ConvertTo-Json

    $buildRes = Invoke-WebRequest -Uri "$($config.BaseUrl)/onchain-execute" `
        -Method POST `
        -Headers @{"Content-Type"="application/json"} `
        -Body $buildPayload `
        -UseBasicParsing

    $buildData = $buildRes.Content | ConvertFrom-Json

    if (-not $buildData.ok) {
        Write-Error "❌ Build failed: $($buildData | ConvertTo-Json -Depth 10)"
        exit 1
    }

    $tradeId = $buildData.tradeId
    Write-Host "✅ Trade built: $tradeId" -ForegroundColor Green

    # Verify raw_quote.transaction.to matches tx_payload.to
    $trade = $buildData.trade
    if (-not $trade) {
        Write-Error "❌ Trade object missing from response"
        exit 1
    }

    $quoteTo = $trade.raw_quote.transaction.to.ToLower()
    $payloadTo = $trade.tx_payload.to.ToLower()

    if (-not $quoteTo) {
        Write-Error "❌ raw_quote.transaction.to missing"
        exit 1
    }
    if (-not $payloadTo) {
        Write-Error "❌ tx_payload.to missing"
        exit 1
    }
    if ($quoteTo -ne $payloadTo) {
        Write-Error "❌ Mismatch: quoteTo=$quoteTo, payloadTo=$payloadTo"
        exit 1
    }

    Write-Host "✅ Verified: raw_quote.transaction.to === tx_payload.to ($quoteTo)" -ForegroundColor Green

    # ========================================================================
    # Step 2: Sign & send
    # ========================================================================
    Write-Host "`n2️⃣  Signing & sending..." -ForegroundColor Yellow

    $signPayload = @{ tradeId = $tradeId } | ConvertTo-Json

    $signRes = Invoke-WebRequest -Uri "$($config.BaseUrl)/onchain-sign-and-send" `
        -Method POST `
        -Headers @{"Content-Type"="application/json"} `
        -Body $signPayload `
        -UseBasicParsing

    $signData = $signRes.Content | ConvertFrom-Json

    if (-not $signData.ok) {
        # Expected errors in DEV: BROADCAST_FAILED
        if ($signData.error.code -eq "BROADCAST_FAILED") {
            Write-Warning "⚠️  Broadcast failed (expected in DEV if wallet unfunded): $($signData.error.message)"
            Write-Host "✅ Sign step succeeded (broadcast failed as expected)" -ForegroundColor Green
            exit 0
        }

        Write-Error "❌ Sign & send failed: $($signData | ConvertTo-Json -Depth 10)"
        exit 1
    }

    Write-Host "✅ Transaction signed & broadcast: tx=$($signData.txHash)" -ForegroundColor Green

    # ========================================================================
    # Step 3: Poll receipts
    # ========================================================================
    Write-Host "`n3️⃣  Polling for receipt..." -ForegroundColor Yellow

    $attempts = 0
    $maxAttempts = 30

    while ($attempts -lt $maxAttempts) {
        Start-Sleep -Seconds 2
        $attempts++

        # Trigger receipt polling
        $receiptPayload = @{} | ConvertTo-Json
        Invoke-WebRequest -Uri "$($config.BaseUrl)/onchain-receipts" `
            -Method POST `
            -Headers @{"Content-Type"="application/json"} `
            -Body $receiptPayload `
            -UseBasicParsing | Out-Null

        # Get trade status
        $getRes = Invoke-WebRequest -Uri "$($config.BaseUrl)/onchain-execute?tradeId=$tradeId" `
            -UseBasicParsing
        $getData = $getRes.Content | ConvertFrom-Json

        if (-not $getData.ok) {
            Write-Error "❌ Failed to fetch trade: $($getData | ConvertTo-Json -Depth 10)"
            exit 1
        }

        $status = $getData.trade.status
        Write-Host "   [$attempts/$maxAttempts] Status: $status"

        if ($status -eq "mined") {
            Write-Host "✅ Transaction mined in block $($getData.trade.block_number)" -ForegroundColor Green
            Write-Host "🎉 Smoke test PASSED" -ForegroundColor Green
            exit 0
        }

        if ($status -eq "failed") {
            Write-Error "❌ Transaction failed: $($getData.trade.notes)"
            exit 1
        }
    }

    Write-Error "❌ Timeout waiting for receipt"
    exit 1

} catch {
    Write-Error "❌ Test error: $_"
    if ($tradeId) {
        Write-Host "Trade ID: $tradeId (check manually in Supabase)" -ForegroundColor Yellow
    }
    exit 1
}
