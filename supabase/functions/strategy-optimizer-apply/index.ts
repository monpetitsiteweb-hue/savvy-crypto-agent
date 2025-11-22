import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase configuration');
    }

    // Create client with anon key and forward Authorization header for RLS
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Parse request body
    const body = await req.json();
    const { suggestion_id, action = 'apply' } = body;

    if (!suggestion_id || typeof suggestion_id !== 'string') {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid or missing suggestion_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action !== 'apply' && action !== 'dismiss') {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid action, must be "apply" or "dismiss"' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`🔧 STRATEGY OPTIMIZER APPLY: User ${user.id}, action=${action}, suggestion=${suggestion_id}`);

    // Load the suggestion (RLS will enforce user ownership)
    const { data: suggestion, error: suggestionError } = await supabase
      .from('calibration_suggestions')
      .select('*')
      .eq('id', suggestion_id)
      .eq('status', 'pending')
      .maybeSingle();

    if (suggestionError) {
      console.error('Error fetching suggestion:', suggestionError);
      return new Response(JSON.stringify({ ok: false, error: 'Failed to fetch suggestion' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!suggestion) {
      return new Response(JSON.stringify({ ok: false, error: 'Suggestion not found or not pending' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Handle dismiss action
    if (action === 'dismiss') {
      const { data: updatedSuggestion, error: updateError } = await supabase
        .from('calibration_suggestions')
        .update({
          status: 'dismissed',
          dismissed_by: user.id,
          dismissed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', suggestion_id)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating suggestion:', updateError);
        return new Response(JSON.stringify({ ok: false, error: 'Failed to dismiss suggestion' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      console.log(`✅ Dismissed suggestion ${suggestion_id}`);

      return new Response(JSON.stringify({
        ok: true,
        action: 'dismiss',
        updated_suggestion: updatedSuggestion,
        updated_parameters: null,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Handle apply action - determine column mapping and parameter name
    let columnName: string | null = null;
    let parameterName: string | null = null;
    
    switch (suggestion.suggestion_type) {
      case 'confidence_threshold':
        columnName = 'min_confidence';
        parameterName = 'min_confidence';
        break;
      case 'tp_adjustment':
        columnName = 'tp_pct';
        parameterName = 'tp_pct';
        break;
      case 'sl_adjustment':
        columnName = 'sl_pct';
        parameterName = 'sl_pct';
        break;
      case 'hold_period':
      case 'cooldown':
        return new Response(JSON.stringify({ 
          ok: false, 
          error: `unsupported suggestion_type for apply: ${suggestion.suggestion_type}` 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      default:
        return new Response(JSON.stringify({ 
          ok: false, 
          error: `unknown suggestion_type: ${suggestion.suggestion_type}` 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // First, load the existing strategy_parameters row to get the old value
    const { data: existingParams, error: fetchError } = await supabase
      .from('strategy_parameters')
      .select('*')
      .eq('user_id', suggestion.user_id)
      .eq('strategy_id', suggestion.strategy_id)
      .eq('symbol', suggestion.symbol)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching strategy_parameters:', fetchError);
      return new Response(JSON.stringify({ ok: false, error: 'Failed to fetch strategy parameters' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!existingParams) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'no_strategy_parameters_row' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get the old value
    const oldValue = existingParams[columnName];

    // Build the new optimizer_history entry
    const newHistoryEntry = {
      parameter: parameterName,
      old: oldValue,
      new: suggestion.suggested_value,
      horizon: suggestion.horizon,
      timestamp: new Date().toISOString(),
      suggestion_id: suggestion.id,
      expected_impact: suggestion.expected_impact_pct ?? null,
    };

    // Update metadata with new history entry
    const currentMetadata = existingParams.metadata || {};
    const optimizerHistory = currentMetadata.optimizer_history || [];
    const updatedMetadata = {
      ...currentMetadata,
      optimizer_history: [...optimizerHistory, newHistoryEntry],
    };

    // Update strategy_parameters with new value and metadata
    const updatePayload: any = {
      [columnName]: suggestion.suggested_value,
      metadata: updatedMetadata,
      last_updated_by: 'optimizer-v3',
      updated_at: new Date().toISOString(),
    };

    const { data: updatedParams, error: paramsError } = await supabase
      .from('strategy_parameters')
      .update(updatePayload)
      .eq('user_id', suggestion.user_id)
      .eq('strategy_id', suggestion.strategy_id)
      .eq('symbol', suggestion.symbol)
      .select()
      .maybeSingle();

    if (paramsError) {
      console.error('Error updating strategy_parameters:', paramsError);
      return new Response(JSON.stringify({ ok: false, error: 'Failed to update strategy parameters' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!updatedParams) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'Failed to update strategy_parameters' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update suggestion status
    const { data: updatedSuggestion, error: updateError } = await supabase
      .from('calibration_suggestions')
      .update({
        status: 'applied',
        applied_by: user.id,
        applied_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', suggestion_id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating suggestion:', updateError);
      return new Response(JSON.stringify({ ok: false, error: 'Failed to update suggestion status' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`✅ Applied suggestion ${suggestion_id}: ${columnName} ${oldValue} → ${suggestion.suggested_value}`);

    return new Response(JSON.stringify({
      ok: true,
      action: 'apply',
      updated_suggestion: updatedSuggestion,
      updated_parameters: updatedParams,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ STRATEGY OPTIMIZER APPLY ERROR:', error);
    return new Response(JSON.stringify({ 
      ok: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
