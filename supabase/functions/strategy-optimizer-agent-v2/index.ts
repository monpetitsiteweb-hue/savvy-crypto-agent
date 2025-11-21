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
    console.log('📥 AGENT-V2: Received input:', JSON.stringify(input));

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

    console.log(`✅ Found suggestion: symbol=${suggestion.symbol}, type=${suggestion.suggestion_type}`);

    // Fetch calibration metrics for context
    const timeWindow = suggestion.based_on_window.replace(/[^0-9]/g, '') || '30';
    const { data: metricsRows } = await supabase
      .from('calibration_metrics')
      .select('*')
      .eq('user_id', suggestion.user_id)
      .eq('strategy_id', suggestion.strategy_id)
      .eq('symbol', suggestion.symbol)
      .eq('horizon', suggestion.horizon)
      .eq('time_window', timeWindow)
      .order('window_end_ts', { ascending: false })
      .limit(1);

    const metrics = metricsRows && metricsRows.length > 0 ? metricsRows[0] : null;

    // Build context for OpenAI based on suggestion_type
    let prompt = '';
    let expectedResponseFormat = '';

    const metricsContext = metrics
      ? `Based on ${metrics.sample_count} samples:
- Win Rate: ${metrics.win_rate_pct.toFixed(1)}%
- Mean Realized PnL: ${metrics.mean_realized_pnl_pct !== null ? metrics.mean_realized_pnl_pct.toFixed(2) : 'N/A'}%
- TP Hit Rate: ${metrics.tp_hit_rate_pct.toFixed(1)}%
- SL Hit Rate: ${metrics.sl_hit_rate_pct.toFixed(1)}%
- Missed Opportunities: ${metrics.missed_opportunity_pct.toFixed(1)}%`
      : 'No detailed calibration metrics available.';

    switch (suggestion.suggestion_type) {
      case 'confidence_threshold':
        prompt = `You are an AI strategy advisor for a crypto trading engine.

A calibration system analyzed trading decisions for ${suggestion.symbol} (${suggestion.horizon} horizon):

${suggestion.reason}

${metricsContext}

Current confidence score: ${suggestion.confidence_score.toFixed(2)}
Sample size: ${suggestion.sample_size}

Suggest a new confidence threshold (between 0.50 and 0.95) to optimize performance.

Respond ONLY with valid JSON:`;
        expectedResponseFormat = `{
  "suggested_confidence_threshold": 0.65,
  "expected_impact_pct": 2.5,
  "explanation": "Your reasoning here"
}`;
        break;

      case 'tp_pct':
        prompt = `You are an AI strategy advisor for a crypto trading engine.

A calibration system analyzed take-profit performance for ${suggestion.symbol} (${suggestion.horizon} horizon):

${suggestion.reason}

${metricsContext}

Current TP: ${suggestion.current_value?.toFixed(2)}%

Suggest a new take-profit percentage (between 0.5% and 5.0%) to optimize risk/return.
Consider: TP hit rate, mean PnL, and market conditions.

Respond ONLY with valid JSON:`;
        expectedResponseFormat = `{
  "suggested_tp_pct": 1.8,
  "expected_impact_pct": 1.2,
  "explanation": "Your reasoning here"
}`;
        break;

      case 'sl_pct':
        prompt = `You are an AI strategy advisor for a crypto trading engine.

A calibration system analyzed stop-loss performance for ${suggestion.symbol} (${suggestion.horizon} horizon):

${suggestion.reason}

${metricsContext}

Current SL: ${suggestion.current_value?.toFixed(2)}%

Suggest a new stop-loss percentage (between 0.3% and 5.0%) to optimize risk management.
Consider: SL hit rate, missed opportunities, and volatility.

Respond ONLY with valid JSON:`;
        expectedResponseFormat = `{
  "suggested_sl_pct": 1.2,
  "expected_impact_pct": -0.5,
  "explanation": "Your reasoning here"
}`;
        break;

      case 'technical_weight':
        prompt = `You are an AI strategy advisor for a crypto trading engine.

A calibration system analyzed signal performance for ${suggestion.symbol} (${suggestion.horizon} horizon):

${suggestion.reason}

${metricsContext}

Current Technical Weight: ${((suggestion.current_value || 0.5) * 100).toFixed(0)}%

Suggest a new technical weight (between 0.2 and 0.8) to optimize signal quality.
Remember: technical_weight + ai_weight must equal 1.0.

Respond ONLY with valid JSON:`;
        expectedResponseFormat = `{
  "suggested_technical_weight": 0.55,
  "expected_impact_pct": 0.8,
  "explanation": "Your reasoning here"
}`;
        break;

      case 'ai_weight':
        prompt = `You are an AI strategy advisor for a crypto trading engine.

A calibration system analyzed signal performance for ${suggestion.symbol} (${suggestion.horizon} horizon):

${suggestion.reason}

${metricsContext}

Current AI Weight: ${((suggestion.current_value || 0.5) * 100).toFixed(0)}%

Suggest a new AI weight (between 0.2 and 0.8) to optimize signal quality.
Remember: technical_weight + ai_weight must equal 1.0.

Respond ONLY with valid JSON:`;
        expectedResponseFormat = `{
  "suggested_ai_weight": 0.45,
  "expected_impact_pct": 0.8,
  "explanation": "Your reasoning here"
}`;
        break;

      default:
        console.error(`❌ Unsupported suggestion_type: ${suggestion.suggestion_type}`);
        return new Response(
          JSON.stringify({ ok: false, reason: 'unsupported_suggestion_type', suggestion_type: suggestion.suggestion_type }), 
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    prompt += `\n\n${expectedResponseFormat}`;
    console.log('🤖 Calling OpenAI for suggestion_type:', suggestion.suggestion_type);

    // Call OpenAI
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      console.error('❌ OPENAI_API_KEY not configured');
      return new Response(
        JSON.stringify({ ok: false, reason: 'openai_api_key_not_configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let aiResponse: any;
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

      aiResponse = JSON.parse(content);
    } catch (error) {
      console.error('❌ OpenAI call failed:', error);
      // Safe defaults based on suggestion type
      const defaultValues: Record<string, any> = {
        'confidence_threshold': { suggested_confidence_threshold: 0.60, expected_impact_pct: 0, explanation: 'AI analysis unavailable' },
        'tp_pct': { suggested_tp_pct: suggestion.current_value || 1.5, expected_impact_pct: 0, explanation: 'AI analysis unavailable' },
        'sl_pct': { suggested_sl_pct: suggestion.current_value || 0.8, expected_impact_pct: 0, explanation: 'AI analysis unavailable' },
        'technical_weight': { suggested_technical_weight: suggestion.current_value || 0.5, expected_impact_pct: 0, explanation: 'AI analysis unavailable' },
        'ai_weight': { suggested_ai_weight: suggestion.current_value || 0.5, expected_impact_pct: 0, explanation: 'AI analysis unavailable' },
      };
      aiResponse = defaultValues[suggestion.suggestion_type] || {};
    }

    console.log('🎯 Parsed AI response:', JSON.stringify(aiResponse));

    // Extract suggested value based on type
    let suggestedValue: number;
    switch (suggestion.suggestion_type) {
      case 'confidence_threshold':
        suggestedValue = aiResponse.suggested_confidence_threshold || 0.60;
        suggestedValue = Math.max(0.0, Math.min(1.0, suggestedValue));
        break;
      case 'tp_pct':
        suggestedValue = aiResponse.suggested_tp_pct || suggestion.current_value || 1.5;
        suggestedValue = Math.max(0.5, Math.min(5.0, suggestedValue));
        break;
      case 'sl_pct':
        suggestedValue = aiResponse.suggested_sl_pct || suggestion.current_value || 0.8;
        suggestedValue = Math.max(0.3, Math.min(5.0, suggestedValue));
        break;
      case 'technical_weight':
        suggestedValue = aiResponse.suggested_technical_weight || suggestion.current_value || 0.5;
        suggestedValue = Math.max(0.0, Math.min(1.0, suggestedValue));
        break;
      case 'ai_weight':
        suggestedValue = aiResponse.suggested_ai_weight || suggestion.current_value || 0.5;
        suggestedValue = Math.max(0.0, Math.min(1.0, suggestedValue));
        break;
      default:
        suggestedValue = 0;
    }

    const expectedImpact = aiResponse.expected_impact_pct || 0;
    const explanation = aiResponse.explanation || 'No explanation provided';
    const updatedReason = `${suggestion.reason} | AI: ${explanation}`;

    console.log(`💾 Updating suggestion with: suggested_value=${suggestedValue}, expected_impact=${expectedImpact}`);

    // Update suggestion
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
        JSON.stringify({ ok: false, reason: 'update_failed', error: updateError.message }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Suggestion updated successfully: id=${updatedSuggestion.id}`);

    return new Response(
      JSON.stringify({ ok: true, suggestion: updatedSuggestion }), 
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
