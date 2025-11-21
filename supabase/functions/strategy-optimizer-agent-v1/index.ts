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
  current_value: number | null;
  suggested_value: number | null;
  expected_impact_pct: number | null;
  reason: string;
  confidence_score: number;
  sample_size: number;
  status: string;
  based_on_window: string;
  created_at: string;
  updated_at: string;
}

interface CalibrationMetric {
  win_rate_pct: number;
  mean_realized_pnl_pct: number | null;
  tp_hit_rate_pct: number;
  sl_hit_rate_pct: number;
  sample_count: number;
}

interface OpenAIResponse {
  suggested_confidence_threshold: number;
  expected_impact_pct: number;
  explanation: string;
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
    console.log('📥 AGENT-V1: Received input:', JSON.stringify(input));

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

    console.log(`✅ Found suggestion: symbol=${suggestion.symbol}, horizon=${suggestion.horizon}, type=${suggestion.suggestion_type}`);

    // Step 2: Validate suggestion_type
    if (suggestion.suggestion_type !== 'confidence_threshold') {
      console.warn(`⚠️ Unsupported suggestion_type: ${suggestion.suggestion_type}`);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'unsupported_suggestion_type',
          suggestion_type: suggestion.suggestion_type
        }), 
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Step 3: Optionally fetch matching calibration_metrics for context
    console.log(`🔍 Fetching calibration metrics for context: user=${suggestion.user_id}, strategy=${suggestion.strategy_id}, symbol=${suggestion.symbol}, horizon=${suggestion.horizon}`);
    
    // Extract time_window from based_on_window (e.g., '30d' -> '30')
    const timeWindow = suggestion.based_on_window.replace(/[^0-9]/g, '') || '30';
    
    const { data: metricsRows, error: metricsError } = await supabase
      .from('calibration_metrics')
      .select('win_rate_pct, mean_realized_pnl_pct, tp_hit_rate_pct, sl_hit_rate_pct, sample_count')
      .eq('user_id', suggestion.user_id)
      .eq('strategy_id', suggestion.strategy_id)
      .eq('symbol', suggestion.symbol)
      .eq('horizon', suggestion.horizon)
      .eq('time_window', timeWindow)
      .order('window_end_ts', { ascending: false })
      .limit(1);

    const metrics: CalibrationMetric | null = metricsRows && metricsRows.length > 0 ? metricsRows[0] : null;

    if (metrics) {
      console.log(`✅ Found calibration metrics: win_rate=${metrics.win_rate_pct}%, mean_pnl=${metrics.mean_realized_pnl_pct}%, samples=${metrics.sample_count}`);
    } else {
      console.log('⚠️ No calibration metrics found for context');
    }

    // Step 4: Build OpenAI prompt
    const metricsContext = metrics
      ? `Based on ${metrics.sample_count} samples:
- Win Rate: ${metrics.win_rate_pct.toFixed(1)}%
- Mean Realized PnL: ${metrics.mean_realized_pnl_pct !== null ? metrics.mean_realized_pnl_pct.toFixed(2) : 'N/A'}%
- TP Hit Rate: ${metrics.tp_hit_rate_pct.toFixed(1)}%
- SL Hit Rate: ${metrics.sl_hit_rate_pct.toFixed(1)}%`
      : 'No detailed calibration metrics available.';

    const prompt = `You are an AI strategy advisor for a crypto trading engine. 

A calibration system has analyzed trading decisions for ${suggestion.symbol} (${suggestion.horizon} horizon) and generated the following summary:

${suggestion.reason}

${metricsContext}

Current confidence score: ${suggestion.confidence_score.toFixed(2)}
Sample size: ${suggestion.sample_size}

Based on this data, suggest:
1. A new confidence threshold (between 0.50 and 0.95) that would optimize performance
2. The expected impact on mean PnL % (can be negative, zero, or positive)
3. A brief explanation of your reasoning

Respond ONLY with valid JSON in this exact format (no markdown, no comments):
{
  "suggested_confidence_threshold": 0.65,
  "expected_impact_pct": 2.5,
  "explanation": "Your reasoning here"
}`;

    console.log('🤖 Calling OpenAI with prompt length:', prompt.length);

    // Step 5: Call OpenAI
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      console.error('❌ OPENAI_API_KEY not configured');
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'openai_api_key_not_configured' 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let aiResponse: OpenAIResponse;
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a precise AI trading advisor. Always respond with valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 300,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ OpenAI API error:', response.status, errorText);
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      console.log('📥 OpenAI raw response:', content);

      // Parse with defensive fallbacks
      try {
        aiResponse = JSON.parse(content);
      } catch (parseError) {
        console.warn('⚠️ Failed to parse OpenAI response, using defaults:', parseError);
        aiResponse = {
          suggested_confidence_threshold: 0.60,
          expected_impact_pct: 0,
          explanation: 'AI analysis unavailable - using safe default threshold'
        };
      }
    } catch (error) {
      console.error('❌ OpenAI call failed:', error);
      // Use safe defaults
      aiResponse = {
        suggested_confidence_threshold: 0.60,
        expected_impact_pct: 0,
        explanation: 'AI analysis failed - using safe default threshold'
      };
    }

    console.log('🎯 Parsed AI response:', JSON.stringify(aiResponse));

    // Step 6: Clamp and validate values
    let suggestedValue = aiResponse.suggested_confidence_threshold;
    
    // Clamp to [0.0, 1.0]
    if (suggestedValue < 0.0) suggestedValue = 0.0;
    if (suggestedValue > 1.0) suggestedValue = 1.0;

    const expectedImpact = aiResponse.expected_impact_pct || 0;
    const explanation = aiResponse.explanation || 'No explanation provided';

    // Step 7: Append AI explanation to existing reason
    const updatedReason = `${suggestion.reason} | AI: ${explanation}`;

    console.log(`💾 Updating suggestion with: suggested_value=${suggestedValue}, expected_impact=${expectedImpact}`);

    // Step 8: Update the calibration_suggestions row
    const { data: updatedSuggestion, error: updateError } = await supabase
      .from('calibration_suggestions')
      .update({
        suggested_value: suggestedValue,
        expected_impact_pct: expectedImpact,
        reason: updatedReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', suggestion_id)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Error updating suggestion:', updateError);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reason: 'update_failed',
          error: updateError.message 
        }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`✅ Suggestion updated successfully: id=${updatedSuggestion.id}`);

    return new Response(
      JSON.stringify({ 
        ok: true, 
        suggestion: updatedSuggestion 
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
