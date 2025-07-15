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

    // Get OpenAI API key
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    
    let marketInsights = '';
    let recommendations = '';

    // Fetch market insights using OpenAI if available
    if (openAIApiKey) {
      try {
        const marketResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are a crypto trading analyst. Provide general market insights, trends, and signals for cryptocurrency trading based on your training data. Be concise and focus on actionable information.'
              },
              {
                role: 'user',
                content: 'What are the general cryptocurrency market patterns, signals, and key indicators that typically affect trading strategies? Include insights about BTC, ETH, and major altcoins.'
              }
            ],
            temperature: 0.2,
            max_tokens: 500,
          }),
        });

        if (marketResponse.ok) {
          const marketData = await marketResponse.json();
          marketInsights = marketData.choices[0]?.message?.content || '';
        }
      } catch (error) {
        console.log('OpenAI API error:', error);
        marketInsights = 'Using general market analysis patterns from training data.';
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

    // Intelligent question analysis and strategy interpretation
    if (!responseMessage && !recommendations) {
      // Analyze sell strategy
      if (lowerMessage.includes('sell strategy') || lowerMessage.includes('selling strategy') || 
          (lowerMessage.includes('sell') && (lowerMessage.includes('strategy') || lowerMessage.includes('when') || lowerMessage.includes('how')))) {
        
        const hasStopLoss = currentConfig?.stopLoss;
        const stopLossPercent = currentConfig?.stopLossPercentage || 3;
        const takeProfitPercent = currentConfig?.takeProfit || 1.3;
        const riskLevel = currentConfig?.riskLevel || 'medium';
        const strategyType = currentConfig?.strategyType || 'trend-following';
        
        responseMessage = `📈 **Your Selling Strategy Analysis:**

**Exit Triggers:**
${hasStopLoss ? `• 🛡️ Stop-loss protection at ${stopLossPercent}% loss (Risk management active)` : '• ⚠️ NO STOP-LOSS - You\'re exposed to unlimited downside risk!'}
• 🎯 Take profit target at ${takeProfitPercent}% gain
• 📊 ${strategyType} signals for trend reversals

**Risk Profile:** ${riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)}
${riskLevel === 'low' ? '- Conservative approach, quick to lock in profits' : 
  riskLevel === 'high' ? '- Aggressive approach, holding for larger gains' : 
  '- Balanced approach between risk and reward'}

**Selling Logic:**
${takeProfitPercent < 1.5 ? '📤 Quick profit-taking strategy (scalping approach)' : 
  takeProfitPercent > 2.5 ? '📈 Hold for larger gains (swing trading)' : 
  '⚖️ Balanced profit targets'}

${!hasStopLoss ? '🚨 **CRITICAL:** Enable stop-loss immediately to protect your capital!' : '✅ Good risk management with stop-loss protection'}`;
      }
      
      // Handle buy settings/configuration queries (UI context aware)
      else if (lowerMessage.includes('buy settings') || lowerMessage.includes('buy configuration') || 
               (lowerMessage.includes('my buy') && lowerMessage.includes('settings'))) {
        
        const maxPosition = currentConfig?.maxPosition || 5000;
        const orderType = currentConfig?.orderType || 'limit';
        const trailingStopBuy = currentConfig?.trailingStopBuy;
        const trailingPercentage = currentConfig?.trailingStopBuyPercentage || 1.5;
        
        responseMessage = `🛒 **Your Buy Settings Configuration:**

**Position Management:**
• Maximum Position Size: €${maxPosition.toLocaleString()}
• Order Type: ${orderType.charAt(0).toUpperCase() + orderType.slice(1)}

**Advanced Buy Features:**
• Trailing Stop-Buy: ${trailingStopBuy ? `✅ Enabled (${trailingPercentage}%)` : '❌ Disabled'}
${trailingStopBuy ? `  - Will track prices down by ${trailingPercentage}% before buying` : '  - No automatic price tracking on entries'}

**Strategy Context:**
• Strategy Type: ${currentConfig?.strategyType || 'trend-following'}
• Risk Level: ${currentConfig?.riskLevel || 'medium'}

💡 **Location:** You can modify these in the "Buy settings" and "Trailing stop-buy" tabs.

**Need changes?** Try:
- "Set max position to 10000"
- "Enable trailing stop buy at 2%"`;
      }
      
      // Handle sell settings/configuration queries (UI context aware)
      else if (lowerMessage.includes('sell settings') || lowerMessage.includes('sell configuration') || 
               (lowerMessage.includes('my sell') && lowerMessage.includes('settings'))) {
        
        const takeProfit = currentConfig?.takeProfit || 1.3;
        const hasStopLoss = currentConfig?.stopLoss;
        const stopLossPercent = currentConfig?.stopLossPercentage || 3;
        const orderType = currentConfig?.orderType || 'limit';
        const autoTrading = currentConfig?.autoTrading;
        
        responseMessage = `💰 **Your Sell Settings Configuration:**

**Exit Targets:**
• Take Profit: ${takeProfit}%
• Stop Loss: ${hasStopLoss ? `${stopLossPercent}%` : '❌ DISABLED'}
• Order Type: ${orderType.charAt(0).toUpperCase() + orderType.slice(1)}

**Automation:**
• Auto Trading: ${autoTrading ? '✅ Enabled' : '❌ Disabled'}

**Risk Assessment:**
${!hasStopLoss ? '⚠️ **WARNING:** No stop-loss protection - unlimited downside risk!' : '✅ Protected with stop-loss'}
${takeProfit < 1.5 ? '📊 Conservative profit-taking (quick exits)' : 
  takeProfit > 2.5 ? '📈 Aggressive profit targets (holding for bigger gains)' : 
  '⚖️ Balanced profit targets'}

💡 **Location:** Configure these in "Sell settings", "Stop-loss", and "Auto close" tabs.

**Quick fixes:** 
- "Enable stop loss at 2.5%"
- "Set take profit to 2%"`;
      }
      
      // Analyze buy strategy  
      else if (lowerMessage.includes('buy strategy') || lowerMessage.includes('buying strategy') || 
               (lowerMessage.includes('buy') && (lowerMessage.includes('strategy') || lowerMessage.includes('when') || lowerMessage.includes('how')))) {
        
        const maxPosition = currentConfig?.maxPosition || 5000;
        const riskLevel = currentConfig?.riskLevel || 'medium';
        const strategyType = currentConfig?.strategyType || 'trend-following';
        
        responseMessage = `📊 **Your Buying Strategy Analysis:**

**Entry Signals:**
• 📈 ${strategyType} indicators for market timing
• 💰 Maximum position size: €${maxPosition.toLocaleString()}
• ⚖️ ${riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)} risk tolerance

**Position Sizing Logic:**
${riskLevel === 'low' ? '- Smaller positions, prioritizing capital preservation' : 
  riskLevel === 'high' ? '- Larger positions for maximum growth potential' : 
  '- Moderate position sizes balancing growth and safety'}

**Buy Triggers:**
${strategyType === 'trend-following' ? '- Entering on confirmed upward momentum\n- Avoiding falling knives (catching downtrends)' :
  strategyType === 'mean-reversion' ? '- Buying oversold conditions\n- Targeting bounce-back opportunities' :
  '- Following systematic entry rules\n- Waiting for confirmation signals'}

**Risk Management:**
• Max exposure per trade: €${maxPosition.toLocaleString()}
• Portfolio diversification across positions`;
      }
      
      // Specific component questions
      else if ((lowerMessage.includes('stop loss') || lowerMessage.includes('stop-loss')) && 
               (lowerMessage.includes('what') || lowerMessage.includes('my') || lowerMessage.includes('current'))) {
        const stopLossValue = currentConfig?.stopLoss ? `${currentConfig.stopLossPercentage}%` : 'Disabled';
        responseMessage = `🛡️ **Your Stop Loss:** ${stopLossValue}${!currentConfig?.stopLoss ? ' ⚠️ This means unlimited downside risk!' : ''}`;
      }
      else if ((lowerMessage.includes('take profit') || lowerMessage.includes('profit')) && 
               (lowerMessage.includes('what') || lowerMessage.includes('my') || lowerMessage.includes('current'))) {
        responseMessage = `🎯 **Your Take Profit:** ${currentConfig?.takeProfit || 1.3}%`;
      }
      else if (lowerMessage.includes('risk') && 
               (lowerMessage.includes('what') || lowerMessage.includes('my') || lowerMessage.includes('current'))) {
        responseMessage = `⚖️ **Your Risk Level:** ${(currentConfig?.riskLevel || 'medium').charAt(0).toUpperCase() + (currentConfig?.riskLevel || 'medium').slice(1)}`;
      }
      else if ((lowerMessage.includes('max position') || lowerMessage.includes('position size')) && 
               (lowerMessage.includes('what') || lowerMessage.includes('my') || lowerMessage.includes('current'))) {
        responseMessage = `💰 **Your Max Position:** €${currentConfig?.maxPosition?.toLocaleString() || '5,000'}`;
      }
      
      // Strategy analysis questions
      else if (lowerMessage.includes('strategy') && (lowerMessage.includes('what') || lowerMessage.includes('my') || lowerMessage.includes('current'))) {
        const hasStopLoss = currentConfig?.stopLoss;
        const riskLevel = currentConfig?.riskLevel || 'medium';
        
        responseMessage = `🎯 **Your Complete Trading Strategy:**

**Type:** ${currentConfig?.strategyType || 'trend-following'}
**Risk Level:** ${riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)}
**Position Size:** €${currentConfig?.maxPosition?.toLocaleString() || '5,000'} max

**Entry/Exit Rules:**
• Buy: ${currentConfig?.strategyType || 'trend-following'} signals
• Sell: ${currentConfig?.takeProfit || 1.3}% profit OR ${hasStopLoss ? `${currentConfig.stopLossPercentage}% loss` : 'NO STOP LOSS ⚠️'}

**Overall Assessment:**
${!hasStopLoss ? '🚨 HIGH RISK - No downside protection' : 
  riskLevel === 'high' && currentConfig?.takeProfit > 2 ? '📈 Aggressive growth strategy' :
  riskLevel === 'low' && currentConfig?.takeProfit < 1.5 ? '🛡️ Conservative preservation strategy' :
  '⚖️ Balanced risk/reward approach'}`;
      }
      
      // Fallback for general questions
      else if (lowerMessage.includes('what') || lowerMessage.includes('current') || lowerMessage.includes('my')) {
        responseMessage = `📋 **Quick Strategy Overview:**
• Risk: ${currentConfig?.riskLevel || 'medium'} | Max: €${currentConfig?.maxPosition?.toLocaleString() || '5,000'}
• Profit: ${currentConfig?.takeProfit || 1.3}% | Stop: ${currentConfig?.stopLoss ? `${currentConfig.stopLossPercentage}%` : 'Disabled'}
• Type: ${currentConfig?.strategyType || 'trend-following'} | Auto: ${currentConfig?.autoTrading ? 'On' : 'Off'}

Ask me specific questions like:
• "What's my sell strategy?"
• "How do I buy positions?"  
• "Should I change my risk level?"`;
      } else {
        responseMessage = `I can analyze your trading strategy intelligently:

• 📈 **Strategy Analysis:** "What's my sell strategy?" or "How does my buying work?"
• 🔧 **Modify Settings:** "Change stop loss to 2.5%" or "Set risk to aggressive"
• 💡 **Get Advice:** "Should I adjust my strategy?" or "What's risky about my setup?"
• 📊 **Market Insights:** "Give me trading recommendations"

What would you like to know?`;
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