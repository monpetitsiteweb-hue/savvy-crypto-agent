import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Simple test of profit gate logic
    const testScenarios = [
      {
        name: "Take Profit Hit",
        position: { avgPrice: 90000, currentPrice: 91500, qty: 0.001 },
        config: { takeProfitPercentage: 1.5, stopLossPercentage: 0.8 },
        confidence: 0.5,
        expected: "ALLOWED"
      },
      {
        name: "Stop Loss Hit", 
        position: { avgPrice: 90000, currentPrice: 89200, qty: 0.001 },
        config: { takeProfitPercentage: 1.5, stopLossPercentage: 0.8 },
        confidence: 0.5,
        expected: "ALLOWED"
      },
      {
        name: "Insufficient Profit",
        position: { avgPrice: 90000, currentPrice: 90100, qty: 0.001 },
        config: { 
          takeProfitPercentage: 1.5,
          stopLossPercentage: 0.8,
          minEdgeBpsForExit: 20,
          minProfitEurForExit: 0.20,
          confidenceThresholdForExit: 0.60
        },
        confidence: 0.40,
        expected: "BLOCKED"
      }
    ];

    const results = [];

    for (const scenario of testScenarios) {
      const { avgPrice, currentPrice, qty } = scenario.position;
      const config = scenario.config;
      
      // Calculate P&L
      const pnlPct = ((currentPrice - avgPrice) / avgPrice) * 100;
      const pnlEur = qty * (currentPrice - avgPrice);
      const edgeBps = Math.abs(pnlPct) * 100;
      
      // Check conditions
      const tpHit = pnlPct >= config.takeProfitPercentage;
      const slHit = pnlPct <= -config.stopLossPercentage;
      const edgeOk = edgeBps >= (config.minEdgeBpsForExit || 8);
      const eurOk = pnlEur >= (config.minProfitEurForExit || 0.20);
      const confOk = scenario.confidence >= (config.confidenceThresholdForExit || 0.60);
      
      const allowed = tpHit || slHit || (edgeOk && eurOk && confOk);
      const actualResult = allowed ? "ALLOWED" : "BLOCKED";
      
      results.push({
        scenario: scenario.name,
        expected: scenario.expected,
        actual: actualResult,
        passed: actualResult === scenario.expected,
        details: {
          pnl_pct: Number(pnlPct.toFixed(2)),
          pnl_eur: Number(pnlEur.toFixed(2)),
          edge_bps: Number(edgeBps.toFixed(1)),
          tp_hit: tpHit,
          sl_hit: slHit,
          conditions: { edge: edgeOk, eur: eurOk, confidence: confOk }
        }
      });
    }

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    return new Response(JSON.stringify({
      success: true,
      summary: { total: results.length, passed, failed },
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Test error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});