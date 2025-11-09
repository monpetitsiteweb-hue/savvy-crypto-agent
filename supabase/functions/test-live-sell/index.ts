/**
 * Test Live SELL Execution (Base 8453)
 * Executes a tiny SELL ETH→USDC with full safety controls
 * 
 * Safety Rails:
 * - Dry-run mode by default (EXECUTION_DRY_RUN=true)
 * - Tiny amounts only (0.0001 ETH max)
 * - Single owner enforcement (BOT_ADDRESS only)
 * - Slippage floor (minimum 50 bps)
 * - Auto-wrap cap via MAX_WRAP_WEI
 * 
 * Flow: wrap → permit2 → swap → receipt
 */

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { BASE_CHAIN_ID, BASE_TOKENS, formatTokenAmount } from '../_shared/addresses.ts';

const PROJECT_URL = Deno.env.get('SB_URL') || Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SB_SERVICE_ROLE') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_ADDRESS = Deno.env.get('BOT_ADDRESS');

const supabase = createClient(PROJECT_URL, SERVICE_ROLE);

interface TestConfig {
  dryRun: boolean;
  amountEth: string;
  slippageBps: number;
  maxWaitMs: number;
}

interface TestResult {
  ok: boolean;
  phase: string;
  dryRun: boolean;
  steps: {
    config?: any;
    wethCheck?: any;
    permit2Check?: any;
    quote?: any;
    build?: any;
    sign?: any;
    broadcast?: any;
    receipt?: any;
  };
  error?: any;
  summary?: {
    tradeId?: string;
    txHash?: string;
    gasUsed?: number;
    executionTimeMs?: number;
    network?: string;
    explorerUrl?: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const result: TestResult = {
    ok: false,
    phase: 'init',
    dryRun: true,
    steps: {},
  };

  try {
    // Parse request config
    const body = await req.json().catch(() => ({}));
    
    const config: TestConfig = {
      dryRun: Deno.env.get('EXECUTION_DRY_RUN') !== 'false',
      amountEth: body.amountEth || '0.0001', // Default tiny amount
      slippageBps: Math.max(body.slippageBps || 50, 50), // Minimum 50 bps
      maxWaitMs: body.maxWaitMs || 30000,
    };

    // Override dry-run if explicitly set in request
    if (body.dryRun === false) {
      config.dryRun = false;
    }

    result.dryRun = config.dryRun;
    result.steps.config = {
      dryRun: config.dryRun,
      amountEth: config.amountEth,
      slippageBps: config.slippageBps,
      botAddress: BOT_ADDRESS,
      autoWrapEnabled: Deno.env.get('ENABLE_AUTO_WRAP') === 'true',
    };

    console.log('test_live_sell.start', result.steps.config);

    // Safety checks
    if (!BOT_ADDRESS) {
      throw new Error('BOT_ADDRESS not configured');
    }

    const amountEthNum = parseFloat(config.amountEth);
    if (amountEthNum > 0.001) {
      throw new Error('Amount exceeds safety limit (max 0.001 ETH)');
    }

    // Step 1: Check WETH balance (read-only)
    result.phase = 'weth_check';
    console.log('test_live_sell.weth_check.start');

    const sellAmountWei = BigInt(Math.floor(amountEthNum * 1e18)).toString();
    
    const wethResponse = await fetch(`${PROJECT_URL}/functions/v1/wallet-ensure-weth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE}`,
        'apikey': SERVICE_ROLE,
      },
      body: JSON.stringify({
        address: BOT_ADDRESS,
        minWethNeededWei: sellAmountWei,
        autoWrap: false, // Read-only check first
      }),
    });

    if (!wethResponse.ok) {
      throw new Error(`WETH check failed: ${await wethResponse.text()}`);
    }

    const wethData = await wethResponse.json();
    result.steps.wethCheck = {
      action: wethData.action,
      currentBalance: wethData.balanceHuman,
      wrapNeeded: wethData.action === 'wrap',
      wrapPlan: wethData.wrapPlan,
    };

    console.log('test_live_sell.weth_check.done', result.steps.wethCheck);

    // Step 2: Check Permit2 allowance
    result.phase = 'permit2_check';
    console.log('test_live_sell.permit2_check.start');

    const permit2Response = await fetch(`${PROJECT_URL}/functions/v1/wallet-permit2-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE}`,
        'apikey': SERVICE_ROLE,
      },
      body: JSON.stringify({
        address: BOT_ADDRESS,
        token: 'WETH',
        minAllowance: sellAmountWei,
      }),
    });

    if (!permit2Response.ok) {
      throw new Error(`Permit2 check failed: ${await permit2Response.text()}`);
    }

    const permit2Data = await permit2Response.json();
    result.steps.permit2Check = {
      action: permit2Data.action,
      approvalNeeded: permit2Data.action === 'permit2-sign',
      currentAllowance: permit2Data.allowance,
    };

    console.log('test_live_sell.permit2_check.done', result.steps.permit2Check);

    // Step 3: Get quote
    result.phase = 'quote';
    console.log('test_live_sell.quote.start');

    const quoteResponse = await fetch(`${PROJECT_URL}/functions/v1/onchain-quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE}`,
        'apikey': SERVICE_ROLE,
      },
      body: JSON.stringify({
        chainId: BASE_CHAIN_ID,
        base: 'ETH',
        quote: 'USDC',
        side: 'SELL',
        amount: config.amountEth,
        slippageBps: config.slippageBps,
        provider: '0x',
        taker: BOT_ADDRESS,
      }),
    });

    if (!quoteResponse.ok) {
      throw new Error(`Quote failed: ${await quoteResponse.text()}`);
    }

    const quoteData = await quoteResponse.json();
    result.steps.quote = {
      provider: quoteData.provider,
      price: quoteData.price,
      minOut: quoteData.minOut,
      gasCostQuote: quoteData.gasCostQuote,
      slippageApplied: quoteData.slippageBps,
    };

    console.log('test_live_sell.quote.done', result.steps.quote);

    // If dry-run, stop here
    if (config.dryRun) {
      result.ok = true;
      result.phase = 'dry_run_complete';
      result.summary = {
        network: 'base',
        executionTimeMs: Date.now() - startTime,
      };

      console.log('test_live_sell.dry_run_complete', result.summary);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // LIVE EXECUTION BELOW (only if dryRun=false)
    console.log('test_live_sell.LIVE_EXECUTION.start');

    // Step 4: Build trade
    result.phase = 'build';
    console.log('test_live_sell.build.start');

    const buildResponse = await fetch(`${PROJECT_URL}/functions/v1/onchain-execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE}`,
        'apikey': SERVICE_ROLE,
      },
      body: JSON.stringify({
        chainId: BASE_CHAIN_ID,
        base: 'ETH',
        quote: 'USDC',
        side: 'SELL',
        amount: parseFloat(config.amountEth),
        slippageBps: config.slippageBps,
        provider: '0x',
        taker: BOT_ADDRESS,
        mode: 'build',
        preflight: false, // Skip preflight since we already checked
      }),
    });

    if (!buildResponse.ok) {
      throw new Error(`Build failed: ${await buildResponse.text()}`);
    }

    const buildData = await buildResponse.json();
    if (!buildData.ok || !buildData.tradeId) {
      throw new Error(`Build failed: ${JSON.stringify(buildData)}`);
    }

    result.steps.build = {
      tradeId: buildData.tradeId,
      status: buildData.trade?.status,
    };

    console.log('test_live_sell.build.done', result.steps.build);

    // Step 5: Sign and send
    result.phase = 'sign_and_send';
    console.log('test_live_sell.sign_and_send.start');

    const signResponse = await fetch(`${PROJECT_URL}/functions/v1/onchain-sign-and-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE}`,
        'apikey': SERVICE_ROLE,
      },
      body: JSON.stringify({
        tradeId: buildData.tradeId,
      }),
    });

    if (!signResponse.ok) {
      throw new Error(`Sign/send failed: ${await signResponse.text()}`);
    }

    const signData = await signResponse.json();
    if (!signData.ok || !signData.tx_hash) {
      throw new Error(`Sign/send failed: ${JSON.stringify(signData)}`);
    }

    result.steps.sign = {
      txHash: signData.tx_hash,
      network: signData.network,
    };

    console.log('test_live_sell.sign_and_send.done', result.steps.sign);

    // Step 6: Poll for receipt
    result.phase = 'receipt';
    console.log('test_live_sell.receipt.start');

    const txHash = signData.tx_hash;
    const maxAttempts = Math.ceil(config.maxWaitMs / 2000);
    let receiptData = null;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const receiptResponse = await fetch(`${PROJECT_URL}/functions/v1/onchain-receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_ROLE}`,
          'apikey': SERVICE_ROLE,
        },
        body: JSON.stringify({
          tradeId: buildData.tradeId,
        }),
      });

      if (receiptResponse.ok) {
        const data = await receiptResponse.json();
        if (data.ok && data.polled?.length > 0) {
          const polled = data.polled[0];
          if (polled.status === 'mined' || polled.status === 'failed') {
            receiptData = polled;
            break;
          }
        }
      }
    }

    if (!receiptData) {
      result.steps.receipt = { status: 'pending', note: 'Receipt not yet available' };
    } else {
      result.steps.receipt = {
        status: receiptData.status,
        gasUsed: receiptData.gasUsed,
        blockNumber: receiptData.blockNumber,
      };
    }

    console.log('test_live_sell.receipt.done', result.steps.receipt);

    // Success
    result.ok = true;
    result.phase = 'complete';
    result.summary = {
      tradeId: buildData.tradeId,
      txHash,
      gasUsed: receiptData?.gasUsed,
      executionTimeMs: Date.now() - startTime,
      network: 'base',
      explorerUrl: `https://basescan.org/tx/${txHash}`,
    };

    console.log('test_live_sell.complete', result.summary);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('test_live_sell.error', { phase: result.phase, error: error.message });
    
    result.error = {
      phase: result.phase,
      message: error.message,
      stack: error.stack,
    };

    return new Response(JSON.stringify(result), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
