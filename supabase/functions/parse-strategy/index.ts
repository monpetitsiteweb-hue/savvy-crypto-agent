import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, userId } = await req.json();
    
    if (!prompt || !userId) {
      return new Response(JSON.stringify({ error: 'Missing prompt or userId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get LLM configuration
    const { data: llmConfig } = await supabase
      .from('llm_configurations')
      .select('*')
      .eq('is_active', true)
      .single();

    if (!llmConfig) {
      return new Response(JSON.stringify({ error: 'No active LLM configuration found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get available data categories
    const { data: categories } = await supabase
      .from('ai_data_categories')
      .select('*')
      .eq('is_enabled', true);

    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      return new Response(JSON.stringify({ error: 'OpenAI API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = `You are an expert crypto trading strategy parser. Your job is to convert natural language trading instructions into structured JSON strategy configurations.

Available data categories: ${categories?.map(c => c.category_name).join(', ')}

Parse the user's prompt and extract:
1. Assets/currencies mentioned
2. Action type (buy, sell, hold, rebalance, etc.)
3. Trigger conditions (price movements, indicators, sentiment, etc.)
4. Amount or percentage
5. Frequency/schedule
6. Thresholds and risk controls
7. Required data categories

Return a JSON object with this exact structure:
{
  "strategy_name": "Generated name based on the strategy",
  "description": "Clear description of what the strategy does",
  "configuration": {
    "action": "buy|sell|hold|rebalance|stop",
    "assets": ["BTC", "ETH", "XRP"],
    "amount": {
      "type": "fixed|percentage|portfolio_percentage",
      "value": 100,
      "currency": "USD|EUR|BTC"
    },
    "frequency": "once|daily|weekly|monthly|on_trigger",
    "triggers": [
      {
        "type": "price_movement|sentiment|indicator|volume|time",
        "asset": "BTC",
        "condition": "drops|rises|above|below|equals",
        "threshold": 2,
        "timeframe": "24h|7d|1h",
        "operator": "and|or"
      }
    ],
    "risk_management": {
      "stop_loss": 10,
      "take_profit": 5,
      "max_drawdown": 15,
      "position_size": 1
    },
    "portfolio_allocation": {
      "BTC": 60,
      "ETH": 30,
      "XRP": 10
    }
  },
  "required_categories": ["Social Sentiment", "Market Data"],
  "risk_level": "low|medium|high",
  "complexity": "simple|intermediate|advanced"
}

Be precise and extract all relevant information. If information is missing, use reasonable defaults.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: llmConfig.temperature,
        max_tokens: llmConfig.max_tokens,
      }),
    });

    const aiResponse = await response.json();
    
    if (!aiResponse.choices || !aiResponse.choices[0]) {
      throw new Error('Invalid AI response');
    }

    let parsedStrategy;
    try {
      parsedStrategy = JSON.parse(aiResponse.choices[0].message.content);
    } catch (e) {
      throw new Error('Failed to parse AI response as JSON');
    }

    // Check which required categories are available and which are missing
    const availableCategoryNames = categories?.map(c => c.category_name) || [];
    const missingCategories = parsedStrategy.required_categories?.filter(
      (cat: string) => !availableCategoryNames.includes(cat)
    ) || [];

    // Get data sources for required categories
    const { data: dataSources } = await supabase
      .from('ai_data_sources')
      .select(`
        *,
        ai_data_categories!inner(category_name, is_enabled)
      `)
      .eq('user_id', userId)
      .eq('is_active', true)
      .in('ai_data_categories.category_name', parsedStrategy.required_categories || []);

    const result = {
      ...parsedStrategy,
      parsing_metadata: {
        original_prompt: prompt,
        available_categories: availableCategoryNames,
        missing_categories: missingCategories,
        available_sources: dataSources?.length || 0,
        confidence: 0.85 // Could be enhanced with actual confidence scoring
      }
    };

    console.log('Strategy parsed successfully:', result.strategy_name);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in parse-strategy function:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to parse strategy',
      details: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});