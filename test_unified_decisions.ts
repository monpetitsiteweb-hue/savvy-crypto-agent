// Test script to validate unified decisions system
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fuieplftlcxdfkxyqzlt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8';

// Test unified decisions coordinator
async function testUnifiedDecisions() {
  console.log('🧪 Testing Unified Decisions System');
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  
  // Test intent - should now use unified decisions
  const testIntent = {
    userId: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
    strategyId: '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e',
    symbol: 'BTC',
    side: 'BUY',
    source: 'automated',
    confidence: 0.75,
    reason: 'Test signal for unified decisions validation',
    qtySuggested: 10,
    metadata: {
      test: true,
      timestamp: new Date().toISOString()
    }
  };
  
  console.log('📤 Sending test intent to coordinator:', testIntent);
  
  try {
    const { data, error } = await supabase.functions.invoke('trading-decision-coordinator', {
      body: { intent: testIntent }
    });
    
    if (error) {
      console.error('❌ Coordinator error:', error);
      return;
    }
    
    console.log('✅ Coordinator response:', data);
    
    // Check if decision was logged
    const { data: decisions, error: decisionError } = await supabase
      .from('trade_decisions_log')
      .select('*')
      .eq('user_id', testIntent.userId)
      .eq('symbol', testIntent.symbol)
      .order('created_at', { ascending: false })
      .limit(1);
      
    if (decisionError) {
      console.error('❌ Decision log error:', decisionError);
      return;
    }
    
    console.log('📋 Latest decision log:', decisions?.[0]);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
if (typeof window !== 'undefined') {
  console.log('⚠️ This script should be run in Node.js environment');
} else {
  testUnifiedDecisions();
}