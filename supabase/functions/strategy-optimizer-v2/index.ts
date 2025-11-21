import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OptimizationRequest {
  user_id: string;
  strategy_id: string;
  symbol: string;
  horizon: string;
  time_window?: string;
  suggestion_types?: string[]; // Optional: which types to generate
}

interface CalibrationMetric {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  horizon: string;
  time_window: string;
  sample_count: number;
  win_rate_pct: number;
  median_realized_pnl_pct: number | null;
  mean_realized_pnl_pct: number | null;
  median_mfe_pct: number | null;
  median_mae_pct: number | null;
  tp_hit_rate_pct: number;
  sl_hit_rate_pct: number;
  missed_opportunity_pct: number;
  window_start_ts: string;
  window_end_ts: string;
  window_days: number;
  computed_at: string;
}

interface StrategyParameter {
  tp_pct: number;
  sl_pct: number;
  min_confidence: number;
  technical_weight: number;
  ai_weight: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('❌ Missing Supabase configuration');
      return new Response(JSON.stringify({ error: 'Missing Supabase configuration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const input: OptimizationRequest = await req.json();
    console.log('📥 OPTIMIZER-V2: Received input:', JSON.stringify(input));

    const { user_id, strategy_id, symbol, horizon, time_window = '30' } = input;

    // Validate required fields
    if (!user_id || !strategy_id || !symbol || !horizon) {
      console.error('❌ Missing required fields');
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'missing_required_fields',
          required: ['user_id', 'strategy_id', 'symbol', 'horizon']
        }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine which suggestion types to generate
    const defaultTypes = ['confidence_threshold', 'tp_pct', 'sl_pct', 'technical_weight', 'ai_weight'];
    const requestedTypes = input.suggestion_types || defaultTypes;
    
    console.log(`🎯 Requested suggestion types: ${requestedTypes.join(', ')}`);

    // Fetch calibration metrics
    console.log(`🔍 Fetching calibration_metrics for: user_id=${user_id}, strategy_id=${strategy_id}, symbol=${symbol}, horizon=${horizon}, time_window=${time_window}`);
    
    const { data: calibrationRows, error: calibrationError } = await supabase
      .from('calibration_metrics')
      .select('*')
      .eq('user_id', user_id)
      .eq('strategy_id', strategy_id)
      .eq('symbol', symbol)
      .eq('horizon', horizon)
      .eq('time_window', time_window)
      .order('window_end_ts', { ascending: false })
      .limit(1);

    if (calibrationError) {
      console.error('❌ Error fetching calibration_metrics:', calibrationError);
      return new Response(
        JSON.stringify({ ok: false, reason: 'calibration_fetch_error', error: calibrationError.message }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!calibrationRows || calibrationRows.length === 0) {
      console.log('⚠️ No calibration row found');
      return new Response(
        JSON.stringify({ ok: false, reason: 'no_calibration_row' }), 
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const calibration: CalibrationMetric = calibrationRows[0];
    console.log(`✅ Found calibration: sample_count=${calibration.sample_count}, win_rate=${calibration.win_rate_pct}%`);

    // Fetch current strategy_parameters for comparison
    const { data: currentParams } = await supabase
      .from('strategy_parameters')
      .select('*')
      .eq('user_id', user_id)
      .eq('strategy_id', strategy_id)
      .eq('symbol', symbol)
      .maybeSingle();

    const current: StrategyParameter = currentParams || {
      tp_pct: 1.5,
      sl_pct: 0.8,
      min_confidence: 0.6,
      technical_weight: 0.5,
      ai_weight: 0.5
    };

    const basedOnWindow = time_window === '30' ? '30d' : `${time_window}d`;
    const suggestions = [];

    // ==========================
    // CONFIDENCE_THRESHOLD LOGIC
    // ==========================
    if (requestedTypes.includes('confidence_threshold')) {
      /**
       * HEURISTIC: Adjust min_confidence based on win_rate_pct
       * - High win rate (>60%) → can potentially increase confidence threshold
       * - Low win rate (<45%) → should decrease confidence threshold to allow more trades
       * - Only generate suggestion if meaningful change (>5% difference from current)
       */
      const winRate = calibration.win_rate_pct / 100.0;
      const confidenceScore = Math.max(0.0, Math.min(1.0, winRate));
      
      // Don't generate if change is minimal
      if (Math.abs(confidenceScore - current.min_confidence) > 0.05) {
        const reason = `Based on ${calibration.sample_count} samples over ${basedOnWindow}: ` +
          `Win Rate ${calibration.win_rate_pct.toFixed(1)}%, ` +
          `Mean PnL ${calibration.mean_realized_pnl_pct?.toFixed(2) ?? 'N/A'}%, ` +
          `TP Hit ${calibration.tp_hit_rate_pct.toFixed(1)}%, ` +
          `SL Hit ${calibration.sl_hit_rate_pct.toFixed(1)}%`;

        suggestions.push({
          user_id, strategy_id, symbol, horizon,
          suggestion_type: 'confidence_threshold',
          current_value: current.min_confidence,
          suggested_value: null, // Will be filled by agent-v1
          expected_impact_pct: null,
          reason,
          confidence_score: confidenceScore,
          sample_size: calibration.sample_count,
          status: 'pending',
          based_on_window: basedOnWindow,
        });
        console.log('✅ Generated confidence_threshold suggestion');
      } else {
        console.log('⏭️ Skipping confidence_threshold - change too small');
      }
    }

    // ==========================
    // TP_PCT LOGIC
    // ==========================
    if (requestedTypes.includes('tp_pct')) {
      /**
       * HEURISTIC: Adjust take-profit percentage based on hit rate and PnL
       * - High TP hit rate (>70%) + positive mean PnL → can increase TP (capture more upside)
       * - Low TP hit rate (<40%) → should decrease TP (take profits earlier)
       * - Range: 0.5% to 5%
       * - Only generate if sample_count >= 5 and meaningful change (>0.2%)
       */
      if (calibration.sample_count >= 5) {
        const tpHitRate = calibration.tp_hit_rate_pct;
        const meanPnl = calibration.mean_realized_pnl_pct || 0;
        
        let suggestedTP = current.tp_pct;
        let shouldGenerate = false;
        
        if (tpHitRate > 70 && meanPnl > 0) {
          // High TP hit rate and positive PnL → increase TP by 10%
          suggestedTP = Math.min(5.0, current.tp_pct * 1.1);
          shouldGenerate = Math.abs(suggestedTP - current.tp_pct) > 0.2;
        } else if (tpHitRate < 40) {
          // Low TP hit rate → decrease TP by 10%
          suggestedTP = Math.max(0.5, current.tp_pct * 0.9);
          shouldGenerate = Math.abs(suggestedTP - current.tp_pct) > 0.2;
        }
        
        if (shouldGenerate) {
          const reason = `Based on ${calibration.sample_count} samples: TP Hit Rate ${tpHitRate.toFixed(1)}%, Mean PnL ${meanPnl.toFixed(2)}%. ` +
            `Adjusting TP from ${current.tp_pct.toFixed(2)}% to capture optimal profit-taking point.`;

          suggestions.push({
            user_id, strategy_id, symbol, horizon,
            suggestion_type: 'tp_pct',
            current_value: current.tp_pct,
            suggested_value: null,
            expected_impact_pct: null,
            reason,
            confidence_score: Math.min(1.0, calibration.sample_count / 20), // Higher confidence with more samples
            sample_size: calibration.sample_count,
            status: 'pending',
            based_on_window: basedOnWindow,
          });
          console.log('✅ Generated tp_pct suggestion');
        } else {
          console.log('⏭️ Skipping tp_pct - no significant adjustment needed');
        }
      } else {
        console.log('⏭️ Skipping tp_pct - insufficient samples');
      }
    }

    // ==========================
    // SL_PCT LOGIC
    // ==========================
    if (requestedTypes.includes('sl_pct')) {
      /**
       * HEURISTIC: Adjust stop-loss percentage based on hit rate and volatility
       * - Very high SL hit rate (>60%) → widen SL (getting stopped out too often)
       * - Low SL hit rate (<20%) but high missed opportunities → tighten SL (losses running too long)
       * - Range: 0.3% to 5%
       * - Only generate if sample_count >= 5 and meaningful change (>0.15%)
       */
      if (calibration.sample_count >= 5) {
        const slHitRate = calibration.sl_hit_rate_pct;
        const missedOpp = calibration.missed_opportunity_pct;
        
        let suggestedSL = current.sl_pct;
        let shouldGenerate = false;
        
        if (slHitRate > 60) {
          // Too many SL hits → widen by 15%
          suggestedSL = Math.min(5.0, current.sl_pct * 1.15);
          shouldGenerate = Math.abs(suggestedSL - current.sl_pct) > 0.15;
        } else if (slHitRate < 20 && missedOpp > 30) {
          // SL rarely hit but missing opportunities → tighten by 10%
          suggestedSL = Math.max(0.3, current.sl_pct * 0.9);
          shouldGenerate = Math.abs(suggestedSL - current.sl_pct) > 0.15;
        }
        
        if (shouldGenerate) {
          const reason = `Based on ${calibration.sample_count} samples: SL Hit Rate ${slHitRate.toFixed(1)}%, Missed Opportunities ${missedOpp.toFixed(1)}%. ` +
            `Adjusting SL from ${current.sl_pct.toFixed(2)}% to better manage risk.`;

          suggestions.push({
            user_id, strategy_id, symbol, horizon,
            suggestion_type: 'sl_pct',
            current_value: current.sl_pct,
            suggested_value: null,
            expected_impact_pct: null,
            reason,
            confidence_score: Math.min(1.0, calibration.sample_count / 20),
            sample_size: calibration.sample_count,
            status: 'pending',
            based_on_window: basedOnWindow,
          });
          console.log('✅ Generated sl_pct suggestion');
        } else {
          console.log('⏭️ Skipping sl_pct - no significant adjustment needed');
        }
      } else {
        console.log('⏭️ Skipping sl_pct - insufficient samples');
      }
    }

    // ==========================
    // TECHNICAL_WEIGHT / AI_WEIGHT LOGIC
    // ==========================
    if (requestedTypes.includes('technical_weight') || requestedTypes.includes('ai_weight')) {
      /**
       * HEURISTIC: Rebalance weights based on overall performance
       * - High win rate (>55%) + positive PnL → slightly increase ai_weight
       * - Low win rate (<45%) or negative PnL → slightly decrease ai_weight, increase technical_weight
       * - Always maintain technical_weight + ai_weight = 1.0
       * - Only generate if sample_count >= 20 (need more data for weight adjustments)
       * - Minimum change: 0.05 (5%)
       */
      if (calibration.sample_count >= 20) {
        const winRate = calibration.win_rate_pct;
        const meanPnl = calibration.mean_realized_pnl_pct || 0;
        
        let newAiWeight = current.ai_weight;
        let shouldGenerate = false;
        
        if (winRate > 55 && meanPnl > 0) {
          // Good performance → increase AI influence by 5%
          newAiWeight = Math.min(0.8, current.ai_weight + 0.05);
          shouldGenerate = Math.abs(newAiWeight - current.ai_weight) >= 0.05;
        } else if (winRate < 45 || meanPnl < -0.5) {
          // Poor performance → decrease AI influence by 5%
          newAiWeight = Math.max(0.2, current.ai_weight - 0.05);
          shouldGenerate = Math.abs(newAiWeight - current.ai_weight) >= 0.05;
        }
        
        if (shouldGenerate) {
          const newTechWeight = 1.0 - newAiWeight;
          
          const reason = `Based on ${calibration.sample_count} samples: Win Rate ${winRate.toFixed(1)}%, Mean PnL ${meanPnl.toFixed(2)}%. ` +
            `Rebalancing weights to optimize signal quality. Current: AI ${(current.ai_weight * 100).toFixed(0)}% / Tech ${(current.technical_weight * 100).toFixed(0)}%`;

          // Generate both weight suggestions together (they must sum to 1.0)
          if (requestedTypes.includes('ai_weight')) {
            suggestions.push({
              user_id, strategy_id, symbol, horizon,
              suggestion_type: 'ai_weight',
              current_value: current.ai_weight,
              suggested_value: null,
              expected_impact_pct: null,
              reason: reason + ` → AI ${(newAiWeight * 100).toFixed(0)}%`,
              confidence_score: Math.min(1.0, calibration.sample_count / 50),
              sample_size: calibration.sample_count,
              status: 'pending',
              based_on_window: basedOnWindow,
            });
            console.log('✅ Generated ai_weight suggestion');
          }
          
          if (requestedTypes.includes('technical_weight')) {
            suggestions.push({
              user_id, strategy_id, symbol, horizon,
              suggestion_type: 'technical_weight',
              current_value: current.technical_weight,
              suggested_value: null,
              expected_impact_pct: null,
              reason: reason + ` → Tech ${(newTechWeight * 100).toFixed(0)}%`,
              confidence_score: Math.min(1.0, calibration.sample_count / 50),
              sample_size: calibration.sample_count,
              status: 'pending',
              based_on_window: basedOnWindow,
            });
            console.log('✅ Generated technical_weight suggestion');
          }
        } else {
          console.log('⏭️ Skipping weight adjustments - no significant change needed');
        }
      } else {
        console.log('⏭️ Skipping weight adjustments - insufficient samples (need >= 20)');
      }
    }

    // Insert all suggestions
    if (suggestions.length === 0) {
      console.log('⚠️ No suggestions generated - no meaningful adjustments needed');
      return new Response(
        JSON.stringify({ ok: false, reason: 'no_suggestions_generated', details: 'No meaningful adjustments needed based on current metrics' }), 
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📝 Inserting ${suggestions.length} suggestions`);
    const { data: insertedSuggestions, error: insertError } = await supabase
      .from('calibration_suggestions')
      .insert(suggestions)
      .select();

    if (insertError) {
      console.error('❌ Error inserting suggestions:', insertError);
      return new Response(
        JSON.stringify({ ok: false, reason: 'suggestion_insert_error', error: insertError.message }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Created ${insertedSuggestions.length} suggestions`);

    return new Response(
      JSON.stringify({ ok: true, suggestions: insertedSuggestions }), 
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return new Response(
      JSON.stringify({ ok: false, reason: 'unexpected_error', error: error.message }), 
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
