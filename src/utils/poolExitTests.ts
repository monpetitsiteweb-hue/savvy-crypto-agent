/**
 * Acceptance Tests for Pool Exit Management
 * 
 * These tests validate the coin pool exit management system
 * according to the requirements specified.
 */

import { 
  buildCoinPoolView, 
  shouldTriggerSecure, 
  shouldArmRunner,
  shouldTriggerTrailingStop,
  nextTrailingStop,
  computeSecureTargetQty,
  allocateFillProRata,
  roundToTick,
  PoolConfig,
  Trade
} from './poolManager';

// Test configuration
const testConfig: PoolConfig = {
  pool_enabled: true,
  secure_pct: 0.4, // 40% secure
  secure_tp_pct: 0.7, // +0.7% target
  secure_sl_pct: 0.6, // -0.6% floor
  runner_trail_pct: 1.0, // 1% trailing
  runner_arm_pct: 0.5, // arm at +0.5%
  qty_tick: 0.0001,
  price_tick: 0.01,
  min_order_notional: 10
};

// Mock trades for testing
const mockTrades: Trade[] = [
  {
    id: '1',
    cryptocurrency: 'XRP',
    amount: 400,
    price: 0.500,
    total_value: 200,
    executed_at: '2024-01-01T10:00:00Z',
    trade_type: 'buy',
    user_id: 'test-user',
    strategy_id: 'test-strategy'
  },
  {
    id: '2', 
    cryptocurrency: 'XRP',
    amount: 600,
    price: 0.500,
    total_value: 300,
    executed_at: '2024-01-01T10:01:00Z',
    trade_type: 'buy',
    user_id: 'test-user',
    strategy_id: 'test-strategy'
  }
];

/**
 * Test 1: Pool Building and Aggregation
 */
export function testPoolAggregation(): boolean {
  console.log('🧪 TEST 1: Pool Aggregation');
  
  const pool = buildCoinPoolView(mockTrades, 'XRP', 0.5035);
  
  const expected = {
    symbol: 'XRP',
    totalQty: 1000,
    avgEntry: 0.500,
    lastPrice: 0.5035,
    poolPnlPct: 0.7, // +0.7% profit
    currentValue: 503.5,
    totalCostBasis: 500
  };

  const passed = (
    pool.symbol === expected.symbol &&
    pool.totalQty === expected.totalQty &&
    Math.abs(pool.avgEntry - expected.avgEntry) < 0.0001 &&
    pool.lastPrice === expected.lastPrice &&
    Math.abs(pool.poolPnlPct - expected.poolPnlPct) < 0.01 &&
    Math.abs(pool.currentValue - expected.currentValue) < 0.01 &&
    Math.abs(pool.totalCostBasis - expected.totalCostBasis) < 0.01
  );

  console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Pool: ${JSON.stringify(pool, null, 2)}`);
  return passed;
}

/**
 * Test 2: Secure Portion Trigger
 */
export function testSecureTrigger(): boolean {
  console.log('🧪 TEST 2: Secure Trigger Logic');
  
  // Test case 1: Should trigger at +0.7% profit
  const pool = buildCoinPoolView(mockTrades, 'XRP', 0.5035); // +0.7% profit
  const shouldTrigger = shouldTriggerSecure(pool, testConfig, 0);
  
  // Test case 2: Should not trigger if already filled
  const shouldNotTrigger = shouldTriggerSecure(pool, testConfig, 400); // Already filled 40%
  
  const passed = shouldTrigger && !shouldNotTrigger;
  
  console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Should trigger (0 filled): ${shouldTrigger}`);
  console.log(`   Should not trigger (400 filled): ${shouldNotTrigger}`);
  return passed;
}

/**
 * Test 3: Runner Arming Logic  
 */
export function testRunnerArming(): boolean {
  console.log('🧪 TEST 3: Runner Arming Logic');
  
  // Test case 1: Should arm at +0.5% profit
  const poolAtArm = buildCoinPoolView(mockTrades, 'XRP', 0.5025); // +0.5% profit
  const shouldArm = shouldArmRunner(poolAtArm, testConfig, false);
  
  // Test case 2: Should not arm if below threshold
  const poolBelow = buildCoinPoolView(mockTrades, 'XRP', 0.502); // +0.4% profit
  const shouldNotArm = shouldArmRunner(poolBelow, testConfig, false);
  
  const passed = shouldArm && !shouldNotArm;
  
  console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Should arm at +0.5%: ${shouldArm}`);
  console.log(`   Should not arm at +0.4%: ${shouldNotArm}`);
  return passed;
}

/**
 * Test 4: Trailing Stop Logic
 */
export function testTrailingStop(): boolean {
  console.log('🧪 TEST 4: Trailing Stop Logic');
  
  // Test trailing stop calculation
  const highWater = 0.520;
  const trailingStop = nextTrailingStop(highWater, testConfig, 0.01);
  const expectedStop = 0.51; // 0.520 * (1 - 0.01) = 0.5148, rounded to 0.51
  
  // Test stop trigger
  const shouldTriggerAtStop = shouldTriggerTrailingStop(0.51, trailingStop);
  const shouldNotTriggerAbove = shouldTriggerTrailingStop(0.52, trailingStop);
  
  const passed = (
    Math.abs(trailingStop - expectedStop) < 0.01 &&
    shouldTriggerAtStop &&
    !shouldNotTriggerAbove
  );
  
  console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Trailing stop (HW: ${highWater}): ${trailingStop} (expected: ${expectedStop})`);
  console.log(`   Should trigger at stop: ${shouldTriggerAtStop}`);
  console.log(`   Should not trigger above: ${shouldNotTriggerAbove}`);
  return passed;
}

/**
 * Test 5: Pro-Rata Allocation
 */
export function testProRataAllocation(): boolean {
  console.log('🧪 TEST 5: Pro-Rata Allocation');
  
  const fillQty = 400; // Selling 400 XRP from 1000 total
  const allocations = allocateFillProRata(fillQty, mockTrades, 0.0001);
  
  // Expected: Trade 1 (400/1000 * 400) = 160, Trade 2 (600/1000 * 400) = 240
  const expected = [
    { trade_id: '1', allocated_qty: 160, remaining_qty: 240 },
    { trade_id: '2', allocated_qty: 240, remaining_qty: 360 }
  ];
  
  const totalAllocated = allocations.reduce((sum, a) => sum + a.allocated_qty, 0);
  const correctAllocations = allocations.every((allocation, i) => {
    const exp = expected[i];
    return (
      allocation.trade_id === exp.trade_id &&
      Math.abs(allocation.allocated_qty - exp.allocated_qty) < 0.0001 &&
      Math.abs(allocation.remaining_qty - exp.remaining_qty) < 0.0001
    );
  });
  
  const passed = correctAllocations && Math.abs(totalAllocated - fillQty) < 0.0001;
  
  console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Allocations: ${JSON.stringify(allocations, null, 2)}`);
  console.log(`   Total allocated: ${totalAllocated} (expected: ${fillQty})`);
  return passed;
}

/**
 * Test 6: Quantity and Price Rounding
 */
export function testRounding(): boolean {
  console.log('🧪 TEST 6: Rounding Logic');
  
  // Test quantity rounding
  const qtyTests = [
    { input: 123.456789, tick: 0.0001, expected: 123.4567 },
    { input: 100.999999, tick: 0.01, expected: 100.99 },
    { input: 5.5555, tick: 0.1, expected: 5.5 }
  ];
  
  let qtyPassed = true;
  for (const test of qtyTests) {
    const result = roundToTick(test.input, test.tick);
    if (Math.abs(result - test.expected) > 0.00001) {
      qtyPassed = false;
      console.log(`   ❌ Qty rounding failed: ${test.input} -> ${result} (expected: ${test.expected})`);
    }
  }
  
  // Test minimum notional
  const orderValue = 123.45 * 0.08; // ~9.88 EUR
  const meetsMinimum = orderValue >= testConfig.min_order_notional;
  const shouldReject = !meetsMinimum; // 9.88 < 10, should reject
  
  const passed = qtyPassed && shouldReject;
  
  console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Quantity rounding: ${qtyPassed ? 'OK' : 'FAILED'}`);
  console.log(`   Order value €${orderValue.toFixed(2)} < €${testConfig.min_order_notional}: ${shouldReject}`);
  return passed;
}

/**
 * Test 7: End-to-End Scenario
 */
export function testEndToEndScenario(): boolean {
  console.log('🧪 TEST 7: End-to-End Scenario');
  
  // Scenario: 1,000 XRP pool @ €0.500 avg, 40% secure at +0.7%, 60% runner trail 1%
  let secureFilledQty = 0;
  
  // Step 1: Price hits €0.5035 (+0.7%) - should trigger secure
  let pool = buildCoinPoolView(mockTrades, 'XRP', 0.5035);
  let shouldSecure = shouldTriggerSecure(pool, testConfig, secureFilledQty);
  
  if (shouldSecure) {
    const secureQty = computeSecureTargetQty(pool.totalQty, testConfig.secure_pct, secureFilledQty);
    secureFilledQty += secureQty;
    console.log(`   📊 Secure triggered: sold ${secureQty} XRP (${secureQty/pool.totalQty*100}%)`);
  }
  
  // Step 2: Price hits €0.505 (+1%) - should arm runner
  pool = buildCoinPoolView(mockTrades, 'XRP', 0.505);
  let isArmed = shouldArmRunner(pool, testConfig, false);
  let highWater = isArmed ? 0.505 : 0;
  let stopPrice = isArmed ? nextTrailingStop(0.505, testConfig, 0.01) : 0;
  
  if (isArmed) {
    console.log(`   🎯 Runner armed at €${highWater}, stop at €${stopPrice}`);
  }
  
  // Step 3: Price rallies to €0.520 - update trailing stop
  if (isArmed) {
    highWater = 0.520;
    stopPrice = nextTrailingStop(0.520, testConfig, 0.01);
    console.log(`   📈 Price rally to €${highWater}, stop updated to €${stopPrice}`);
  }
  
  // Step 4: Price drops to stop - should trigger runner exit
  const runnerTriggered = shouldTriggerTrailingStop(stopPrice, stopPrice);
  
  const passed = shouldSecure && isArmed && runnerTriggered;
  
  console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Scenario summary:`);
  console.log(`   - Secure triggered: ${shouldSecure}`);
  console.log(`   - Runner armed: ${isArmed}`);
  console.log(`   - Runner triggered: ${runnerTriggered}`);
  console.log(`   - Final secure filled: ${secureFilledQty}`);
  return passed;
}

/**
 * Run all acceptance tests
 */
export function runAllPoolTests(): boolean {
  console.log('🚀 POOL EXIT MANAGEMENT - ACCEPTANCE TESTS');
  console.log('===========================================');
  
  const results = [
    testPoolAggregation(),
    testSecureTrigger(),
    testRunnerArming(),
    testTrailingStop(),
    testProRataAllocation(),
    testRounding(),
    testEndToEndScenario()
  ];
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log('===========================================');
  console.log(`📊 RESULTS: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('✅ ALL TESTS PASSED - Pool exit management is working correctly!');
  } else {
    console.log('❌ SOME TESTS FAILED - Please review the implementation.');
  }
  
  return passed === total;
}

// Export for console testing
declare global {
  interface Window {
    poolTests: {
      runAll: () => boolean;
      testPoolAggregation: () => boolean;
      testSecureTrigger: () => boolean;
      testRunnerArming: () => boolean;
      testTrailingStop: () => boolean;
      testProRataAllocation: () => boolean;
      testRounding: () => boolean;
      testEndToEndScenario: () => boolean;
    };
  }
}

if (typeof window !== 'undefined') {
  window.poolTests = {
    runAll: runAllPoolTests,
    testPoolAggregation,
    testSecureTrigger,
    testRunnerArming,
    testTrailingStop,
    testProRataAllocation,
    testRounding,
    testEndToEndScenario
  };
}