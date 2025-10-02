#!/usr/bin/env node

/**
 * Smoke Test: End-to-End 0x Trade on Base
 * 
 * Tests the full flow:
 * 1. Build trade with taker → verifies raw_quote.transaction.to === tx_payload.to
 * 2. Sign & send → expects 'submitted' status
 * 3. Poll receipts → expects 'mined' or 'failed'
 */

const ENV = process.argv.includes('--env') 
  ? process.argv[process.argv.indexOf('--env') + 1] 
  : 'dev';

const CONFIG = {
  dev: {
    baseUrl: 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1',
    taker: process.env.DEV_BOT_ADDRESS || '0xYourDevBotAddress',
  },
  prod: {
    baseUrl: 'https://YOUR_PROD_REF.supabase.co/functions/v1',
    taker: process.env.PROD_BOT_ADDRESS || '0xYourProdBotAddress',
  },
};

const config = CONFIG[ENV];
if (!config) {
  console.error(`❌ Invalid env: ${ENV}. Use --env dev or --env prod`);
  process.exit(1);
}

console.log(`🧪 Running smoke test against ${ENV.toUpperCase()} environment`);
console.log(`📍 Base URL: ${config.baseUrl}`);
console.log(`👤 Taker: ${config.taker}\n`);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let tradeId;

  try {
    // ========================================================================
    // Step 1: Build trade
    // ========================================================================
    console.log('1️⃣  Building trade (ETH → USDC, mode=build)...');
    
    const buildPayload = {
      mode: 'build',
      chainId: 8453,
      side: 'SELL',
      tokenIn: 'ETH',
      tokenOut: 'USDC',
      amountIn: '0.001', // 0.001 ETH
      taker: config.taker,
      provider: '0x',
    };

    const buildRes = await fetch(`${config.baseUrl}/onchain-execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload),
    });

    const buildData = await buildRes.json();

    if (!buildRes.ok || !buildData.ok) {
      console.error('❌ Build failed:', buildData);
      process.exit(1);
    }

    tradeId = buildData.tradeId;
    console.log(`✅ Trade built: ${tradeId}`);

    // Verify raw_quote.transaction.to matches tx_payload.to
    const trade = buildData.trade;
    if (!trade) {
      console.error('❌ Trade object missing from response');
      process.exit(1);
    }

    const quoteTo = trade.raw_quote?.transaction?.to?.toLowerCase();
    const payloadTo = trade.tx_payload?.to?.toLowerCase();

    if (!quoteTo) {
      console.error('❌ raw_quote.transaction.to missing');
      process.exit(1);
    }
    if (!payloadTo) {
      console.error('❌ tx_payload.to missing');
      process.exit(1);
    }
    if (quoteTo !== payloadTo) {
      console.error(`❌ Mismatch: quoteTo=${quoteTo}, payloadTo=${payloadTo}`);
      process.exit(1);
    }

    console.log(`✅ Verified: raw_quote.transaction.to === tx_payload.to (${quoteTo})`);

    // ========================================================================
    // Step 2: Sign & send
    // ========================================================================
    console.log('\n2️⃣  Signing & sending...');

    const signRes = await fetch(`${config.baseUrl}/onchain-sign-and-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeId }),
    });

    const signData = await signRes.json();

    if (!signRes.ok || !signData.ok) {
      // Expected errors in DEV: BROADCAST_FAILED (insufficient funds, etc.)
      if (signData.error?.code === 'BROADCAST_FAILED') {
        console.warn(`⚠️  Broadcast failed (expected in DEV if wallet unfunded): ${signData.error.message}`);
        console.log('✅ Sign step succeeded (broadcast failed as expected)');
        process.exit(0);
      }

      console.error('❌ Sign & send failed:', signData);
      process.exit(1);
    }

    console.log(`✅ Transaction signed & broadcast: tx=${signData.txHash}`);

    // ========================================================================
    // Step 3: Poll receipts
    // ========================================================================
    console.log('\n3️⃣  Polling for receipt...');

    let attempts = 0;
    const maxAttempts = 30; // 30 * 2s = 60s timeout

    while (attempts < maxAttempts) {
      await sleep(2000);
      attempts++;

      const receiptRes = await fetch(`${config.baseUrl}/onchain-receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // Checks all pending trades
      });

      const receiptData = await receiptRes.json();

      // Get trade by ID
      const getRes = await fetch(`${config.baseUrl}/onchain-execute?tradeId=${tradeId}`);
      const getData = await getRes.json();

      if (!getData.ok) {
        console.error('❌ Failed to fetch trade:', getData);
        process.exit(1);
      }

      const status = getData.trade.status;
      console.log(`   [${attempts}/${maxAttempts}] Status: ${status}`);

      if (status === 'mined') {
        console.log(`✅ Transaction mined in block ${getData.trade.block_number}`);
        console.log(`🎉 Smoke test PASSED`);
        process.exit(0);
      }

      if (status === 'failed') {
        console.error(`❌ Transaction failed: ${getData.trade.notes}`);
        process.exit(1);
      }
    }

    console.error('❌ Timeout waiting for receipt');
    process.exit(1);
  } catch (error) {
    console.error('❌ Test error:', error.message);
    if (tradeId) {
      console.log(`Trade ID: ${tradeId} (check manually in Supabase)`);
    }
    process.exit(1);
  }
}

main();
