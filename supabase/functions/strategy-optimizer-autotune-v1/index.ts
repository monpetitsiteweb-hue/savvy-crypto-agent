import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestInput {
  suggestion_id: string;
}

interface CalibrationSuggestion {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  horizon: string;
  suggestion_type: string;
  suggested_value: number | null;
  expected_impact_pct: number | null;
  reason: string;
  confidence_score: number;
  sample_size: number;
  status: string;
  applied_by: string | null;
  applied_at: string | null;
  dismissed_by: string | null;
  dismissed_at: string | null;
  based_on_window: string;
  created_at: string;
  updated_at: string;
}

interface StrategyParameter {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  tp_pct: number;
  sl_pct: number;
  min_confidence: number;
  technical_weight: number;
  ai_weight: number;
  last_updated_by: string;
  last_optimizer_run_at: string | null;
  optimization_iteration: number;
  metadata: any;
  created_at: string;
  updated_at: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    // Initialize Supabase client with service role
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

    // Parse input
    const input: RequestInput = await req.json();
    console.log('📥 AUTOTUNE-V1: Received input:', JSON.stringify(input));

    const { suggestion_id } = input;

    if (!suggestion_id) {
      console.error('❌ Missing suggestion_id');
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'missing_suggestion_id' 
        }), 
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Step 1: Fetch the calibration_suggestions row
    console.log(`🔍 Fetching suggestion: ${suggestion_id}`);
    
    const { data: suggestion, error: fetchError } = await supabase
      .from('calibration_suggestions')
      .select('*')
      .eq('id', suggestion_id)
      .single();

    if (fetchError || !suggestion) {
      console.error('❌ Suggestion not found:', fetchError);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'suggestion_not_found' 
        }), 
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`✅ Found suggestion: symbol=${suggestion.symbol}, type=${suggestion.suggestion_type}, status=${suggestion.status}`);

    // Step 2: Validate suggestion eligibility
    const validationDetails: any = {};
    let isEligible = true;

    if (suggestion.suggestion_type !== 'confidence_threshold') {
      validationDetails.suggestion_type = `Expected 'confidence_threshold', got '${suggestion.suggestion_type}'`;
      isEligible = false;
    }

    if (suggestion.status !== 'pending') {
      validationDetails.status = `Expected 'pending', got '${suggestion.status}'`;
      isEligible = false;
    }

    if (suggestion.suggested_value === null || suggestion.suggested_value === undefined) {
      validationDetails.suggested_value = 'Must not be NULL';
      isEligible = false;
    }

    if (suggestion.confidence_score < 0.7) {
      validationDetails.confidence_score = `Must be >= 0.7, got ${suggestion.confidence_score}`;
      isEligible = false;
    }

    if (suggestion.sample_size < 3) {
      validationDetails.sample_size = `Must be >= 3, got ${suggestion.sample_size}`;
      isEligible = false;
    }

    if (!isEligible) {
      console.warn('⚠️ Suggestion not eligible for autotune:', validationDetails);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'not_eligible_for_autotune',
          details: validationDetails
        }), 
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('✅ Suggestion is eligible for autotune');

    // Step 3: Get or create strategy_parameters row
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
        JSON.stringify({ 
          ok: false, 
          reason: 'db_error_fetching_params',
          error: paramsError.message 
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    let strategyParams: StrategyParameter;

    if (!existingParams || existingParams.length === 0) {
      // Case 1: Create new row with defaults
      console.log('📝 No existing strategy_parameters found, creating new row with defaults');
      
      const { data: newParams, error: insertError } = await supabase
        .from('strategy_parameters')
        .insert({
          user_id: suggestion.user_id,
          strategy_id: suggestion.strategy_id,
          symbol: suggestion.symbol,
          // Let Postgres fill defaults for other fields
        })
        .select()
        .single();

      if (insertError || !newParams) {
        console.error('❌ Error creating strategy_parameters:', insertError);
        return new Response(
          JSON.stringify({ 
            ok: false, 
            reason: 'db_error_creating_params',
            error: insertError?.message 
          }), 
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      strategyParams = newParams;
      console.log('✅ Created new strategy_parameters row');
    } else if (existingParams.length === 1) {
      // Case 2: Use existing row
      strategyParams = existingParams[0];
      console.log(`✅ Found existing strategy_parameters: id=${strategyParams.id}, current min_confidence=${strategyParams.min_confidence}`);
    } else {
      // Case 3: Multiple rows (should not happen with unique constraint)
      console.error('❌ Multiple strategy_parameters rows found');
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'multiple_strategy_parameters_rows',
          count: existingParams.length
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Step 4: Apply new min_confidence
    const oldMinConfidence = strategyParams.min_confidence;
    let newMinConfidence = suggestion.suggested_value!;
    
    // Clamp to [0.0, 1.0] for safety
    if (newMinConfidence < 0.0) newMinConfidence = 0.0;
    if (newMinConfidence > 1.0) newMinConfidence = 1.0;

    console.log(`🔧 Applying update: min_confidence ${oldMinConfidence} → ${newMinConfidence}`);

    // Build optimizer history entry
    const historyEntry = {
      old: oldMinConfidence,
      new: newMinConfidence,
      suggestion_id: suggestion.id,
      expected_impact: suggestion.expected_impact_pct,
      timestamp: new Date().toISOString(),
    };

    // Get existing optimizer_history or initialize empty array
    const existingHistory = strategyParams.metadata?.optimizer_history || [];
    const newHistory = [...existingHistory, historyEntry];

    // Update strategy_parameters
    const { data: updatedParams, error: updateError } = await supabase
      .from('strategy_parameters')
      .update({
        min_confidence: newMinConfidence,
        last_updated_by: 'optimizer-v3',
        last_optimizer_run_at: new Date().toISOString(),
        optimization_iteration: strategyParams.optimization_iteration + 1,
        metadata: {
          ...strategyParams.metadata,
          optimizer_history: newHistory,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', strategyParams.id)
      .select()
      .single();

    if (updateError || !updatedParams) {
      console.error('❌ Error updating strategy_parameters:', updateError);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'db_error_updating_params',
          error: updateError?.message 
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`✅ Updated strategy_parameters: iteration=${updatedParams.optimization_iteration}`);

    // Step 5: Mark suggestion as applied
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
        JSON.stringify({ 
          ok: false, 
          reason: 'db_error_marking_applied',
          error: appliedError?.message 
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`✅ Suggestion marked as applied: id=${updatedSuggestion.id}, applied_at=${updatedSuggestion.applied_at}`);

    // Return success
    return new Response(
      JSON.stringify({ 
        ok: true, 
        suggestion: updatedSuggestion,
        strategy_parameters: updatedParams
      }), 
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return new Response(
      JSON.stringify({ 
        ok: false, 
        reason: 'unexpected_error',
        error: error.message 
      }), 
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
