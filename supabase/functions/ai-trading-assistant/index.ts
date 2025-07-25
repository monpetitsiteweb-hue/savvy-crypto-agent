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
    const { action, userId, symbols, confidenceThreshold = 0.7, message, strategyId, currentConfig, testMode, recentTrades, marketData, whaleAlerts, indicatorContext, indicatorConfig } = requestBody;
    
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

      // Get current strategy context and recent trading activity
      let strategyAnalysis = '';
      let recentTradingContext = '';
      let marketContext = '';
      let whaleContext = '';
      let indicatorContextForPrompt = '';
      
      // Prepare market data context for AI
      if (marketData && typeof marketData === 'object') {
        const marketEntries = Object.entries(marketData).map(([symbol, data]: [string, any]) => 
          `- ${symbol}: €${data.price?.toLocaleString() || 'N/A'} (${data.change24h > 0 ? '+' : ''}${data.change24h?.toFixed(2) || 0}% 24h)`
        ).join('\n');
        
        marketContext = `
CURRENT MARKET DATA:
${marketEntries}
Last updated: ${new Date().toLocaleString()}
`;
      }
      
      // Prepare whale alerts context
      if (whaleAlerts && Array.isArray(whaleAlerts) && whaleAlerts.length > 0) {
        const whaleEntries = whaleAlerts.slice(0, 3).map(alert => 
          `- ${alert.asset}: ${alert.amount?.toLocaleString() || 'N/A'} (${alert.direction || 'movement'})`
        ).join('\n');
        
        whaleContext = `
RECENT WHALE ALERTS:
${whaleEntries}
`;
      }
      
      // Prepare technical indicators context with structured data
      let indicatorContextText = '';
      let structuredIndicators = {};
      
      if (indicatorContext && typeof indicatorContext === 'object') {
        structuredIndicators = indicatorContext;
        
        const indicatorEntries = Object.entries(indicatorContext).map(([symbol, indicators]: [string, any]) => {
          const indicatorsList = [];
          
          if (indicators.RSI) {
            indicatorsList.push(`RSI: ${indicators.RSI.value || 'N/A'} (${indicators.RSI.signal || 'neutral'} - buy < ${indicators.RSI.buyThreshold || 30}, sell > ${indicators.RSI.sellThreshold || 70})`);
          }
          if (indicators.MACD) {
            const crossover = indicators.MACD.crossover ? 'bullish crossover' : 'bearish crossover';
            indicatorsList.push(`MACD: ${crossover} (histogram: ${indicators.MACD.histogram || 'N/A'})`);
          }
          if (indicators.EMA) {
            const trend = indicators.EMA.short > indicators.EMA.long ? 'bullish' : 'bearish';
            indicatorsList.push(`EMA: ${indicators.EMA.short}/${indicators.EMA.long} (${trend} trend)`);
          }
          if (indicators.SMA) {
            indicatorsList.push(`SMA: ${indicators.SMA.value || 'N/A'}`);
          }
          if (indicators.Bollinger) {
            indicatorsList.push(`Bollinger: ${indicators.Bollinger.position || 'middle'} band (width: ${indicators.Bollinger.width || 'N/A'}%)`);
          }
          if (indicators.ADX) {
            indicatorsList.push(`ADX: ${indicators.ADX.value || 'N/A'} (${indicators.ADX.trendStrength || 'weak'} trend strength)`);
          }
          if (indicators.StochasticRSI) {
            indicatorsList.push(`Stoch RSI: K=${indicators.StochasticRSI.k || 'N/A'}, D=${indicators.StochasticRSI.d || 'N/A'} (${indicators.StochasticRSI.signal || 'neutral'})`);
          }
          
          return indicatorsList.length > 0 ? `- ${symbol}: ${indicatorsList.join(', ')}` : null;
        }).filter(Boolean).join('\n');
        
        if (indicatorEntries) {
          indicatorContextText = `
LIVE TECHNICAL INDICATORS:
${indicatorEntries}
Last calculated: ${new Date().toLocaleString()}

STRUCTURED INDICATOR DATA:
${JSON.stringify(structuredIndicators, null, 2)}
`;
        }
      }
      
      if (strategyId && currentConfig) {
        // Extract strategy details from configuration
        const strategyType = currentConfig.strategyType || 'balanced';
        const riskLevel = currentConfig.riskLevel || currentConfig.riskProfile || 'medium';
        const stopLoss = currentConfig.stopLoss || currentConfig.stop_loss || 'not set';
        const takeProfit = currentConfig.takeProfit || currentConfig.take_profit || 'not set';
        const maxPositionSize = currentConfig.maxPositionSize || currentConfig.max_position_size || 'not set';
        const indicators = currentConfig.indicators || currentConfig.technical_indicators || [];
        const entryRules = currentConfig.entryRules || currentConfig.entry_conditions;
        const exitRules = currentConfig.exitRules || currentConfig.exit_conditions;
        
        strategyAnalysis = `
CURRENT STRATEGY ANALYSIS:
- Strategy ID: ${strategyId}
- Strategy Type: ${strategyType}
- Risk Profile: ${riskLevel}
- Stop Loss: ${stopLoss}${typeof stopLoss === 'number' ? '%' : ''}
- Take Profit: ${takeProfit}${typeof takeProfit === 'number' ? '%' : ''}
- Max Position Size: ${maxPositionSize}
- Technical Indicators: ${Array.isArray(indicators) ? indicators.join(', ') : indicators || 'Standard indicators'}
- Entry Rules: ${entryRules || 'Market-based entry conditions'}
- Exit Rules: ${exitRules || 'Stop-loss and take-profit based exits'}
- Test Mode: ${testMode}
- Full Configuration: ${JSON.stringify(currentConfig, null, 2)}
`;

        // Get recent trades for context if available
        if (recentTrades && Array.isArray(recentTrades) && recentTrades.length > 0) {
          recentTradingContext = `
RECENT TRADING ACTIVITY:
${recentTrades.slice(0, 5).map(trade => 
  `- ${trade.trade_type?.toUpperCase() || 'TRADE'} ${trade.cryptocurrency}: ${trade.amount} at €${trade.price} (P&L: €${trade.profit_loss || 0})`
).join('\n')}
`;
        }
      }

      // Enhanced system prompt with strategy reasoning capabilities and market awareness
      const systemPrompt = `You are an advanced cryptocurrency trading strategy assistant with deep analytical capabilities and real-time market awareness.

${strategyAnalysis}
${recentTradingContext}
${marketContext}
${whaleContext}
${indicatorContextText}

Your core capabilities include:

1. STRATEGY CONFIGURATION: Handle requests to modify trading parameters (risk level, stop loss, take profit, position sizing)

2. STRATEGY ANALYSIS & REASONING: When users ask questions like:
   - "Why are you buying/selling?"
   - "Explain my strategy"
   - "What model are you using?"
   - "Are you trend-following or mean-reverting?"
   - "Why this stop loss?"
   
   Provide intelligent explanations based on:
   - The current strategy configuration and risk profile
   - The strategy type and approach (trend-following, mean-reverting, breakout, etc.)
   - Technical indicators being used
   - Entry/exit rules and logic
   - Risk management settings
   - Recent trading context if available

3. MARKET DATA ANALYSIS: When users ask about:
   - "What is the price of XRP?"
   - "Is BTC going up or down?"
   - "What are the whale alerts?"
   - "Is the market bullish or bearish?"
   
   Use the provided real-time market data and whale alerts to give accurate, current information.

4. TECHNICAL INDICATOR ANALYSIS: When users ask about indicators:
   - "What is the RSI on ETH?"
   - "Is RSI oversold?"
   - "Why are you buying now?" (reference live indicators)
   - "Is this a breakout or trend continuation?"
   - "What indicators triggered the last buy?"
   
   CRITICAL: Use the LIVE TECHNICAL INDICATORS data provided above. The structured indicator data contains real-time values for enabled indicators. When asked about specific indicators:
   - Extract the exact value from the provided data (e.g., "RSI: 46.25")
   - Include the signal interpretation (e.g., "neutral - buy < 30, sell > 70")
   - Reference crossovers, trends, and thresholds from the live data
   - Never say "Live RSI value not provided" - use the structured data provided

5. GENERAL TRADING ASSISTANCE: Answer questions about market conditions, price movements, and trading advice

RESPONSE GUIDELINES:
- For configuration changes: Return JSON with "configUpdates" object containing the specific changes
- For strategy explanations: Analyze the provided configuration and explain the reasoning behind current settings
- For technical indicator questions: Use the live calculated values from the indicator context
- For general questions: Provide helpful trading insights without configuration changes
- Be direct, analytical, and avoid emojis
- Base explanations on actual data provided, not hypothetical scenarios
- Only reference indicators that are enabled and have live calculated values
- If insufficient data is available, acknowledge limitations rather than making assumptions

VALID CONFIGURATION FIELDS:
- riskLevel/riskProfile: low, medium, high
- stopLoss: percentage value (e.g., 2.5 for 2.5%)
- takeProfit: percentage value (e.g., 5.0 for 5.0%)
- maxPositionSize: position sizing limits
- strategyType: trend-following, mean-reverting, breakout, scalping, etc.
- technicalIndicators: object with indicator configs (e.g., { rsi: { enabled: true, period: 14, buyThreshold: 30, sellThreshold: 70 } })

IMPORTANT: When enabling indicators like "enable RSI" or "enable RSI and MACD", immediately include current calculated values in your response for the user to see.`;

      const userPrompt = `User message: "${message.replace(/"/g, '\\"')}"

Analyze this message and respond appropriately. Consider the current strategy context and provide:
1. Configuration updates if this is a settings change request
2. Strategic reasoning and explanation if this is an analysis question
3. General trading assistance for other queries

For configuration changes, use this format:
{
  "message": "Configuration updated. This change means...",
  "configUpdates": {
    "riskLevel": "high",
    "stopLoss": 3.0
  }
}

For strategy analysis, provide detailed explanations based on the actual configuration data provided above.

Special handling for indicator enablement:
- If enabling indicators (e.g., "enable RSI", "enable MACD"), return configUpdates AND include current indicator values in your message
- Example: "RSI is now enabled for your strategy. Current RSI for ETH: 27.2 (oversold - buy signal active)"
- Use the live indicator data from the provided context to give immediate feedback`;

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