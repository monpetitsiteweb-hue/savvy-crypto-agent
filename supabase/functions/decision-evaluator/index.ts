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
  metadata?: any;  // May contain profitAnalysis.entry_price for old rows
  raw_intent?: any;  // Legacy: may contain metadata.entry_price
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

  // Parse request body to check for backfill mode
  let mode = 'default';
  let isScheduled = false;
  let requestBody = null;
  try {
    requestBody = await req.clone().json();
    mode = requestBody?.mode || 'default';
    isScheduled = requestBody?.scheduled === true;
    console.log(`🔍 EVALUATOR: Received request body:`, JSON.stringify(requestBody));
    console.log(`🔍 EVALUATOR: Parsed mode="${mode}", scheduled=${isScheduled}`);
  } catch (e) {
    console.log(`⚠️ EVALUATOR: Failed to parse request body, defaulting to mode="default"`, e);
  }
  
  const isBackfillMode = mode === 'backfill';
  
  // Security check for scheduled calls
  const hdrSecret = req.headers.get('x-cron-secret');
  
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
    console.log(`📊 EVALUATOR: Starting decision evaluation cycle (mode: ${mode})`);
    
    // Define time cutoff based on mode
    let timeFilterMessage = '';
    let shouldApplyTimeFilter = false;
    let thirtyDaysAgo: Date | null = null;
    
    if (isBackfillMode) {
      console.log('🔄 BACKFILL MODE: Will evaluate ALL historical decisions with valid OHLCV coverage');
      timeFilterMessage = 'backfill mode (no time cutoff)';
    } else {
      // Default: only evaluate decisions from last 30 days
      thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      shouldApplyTimeFilter = true;
      timeFilterMessage = `recent only (last 30 days, since ${thirtyDaysAgo.toISOString()})`;
      console.log(`📅 EVALUATOR: Will only evaluate decisions from last 30 days (since ${thirtyDaysAgo.toISOString()})`);
    }

    // Process each horizon
    const horizons = ['15m', '1h', '4h', '24h'];
    let totalOutcomes = 0;
    let totalPending = 0;
    let totalSkippedOld = 0;
    let totalSkippedNoData = 0;
    
    // Detailed skip reason tracking
    let skippedMissingEntryPrice = 0;
    let skippedNoOhlcvData = 0;
    let skippedOhlcvInsufficient = 0;
    let skippedOther = 0;
    
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
      
      // Filter decisions based on mode
      let decisionsToProcess: DecisionEvent[];
      
      if (shouldApplyTimeFilter && thirtyDaysAgo) {
        // Default mode: filter for recent decisions only
        decisionsToProcess = (pendingDecisions as DecisionEvent[]).filter(d => {
          const decisionDate = new Date(d.decision_ts);
          return decisionDate >= thirtyDaysAgo;
        });
        
        const skippedOld = pendingDecisions.length - decisionsToProcess.length;
        totalSkippedOld += skippedOld;
        console.log(`📋 EVALUATOR: Processing ${decisionsToProcess.length} recent decisions (skipped ${skippedOld} older than 30 days)`);
      } else {
        // Backfill mode: process all pending decisions with valid data
        decisionsToProcess = pendingDecisions as DecisionEvent[];
        console.log(`🔄 BACKFILL: Processing ALL ${decisionsToProcess.length} pending decisions (no time filter)`);
      }
      
      totalPending += decisionsToProcess.length;

      // Log sample of what we're processing
      if (decisionsToProcess.length > 0) {
        const sample = decisionsToProcess[0];
        const daysOld = Math.floor((Date.now() - new Date(sample.decision_ts).getTime()) / (1000 * 60 * 60 * 24));
        console.log(`   Sample: ${sample.symbol} ${sample.side} at ${sample.decision_ts} (${daysOld} days old, entry: ${sample.entry_price})`);
      }

      // Process each decision
      for (const decision of decisionsToProcess) {
        console.log(
          `🔄 EVALUATOR: Processing decision ${decision.id} for horizon ${horizon} ` +
          `(symbol=${decision.symbol}, side=${decision.side}, ` +
          `entry_price_col=${decision.entry_price}, tp_pct=${decision.tp_pct}, sl_pct=${decision.sl_pct})`
        );
        try {
          // For backfill mode, pass a very old date to disable any date filtering
          const dateParam = isBackfillMode ? new Date(0) : (thirtyDaysAgo || new Date(0));
          const result = await evaluateDecision(supabase, decision, horizon, dateParam);
          
          if (result === 'success') {
            totalOutcomes++;
            console.log(`✅ EVALUATOR: Created outcome for decision ${decision.id} (${horizon})`);
          } else if (result === 'missing_entry_price') {
            skippedMissingEntryPrice++;
            totalSkippedNoData++;
          } else if (result === 'no_ohlcv_data') {
            skippedNoOhlcvData++;
            totalSkippedNoData++;
          } else if (result === 'ohlcv_insufficient') {
            skippedOhlcvInsufficient++;
            totalSkippedNoData++;
          } else if (result === 'no_data') {
            skippedOther++;
            totalSkippedNoData++;
          }
        } catch (error) {
          console.error(`❌ EVALUATOR: Failed to evaluate decision ${decision.id}:`, error);
          skippedOther++;
        }
      }
    }

    console.log(`\n✅ EVALUATOR: Evaluation cycle complete (mode: ${mode})`);
    console.log(`   Total pending: ${totalPending}`);
    console.log(`   Skipped (old): ${totalSkippedOld}`);
    console.log(`   Skipped (no data): ${totalSkippedNoData}`);
    console.log(`   Outcomes created: ${totalOutcomes}`);
    console.log(`📊 EVALUATOR SKIP DETAILS:`);
    console.log(`  - Missing entry_price/tp/sl: ${skippedMissingEntryPrice}`);
    console.log(`  - No OHLCV data found: ${skippedNoOhlcvData}`);
    console.log(`  - OHLCV insufficient (<2 rows): ${skippedOhlcvInsufficient}`);
    console.log(`  - Other reasons: ${skippedOther}`);
    
    if (isBackfillMode) {
      console.log(`🔄 BACKFILL SUMMARY: Evaluated ${totalPending} historical decisions, created ${totalOutcomes} outcomes`);
    } else {
      console.log(`   Success rate: ${totalPending > 0 ? ((totalOutcomes / totalPending) * 100).toFixed(1) : 0}%`);
    }

    return new Response(JSON.stringify({
      success: true,
      mode: mode,
      pending_decisions_recent: totalPending,
      pending_decisions_skipped_old: totalSkippedOld,
      pending_decisions_skipped_no_data: totalSkippedNoData,
      outcomes_created: totalOutcomes,
      horizons_processed: horizons.length,
      timestamp: new Date().toISOString(),
      skip_details: {
        missing_entry_price: skippedMissingEntryPrice,
        no_ohlcv_data: skippedNoOhlcvData,
        ohlcv_insufficient: skippedOhlcvInsufficient,
        other: skippedOther
      }
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
  horizon: string,
  dataStartDate: Date
): Promise<'success' | 'no_data' | 'skipped' | 'missing_entry_price' | 'no_ohlcv_data' | 'ohlcv_insufficient'> {
  
  // Derive entry price with fallbacks for older data (stored in metadata)
  const entryPrice =
    decision.entry_price ??
    // Old style: profitAnalysis.entry_price
    decision.metadata?.profitAnalysis?.entry_price ??
    // Some earlier versions might have put it directly in metadata
    decision.metadata?.entry_price ??
    // Very old: inside raw_intent.metadata.entry_price
    decision.raw_intent?.metadata?.entry_price;

  if (!entryPrice || entryPrice <= 0) {
    console.log(
      `⚠️ EVALUATOR: Decision ${decision.id} has no valid entry_price ` +
      `(column=${decision.entry_price}, ` +
      `profitAnalysis=${decision.metadata?.profitAnalysis?.entry_price}, ` +
      `metadata=${decision.metadata?.entry_price}, ` +
      `raw_intent=${decision.raw_intent?.metadata?.entry_price})`
    );
    return 'missing_entry_price';
  }

  // Derive TP/SL similarly, with defaults if needed
  const tpPct =
    decision.tp_pct ??
    decision.metadata?.tp_pct ??
    decision.metadata?.profitAnalysis?.tp_pct ??
    null;
  const slPct =
    decision.sl_pct ??
    decision.metadata?.sl_pct ??
    decision.metadata?.profitAnalysis?.sl_pct ??
    null;

  if (!tpPct || !slPct) {
    console.log(
      `⚠️ EVALUATOR: Decision ${decision.id} missing tp_pct or sl_pct ` +
      `(tp_pct=${tpPct}, sl_pct=${slPct})`
    );
    return 'missing_entry_price';
  }

  console.log(
    `🔍 EVALUATOR: Decision ${decision.id} derived values: ` +
    `entry_price=${entryPrice}, tp_pct=${tpPct}, sl_pct=${slPct}`
  );
  
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
  
  // Allow data a bit before the decision_ts to account for bar timing
  const windowStart = new Date(decisionTime.getTime() - 5 * 60 * 1000); // 5 minutes before
  
  // Map horizon → OHLCV granularity
  const granularityMap: Record<string, string> = {
    '15m': '1h',   // we only have 1h/4h/24h in market_ohlcv_raw
    '1h': '1h',
    '4h': '4h',
    '24h': '24h',
  };
  const granularity = granularityMap[horizon] ?? '1h';

  // Try both base symbol (BTC) and quote symbol (BTC-EUR)
  const candidateSymbols = [decision.symbol, `${decision.symbol}-EUR`];

  let ohlcvRows: any[] = [];
  let lastError: any = null;

  for (const sym of candidateSymbols) {
    const { data, error } = await supabase
      .from('market_ohlcv_raw')
      .select('close, ts_utc')
      .eq('symbol', sym)
      .eq('granularity', granularity)
      .gte('ts_utc', windowStart.toISOString())
      .lte('ts_utc', evaluationEnd.toISOString())
      .order('ts_utc', { ascending: true });

    if (error) {
      lastError = error;
      continue;
    }
    if (data && data.length > 0) {
      ohlcvRows = data;
      break;
    }
  }

  if (!ohlcvRows || ohlcvRows.length === 0) {
    if (lastError) {
      console.error(`❌ EVALUATOR: OHLCV error for ${decision.symbol}:`, lastError);
    }
    console.log(`⚠️ EVALUATOR: No OHLCV data found for ${decision.symbol} (${horizon})`);
    return 'no_ohlcv_data';
  }

  const prices = ohlcvRows.map(r => Number(r.close));
  
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

  // Check TP/SL hits - use derived tp_pct/sl_pct
  const hit_tp = tpPct && Math.abs(mfe_pct) >= tpPct;
  const hit_sl = slPct && Math.abs(mae_pct) >= slPct;

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
    console.error(`❌ EVALUATOR: Failed to insert outcome for ${decision.id}:`, insertError);
    return 'no_ohlcv_data';
  }

  console.log(`✅ EVALUATOR: Created outcome for decision ${decision.id} (${symbolWithPair}, ${horizon}): realized_pnl=${realized_pnl_pct.toFixed(2)}%, hit_tp=${hit_tp}, hit_sl=${hit_sl}`);
  return 'success';
}