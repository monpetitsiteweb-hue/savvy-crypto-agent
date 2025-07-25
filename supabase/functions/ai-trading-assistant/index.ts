import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Security headers and logging
    const clientIP = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';
    console.log(`🔐 AI Assistant request from IP: ${clientIP}, User-Agent: ${userAgent}`);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const requestBody = await req.json();
    const { action, userId, symbols, confidenceThreshold = 0.7, message, strategyId, currentConfig, testMode } = requestBody;
    
    // Input validation - allow either action-based calls OR message-based calls
    if (!action && !message) {
      return new Response(JSON.stringify({ error: 'Either action or message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!userId || typeof userId !== 'string') {
      return new Response(JSON.stringify({ error: 'Valid userId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`🤖 AI Trading Assistant: ${action || 'message'} for user: ${userId}`);

    // Handle message-based requests (from conversation panel)
    if (message && !action) {
      console.log(`💬 Processing message: "${message}"`);
      
      if (!openAIApiKey) {
        return new Response(JSON.stringify({ 
          message: "❌ OpenAI API key not configured. Please contact admin.",
          configUpdates: {}
        }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Get current strategy if available
      let strategyContext = '';
      if (strategyId && currentConfig) {
        strategyContext = `
Current Strategy Configuration:
- Strategy ID: ${strategyId}
- Configuration: ${JSON.stringify(currentConfig, null, 2)}
- Test Mode: ${testMode}
`;
      }

      // Use OpenAI to understand the user's intent and respond appropriately
      const systemPrompt = `You are a cryptocurrency trading strategy assistant. 

${strategyContext}

Your job is to:
1. Understand what the user wants to change about their trading strategy
2. If they want to change configuration (risk profile, stop loss, take profit, etc.), extract the specific changes
3. Respond with helpful information about their strategy

If the user wants to change their risk profile, stop loss, or take profit, you should:
- Acknowledge the change
- Explain what it means for their strategy
- Return a JSON response that includes configUpdates

For risk profile changes, valid values are: low, medium, high
For stop loss/take profit changes, accept percentage values

Be direct and concise. Do not use emojis or icons in your responses.`;

      const userPrompt = `User message: "${message}"

Please analyze this message and respond appropriately. If this is a configuration change request, include a "configUpdates" object in your response with the specific changes.

Example response format for config changes:
{
  "message": "Risk profile updated to high. This means...",
  "configUpdates": {
    "riskLevel": "high",
    "riskProfile": "high"
  }
}`;

      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4.1-2025-04-14',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.3,
            max_tokens: 500,
          }),
        });

        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;

        // Try to parse as JSON in case it includes configUpdates
        try {
          const parsedResponse = JSON.parse(aiResponse);
          if (parsedResponse.configUpdates && strategyId) {
            // Update the strategy configuration in the database
            const { error: updateError } = await supabaseClient
              .from('trading_strategies')
              .update({
                configuration: { ...currentConfig, ...parsedResponse.configUpdates },
                updated_at: new Date().toISOString()
              })
              .eq('id', strategyId)
              .eq('user_id', userId);

            if (updateError) {
              console.error('Error updating strategy:', updateError);
              return new Response(JSON.stringify({ 
                message: `❌ Error updating strategy: ${updateError.message}`,
                configUpdates: {}
              }), { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
              });
            }

            return new Response(JSON.stringify(parsedResponse), { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            });
          }
        } catch {
          // If it's not JSON, treat as a regular message
        }

        return new Response(JSON.stringify({ 
          message: aiResponse,
          configUpdates: {}
        }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });

      } catch (error) {
        console.error('OpenAI API error:', error);
        return new Response(JSON.stringify({ 
          message: `❌ AI processing error: ${error.message}`,
          configUpdates: {}
        }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }
    
    if (action === 'analyze_opportunities') {
      // Get recent signals
      const { data: signals } = await supabaseClient
        .from('live_signals')
        .select('*')
        .gte('timestamp', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
        .order('signal_strength', { ascending: false });

      // Get AI knowledge
      const { data: knowledge } = await supabaseClient
        .from('ai_knowledge_base')
        .select('*')
        .eq('user_id', userId)
        .eq('knowledge_type', 'signal_correlation')
        .order('confidence_score', { ascending: false });

      const opportunities = [];
      for (const signal of signals || []) {
        if (signal.signal_strength >= confidenceThreshold * 100) {
          const relatedKnowledge = (knowledge || []).find(k => 
            k.metadata?.signal?.signal_type === signal.signal_type
          );
          
          const aiConfidence = relatedKnowledge ? 
            (signal.signal_strength / 100 + relatedKnowledge.confidence_score) / 2 : 
            signal.signal_strength / 100;

          if (aiConfidence >= confidenceThreshold) {
            opportunities.push({
              symbol: signal.symbol,
              action: signal.signal_type.includes('bullish') ? 'buy' : 'sell',
              confidence: aiConfidence,
              reasoning: `${signal.signal_type} signal with ${(aiConfidence * 100).toFixed(1)}% AI confidence`,
              signal_strength: signal.signal_strength,
              timestamp: signal.timestamp
            });
          }
        }
      }

      // Store recommendation
      if (opportunities.length > 0) {
        const topOpportunity = opportunities[0];
        await supabaseClient.from('conversation_history').insert([{
          user_id: userId,
          message_type: 'ai_recommendation',
          content: `AI recommends ${topOpportunity.action} ${topOpportunity.symbol} - ${topOpportunity.reasoning}`,
          metadata: { opportunities: opportunities.slice(0, 3) }
        }]);
      }

      return new Response(JSON.stringify({ 
        success: true, 
        opportunities: opportunities.slice(0, 5),
        total_analyzed: signals?.length || 0,
        message: `Found ${opportunities.length} high-confidence opportunities`
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ AI Trading Assistant error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});