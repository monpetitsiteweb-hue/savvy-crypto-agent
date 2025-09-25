// @ts-nocheck
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!openAIApiKey) {
      return new Response(
        JSON.stringify({ error: 'OpenAI API key not configured. Please contact admin.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { prompt } = await req.json();

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `You are an expert crypto trading strategy advisor. Based on the user's input, generate a detailed trading strategy configuration.

Return a JSON object with the following structure:
{
  "name": "Strategy Name",
  "description": "Detailed description",
  "riskLevel": "Low|Medium|High",
  "indicators": {
    "rsi": { "enabled": true, "oversold": 30, "overbought": 70 },
    "macd": { "enabled": true, "fastPeriod": 12, "slowPeriod": 26 },
    "ema": { "enabled": true, "shortPeriod": 9, "longPeriod": 21 },
    "bollinger": { "enabled": false, "period": 20, "deviation": 2 }
  },
  "triggers": {
    "buySignals": ["RSI oversold", "MACD bullish crossover"],
    "sellSignals": ["RSI overbought", "MACD bearish crossover"],
    "stopLoss": 2.5,
    "takeProfit": 5.0
  },
  "settings": {
    "maxPositionSize": 1000,
    "tradingHours": "24/7",
    "allowedPairs": ["BTC/EUR", "ETH/EUR"]
  }
}

Make realistic and safe recommendations based on the user's description.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        response_format: { type: "json_object" }
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'OpenAI API error');
    }

    const strategyConfig = JSON.parse(data.choices[0].message.content);

    return new Response(
      JSON.stringify({ strategy: strategyConfig }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-ai-strategy function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});