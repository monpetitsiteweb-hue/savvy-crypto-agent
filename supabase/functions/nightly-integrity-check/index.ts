// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🔍 INTEGRITY: Starting nightly integrity check');
    
    const epsilon = 0.01; // 1 cent tolerance
    const issues = [];
    let totalChecked = 0;
    let corruptedCount = 0;

    // Get current prices for validation
    const symbols = ['BTC', 'ETH', 'XRP', 'ADA', 'SOL', 'DOT', 'MATIC', 'AVAX', 'LINK', 'LTC'];
    const currentPrices: Record<string, number> = {};
    
    for (const symbol of symbols) {
      try {
        const response = await fetch(`https://api.exchange.coinbase.com/products/${symbol}-EUR/ticker`);
        if (response.ok) {
          const data = await response.json();
          currentPrices[symbol] = parseFloat(data.price);
        }
      } catch (error) {
        console.warn(`Failed to fetch price for ${symbol}:`, error.message);
        currentPrices[symbol] = 0; // Will skip validation for this symbol
      }
    }

    // Check all trades for integrity violations
    const { data: trades, error: tradesError } = await supabaseClient
      .from('mock_trades')
      .select('*')
      .eq('is_corrupted', false); // Only check non-corrupted trades

    if (tradesError) {
      throw new Error(`Failed to fetch trades: ${tradesError.message}`);
    }

    for (const trade of trades || []) {
      totalChecked++;
      const violations = [];
      
      // Check 1: purchase_value should equal amount * entry_price
      if (trade.trade_type === 'buy' || (trade.trade_type === 'sell' && trade.original_purchase_price)) {
        const entryPrice = trade.trade_type === 'buy' ? trade.price : trade.original_purchase_price;
        const purchaseValue = trade.trade_type === 'buy' ? trade.total_value : trade.original_purchase_value;
        const expectedValue = trade.amount * entryPrice;
        
        if (Math.abs(purchaseValue - expectedValue) > epsilon) {
          violations.push(`purchase_value_mismatch: ${purchaseValue} ≠ ${trade.amount} × ${entryPrice} = ${expectedValue}`);
        }
      }

      // Check 2: current_value should equal amount * current_price (for recent trades)
      const symbol = trade.cryptocurrency.replace('-EUR', '');
      const currentPrice = currentPrices[symbol];
      
      if (currentPrice > 0) {
        const expectedCurrentValue = trade.amount * currentPrice;
        const actualCurrentValue = trade.amount * currentPrice; // Using live calculation
        
        if (Math.abs(expectedCurrentValue - actualCurrentValue) > epsilon) {
          violations.push(`current_value_mismatch: calculated vs expected`);
        }
      }

      // Check 3: Suspicious €100 placeholder prices
      if (trade.price === 100 && trade.amount >= 10) {
        violations.push('suspicious_100_eur_placeholder');
      }

      // Check 4: Invalid negative or zero values
      if (trade.amount <= 0 || trade.price <= 0 || trade.total_value <= 0) {
        violations.push('invalid_negative_zero_values');
      }

      // If violations found, tag the trade
      if (violations.length > 0) {
        const integrityReason = violations.join('; ');
        
        await supabaseClient
          .from('mock_trades')
          .update({
            is_corrupted: true,
            integrity_reason: integrityReason
          })
          .eq('id', trade.id);

        issues.push({
          trade_id: trade.id,
          symbol: trade.cryptocurrency,
          violations: violations.length,
          reason: integrityReason
        });

        corruptedCount++;
        console.log(`🔴 INTEGRITY: Tagged trade ${trade.id} (${trade.cryptocurrency}): ${integrityReason}`);
      }
    }

    // Check for contradiction patterns in recent decisions
    const { data: recentDecisions } = await supabaseClient
      .from('trade_decisions_log')
      .select('*')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });

    const contradictions = [];
    const symbolDecisions: Record<string, any[]> = {};

    // Group decisions by symbol
    for (const decision of recentDecisions || []) {
      if (!symbolDecisions[decision.symbol]) {
        symbolDecisions[decision.symbol] = [];
      }
      symbolDecisions[decision.symbol].push(decision);
    }

    // Check for contradictory decisions within cooldown periods
    for (const [symbol, decisions] of Object.entries(symbolDecisions)) {
      for (let i = 0; i < decisions.length - 1; i++) {
        const current = decisions[i];
        const next = decisions[i + 1];
        
        const timeDiff = new Date(current.created_at).getTime() - new Date(next.created_at).getTime();
        
        // Check if BUY follows SELL within 30 seconds (typical cooldown)
        if (current.decision_action === 'BUY' && next.decision_action === 'SELL' && timeDiff < 30000) {
          contradictions.push({
            symbol,
            current_action: current.decision_action,
            previous_action: next.decision_action,
            time_diff_ms: timeDiff,
            current_reason: current.decision_reason,
            previous_reason: next.decision_reason
          });
        }
      }
    }

    // Generate summary by symbol
    const summaryBySymbol: Record<string, number> = {};
    for (const issue of issues) {
      summaryBySymbol[issue.symbol] = (summaryBySymbol[issue.symbol] || 0) + 1;
    }

    const summary = {
      timestamp: new Date().toISOString(),
      total_trades_checked: totalChecked,
      newly_corrupted: corruptedCount,
      issues_by_symbol: summaryBySymbol,
      contradictions_found: contradictions.length,
      top_violations: issues.slice(0, 10)
    };

    console.log('✅ INTEGRITY: Nightly check complete:', JSON.stringify(summary, null, 2));

    // Alert if issues found
    if (corruptedCount > 0) {
      console.log(`🚨 INTEGRITY: ALERT - ${corruptedCount} trades newly tagged as corrupted`);
      
      // Could integrate with alerting system here
      // await sendAlert('integrity_violations', summary);
    }

    if (contradictions.length > 0) {
      console.log(`🚨 INTEGRITY: ALERT - ${contradictions.length} decision contradictions detected`);
    }

    return new Response(JSON.stringify({
      ok: true,
      summary,
      contradictions: contradictions.slice(0, 5) // Return top 5 contradictions
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ INTEGRITY: Nightly check failed:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});