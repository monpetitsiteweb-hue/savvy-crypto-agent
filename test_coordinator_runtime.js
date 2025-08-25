// Test script to provide runtime evidence for Step 4
const testCoordinator = async () => {
  const API_ENDPOINT = 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/trading-decision-coordinator';
  const AUTH_KEY = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8';

  // Strategy with UD=OFF for testing
  const testIntent = {
    userId: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
    strategyId: '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e',
    symbol: 'BTC',
    side: 'BUY',
    source: 'manual',
    confidence: 0.8,
    reason: 'step4_test',
    ts: Date.now().toString()
  };

  console.log('=== STEP 4 RUNTIME EVIDENCE ===\n');

  try {
    // Test 1: UD=OFF Direct Execution
    console.log('🎯 Test 1: UD=OFF Direct Execution');
    const response1 = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': AUTH_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: { ...testIntent, reason: 'ud_off_test' }
      })
    });
    
    const result1 = await response1.json();
    console.log('Response:', JSON.stringify(result1, null, 2));
    console.log('');

    // Test 2: UD=ON with different symbol to avoid conflicts
    console.log('🎯 Test 2: UD=ON Execute (new symbol)');
    const response2 = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': AUTH_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: { 
          ...testIntent, 
          symbol: 'ETH', 
          side: 'BUY',
          reason: 'ud_on_execute_test',
          ts: (Date.now() + 1000).toString()
        }
      })
    });
    
    const result2 = await response2.json();
    console.log('Response:', JSON.stringify(result2, null, 2));
    console.log('');

    // Test 3: UD=ON cooldown test (sell right after buy)
    console.log('🎯 Test 3: UD=ON Cooldown Test (SELL after BUY)');
    const response3 = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': AUTH_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: { 
          ...testIntent, 
          symbol: 'ETH', 
          side: 'SELL',
          source: 'automated',
          reason: 'ud_on_cooldown_test',
          ts: (Date.now() + 2000).toString()
        }
      })
    });
    
    const result3 = await response3.json();
    console.log('Response:', JSON.stringify(result3, null, 2));
    console.log('');

    // Test 4: Try multiple concurrent requests for DEFER testing
    console.log('🎯 Test 4: Concurrent requests for DEFER test');
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(
        fetch(API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Authorization': AUTH_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            intent: { 
              ...testIntent, 
              symbol: 'SOL',
              side: 'BUY',
              reason: `concurrent_test_${i}`,
              ts: (Date.now() + 3000 + i * 100).toString()
            }
          })
        })
      );
    }

    const concurrentResults = await Promise.all(promises);
    for (let i = 0; i < concurrentResults.length; i++) {
      const result = await concurrentResults[i].json();
      console.log(`Concurrent Request ${i + 1}:`, JSON.stringify(result, null, 2));
    }

  } catch (error) {
    console.error('Test error:', error);
  }
};

// Run if in Node.js
if (typeof window === 'undefined') {
  testCoordinator();
}