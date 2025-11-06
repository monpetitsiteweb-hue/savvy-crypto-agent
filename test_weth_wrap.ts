/**
 * Test Script for wallet-ensure-weth Edge Function
 * 
 * Usage:
 * 1. Set your environment variables in .env
 * 2. Run: deno run --allow-net --allow-env test_weth_wrap.ts
 */

const FUNCTION_URL = 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/wallet-ensure-weth';
const BOT_ADDRESS = Deno.env.get('BOT_ADDRESS') || '0x...'; // Replace with your bot address

async function testWethWrap(testName: string, payload: any) {
  console.log(`\n🧪 Test: ${testName}`);
  console.log('📤 Request:', JSON.stringify(payload, null, 2));
  
  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    console.log(`📥 Response (${response.status}):`, JSON.stringify(result, null, 2));
    
    if (response.ok) {
      console.log('✅ Test passed');
    } else {
      console.log('❌ Test failed with error');
    }
    
    return { status: response.status, result };
  } catch (error) {
    console.error('❌ Test failed with exception:', error);
    return { status: 'error', result: error };
  }
}

async function runAllTests() {
  console.log('🚀 Starting WETH Wrap Tests\n');
  console.log('=' .repeat(60));

  // Test 1: Sufficient WETH (no wrap needed)
  await testWethWrap('Sufficient WETH Balance', {
    address: BOT_ADDRESS,
    minWethNeededWei: '1000000000000000', // 0.001 WETH
    autoWrap: false,
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 2: Plan-Only Path (insufficient WETH, autoWrap=false)
  await testWethWrap('Plan-Only (Insufficient WETH)', {
    address: BOT_ADDRESS,
    minWethNeededWei: '100000000000000000000', // 100 WETH (likely insufficient)
    autoWrap: false,
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 3: Execute Wrap (Happy Path)
  await testWethWrap('Execute Wrap (autoWrap=true)', {
    address: BOT_ADDRESS,
    minWethNeededWei: '10000000000000000', // 0.01 WETH
    autoWrap: true,
    maxWaitMs: 10000,
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 4: Idempotency (call same request twice quickly)
  console.log('\n🔁 Testing Idempotency...');
  const idempotencyPayload = {
    address: BOT_ADDRESS,
    minWethNeededWei: '10000000000000000',
    autoWrap: true,
    maxWaitMs: 10000,
  };
  
  await testWethWrap('Idempotency - Call 1', idempotencyPayload);
  await testWethWrap('Idempotency - Call 2 (immediate)', idempotencyPayload);

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 5: Bad Request (invalid address)
  await testWethWrap('Bad Request (Invalid Address)', {
    address: 'invalid-address',
    minWethNeededWei: '1000000000000000',
    autoWrap: false,
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 6: Missing required field
  await testWethWrap('Bad Request (Missing minWethNeededWei)', {
    address: BOT_ADDRESS,
    autoWrap: false,
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 7: Timeout test (very low maxWaitMs)
  await testWethWrap('Timeout Test', {
    address: BOT_ADDRESS,
    minWethNeededWei: '10000000000000000',
    autoWrap: true,
    maxWaitMs: 1, // Very low timeout
  });

  console.log('\n' + '='.repeat(60));
  console.log('✨ All tests completed\n');
}

// Run the tests
if (import.meta.main) {
  runAllTests();
}
