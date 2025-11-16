// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

interface DecisionEvent {
  id: string;
  user_id: string;
  symbol: string;
  side: string;
  decision_ts: string;
  entry_price: number;
  tp_pct: number;
  sl_pct: number;
  expected_pnl_pct: number;
}

interface PriceSnapshot {
  symbol: string;
  price: number;
  ts: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Create Supabase client first
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Security check for scheduled calls
  const hdrSecret = req.headers.get('x-cron-secret');
  let isScheduled = false;
  try {
    const b = await req.clone().json();
    isScheduled = b?.scheduled === true;
  } catch { /* non-scheduled/manual call */ }
  
  if (isScheduled) {
    const { data, error } = await supabase
      .schema('vault')
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', 'CRON_SECRET')
      .single();

    const expected = data?.decrypted_secret;
    if (error || !expected || hdrSecret !== expected) {
      return new Response(JSON.stringify({ success: false, error: 'forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  try {
    console.log('📊 EVALUATOR: Starting decision evaluation cycle');
    
    // Get date range for selection
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    console.log(`📅 EVALUATOR: Selecting decisions from last 7 days (since ${sevenDaysAgo.toISOString()})`);

    // Process each horizon
    const horizons = ['15m', '1h', '4h', '24h'];
    let totalOutcomes = 0;
    let totalPending = 0;
    
    for (const horizon of horizons) {
      console.log(`📋 EVALUATOR: Processing ${horizon} horizon`);
      
      // Get pending decisions for this horizon
      const { data: pendingDecisions, error: pendingError } = await supabase
        .rpc('get_pending_decisions_for_horizon', { horizon_key: horizon });

      if (pendingError) {
        console.error(`❌ EVALUATOR: Error fetching pending decisions for ${horizon}:`, pendingError);
        continue;
      }

      if (!pendingDecisions || pendingDecisions.length === 0) {
        console.log(`📋 EVALUATOR: No pending decisions for ${horizon}`);
        continue;
      }

      console.log(`📋 EVALUATOR: Found ${pendingDecisions.length} pending decisions for ${horizon}`);
      totalPending += pendingDecisions.length;

      // Process each decision
      for (const decision of pendingDecisions as DecisionEvent[]) {
        try {
          const outcome = await evaluateDecision(supabase, decision, horizon);
          if (outcome) {
            totalOutcomes++;
            console.log(`✅ EVALUATOR: Created outcome for decision ${decision.id} (${horizon})`);
          }
        } catch (error) {
          console.error(`❌ EVALUATOR: Failed to evaluate decision ${decision.id}:`, error);
        }
      }
    }

    console.log(`📊 EVALUATOR: Completed cycle`);
    console.log(`   - Total pending decisions: ${totalPending}`);
    console.log(`   - Outcomes created: ${totalOutcomes}`);
    console.log(`   - Success rate: ${totalPending > 0 ? ((totalOutcomes / totalPending) * 100).toFixed(1) : 0}%`);

    return new Response(JSON.stringify({
      success: true,
      pending_decisions: totalPending,
      outcomes_created: totalOutcomes,
      horizons_processed: horizons.length,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ EVALUATOR: Critical error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function evaluateDecision(
  supabase: any, 
  decision: DecisionEvent, 
  horizon: string
): Promise<boolean> {
  
  const now = new Date();
  const decisionTime = new Date(decision.decision_ts);
  
  // Calculate horizon end time
  const horizonMs = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000
  }[horizon] || 60 * 60 * 1000;
  
  const evaluationEnd = new Date(decisionTime.getTime() + horizonMs);
  
  // Get price data for the evaluation period
  const { data: priceData, error: priceError } = await supabase
    .from('price_snapshots')
    .select('price, ts')
    .eq('symbol', decision.symbol)
    .gte('ts', decision.decision_ts)
    .lte('ts', evaluationEnd.toISOString())
    .order('ts', { ascending: true });

  if (priceError) {
    console.error(`❌ EVALUATOR: Price data error for ${decision.symbol}:`, priceError);
    return false;
  }

  if (!priceData || priceData.length === 0) {
    console.log(`⚠️ EVALUATOR: No price data found for ${decision.symbol} in period`);
    return false;
  }

  // Calculate metrics
  const entryPrice = decision.entry_price;
  const prices = priceData.map(p => p.price);
  
  // Maximum Favorable Excursion (MFE)
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  
  let mfe_pct: number;
  let mae_pct: number;
  
  if (decision.side === 'BUY') {
    // For BUY decisions, favorable is price going up
    mfe_pct = ((maxPrice - entryPrice) / entryPrice) * 100;
    mae_pct = ((minPrice - entryPrice) / entryPrice) * 100;
  } else {
    // For SELL decisions, favorable is price going down
    mfe_pct = ((entryPrice - minPrice) / entryPrice) * 100;
    mae_pct = ((entryPrice - maxPrice) / entryPrice) * 100;
  }

  // Final price at horizon end
  const finalPrice = prices[prices.length - 1];
  const realized_pnl_pct = decision.side === 'BUY' 
    ? ((finalPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - finalPrice) / entryPrice) * 100;

  // Check TP/SL hits
  const hit_tp = decision.tp_pct && Math.abs(mfe_pct) >= decision.tp_pct;
  const hit_sl = decision.sl_pct && Math.abs(mae_pct) >= decision.sl_pct;

  // Missed opportunity (price moved favorably but we didn't capture it)
  const missed_opportunity = Math.abs(mfe_pct) > 2 && Math.abs(realized_pnl_pct) < Math.abs(mfe_pct) * 0.5;

  // Expectation error (difference between expected and actual)
  const expectation_error_pct = decision.expected_pnl_pct 
    ? Math.abs(realized_pnl_pct - decision.expected_pnl_pct)
    : null;

  // Insert outcome with upsert to prevent duplicates
  const { error: insertError } = await supabase
    .from('decision_outcomes')
    .upsert({
      decision_id: decision.id,
      user_id: decision.user_id,
      symbol: decision.symbol,
      horizon: horizon,
      mfe_pct: Number(mfe_pct.toFixed(2)),
      mae_pct: Number(mae_pct.toFixed(2)),
      realized_pnl_pct: Number(realized_pnl_pct.toFixed(2)),
      hit_tp,
      hit_sl,
      missed_opportunity,
      expectation_error_pct: expectation_error_pct ? Number(expectation_error_pct.toFixed(2)) : null,
      evaluated_at: now.toISOString()
    }, {
      onConflict: 'decision_id,horizon'
    });

  if (insertError) {
    console.error(`❌ EVALUATOR: Failed to insert outcome:`, insertError);
    return false;
  }

  return true;
}