// Manual test to trigger coordinator and validate unified decisions
async function testCoordinator() {
  const intent = {
    userId: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
    strategyId: '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e', 
    symbol: 'BTC',
    side: 'BUY',
    source: 'manual',
    confidence: 0.95,
    reason: 'Manual test - should trigger unified decisions with precedence logic',
    qtySuggested: 10,
    metadata: { 
      test: true, 
      timestamp: new Date().toISOString(),
      expected: 'unified_decisions_enabled' 
    }
  };

  try {
    const response = await fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/trading-decision-coordinator', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ intent })
    });

    const result = await response.json();
    console.log('Coordinator Response:', result);
    
    // The response should show unified decisions logic instead of "auto-approved"
    return result;
  } catch (error) {
    console.error('Test failed:', error);
    return { error: error.message };
  }
}

// To run: node manual_test_coordinator.js
if (typeof process !== 'undefined' && process.argv) {
  testCoordinator().then(result => {
    console.log('Final result:', JSON.stringify(result, null, 2));
  });
}