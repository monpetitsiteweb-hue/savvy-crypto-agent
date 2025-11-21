import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestInput {
  suggestion_id: string;
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
    const input: RequestInput = await req.json();
    console.log('📥 AUTOTUNE-V2: Received input:', JSON.stringify(input));

    const { suggestion_id } = input;

    if (!suggestion_id) {
      console.error('❌ Missing suggestion_id');
      return new Response(
        JSON.stringify({ ok: false, reason: 'missing_suggestion_id' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch suggestion
    console.log(`🔍 Fetching suggestion: ${suggestion_id}`);
    const { data: suggestion, error: fetchError } = await supabase
      .from('calibration_suggestions')
      .select('*')
      .eq('id', suggestion_id)
      .single();

    if (fetchError || !suggestion) {
      console.error('❌ Suggestion not found:', fetchError);
      return new Response(
        JSON.stringify({ ok: false, reason: 'suggestion_not_found' }), 
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Found suggestion: symbol=${suggestion.symbol}, type=${suggestion.suggestion_type}, status=${suggestion.status}`);

    // Map suggestion_type to strategy_parameters column
    let parameterColumn: string;
    let parameterName: string;
    
    switch (suggestion.suggestion_type) {
      case 'confidence_threshold':
        parameterColumn = 'min_confidence';
        parameterName = 'min_confidence';
        break;
      case 'tp_pct':
        parameterColumn = 'tp_pct';
        parameterName = 'tp_pct';
        break;
      case 'sl_pct':
        parameterColumn = 'sl_pct';
        parameterName = 'sl_pct';
        break;
      case 'technical_weight':
        parameterColumn = 'technical_weight';
        parameterName = 'technical_weight';
        break;
      case 'ai_weight':
        parameterColumn = 'ai_weight';
        parameterName = 'ai_weight';
        break;
      default:
        console.error(`❌ Unsupported suggestion_type: ${suggestion.suggestion_type}`);
        return new Response(
          JSON.stringify({ 
            ok: false, 
            reason: 'not_eligible_for_autotune',
            details: { suggestion_type: `Unsupported type '${suggestion.suggestion_type}'` }
          }), 
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    // Type-specific validation
    const validationDetails: any = {};
    let isEligible = true;

    if (suggestion.status !== 'pending') {
      validationDetails.status = `Expected 'pending', got '${suggestion.status}'`;
      isEligible = false;
    }

    if (suggestion.suggested_value === null || suggestion.suggested_value === undefined) {
      validationDetails.suggested_value = 'Must not be NULL';
      isEligible = false;
    }

    /**
     * TYPE-SPECIFIC GUARDRAILS
     */
    switch (suggestion.suggestion_type) {
      case 'confidence_threshold':
        // min_confidence: sample_size >= 3, 0.3 <= value <= 0.9, confidence_score >= 0.7
        if (suggestion.sample_size < 3) {
          validationDetails.sample_size = `confidence_threshold requires >= 3 samples, got ${suggestion.sample_size}`;
          isEligible = false;
        }
        if (suggestion.confidence_score < 0.7) {
          validationDetails.confidence_score = `confidence_threshold requires >= 0.7, got ${suggestion.confidence_score}`;
          isEligible = false;
        }
        if (suggestion.suggested_value !== null && (suggestion.suggested_value < 0.3 || suggestion.suggested_value > 0.9)) {
          validationDetails.suggested_value_range = `confidence_threshold must be in [0.3, 0.9], got ${suggestion.suggested_value}`;
          isEligible = false;
        }
        break;

      case 'tp_pct':
        // tp_pct: sample_size >= 5, 0.5% <= value <= 5%
        if (suggestion.sample_size < 5) {
          validationDetails.sample_size = `tp_pct requires >= 5 samples, got ${suggestion.sample_size}`;
          isEligible = false;
        }
        if (suggestion.suggested_value !== null && (suggestion.suggested_value < 0.5 || suggestion.suggested_value > 5.0)) {
          validationDetails.suggested_value_range = `tp_pct must be in [0.5, 5.0], got ${suggestion.suggested_value}`;
          isEligible = false;
        }
        break;

      case 'sl_pct':
        // sl_pct: sample_size >= 5, 0.3% <= value <= 5%
        if (suggestion.sample_size < 5) {
          validationDetails.sample_size = `sl_pct requires >= 5 samples, got ${suggestion.sample_size}`;
          isEligible = false;
        }
        if (suggestion.suggested_value !== null && (suggestion.suggested_value < 0.3 || suggestion.suggested_value > 5.0)) {
          validationDetails.suggested_value_range = `sl_pct must be in [0.3, 5.0], got ${suggestion.suggested_value}`;
          isEligible = false;
        }
        break;

      case 'technical_weight':
      case 'ai_weight':
        // weights: sample_size >= 20, 0 <= value <= 1
        if (suggestion.sample_size < 20) {
          validationDetails.sample_size = `${suggestion.suggestion_type} requires >= 20 samples, got ${suggestion.sample_size}`;
          isEligible = false;
        }
        if (suggestion.suggested_value !== null && (suggestion.suggested_value < 0.0 || suggestion.suggested_value > 1.0)) {
          validationDetails.suggested_value_range = `${suggestion.suggestion_type} must be in [0.0, 1.0], got ${suggestion.suggested_value}`;
          isEligible = false;
        }
        break;
    }

    if (!isEligible) {
      console.warn('⚠️ Suggestion not eligible for autotune:', validationDetails);
      // DO NOT change status - leave as 'pending' for manual review
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'not_eligible_for_autotune',
          details: validationDetails
        }), 
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Suggestion is eligible for autotune');

    // Get or create strategy_parameters row
    console.log(`🔍 Fetching strategy_parameters for user=${suggestion.user_id}, strategy=${suggestion.strategy_id}, symbol=${suggestion.symbol}`);
    
    const { data: existingParams, error: paramsError } = await supabase
      .from('strategy_parameters')
      .select('*')
      .eq('user_id', suggestion.user_id)
      .eq('strategy_id', suggestion.strategy_id)
      .eq('symbol', suggestion.symbol);

    if (paramsError) {
      console.error('❌ Error fetching strategy_parameters:', paramsError);
      return new Response(
        JSON.stringify({ ok: false, reason: 'db_error_fetching_params', error: paramsError.message }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let strategyParams: any;

    if (!existingParams || existingParams.length === 0) {
      console.log('📝 Creating new strategy_parameters row with defaults');
      const { data: newParams, error: insertError } = await supabase
        .from('strategy_parameters')
        .insert({
          user_id: suggestion.user_id,
          strategy_id: suggestion.strategy_id,
          symbol: suggestion.symbol,
        })
        .select()
        .single();

      if (insertError || !newParams) {
        console.error('❌ Error creating strategy_parameters:', insertError);
        return new Response(
          JSON.stringify({ ok: false, reason: 'db_error_creating_params', error: insertError?.message }), 
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      strategyParams = newParams;
      console.log('✅ Created new strategy_parameters row');
    } else if (existingParams.length === 1) {
      strategyParams = existingParams[0];
      console.log(`✅ Found existing strategy_parameters: id=${strategyParams.id}, current ${parameterColumn}=${strategyParams[parameterColumn]}`);
    } else {
      console.error('❌ Multiple strategy_parameters rows found');
      return new Response(
        JSON.stringify({ ok: false, reason: 'multiple_strategy_parameters_rows', count: existingParams.length }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Apply update
    const oldValue = strategyParams[parameterColumn];
    let newValue = suggestion.suggested_value!;
    
    // Final safety clamp based on type
    switch (suggestion.suggestion_type) {
      case 'confidence_threshold':
        newValue = Math.max(0.0, Math.min(1.0, newValue));
        break;
      case 'tp_pct':
        newValue = Math.max(0.5, Math.min(5.0, newValue));
        break;
      case 'sl_pct':
        newValue = Math.max(0.3, Math.min(5.0, newValue));
        break;
      case 'technical_weight':
      case 'ai_weight':
        newValue = Math.max(0.0, Math.min(1.0, newValue));
        break;
    }

    console.log(`🔧 Applying update: ${parameterColumn} ${oldValue} → ${newValue}`);

    // Build history entry
    const historyEntry = {
      parameter: parameterName,
      old: oldValue,
      new: newValue,
      suggestion_id: suggestion.id,
      expected_impact: suggestion.expected_impact_pct,
      timestamp: new Date().toISOString(),
      horizon: suggestion.horizon,
    };

    const existingHistory = strategyParams.metadata?.optimizer_history || [];
    const newHistory = [...existingHistory, historyEntry];

    // Update strategy_parameters
    const updatePayload: any = {
      [parameterColumn]: newValue,
      last_updated_by: 'optimizer-v3',
      last_optimizer_run_at: new Date().toISOString(),
      optimization_iteration: strategyParams.optimization_iteration + 1,
      metadata: {
        ...strategyParams.metadata,
        optimizer_history: newHistory,
      },
      updated_at: new Date().toISOString(),
    };

    const { data: updatedParams, error: updateError } = await supabase
      .from('strategy_parameters')
      .update(updatePayload)
      .eq('id', strategyParams.id)
      .select()
      .single();

    if (updateError || !updatedParams) {
      console.error('❌ Error updating strategy_parameters:', updateError);
      return new Response(
        JSON.stringify({ ok: false, reason: 'db_error_updating_params', error: updateError?.message }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Updated strategy_parameters: iteration=${updatedParams.optimization_iteration}`);

    // Mark suggestion as applied
    console.log('📝 Marking suggestion as applied');
    const { data: updatedSuggestion, error: appliedError } = await supabase
      .from('calibration_suggestions')
      .update({
        status: 'applied',
        applied_at: new Date().toISOString(),
        applied_by: suggestion.user_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', suggestion_id)
      .select()
      .single();

    if (appliedError || !updatedSuggestion) {
      console.error('❌ Error marking suggestion as applied:', appliedError);
      return new Response(
        JSON.stringify({ ok: false, reason: 'db_error_marking_applied', error: appliedError?.message }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Suggestion marked as applied: id=${updatedSuggestion.id}`);

    return new Response(
      JSON.stringify({ ok: true, suggestion: updatedSuggestion, strategy_parameters: updatedParams }), 
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
