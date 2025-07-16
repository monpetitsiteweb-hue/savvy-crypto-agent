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

interface TradeRequest {
  tradeType: 'buy' | 'sell';
  cryptocurrency: string;
  amount: number;
  strategyId?: string;
  orderType?: 'market' | 'limit';
  price?: number;
  testMode?: boolean; // Add test mode to trade request
}

// Trade execution function
async function executeTrade(supabase: any, userId: string, trade: TradeRequest, authToken?: string): Promise<string> {
  try {
    console.log('🔄 TRADE STEP 1: Starting trade execution...');
    console.log('Trade details:', JSON.stringify(trade, null, 2));
    
    // Step 1: Get user's active connections
    console.log('🔄 TRADE STEP 2: Looking for active Coinbase connections...');
    const { data: connections, error: connectionError } = await supabase
      .from('user_coinbase_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (connectionError) {
      console.error('❌ TRADE STEP 2 FAILED: Connection query error:', connectionError);
      return `❌ **Trade Step 2 Failed**: Database error while fetching connections\n\n**Error:** ${connectionError.message}\n**Details:** Could not access your Coinbase connection data`;
    }
    
    if (!connections || connections.length === 0) {
      console.error('❌ TRADE STEP 2 FAILED: No active connections found');
      return `❌ **Trade Step 2 Failed**: No active Coinbase connections\n\n**Problem:** No active Coinbase accounts linked\n**Solution:** Connect your Coinbase account in the Dashboard tab`;
    }

    console.log('✅ TRADE STEP 2 SUCCESS: Found active connection');
    
    // Step 3: Prepare trade payload
    console.log('🔄 TRADE STEP 3: Preparing trade parameters...');
    const connection = connections[0];
    const isTestMode = trade.testMode !== undefined ? trade.testMode : true;
    const tradingFunction = isTestMode ? 'coinbase-sandbox-trade' : 'coinbase-live-trade';
    const environment = isTestMode ? 'TEST' : 'LIVE';
    
    const tradePayload = {
      connectionId: connection.id,
      tradeType: trade.tradeType,
      cryptocurrency: trade.cryptocurrency,
      amount: trade.amount,
      price: trade.price,
      strategyId: trade.strategyId,
      orderType: trade.orderType || 'market',
      userId: userId
    };

    console.log('✅ TRADE STEP 3 SUCCESS: Trade payload prepared');
    console.log('Trade payload:', JSON.stringify(tradePayload, null, 2));
    console.log('Target function:', tradingFunction);
    console.log('Environment:', environment);

    // Step 4: Execute the trade
    console.log('🔄 TRADE STEP 4: Calling trading function...');
    const invokeOptions: any = {
      body: tradePayload
    };
    
    if (authToken) {
      invokeOptions.headers = {
        Authorization: `Bearer ${authToken}`
      };
      console.log('Auth token included in request');
    }
    
    let tradeResult, tradeError;
    try {
      const response = await supabase.functions.invoke(tradingFunction, invokeOptions);
      tradeResult = response.data;
      tradeError = response.error;
      
      console.log('Raw trading function response:', JSON.stringify(response, null, 2));
    } catch (invokeError) {
      console.error('❌ TRADE STEP 4 FAILED: Function invoke error:', invokeError);
      return `❌ **Trade Step 4 Failed**: Could not call trading function\n\n**Function:** ${tradingFunction}\n**Error:** ${invokeError.message}\n**Type:** ${invokeError.name}\n\n**Debug Info:**\n- Test Mode: ${isTestMode}\n- Connection ID: ${connection.id}\n- Payload: ${JSON.stringify(tradePayload, null, 2)}`;
    }

    if (tradeError) {
      console.error('❌ TRADE STEP 4 FAILED: Trading function error:', tradeError);
      let errorDetails = `❌ **Trade Step 4 Failed**: Trading function returned error\n\n`;
      errorDetails += `**Function:** ${tradingFunction}\n`;
      errorDetails += `**Environment:** ${environment}\n`;
      errorDetails += `**Error Message:** ${tradeError.message || 'Unknown error'}\n`;
      
      if (tradeError.details) {
        errorDetails += `**Details:** ${tradeError.details}\n`;
      }
      
      // Check for specific error patterns
      if (tradeError.message && tradeError.message.includes('Edge Function returned a non-2xx status code')) {
        errorDetails += `\n**Specific Issue:** Coinbase API connectivity problem\n`;
        errorDetails += `**API Endpoint:** api.sandbox.coinbase.com\n`;
        errorDetails += `**Likely Cause:** Coinbase Sandbox API is temporarily unavailable\n`;
        errorDetails += `**Suggestion:** Try again in a few minutes\n`;
      }
      
      errorDetails += `\n**Full Error Object:** ${JSON.stringify(tradeError, null, 2)}`;
      return errorDetails;
    }

    // Step 5: Validate trade result
    console.log('🔄 TRADE STEP 5: Validating trade result...');
    if (!tradeResult) {
      console.error('❌ TRADE STEP 5 FAILED: No trade result received');
      return `❌ **Trade Step 5 Failed**: No response from trading function\n\n**Function:** ${tradingFunction}\n**Expected:** Trade execution result\n**Received:** null/undefined`;
    }

    if (!tradeResult.success) {
      console.error('❌ TRADE STEP 5 FAILED: Trade execution failed:', tradeResult);
      return `❌ **Trade Step 5 Failed**: Trade execution unsuccessful\n\n**Function:** ${tradingFunction}\n**Error:** ${tradeResult.error || 'Unknown execution error'}\n**Result:** ${JSON.stringify(tradeResult, null, 2)}`;
    }

    console.log('✅ TRADE STEP 5 SUCCESS: Trade executed successfully');

    // Step 6: Format success response
    console.log('🔄 TRADE STEP 6: Formatting success response...');
    const crypto = trade.cryptocurrency.toUpperCase();
    const action = trade.tradeType === 'buy' ? 'Bought' : 'Sold';
    const orderTypeText = trade.orderType === 'market' ? 'Market' : 'Limit';
    
    const successMessage = `🚀 **Trade Executed Successfully!**

${action} ${trade.amount} ${trade.tradeType === 'buy' ? 'euros worth of' : ''} ${crypto} 
Order Type: ${orderTypeText}
Environment: ${environment}
Order ID: ${tradeResult.data?.order_id || 'Unknown'}

${isTestMode ? '🧪 This was a TEST trade (sandbox mode). No real money was involved.' : '💰 This was a LIVE trade with real money!'}

The trade has been recorded in your trading history.`;

    console.log('✅ TRADE STEP 6 SUCCESS: Response formatted');
    return successMessage;

  } catch (error) {
    console.error('❌ TRADE EXECUTION FATAL ERROR:', error);
    let errorDetails = `❌ **Fatal Trade Error**: Unexpected system error\n\n`;
    errorDetails += `**Error Type:** ${error.name || 'Unknown'}\n`;
    errorDetails += `**Error Message:** ${error.message || 'Unknown error'}\n`;
    errorDetails += `**Stack Trace:** ${error.stack || 'Not available'}\n`;
    errorDetails += `\n**Trade Details:**\n`;
    errorDetails += `- User: ${userId}\n`;
    errorDetails += `- Type: ${trade.tradeType}\n`;
    errorDetails += `- Crypto: ${trade.cryptocurrency}\n`;
    errorDetails += `- Amount: ${trade.amount}\n`;
    errorDetails += `- Test Mode: ${trade.testMode}\n`;
    
    return errorDetails;
  }
}

serve(async (req) => {
  console.log('=== AI Trading Assistant Function Called ===');
  
  if (req.method === 'OPTIONS') {
    console.log('STEP 0: OPTIONS request - returning CORS headers');
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('STEP 1: Processing request...');
    
    // Step 1: Parse request body
    let requestBody;
    try {
      requestBody = await req.json();
      console.log('STEP 1 SUCCESS: Request body parsed');
      console.log('Request data:', JSON.stringify(requestBody, null, 2));
    } catch (parseError) {
      console.error('STEP 1 FAILED: Request parsing error:', parseError);
      return new Response(JSON.stringify({ 
        error: 'Request parsing failed',
        step: 'STEP_1_REQUEST_PARSING',
        details: parseError.message,
        message: `❌ **Step 1 Failed**: Could not parse request data\n\n**Error:** ${parseError.message}`
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 2: Get authentication
    console.log('STEP 2: Checking authentication...');
    const authHeader = req.headers.get('Authorization');
    const authToken = authHeader?.replace('Bearer ', '');
    console.log('STEP 2 INFO: Auth header present:', !!authHeader);
    
    const { message, userId, strategyId, currentConfig, testMode }: StrategyUpdateRequest & { testMode?: boolean } = requestBody;
    
    if (!userId) {
      console.error('STEP 2 FAILED: No userId provided');
      return new Response(JSON.stringify({ 
        error: 'Authentication failed',
        step: 'STEP_2_AUTHENTICATION',
        message: `❌ **Step 2 Failed**: No user ID provided\n\n**Required:** User authentication is required for trading operations`
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('STEP 2 SUCCESS: User ID found:', userId);

    // Step 3: Initialize Supabase client
    console.log('STEP 3: Initializing database connection...');
    let supabase;
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase environment variables');
      }
      
      supabase = createClient(supabaseUrl, supabaseKey);
      console.log('STEP 3 SUCCESS: Database client initialized');
    } catch (dbError) {
      console.error('STEP 3 FAILED: Database initialization error:', dbError);
      return new Response(JSON.stringify({ 
        error: 'Database connection failed',
        step: 'STEP_3_DATABASE_INIT',
        message: `❌ **Step 3 Failed**: Could not connect to database\n\n**Error:** ${dbError.message}`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get LLM configuration from database
    let llmConfig: any = {
      system_prompt: 'You are a cryptocurrency trading assistant. Help users analyze and modify their trading strategies. Always be direct and concise. Do not use emojis or icons in your responses. Focus on the user\'s exact request and maintain context from previous messages.',
      temperature: 0.3,
      max_tokens: 2000,
      model: 'gpt-4o-mini'
    };

    try {
      const { data: configData } = await supabase
        .from('llm_configurations')
        .select('*')
        .eq('is_active', true)
        .single();
      
      if (configData) {
        llmConfig = configData;
      }
    } catch (error) {
      console.log('Using default LLM configuration');
    }

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
              model: llmConfig.model || 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: llmConfig.system_prompt
                },
                {
                  role: 'user',
                  content: message
                }
              ],
              temperature: llmConfig.temperature || 0.3,
              max_tokens: llmConfig.max_tokens || 2000,
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

    // Handle stop loss changes with context awareness
    if (lowerMessage.includes('stop loss') || lowerMessage.includes('stop-loss') || 
        (lowerMessage.includes('change') && lowerMessage.includes('3')) ||
        (lowerMessage.includes('to') && lowerMessage.match(/\d+/))) {
      
      const percentageMatch = message.match(/(\d+(?:\.\d+)?)\s*%?/);
      if (percentageMatch) {
        const newPercentage = parseFloat(percentageMatch[1]);
        configUpdates.stopLoss = true;
        configUpdates.stopLossPercentage = newPercentage;
        responseMessage = `Updated stop-loss to ${newPercentage}% and enabled it. This will help protect your capital by automatically selling if positions drop by ${newPercentage}% or more.`;
      } else if (lowerMessage.includes('enable') || lowerMessage.includes('activate')) {
        configUpdates.stopLoss = true;
        responseMessage = `Enabled stop-loss protection at ${currentConfig?.stopLossPercentage || 3}%. This will help limit your downside risk.`;
      } else if (lowerMessage.includes('disable') || lowerMessage.includes('turn off')) {
        configUpdates.stopLoss = false;
        responseMessage = `Disabled stop-loss protection. Note that this increases your risk exposure. You might want to monitor your positions more closely.`;
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
        responseMessage = `Your Stop Loss: ${stopLossValue}${!currentConfig?.stopLoss ? ' - This means unlimited downside risk!' : ''}`;
      }
      else if ((lowerMessage.includes('take profit') || lowerMessage.includes('profit')) && 
               (lowerMessage.includes('what') || lowerMessage.includes('my') || lowerMessage.includes('current'))) {
        responseMessage = `Your Take Profit: ${currentConfig?.takeProfit || 1.3}%`;
      }
      else if (lowerMessage.includes('risk') && 
               (lowerMessage.includes('what') || lowerMessage.includes('my') || lowerMessage.includes('current'))) {
        responseMessage = `Your Risk Level: ${(currentConfig?.riskLevel || 'medium').charAt(0).toUpperCase() + (currentConfig?.riskLevel || 'medium').slice(1)}`;
      }
      else if ((lowerMessage.includes('max position') || lowerMessage.includes('position size')) && 
               (lowerMessage.includes('what') || lowerMessage.includes('my') || lowerMessage.includes('current'))) {
        responseMessage = `Your Max Position: €${currentConfig?.maxPosition?.toLocaleString() || '5,000'}`;
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
      
      // Fallback for general questions - use the LLM for actual conversation
      else if (lowerMessage.includes('what') || lowerMessage.includes('current') || lowerMessage.includes('my')) {
        responseMessage = `Quick Strategy Overview:
• Risk: ${currentConfig?.riskLevel || 'medium'} | Max: €${currentConfig?.maxPosition?.toLocaleString() || '5,000'}
• Profit: ${currentConfig?.takeProfit || 1.3}% | Stop: ${currentConfig?.stopLoss ? `${currentConfig.stopLossPercentage}%` : 'Disabled'}
• Type: ${currentConfig?.strategyType || 'trend-following'} | Auto: ${currentConfig?.autoTrading ? 'On' : 'Off'}

        Ask me specific questions like:
• "What's my sell strategy?"
• "How do I buy positions?"  
• "Should I change my risk level?"`;
      } 
      // ===== NEW TRADE EXECUTION LOGIC =====
      else if (lowerMessage.includes('buy') && (lowerMessage.includes('euro') || lowerMessage.includes('€') || lowerMessage.includes('dollar') || lowerMessage.includes('$'))) {
        // Extract amount and cryptocurrency from message
        const amountMatch = message.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:euro|eur|€|dollar|usd|\$)/i);
        const cryptoMatch = message.match(/\b(btc|bitcoin|eth|ethereum|xrp|ripple)\b/i);
        
        if (amountMatch && cryptoMatch) {
          const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
          let crypto = cryptoMatch[1].toLowerCase();
          
          // Normalize crypto names
          if (crypto === 'bitcoin') crypto = 'btc';
          if (crypto === 'ethereum') crypto = 'eth';
          if (crypto === 'ripple') crypto = 'xrp';
          
          // Execute the trade
          responseMessage = await executeTrade(supabase, userId, {
            tradeType: 'buy',
            cryptocurrency: crypto,
            amount: amount,
            strategyId: strategyId,
            orderType: 'market', // Use market order for AI-initiated trades
            testMode: testMode // Pass the test mode from UI
          }, authToken);
        } else {
          responseMessage = `I understand you want to buy crypto, but I need more details. Try: "Buy 1000 euros worth of BTC" or "Buy 500€ of ETH"`;
        }
      }
      else if (lowerMessage.includes('sell') && (lowerMessage.includes('btc') || lowerMessage.includes('eth') || lowerMessage.includes('xrp') || lowerMessage.includes('bitcoin') || lowerMessage.includes('ethereum'))) {
        // Extract amount and cryptocurrency from message  
        const amountMatch = message.match(/(\d+(?:\.\d+)?)/);
        const cryptoMatch = message.match(/\b(btc|bitcoin|eth|ethereum|xrp|ripple)\b/i);
        
        if (amountMatch && cryptoMatch) {
          const amount = parseFloat(amountMatch[1]);
          let crypto = cryptoMatch[1].toLowerCase();
          
          // Normalize crypto names
          if (crypto === 'bitcoin') crypto = 'btc';
          if (crypto === 'ethereum') crypto = 'eth';
          if (crypto === 'ripple') crypto = 'xrp';
          
          // Execute the trade
          responseMessage = await executeTrade(supabase, userId, {
            tradeType: 'sell',
            cryptocurrency: crypto,
            amount: amount,
            strategyId: strategyId,
            orderType: 'market',
            testMode: testMode // Pass the test mode from UI
          }, authToken);
        } else {
          responseMessage = `I understand you want to sell crypto, but I need more details. Try: "Sell 0.5 BTC" or "Sell 2 ETH"`;
        }
      }
      else {
        // Use LLM for general conversation and questions not related to trading config
        if (openAIApiKey) {
          try {
            const conversationResponse = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openAIApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: llmConfig.model || 'gpt-4o-mini',
                messages: [
                  {
                    role: 'system',
                    content: llmConfig.system_prompt + '\n\nIMPORTANT: You can execute real trades when users ask. Examples:\n- "Buy 1000 euros worth of BTC" - I will execute a market buy order\n- "Sell 0.5 BTC" - I will execute a market sell order\n\nAlways ask for confirmation before executing trades and specify if it will be live or test mode.'
                  },
                  {
                    role: 'user',
                    content: message
                  }
                ],
                temperature: llmConfig.temperature || 0.3,
                max_tokens: llmConfig.max_tokens || 2000,
              }),
            });

            if (conversationResponse.ok) {
              const conversationData = await conversationResponse.json();
              responseMessage = conversationData.choices[0]?.message?.content || 'I can help you with your trading strategy and execute trades. What would you like to do?';
            } else {
              responseMessage = 'I can help you with your trading strategy and execute trades. What would you like to do?';
            }
          } catch (error) {
            console.error('LLM conversation error:', error);
            responseMessage = 'I can help you with your trading strategy and execute trades. What would you like to do?';
          }
        } else {
          responseMessage = 'I can help you with your trading strategy and execute trades. What would you like to do?';
        }
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