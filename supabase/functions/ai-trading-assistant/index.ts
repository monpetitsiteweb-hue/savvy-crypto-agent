import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StrategyUpdateRequest {
  message: string;
  userId: string;
  strategyId?: string;
  currentConfig?: any;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, userId, strategyId, currentConfig }: StrategyUpdateRequest = await req.json();
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get Perplexity API key
    const perplexityApiKey = Deno.env.get('PERPLEXITY_API_KEY');
    
    let marketInsights = '';
    let recommendations = '';

    // Fetch market insights using Perplexity if available
    if (perplexityApiKey) {
      try {
        const marketResponse = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${perplexityApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.1-sonar-small-128k-online',
            messages: [
              {
                role: 'system',
                content: 'You are a crypto trading analyst. Provide current market insights, trends, and signals for cryptocurrency trading. Be concise and focus on actionable information.'
              },
              {
                role: 'user',
                content: 'What are the current cryptocurrency market trends, signals, and key indicators that would affect trading strategies today? Include BTC, ETH, and major altcoins.'
              }
            ],
            temperature: 0.2,
            top_p: 0.9,
            max_tokens: 500,
            return_images: false,
            return_related_questions: false,
            search_recency_filter: 'day',
            frequency_penalty: 1,
            presence_penalty: 0
          }),
        });

        if (marketResponse.ok) {
          const marketData = await marketResponse.json();
          marketInsights = marketData.choices[0]?.message?.content || '';
        }
      } catch (error) {
        console.log('Perplexity API error:', error);
        marketInsights = 'Unable to fetch current market data at this time.';
      }
    }

    // Parse the user message for configuration changes
    const lowerMessage = message.toLowerCase();
    let configUpdates: any = {};
    let responseMessage = '';

    // Handle stop loss changes
    if (lowerMessage.includes('stop loss') || lowerMessage.includes('stop-loss')) {
      const percentageMatch = message.match(/(\d+(?:\.\d+)?)\s*%?/);
      if (percentageMatch) {
        const newPercentage = parseFloat(percentageMatch[1]);
        configUpdates.stopLoss = true;
        configUpdates.stopLossPercentage = newPercentage;
        responseMessage = `✅ Updated stop-loss to ${newPercentage}% and enabled it. This will help protect your capital by automatically selling if positions drop by ${newPercentage}% or more.`;
      } else if (lowerMessage.includes('enable') || lowerMessage.includes('activate')) {
        configUpdates.stopLoss = true;
        responseMessage = `✅ Enabled stop-loss protection at ${currentConfig?.stopLossPercentage || 3}%. This will help limit your downside risk.`;
      } else if (lowerMessage.includes('disable') || lowerMessage.includes('turn off')) {
        configUpdates.stopLoss = false;
        responseMessage = `⚠️ Disabled stop-loss protection. Note that this increases your risk exposure. You might want to monitor your positions more closely.`;
      }
    }

    // Handle take profit changes
    if (lowerMessage.includes('take profit') || lowerMessage.includes('profit target')) {
      const percentageMatch = message.match(/(\d+(?:\.\d+)?)\s*%?/);
      if (percentageMatch) {
        const newPercentage = parseFloat(percentageMatch[1]);
        configUpdates.takeProfit = newPercentage;
        responseMessage = `✅ Updated take profit target to ${newPercentage}%. Your strategy will now automatically sell positions when they reach ${newPercentage}% profit.`;
      }
    }

    // Handle risk level changes
    if (lowerMessage.includes('risk')) {
      if (lowerMessage.includes('low') || lowerMessage.includes('conservative')) {
        configUpdates.riskLevel = 'low';
        responseMessage = `✅ Changed risk tolerance to Conservative. This setting prioritizes capital preservation over aggressive gains.`;
      } else if (lowerMessage.includes('high') || lowerMessage.includes('aggressive')) {
        configUpdates.riskLevel = 'high';
        responseMessage = `✅ Changed risk tolerance to Aggressive. This allows for higher potential returns but also higher risk of losses.`;
      } else if (lowerMessage.includes('medium') || lowerMessage.includes('moderate')) {
        configUpdates.riskLevel = 'medium';
        responseMessage = `✅ Set risk tolerance to Moderate. This balances risk and reward appropriately.`;
      }
    }

    // Handle max position changes
    if (lowerMessage.includes('max position') || lowerMessage.includes('position size')) {
      const amountMatch = message.match(/(\d+(?:,\d{3})*(?:\.\d+)?)/);
      if (amountMatch) {
        const newAmount = parseFloat(amountMatch[1].replace(/,/g, ''));
        configUpdates.maxPosition = newAmount;
        responseMessage = `✅ Updated maximum position size to €${newAmount.toLocaleString()}.`;
      }
    }

    // Update strategy configuration if there are changes and strategyId is provided
    if (Object.keys(configUpdates).length > 0 && strategyId) {
      const newConfig = { ...currentConfig, ...configUpdates };
      
      const { error } = await supabase
        .from('trading_strategies')
        .update({
          configuration: newConfig,
          updated_at: new Date().toISOString(),
        })
        .eq('id', strategyId)
        .eq('user_id', userId);

      if (error) {
        console.error('Database update error:', error);
        responseMessage = '❌ Failed to update strategy configuration. Please try again.';
      }
    }

    // Generate AI recommendations based on current config and market insights
    if (lowerMessage.includes('advice') || lowerMessage.includes('recommend') || lowerMessage.includes('suggest') || lowerMessage.includes('improve') || lowerMessage.includes('analysis')) {
      const currentRisk = currentConfig?.riskLevel || 'medium';
      const hasStopLoss = currentConfig?.stopLoss || false;
      const stopLossPercent = currentConfig?.stopLossPercentage || 3;
      const takeProfitPercent = currentConfig?.takeProfit || 1.3;

      recommendations = `
📊 **Current Market Analysis:**
${marketInsights || 'Market data unavailable - consider checking major crypto news sources for current trends.'}

💡 **Strategy Assessment:**
• Stop-loss: ${hasStopLoss ? `✅ Protected at ${stopLossPercent}%` : '❌ DISABLED - High risk!'}
• Take profit: ${takeProfitPercent}% ${takeProfitPercent < 1.5 ? '(Conservative)' : takeProfitPercent > 2.5 ? '(Aggressive)' : '(Balanced)'}
• Risk level: ${currentRisk.charAt(0).toUpperCase() + currentRisk.slice(1)}

🎯 **Actionable Recommendations:**
${!hasStopLoss ? '• 🚨 URGENT: Enable stop-loss protection (recommended 2-4% for your risk level)\n' : ''}• Monitor key support/resistance levels for BTC and ETH
• Consider dollar-cost averaging during high volatility periods
• Keep position sizes aligned with your ${currentRisk} risk tolerance
• Review and adjust settings based on market conditions weekly

⚡ **Quick Commands:**
- "Change stop loss to 2.5%" 
- "Set take profit to 2%"
- "Change risk to conservative"
      `;
    }

    // Handle general questions about current configuration
    if (!responseMessage && !recommendations) {
      if (lowerMessage.includes('what') || lowerMessage.includes('current') || lowerMessage.includes('my')) {
        responseMessage = `📋 **Your Current Strategy Configuration:**
• Risk Level: ${currentConfig?.riskLevel || 'medium'}
• Max Position: €${currentConfig?.maxPosition?.toLocaleString() || '5,000'}
• Take Profit: ${currentConfig?.takeProfit || 1.3}%
• Stop Loss: ${currentConfig?.stopLoss ? `${currentConfig.stopLossPercentage}%` : 'Disabled'}
• Auto Trading: ${currentConfig?.autoTrading ? 'Enabled' : 'Disabled'}
• Strategy Type: ${currentConfig?.strategyType || 'trend-following'}

Ask me to change any of these settings or request trading advice!`;
      } else {
        responseMessage = `I can help you:
• 🔧 Modify settings: "change stop loss to 2.5%"
• 📈 Get advice: "give me trading recommendations"  
• 📊 Check config: "what's my current setup?"
• 🎯 Analyze market: "what are current crypto trends?"

What would you like to do?`;
      }
    }

    // Combine response message with recommendations if any
    const finalResponse = responseMessage + (recommendations ? '\n\n' + recommendations : '');

    return new Response(JSON.stringify({ 
      success: true, 
      message: finalResponse,
      configUpdates: configUpdates 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in ai-trading-assistant function:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message,
      message: 'I encountered an error processing your request. Please try again.'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});