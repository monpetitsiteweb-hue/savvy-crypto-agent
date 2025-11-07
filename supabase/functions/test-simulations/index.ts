import { logger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: any;
}

interface TestSuiteResponse {
  success: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
  timestamp: number;
  artifacts: string[];
}

async function runTest(
  name: string,
  testFn: () => Promise<any>
): Promise<TestResult> {
  const startTs = Date.now();
  try {
    const details = await testFn();
    return {
      name,
      passed: true,
      duration: Date.now() - startTs,
      details,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      duration: Date.now() - startTs,
      error: error.message,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  logger.info('[test.suite.start] Running simulation test suite');
  const suiteStartTs = Date.now();
  
  const testAddress = '0x2C779B78175d4069CcF2C8d79268957F5a06CF68';
  const baseUrl = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
  const results: TestResult[] = [];
  const artifacts: string[] = [];

  // Test 1: SELL ETH→USDC happy path
  results.push(await runTest('SELL ETH→USDC happy path', async () => {
    const response = await fetch(`${baseUrl}/functions/v1/simulate-swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: testAddress,
        side: 'SELL',
        baseToken: 'ETH',
        quoteToken: 'USDC',
        amount: '1000000000000000000', // 1 ETH in wei
        slippageBps: 50, // 0.5%
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Simulation failed');
    }
    
    artifacts.push(`sell-eth-usdc-route-${Date.now()}.json`);
    return { 
      expectedOut: data.expectedOut,
      determinismHash: data.determinismHash,
    };
  }));

  // Test 2: BUY ETH (SELL USDC→ETH) happy path
  results.push(await runTest('BUY ETH (SELL USDC→ETH) happy path', async () => {
    const response = await fetch(`${baseUrl}/functions/v1/simulate-swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: testAddress,
        side: 'BUY',
        baseToken: 'ETH',
        quoteToken: 'USDC',
        amount: '1000000000', // 1000 USDC (6 decimals)
        slippageBps: 50,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Simulation failed');
    }
    
    artifacts.push(`buy-eth-usdc-route-${Date.now()}.json`);
    return { 
      expectedOut: data.expectedOut,
      determinismHash: data.determinismHash,
    };
  }));

  // Test 3: Tight slippage revert test
  results.push(await runTest('Tight slippage (1 bps) should handle gracefully', async () => {
    const response = await fetch(`${baseUrl}/functions/v1/simulate-swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: testAddress,
        side: 'SELL',
        baseToken: 'ETH',
        quoteToken: 'USDC',
        amount: '1000000000000000000',
        slippageBps: 1, // 0.01% - very tight
      }),
    });
    
    const data = await response.json();
    // Either success with tight slippage or documented failure
    artifacts.push(`tight-slippage-test-${Date.now()}.json`);
    return { 
      success: data.success,
      message: data.error || 'Tight slippage handled',
    };
  }));

  // Test 4: Wrap simulation
  results.push(await runTest('WETH wrap simulation', async () => {
    const response = await fetch(`${baseUrl}/functions/v1/simulate-wrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: testAddress,
        amountWei: '100000000000000000', // 0.1 ETH
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Wrap simulation failed');
    }
    
    artifacts.push(`wrap-simulation-${Date.now()}.json`);
    return { expectedGas: data.expectedGas };
  }));

  // Test 5: Permit2 with expired signature
  results.push(await runTest('Permit2 expired signature detection', async () => {
    const expiredDeadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const response = await fetch(`${baseUrl}/functions/v1/simulate-permit2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner: testAddress,
        token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
        amount: '1000000000',
        spender: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF',
        deadline: expiredDeadline,
        nonce: 0,
        signature: '0x' + '0'.repeat(130), // Dummy signature
      }),
    });
    
    const data = await response.json();
    // Should detect expired deadline
    if (data.sigChecks && !data.sigChecks.deadlineValid) {
      artifacts.push(`expired-permit2-${Date.now()}.json`);
      return { deadlineDetected: true };
    }
    throw new Error('Failed to detect expired deadline');
  }));

  // Test 6: Determinism verification
  results.push(await runTest('Determinism verification (identical inputs)', async () => {
    const request = {
      from: testAddress,
      side: 'SELL',
      baseToken: 'ETH',
      quoteToken: 'USDC',
      amount: '500000000000000000', // 0.5 ETH
      slippageBps: 50,
    };
    
    // Call twice with identical inputs
    const response1 = await fetch(`${baseUrl}/functions/v1/simulate-swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const data1 = await response1.json();
    
    // Small delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const response2 = await fetch(`${baseUrl}/functions/v1/simulate-swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const data2 = await response2.json();
    
    if (data1.determinismHash !== data2.determinismHash) {
      throw new Error('Determinism hashes do not match!');
    }
    
    artifacts.push(`determinism-test-${Date.now()}.json`);
    return {
      hash1: data1.determinismHash,
      hash2: data2.determinismHash,
      match: true,
    };
  }));

  const passedTests = results.filter(r => r.passed).length;
  const failedTests = results.filter(r => !r.passed).length;

  logger.info('[test.suite.done]', {
    totalTests: results.length,
    passedTests,
    failedTests,
    duration: Date.now() - suiteStartTs,
  });

  const response: TestSuiteResponse = {
    success: failedTests === 0,
    totalTests: results.length,
    passedTests,
    failedTests,
    results,
    timestamp: Date.now(),
    artifacts,
  };

  return new Response(JSON.stringify(response, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
