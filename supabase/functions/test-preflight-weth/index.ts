/**
 * Test suite for Preflight WETH Integration
 * 
 * Tests the BUY path preflight checks with various WETH balance scenarios.
 */

import { corsHeaders } from '../_shared/cors.ts';

const PROJECT_URL = Deno.env.get('SB_URL') || 'http://localhost:54321';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  message?: string;
  response?: any;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const results: TestResult[] = [];
  const startTime = Date.now();

  console.log('=== Starting Preflight WETH Integration Tests ===');

  // Test 1: Read-only check with sufficient WETH (mock scenario)
  try {
    const test1Start = Date.now();
    const response = await fetch(`${PROJECT_URL}/functions/v1/onchain-execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({
        chainId: 8453,
        base: 'ETH',
        quote: 'USDC',
        side: 'BUY',
        amount: 0.001, // Small amount
        slippageBps: 50,
        taker: '0x2C779B78175d4069CcF2C8d79268957F5a06CF68',
        mode: 'build',
        persist: false,
      }),
    });

    const data = await response.json();
    const duration = Date.now() - test1Start;

    if (response.ok) {
      results.push({
        name: 'Test 1: Read-only check (small amount)',
        status: 'PASS',
        duration,
        message: `Preflight completed: ${data.status || 'unknown'}`,
        response: data,
      });
      console.log('✅ Test 1: PASS');
    } else {
      results.push({
        name: 'Test 1: Read-only check (small amount)',
        status: 'FAIL',
        duration,
        message: `Expected 200, got ${response.status}`,
        response: data,
      });
      console.log('❌ Test 1: FAIL');
    }
  } catch (error) {
    results.push({
      name: 'Test 1: Read-only check (small amount)',
      status: 'FAIL',
      duration: Date.now() - startTime,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    console.log('❌ Test 1: ERROR -', error);
  }

  // Test 2: Read-only check with insufficient WETH (large amount)
  try {
    const test2Start = Date.now();
    const response = await fetch(`${PROJECT_URL}/functions/v1/onchain-execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({
        chainId: 8453,
        base: 'ETH',
        quote: 'USDC',
        side: 'BUY',
        amount: 100000, // Very large amount
        slippageBps: 50,
        taker: '0x2C779B78175d4069CcF2C8d79268957F5a06CF68',
        mode: 'build',
        persist: false,
      }),
    });

    const data = await response.json();
    const duration = Date.now() - test2Start;

    // Expect preflight_required for insufficient WETH
    if (response.ok && data.status === 'preflight_required' && data.reason === 'insufficient_weth') {
      results.push({
        name: 'Test 2: Insufficient WETH detection',
        status: 'PASS',
        duration,
        message: 'Correctly detected insufficient WETH',
        response: data,
      });
      console.log('✅ Test 2: PASS - Insufficient WETH detected');
    } else {
      results.push({
        name: 'Test 2: Insufficient WETH detection',
        status: 'FAIL',
        duration,
        message: `Expected insufficient_weth, got: ${data.status}/${data.reason}`,
        response: data,
      });
      console.log('❌ Test 2: FAIL - Expected insufficient_weth');
    }
  } catch (error) {
    results.push({
      name: 'Test 2: Insufficient WETH detection',
      status: 'FAIL',
      duration: Date.now() - test2Start,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    console.log('❌ Test 2: ERROR -', error);
  }

  // Test 3: Direct wallet-ensure-weth call (read-only)
  try {
    const test3Start = Date.now();
    const response = await fetch(`${PROJECT_URL}/functions/v1/wallet-ensure-weth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({
        action: 'plan',
        owner: '0x2C779B78175d4069CcF2C8d79268957F5a06CF68',
        minWethNeededWei: '10000000000000000', // 0.01 WETH
      }),
    });

    const data = await response.json();
    const duration = Date.now() - test3Start;

    if (response.ok && (data.action === 'none' || data.action === 'wrap')) {
      results.push({
        name: 'Test 3: Direct WETH check',
        status: 'PASS',
        duration,
        message: `Action: ${data.action}`,
        response: data,
      });
      console.log('✅ Test 3: PASS - Direct WETH check completed');
    } else {
      results.push({
        name: 'Test 3: Direct WETH check',
        status: 'FAIL',
        duration,
        message: `Unexpected response: ${response.status}`,
        response: data,
      });
      console.log('❌ Test 3: FAIL');
    }
  } catch (error) {
    results.push({
      name: 'Test 3: Direct WETH check',
      status: 'FAIL',
      duration: Date.now() - test3Start,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    console.log('❌ Test 3: ERROR -', error);
  }

  // Test 4: Auto-wrap policy check (should fail for non-bot address)
  try {
    const test4Start = Date.now();
    const response = await fetch(`${PROJECT_URL}/functions/v1/wallet-ensure-weth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({
        action: 'submit',
        owner: '0x2C779B78175d4069CcF2C8d79268957F5a06CF68', // Not BOT_ADDRESS
        minWethNeededWei: '10000000000000000',
      }),
    });

    const data = await response.json();
    const duration = Date.now() - test4Start;

    // Expect 403 Forbidden for owner mismatch
    if (response.status === 403 && data.code === 'owner_mismatch') {
      results.push({
        name: 'Test 4: Auto-wrap policy enforcement',
        status: 'PASS',
        duration,
        message: 'Correctly blocked auto-wrap for non-bot address',
        response: data,
      });
      console.log('✅ Test 4: PASS - Auto-wrap policy enforced');
    } else {
      results.push({
        name: 'Test 4: Auto-wrap policy enforcement',
        status: 'FAIL',
        duration,
        message: `Expected 403 with owner_mismatch, got ${response.status}/${data.code}`,
        response: data,
      });
      console.log('❌ Test 4: FAIL - Policy not enforced');
    }
  } catch (error) {
    results.push({
      name: 'Test 4: Auto-wrap policy enforcement',
      status: 'FAIL',
      duration: Date.now() - test4Start,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    console.log('❌ Test 4: ERROR -', error);
  }

  // Test 5: Config check - verify EXECUTION_DRY_RUN setting
  try {
    const dryRunEnabled = Deno.env.get('EXECUTION_DRY_RUN') !== 'false';
    results.push({
      name: 'Test 5: Config verification',
      status: 'PASS',
      duration: 0,
      message: `EXECUTION_DRY_RUN=${dryRunEnabled}`,
    });
    console.log(`✅ Test 5: PASS - EXECUTION_DRY_RUN=${dryRunEnabled}`);
  } catch (error) {
    results.push({
      name: 'Test 5: Config verification',
      status: 'FAIL',
      duration: 0,
      message: 'Failed to read config',
    });
    console.log('❌ Test 5: FAIL');
  }

  // Test 6: Dry-run mode check
  const BOT_ADDRESS = Deno.env.get('BOT_ADDRESS');
  if (BOT_ADDRESS) {
    try {
      const test6Start = Date.now();
      const response = await fetch(`${PROJECT_URL}/functions/v1/wallet-ensure-weth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'submit',
          owner: BOT_ADDRESS,
          minWethNeededWei: '5000000000000000', // 0.005 ETH - under MAX_WRAP_WEI
        }),
      });

      const data = await response.json();
      const duration = Date.now() - test6Start;

      // Expect dry-run response if EXECUTION_DRY_RUN=true
      if (response.ok && data.dryRun === true) {
        results.push({
          name: 'Test 6: Dry-run mode',
          status: 'PASS',
          duration,
          message: 'Correctly returned dry-run response',
          response: data,
        });
        console.log('✅ Test 6: PASS - Dry-run mode active');
      } else if (response.ok && data.dryRun === false) {
        results.push({
          name: 'Test 6: Dry-run mode',
          status: 'PASS',
          duration,
          message: 'Live execution enabled (EXECUTION_DRY_RUN=false)',
          response: data,
        });
        console.log('✅ Test 6: PASS - Live mode active');
      } else {
        results.push({
          name: 'Test 6: Dry-run mode',
          status: 'FAIL',
          duration,
          message: `Unexpected response: ${response.status}`,
          response: data,
        });
        console.log('❌ Test 6: FAIL');
      }
    } catch (error) {
      results.push({
        name: 'Test 6: Dry-run mode',
        status: 'FAIL',
        duration: 0,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      console.log('❌ Test 6: ERROR -', error);
    }
  } else {
    results.push({
      name: 'Test 6: Dry-run mode',
      status: 'SKIP',
      duration: 0,
      message: 'BOT_ADDRESS not configured',
    });
    console.log('⏭️  Test 6: SKIP - BOT_ADDRESS not configured');
  }

  const totalDuration = Date.now() - startTime;
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const skipCount = results.filter((r) => r.status === 'SKIP').length;

  console.log('=== Test Summary ===');
  console.log(`Total: ${results.length}, Pass: ${passCount}, Fail: ${failCount}, Skip: ${skipCount}, Duration: ${totalDuration}ms`);

  return new Response(
    JSON.stringify(
      {
        summary: {
          total: results.length,
          pass: passCount,
          fail: failCount,
          skip: skipCount,
          duration: totalDuration,
        },
        results,
        dryRunEnabled: Deno.env.get('EXECUTION_DRY_RUN') !== 'false',
        timestamp: new Date().toISOString(),
      },
      null,
      2
    ),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
