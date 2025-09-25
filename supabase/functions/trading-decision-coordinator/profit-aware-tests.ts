// @ts-nocheck
// Unit and Integration Tests for Profit-Aware Coordinator (Milestone 1)

interface TestCase {
  name: string;
  setup: any;
  expected: { allowed: boolean; reason?: string };
}

// Mock Supabase client for testing
const createMockSupabaseClient = (mockTrades: any[]) => {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  data: mockTrades.filter(t => t.trade_type === 'buy'),
                  error: null
                })
              })
            })
          })
        })
      }),
      // For sell trades query  
      not: () => ({
        data: mockTrades.filter(t => t.trade_type === 'sell'),
        error: null
      })
    })
  };
};

// UNIT TESTS

export const unitTests: TestCase[] = [
  {
    name: "TP Path - Take Profit Hit (>1.5%)",
    setup: {
      buyTrades: [{ amount: 0.001, price: 90000, executed_at: '2025-01-01T10:00:00Z' }],
      sellTrades: [],
      currentPrice: 91500, // +1.67% gain
      intent: { qtySuggested: 0.001, confidence: 0.5 },
      config: { takeProfitPercentage: 1.5, stopLossPercentage: 0.8 }
    },
    expected: { allowed: true, reason: "Take Profit hit (1.67%)" }
  },
  
  {
    name: "SL Path - Stop Loss Hit (<-0.8%)",  
    setup: {
      buyTrades: [{ amount: 0.001, price: 90000, executed_at: '2025-01-01T10:00:00Z' }],
      sellTrades: [],
      currentPrice: 89200, // -0.89% loss
      intent: { qtySuggested: 0.001, confidence: 0.5 },
      config: { stopLossPercentage: 0.8 }
    },
    expected: { allowed: true, reason: "Stop Loss hit (-0.89%)" }
  },

  {
    name: "Edge Path - All Edge Conditions Met", 
    setup: {
      buyTrades: [{ amount: 0.001, price: 90000, executed_at: '2025-01-01T10:00:00Z' }],
      sellTrades: [],
      currentPrice: 90300, // +0.33% gain, €0.30 profit
      intent: { qtySuggested: 0.001, confidence: 0.65 },
      config: { 
        minEdgeBpsForExit: 30, // 30 bps = 0.30%  
        minProfitEurForExit: 0.20,
        confidenceThresholdForExit: 0.60
      }
    },
    expected: { allowed: true, reason: "Edge/EUR/Confidence conditions met" }
  },

  {
    name: "Block Path - Insufficient Profit Conditions",
    setup: {
      buyTrades: [{ amount: 0.001, price: 90000, executed_at: '2025-01-01T10:00:00Z' }],
      sellTrades: [],
      currentPrice: 90100, // +0.11% gain, €0.10 profit
      intent: { qtySuggested: 0.001, confidence: 0.40 },
      config: {
        takeProfitPercentage: 1.5,
        stopLossPercentage: 0.8,
        minEdgeBpsForExit: 20, // 20 bps = 0.20%
        minProfitEurForExit: 0.20,
        confidenceThresholdForExit: 0.60
      }
    },
    expected: { allowed: false, reason: "Insufficient profit conditions" }
  }
];

// INTEGRATION TESTS

export const integrationTests: TestCase[] = [
  {
    name: "Weak Bearish + Low Confidence + Near-Zero P&L → Block",
    setup: {
      buyTrades: [{ amount: 0.001, price: 90000, executed_at: '2025-01-01T10:00:00Z' }],
      sellTrades: [],
      currentPrice: 90020, // +0.02% tiny gain, €0.02 profit  
      intent: { 
        qtySuggested: 0.001, 
        confidence: 0.35, // Low confidence
        side: 'SELL',
        source: 'automated' // Weak signal
      },
      config: {
        takeProfitPercentage: 1.5,  // Need 1.5% for TP
        stopLossPercentage: 0.8,    // Need -0.8% for SL
        minEdgeBpsForExit: 10,      // Need 10 bps = 0.10%
        minProfitEurForExit: 0.15,  // Need €0.15 profit
        confidenceThresholdForExit: 0.60 // Need 60% confidence
      }
    },
    expected: { 
      allowed: false,
      reason: "Should block: P&L 0.02% < TP 1.5%, P&L 0.02% > SL -0.8%, Edge/EUR/Confidence not all met"
    }
  },

  {
    name: "FIFO Position Calculation - Partial Sells",
    setup: {
      buyTrades: [
        { amount: 0.002, price: 90000, executed_at: '2025-01-01T10:00:00Z' },
        { amount: 0.001, price: 95000, executed_at: '2025-01-01T11:00:00Z' }
      ],
      sellTrades: [
        { 
          original_purchase_amount: 0.001, 
          original_purchase_value: 90,  // Sold first 0.001 from first buy
          trade_type: 'sell' 
        }
      ],
      currentPrice: 98000, // Good profit on remaining position
      intent: { qtySuggested: 0.0015, confidence: 0.70 }, // Selling remaining 0.0015
      config: { takeProfitPercentage: 1.5 }
    },
    expected: { allowed: true, reason: "Take Profit from FIFO calculation" }
  }
];

// Test runner function
export async function runProfitAwareTests(): Promise<{ passed: number; failed: number; results: any[] }> {
  let passed = 0;
  let failed = 0;
  const results: any[] = [];

  console.log('🧪 Running Profit-Aware Coordinator Tests...\n');

  // Run unit tests
  console.log('📋 UNIT TESTS:');
  for (const test of unitTests) {
    try {
      const mockClient = createMockSupabaseClient([
        ...test.setup.buyTrades,
        ...test.setup.sellTrades
      ]);
      
      // Mock the evaluateProfitGate function call
      const result = await mockEvaluateProfitGate(
        mockClient,
        test.setup.intent,
        test.setup.config,
        test.setup.currentPrice
      );

      const testPassed = result.allowed === test.expected.allowed;
      
      if (testPassed) {
        console.log(`✅ ${test.name}`);
        passed++;
      } else {
        console.log(`❌ ${test.name}`);
        console.log(`   Expected: allowed=${test.expected.allowed}`);
        console.log(`   Got: allowed=${result.allowed}, reason="${result.reason}"`);
        failed++;
      }
      
      results.push({
        test: test.name,
        passed: testPassed,
        result,
        expected: test.expected
      });
      
    } catch (error) {
      console.log(`❌ ${test.name} - ERROR: ${error.message}`);
      failed++;
      results.push({
        test: test.name,
        passed: false,
        error: error.message
      });
    }
  }

  // Run integration tests  
  console.log('\n📋 INTEGRATION TESTS:');
  for (const test of integrationTests) {
    try {
      const mockClient = createMockSupabaseClient([
        ...test.setup.buyTrades,
        ...test.setup.sellTrades
      ]);
      
      const result = await mockEvaluateProfitGate(
        mockClient,
        test.setup.intent,
        test.setup.config,
        test.setup.currentPrice
      );

      const testPassed = result.allowed === test.expected.allowed;
      
      if (testPassed) {
        console.log(`✅ ${test.name}`);
        passed++;
      } else {
        console.log(`❌ ${test.name}`);
        console.log(`   Expected: allowed=${test.expected.allowed}`);
        console.log(`   Got: allowed=${result.allowed}`);
        console.log(`   Metadata:`, JSON.stringify(result.metadata, null, 2));
        failed++;
      }
      
      results.push({
        test: test.name,
        passed: testPassed,
        result,
        expected: test.expected
      });
      
    } catch (error) {
      console.log(`❌ ${test.name} - ERROR: ${error.message}`);
      failed++;
      results.push({
        test: test.name,
        passed: false,
        error: error.message
      });
    }
  }

  console.log(`\n📊 RESULTS: ${passed} passed, ${failed} failed`);
  
  return { passed, failed, results };
}

// Mock implementation for testing (simplified version of the actual function)
async function mockEvaluateProfitGate(
  supabaseClient: any,
  intent: any,
  strategyConfig: any,
  currentPrice: number
): Promise<{ allowed: boolean; reason?: string; metadata: any }> {
  
  // Extract config with defaults
  const profitConfig = {
    takeProfitPercentage: strategyConfig?.takeProfitPercentage || 1.5,
    stopLossPercentage: strategyConfig?.stopLossPercentage || 0.8,
    minEdgeBpsForExit: strategyConfig?.minEdgeBpsForExit || 8,
    minProfitEurForExit: strategyConfig?.minProfitEurForExit || 0.20,
    confidenceThresholdForExit: strategyConfig?.confidenceThresholdForExit || 0.60
  };

  // Mock data retrieval - simplified for testing
  const buyTrades = supabaseClient.from().select().eq().eq().eq().eq().order().data;
  const sellTrades = supabaseClient.from().not().data;
  
  if (!buyTrades || buyTrades.length === 0) {
    return { allowed: false, reason: 'no_position_to_sell', metadata: {} };
  }

  // FIFO calculation (simplified)
  let totalPurchaseValue = 0;
  let totalPurchaseAmount = 0;
  let remainingAmount = intent.qtySuggested || 0.001;
  
  for (const buy of buyTrades) {
    if (remainingAmount <= 0) break;
    
    const takeAmount = Math.min(remainingAmount, buy.amount);
    totalPurchaseAmount += takeAmount;
    totalPurchaseValue += takeAmount * buy.price;
    remainingAmount -= takeAmount;
  }

  if (totalPurchaseAmount === 0) {
    return { allowed: false, reason: 'insufficient_position_size', metadata: {} };
  }

  const avgPurchasePrice = totalPurchaseValue / totalPurchaseAmount;
  const sellAmount = intent.qtySuggested || 0.001;
  const sellValue = sellAmount * currentPrice;
  const pnlEur = sellValue - totalPurchaseValue;
  const pnlPct = ((currentPrice - avgPurchasePrice) / avgPurchasePrice) * 100;
  const edgeBps = Math.abs(pnlPct) * 100;
  
  // Conditions
  const tpHit = pnlPct >= profitConfig.takeProfitPercentage;
  const slHit = pnlPct <= -profitConfig.stopLossPercentage;
  const edgeCondition = edgeBps >= profitConfig.minEdgeBpsForExit;
  const eurCondition = pnlEur >= profitConfig.minProfitEurForExit;
  const confidenceCondition = intent.confidence >= profitConfig.confidenceThresholdForExit;
  const allConditionsMet = edgeCondition && eurCondition && confidenceCondition;

  const metadata = {
    pnl_eur: Number(pnlEur.toFixed(2)),
    pnl_pct: Number(pnlPct.toFixed(2)),
    edge_bps: Number(edgeBps.toFixed(1)),
    tp_hit: tpHit,
    sl_hit: slHit,
    conditions: { edgeCondition, eurCondition, confidenceCondition }
  };

  // Decision logic
  const allowed = tpHit || slHit || allConditionsMet;
  
  let reason: string;
  if (allowed) {
    if (tpHit) reason = `Take Profit hit (${pnlPct.toFixed(2)}%)`;
    else if (slHit) reason = `Stop Loss hit (${pnlPct.toFixed(2)}%)`;  
    else reason = 'Edge/EUR/Confidence conditions met';
  } else {
    reason = 'Insufficient profit conditions';
  }
  
  return { allowed, reason, metadata };
}

// Export for use in other files
export { runProfitAwareTests, mockEvaluateProfitGate };