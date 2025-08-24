// Direct test of coordinator with curl-equivalent
const testIntent = {
  intent: {
    userId: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
    strategyId: '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e',
    symbol: 'BTC',
    side: 'BUY',
    source: 'automated',
    confidence: 0.8,
    reason: 'Direct test of unified decisions',
    qtySuggested: 10,
    metadata: { test: true }
  }
};

// This would be equivalent to:
// curl -X POST https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/trading-decision-coordinator \
//   -H 'Content-Type: application/json' \
//   -d '{"intent": {"userId": "25a0c221-1f0e-431d-8d79-db9fb4db9cb3", "strategyId": "5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e", "symbol": "BTC", "side": "BUY", "source": "automated", "confidence": 0.8, "reason": "Direct test", "qtySuggested": 10}}'

console.log('Test payload:', JSON.stringify(testIntent, null, 2));