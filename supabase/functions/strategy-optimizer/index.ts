// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Safety Rules (CRITICAL - DO NOT MODIFY)
const SAFETY_RULES = {
  TP_MIN: 0.3,
  TP_MAX: 50,
  SL_MIN: 0.1,
  SL_MAX: 15,
  CONFIDENCE_MAX: 0.90,
  MAX_CHANGE_PCT: 10,  // Max ±10% change per iteration
  MIN_UPDATE_INTERVAL_HOURS: 24,
};

interface OptimizationRequest {
  action: 'evaluate' | 'propose' | 'apply';
  userId: string;
  strategyId: string;
  symbol?: string;
  proposal?: StrategyProposal;
}

interface StrategyProposal {
  symbol: string;
  tp_pct: number;
  sl_pct: number;
  min_confidence: number;
  technical_weight?: number;
  ai_weight?: number;
  reason: string;
  metrics_used: any;
}

interface CalibrationMetrics {
  symbol: string;
  win_rate_pct: number;
  tp_hit_rate_pct: number;
  sl_hit_rate_pct: number;
  median_realized_pnl_pct: number;
  sample_count: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, userId, strategyId, symbol, proposal }: OptimizationRequest = await req.json();

    console.log(`[strategy-optimizer] action=${action}, userId=${userId}, strategyId=${strategyId}, symbol=${symbol}`);

    // Route to action handler
    switch (action) {
      case 'evaluate':
        return await handleEvaluate(supabase, userId, strategyId, symbol);
      case 'propose':
        return await handlePropose(supabase, userId, strategyId, symbol);
      case 'apply':
        return await handleApply(supabase, userId, strategyId, proposal!);
      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (error: any) {
    console.error('[strategy-optimizer] ERROR:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================
// EVALUATE: Read calibration metrics (TEST-only)
// ============================================
async function handleEvaluate(supabase: any, userId: string, strategyId: string, symbol?: string) {
  console.log(`[optimizer] EVALUATE: userId=${userId}, strategyId=${strategyId}, symbol=${symbol || 'ALL'}`);

  // Query calibration_metrics filtered by TEST mode via decision_events
  let query = supabase
    .from('calibration_metrics')
    .select(`
      *,
      decision_events!inner(metadata)
    `)
    .eq('user_id', userId)
    .eq('strategy_id', strategyId);

  if (symbol) {
    query = query.eq('symbol', symbol);
  }

  const { data: metrics, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch calibration metrics: ${error.message}`);
  }

  // Filter TEST-only metrics (execution_mode = 'TEST')
  const testMetrics = metrics?.filter((m: any) => 
    m.decision_events?.metadata?.execution_mode === 'TEST'
  ) || [];

  console.log(`[optimizer] EVALUATE: Found ${testMetrics.length} TEST-mode metrics`);

  return new Response(
    JSON.stringify({ 
      success: true, 
      metrics: testMetrics,
      count: testMetrics.length
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============================================
// PROPOSE: Generate parameter adjustments
// ============================================
async function handlePropose(supabase: any, userId: string, strategyId: string, symbol?: string) {
  console.log(`[optimizer] PROPOSE: userId=${userId}, strategyId=${strategyId}, symbol=${symbol || 'ALL'}`);

  // Get TEST-only calibration metrics
  const evaluateResult = await handleEvaluate(supabase, userId, strategyId, symbol);
  const { metrics } = await evaluateResult.json();

  if (!metrics || metrics.length === 0) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'No TEST-mode metrics available for optimization'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Get current strategy parameters
  const { data: currentParams, error: paramsError } = await supabase
    .from('strategy_parameters')
    .select('*')
    .eq('user_id', userId)
    .eq('strategy_id', strategyId);

  if (paramsError) {
    throw new Error(`Failed to fetch current parameters: ${paramsError.message}`);
  }

  const proposals: StrategyProposal[] = [];

  // Generate proposals per symbol
  const symbolMetrics = groupBySymbol(metrics);

  for (const [sym, symMetrics] of Object.entries(symbolMetrics)) {
    const current = currentParams?.find((p: any) => p.symbol === sym);
    const proposal = generateProposal(sym, symMetrics, current);
    
    if (proposal) {
      proposals.push(proposal);
    }
  }

  console.log(`[optimizer] PROPOSE: Generated ${proposals.length} proposals`);

  return new Response(
    JSON.stringify({ 
      success: true, 
      proposals,
      count: proposals.length
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============================================
// APPLY: Write optimized parameters to DB
// ============================================
async function handleApply(supabase: any, userId: string, strategyId: string, proposal: StrategyProposal) {
  console.log(`[optimizer] APPLY: symbol=${proposal.symbol}, tp=${proposal.tp_pct}%, sl=${proposal.sl_pct}%`);

  // Validate proposal against safety rules
  const validationError = validateProposal(proposal);
  if (validationError) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: `Safety validation failed: ${validationError}`
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Check last update time (24h cooldown)
  const { data: existing } = await supabase
    .from('strategy_parameters')
    .select('last_optimizer_run_at')
    .eq('user_id', userId)
    .eq('strategy_id', strategyId)
    .eq('symbol', proposal.symbol)
    .single();

  if (existing?.last_optimizer_run_at) {
    const lastUpdate = new Date(existing.last_optimizer_run_at);
    const hoursSince = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
    
    if (hoursSince < SAFETY_RULES.MIN_UPDATE_INTERVAL_HOURS) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Update cooldown: ${SAFETY_RULES.MIN_UPDATE_INTERVAL_HOURS}h required, ${hoursSince.toFixed(1)}h elapsed`
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // Upsert parameters
  const { error: upsertError } = await supabase
    .from('strategy_parameters')
    .upsert({
      user_id: userId,
      strategy_id: strategyId,
      symbol: proposal.symbol,
      tp_pct: proposal.tp_pct,
      sl_pct: proposal.sl_pct,
      min_confidence: proposal.min_confidence,
      technical_weight: proposal.technical_weight || 0.5,
      ai_weight: proposal.ai_weight || 0.5,
      last_updated_by: 'strategy_optimizer',
      last_optimizer_run_at: new Date().toISOString(),
      optimization_iteration: (existing?.optimization_iteration || 0) + 1,
      metadata: {
        reason: proposal.reason,
        metrics_used: proposal.metrics_used,
        applied_at: new Date().toISOString()
      }
    }, {
      onConflict: 'strategy_id,symbol'
    });

  if (upsertError) {
    throw new Error(`Failed to upsert parameters: ${upsertError.message}`);
  }

  console.log(`[optimizer] APPLY: Successfully updated parameters for ${proposal.symbol}`);

  return new Response(
    JSON.stringify({ 
      success: true, 
      symbol: proposal.symbol,
      updated_params: {
        tp_pct: proposal.tp_pct,
        sl_pct: proposal.sl_pct,
        min_confidence: proposal.min_confidence
      }
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============================================
// Helper: Group metrics by symbol
// ============================================
function groupBySymbol(metrics: any[]): Record<string, CalibrationMetrics[]> {
  const grouped: Record<string, any[]> = {};
  
  for (const m of metrics) {
    if (!grouped[m.symbol]) {
      grouped[m.symbol] = [];
    }
    grouped[m.symbol].push(m);
  }
  
  return grouped;
}

// ============================================
// Helper: Generate proposal from metrics
// ============================================
function generateProposal(
  symbol: string, 
  metrics: CalibrationMetrics[], 
  currentParams?: any
): StrategyProposal | null {
  
  // Aggregate metrics
  const winRate = metrics.reduce((sum, m) => sum + (m.win_rate_pct || 0), 0) / metrics.length;
  const tpHitRate = metrics.reduce((sum, m) => sum + (m.tp_hit_rate_pct || 0), 0) / metrics.length;
  const slHitRate = metrics.reduce((sum, m) => sum + (m.sl_hit_rate_pct || 0), 0) / metrics.length;
  const medianPnl = metrics.reduce((sum, m) => sum + (m.median_realized_pnl_pct || 0), 0) / metrics.length;
  const totalSamples = metrics.reduce((sum, m) => sum + (m.sample_count || 0), 0);

  // Need minimum samples
  if (totalSamples < 20) {
    console.log(`[optimizer] Skipping ${symbol}: insufficient samples (${totalSamples} < 20)`);
    return null;
  }

  // Current values (defaults if none)
  const currentTP = currentParams?.tp_pct || 1.5;
  const currentSL = currentParams?.sl_pct || 0.8;
  const currentConfidence = currentParams?.min_confidence || 0.6;

  // Decision rules
  let newTP = currentTP;
  let newSL = currentSL;
  let newConfidence = currentConfidence;
  let reason = '';

  // Rule 1: If win_rate > 60% and tp_hit_rate < 30%, increase TP
  if (winRate > 60 && tpHitRate < 30) {
    newTP = Math.min(currentTP * 1.1, SAFETY_RULES.TP_MAX);
    reason += 'High win rate, low TP hits → Increase TP. ';
  }

  // Rule 2: If win_rate < 40% and sl_hit_rate > 30%, tighten SL
  if (winRate < 40 && slHitRate > 30) {
    newSL = Math.max(currentSL * 0.9, SAFETY_RULES.SL_MIN);
    reason += 'Low win rate, high SL hits → Tighten SL. ';
  }

  // Rule 3: If median PnL < 0, increase confidence threshold
  if (medianPnl < 0) {
    newConfidence = Math.min(currentConfidence + 0.05, SAFETY_RULES.CONFIDENCE_MAX);
    reason += 'Negative median PnL → Increase confidence. ';
  }

  // Rule 4: If median PnL > 1%, relax confidence slightly
  if (medianPnl > 1) {
    newConfidence = Math.max(currentConfidence - 0.05, 0.3);
    reason += 'Strong median PnL → Relax confidence. ';
  }

  // Only propose if something changed
  if (newTP === currentTP && newSL === currentSL && newConfidence === currentConfidence) {
    console.log(`[optimizer] No changes needed for ${symbol}`);
    return null;
  }

  return {
    symbol,
    tp_pct: Math.round(newTP * 100) / 100,
    sl_pct: Math.round(newSL * 100) / 100,
    min_confidence: Math.round(newConfidence * 100) / 100,
    reason: reason.trim(),
    metrics_used: {
      win_rate: winRate.toFixed(1),
      tp_hit_rate: tpHitRate.toFixed(1),
      sl_hit_rate: slHitRate.toFixed(1),
      median_pnl: medianPnl.toFixed(2),
      sample_count: totalSamples
    }
  };
}

// ============================================
// Helper: Validate proposal against safety rules
// ============================================
function validateProposal(proposal: StrategyProposal): string | null {
  // TP bounds
  if (proposal.tp_pct < SAFETY_RULES.TP_MIN) {
    return `TP ${proposal.tp_pct}% < minimum ${SAFETY_RULES.TP_MIN}%`;
  }
  if (proposal.tp_pct > SAFETY_RULES.TP_MAX) {
    return `TP ${proposal.tp_pct}% > maximum ${SAFETY_RULES.TP_MAX}%`;
  }

  // SL bounds
  if (proposal.sl_pct < SAFETY_RULES.SL_MIN) {
    return `SL ${proposal.sl_pct}% < minimum ${SAFETY_RULES.SL_MIN}%`;
  }
  if (proposal.sl_pct > SAFETY_RULES.SL_MAX) {
    return `SL ${proposal.sl_pct}% > maximum ${SAFETY_RULES.SL_MAX}%`;
  }

  // Confidence bounds
  if (proposal.min_confidence > SAFETY_RULES.CONFIDENCE_MAX) {
    return `Confidence ${proposal.min_confidence} > maximum ${SAFETY_RULES.CONFIDENCE_MAX}`;
  }

  return null; // Valid
}
