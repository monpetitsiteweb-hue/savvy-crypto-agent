// Validation Tests for Unified Decisions
const API_URL = 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/trading-decision-coordinator';
const AUTH_HEADER = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8';

const USER_ID = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';
const STRATEGY_ID = '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e';

async function sendIntent(intent) {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': AUTH_HEADER
        },
        body: JSON.stringify({ intent })
    });
    
    const data = await response.json();
    return { status: response.status, data, timestamp: Date.now() };
}

// Test B: Pool Precedence
async function testPoolPrecedence() {
    console.log('\n🔬 TEST B: Pool Precedence');
    console.log('=====================================');
    
    // Pool SELL (should win precedence over scheduler BUY)
    const poolSell = {
        userId: USER_ID,
        strategyId: STRATEGY_ID,
        symbol: 'BTC-EUR',
        side: 'SELL',
        source: 'pool',
        confidence: 0.9,
        reason: 'secure_take_profit',
        qtySuggested: 15,
        ts: new Date().toISOString()
    };
    
    const result = await sendIntent(poolSell);
    console.log('Pool SELL result:', result);
    
    return result;
}

// Test C: Min Hold Period
async function testMinHoldPeriod() {
    console.log('\n🔬 TEST C: Min Hold Period');  
    console.log('=====================================');
    
    // First BUY
    const buyIntent = {
        userId: USER_ID,
        strategyId: STRATEGY_ID,
        symbol: 'ADA-EUR',
        side: 'BUY',
        source: 'manual',
        confidence: 0.95,
        reason: 'test_setup_buy',
        qtySuggested: 20,
        ts: new Date().toISOString()
    };
    
    console.log('Step 1: Execute BUY...');
    const buyResult = await sendIntent(buyIntent);
    console.log('BUY result:', buyResult);
    
    // Wait 3 seconds (much less than 120s min hold)
    console.log('Step 2: Waiting 3 seconds...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Then SELL 
    const sellIntent = {
        userId: USER_ID,
        strategyId: STRATEGY_ID, 
        symbol: 'ADA-EUR',
        side: 'SELL',
        source: 'automated',
        confidence: 0.6,
        reason: 'technical_signal_test',
        qtySuggested: 15,
        ts: new Date().toISOString()
    };
    
    console.log('Step 3: Try SELL within min hold period...');
    const sellResult = await sendIntent(sellIntent);
    console.log('SELL result:', sellResult);
    
    return { buyResult, sellResult };
}

// Test D: Cooldown After SELL
async function testCooldownAfterSell() {
    console.log('\n🔬 TEST D: Cooldown After SELL');
    console.log('=====================================');
    
    // First SELL
    const sellIntent = {
        userId: USER_ID,
        strategyId: STRATEGY_ID,
        symbol: 'SOL-EUR', 
        side: 'SELL',
        source: 'manual',
        confidence: 0.95,
        reason: 'test_setup_sell',
        qtySuggested: 5,
        ts: new Date().toISOString()
    };
    
    console.log('Step 1: Execute SELL...');
    const sellResult = await sendIntent(sellIntent);
    console.log('SELL result:', sellResult);
    
    // Wait 2 seconds (much less than 30s cooldown)
    console.log('Step 2: Waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Then BUY with low confidence
    const buyIntent = {
        userId: USER_ID,
        strategyId: STRATEGY_ID,
        symbol: 'SOL-EUR',
        side: 'BUY', 
        source: 'intelligent',
        confidence: 0.65, // Below 0.70 threshold
        reason: 'ai_bullish_signal',
        qtySuggested: 8,
        ts: new Date().toISOString()
    };
    
    console.log('Step 3: Try BUY within cooldown (confidence 0.65 < 0.70)...');
    const buyResult = await sendIntent(buyIntent);
    console.log('BUY result:', buyResult);
    
    return { sellResult, buyResult };
}

// Run all tests
async function runAllTests() {
    console.log('🚀 Starting Unified Decisions Validation Tests');
    console.log('===============================================');
    
    try {
        await testPoolPrecedence();
        await testMinHoldPeriod();  
        await testCooldownAfterSell();
        
        console.log('\n✅ All tests completed!');
        console.log('Check database logs for decision audit trail.');
        
    } catch (error) {
        console.error('❌ Test execution failed:', error);
    }
}

// Run if called directly
if (typeof process !== 'undefined' && process.argv) {
    runAllTests();
}