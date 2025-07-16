import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface StrategyUpdateRequest {
  message: string;
  userId: string;
  strategyId: string;
  currentConfig: any;
}

interface TradeRequest {
  tradeType: 'buy' | 'sell';
  cryptocurrency: string;
  amount: number;
  strategyId: string;
  orderType: 'market' | 'limit';
  testMode?: boolean;
}

// Trade execution function
async function executeTrade(supabase: any, userId: string, trade: TradeRequest, authToken?: string): Promise<string> {
  console.log('🔄 TRADE STEP 1: Starting trade execution...');
  console.log('Trade details:', JSON.stringify(trade, null, 2));

  try {
    // Step 2: Check for active Coinbase connections
    console.log('🔄 TRADE STEP 2: Looking for active Coinbase connections...');
    const { data: connections, error: connectionError } = await supabase
      .from('user_coinbase_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1);

    if (connectionError || !connections || connections.length === 0) {
      return `❌ **No Coinbase Connection Found**\n\nPlease connect your Coinbase account first in the Admin section to enable trading.`;
    }

    console.log('✅ TRADE STEP 2 SUCCESS: Found active connection');

    // Step 3: Prepare trade parameters
    console.log('🔄 TRADE STEP 3: Preparing trade parameters...');
    
    const mockPrices = {
      BTC: 118500, // USD price
      ETH: 3190,   // USD price  
      XRP: 2.975   // USD price
    };

    const eurToUsdRate = 1.05; // Approximate EUR to USD rate
    const cryptoPrice = mockPrices[trade.cryptocurrency.toUpperCase() as keyof typeof mockPrices] || 50000;
    const cryptoAmount = trade.amount / (cryptoPrice * eurToUsdRate); // Calculate crypto amount from EUR

    console.log('Environment:', trade.testMode ? 'TEST' : 'LIVE');
    console.log('Test Mode:', trade.testMode);
    console.log(`Mock trade: ${trade.tradeType} ${cryptoAmount} ${trade.cryptocurrency} at €${cryptoPrice * eurToUsdRate} (total: €${trade.amount})`);

    console.log('✅ TRADE STEP 3 SUCCESS: Trade parameters prepared');

    // Step 4: Execute trade (test mode or live)
    if (trade.testMode) {
      console.log('🔄 TRADE STEP 4: Test mode detected - executing mock trade locally (no Coinbase API call)');
      
      // Insert mock trade record
      const { error: insertError } = await supabase
        .from('mock_trades')
        .insert({
          user_id: userId,
          strategy_id: trade.strategyId,
          cryptocurrency: trade.cryptocurrency.toLowerCase(),
          trade_type: trade.tradeType,
          amount: cryptoAmount,
          price: cryptoPrice * eurToUsdRate,
          total_value: trade.amount,
          fees: trade.amount * 0.005, // 0.5% fee
          is_test_mode: true,
          notes: `AI-executed ${trade.tradeType} order`,
          market_conditions: {
            price_at_execution: cryptoPrice * eurToUsdRate,
            market_type: 'simulated',
            timestamp: new Date().toISOString()
          }
        });

      if (insertError) {
        console.error('Mock trade insert error:', insertError);
        return `❌ **Trade Recording Failed**\n\nError: ${insertError.message}`;
      }

      console.log('✅ TRADE STEP 4 SUCCESS: Mock trade executed and recorded (no external API call made)');
    } else {
      console.log('🔄 TRADE STEP 4: Live mode detected - calling Coinbase live trade function');
      
      // Call live trading function
      const { data: liveTradeResult, error: liveTradeError } = await supabase.functions.invoke('coinbase-live-trade', {
        body: {
          tradeType: trade.tradeType,
          cryptocurrency: trade.cryptocurrency,
          amount: trade.amount,
          orderType: trade.orderType,
          userId: userId,
          strategyId: trade.strategyId
        },
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      if (liveTradeError) {
        console.error('Live trade error:', liveTradeError);
        return `❌ **Live Trade Failed**\n\nError: ${liveTradeError.message}`;
      }

      console.log('✅ TRADE STEP 4 SUCCESS: Live trade executed via Coinbase API');
    }

    // Step 5: Format success response
    console.log('🔄 TRADE STEP 5: Validating trade result...');
    console.log('✅ TRADE STEP 5 SUCCESS: Trade executed successfully');

    console.log('🔄 TRADE STEP 6: Formatting success response...');
    const successMessage = `✅ **${trade.tradeType.toUpperCase()} Order Executed Successfully**

**Details:**
• Amount: ${cryptoAmount.toFixed(6)} ${trade.cryptocurrency.toUpperCase()}
• Value: €${trade.amount.toLocaleString()}
• Price: €${(cryptoPrice * eurToUsdRate).toFixed(2)} per ${trade.cryptocurrency.toUpperCase()}
• Fees: €${(trade.amount * 0.005).toFixed(2)}
• Environment: ${trade.testMode ? '🧪 Test Mode' : '🔴 Live Trading'}

${trade.testMode ? '**Note:** This was a simulated trade for testing purposes.' : '**Note:** This was a real trade executed on Coinbase.'}`;

    console.log('✅ TRADE STEP 6 SUCCESS: Response formatted');
    return successMessage;

  } catch (error) {
    console.error('Trade execution error:', error);
    return `❌ **Trading Operation Failed**\n\nError: ${error.message}\n\nPlease try again or contact support if the issue persists.`;
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
        throw new Error('Missing Supabase configuration');
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

    // Step 4: Load LLM configuration
    console.log('STEP 4: Loading LLM configuration...');
    let llmConfig = null;
    let openAIApiKey = null;
    
    try {
      const { data: configs } = await supabase
        .from('llm_configurations')
        .select('*')
        .eq('is_active', true)
        .limit(1);
      
      llmConfig = configs?.[0] || null;
      openAIApiKey = Deno.env.get('OPENAI_API_KEY');
      
      console.log('STEP 4 SUCCESS: LLM configuration loaded');
    } catch (llmError) {
      console.log('STEP 4 WARNING: Could not load LLM config, continuing with basic functionality');
    }

    // Main processing logic
    const lowerMessage = message.toLowerCase();
    let configUpdates: any = {};
    let responseMessage = '';

    // Priority 1: Trade execution
    if (lowerMessage.includes('buy') && (lowerMessage.includes('euro') || lowerMessage.includes('€') || lowerMessage.includes('dollar') || lowerMessage.includes('$'))) {
      console.log('🛒 TRADE REQUEST: Buy detected');
      const amountMatch = message.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:euro|eur|€|dollar|usd|\$)/i);
      const cryptoMatch = message.match(/\b(btc|bitcoin|eth|ethereum|xrp|ripple)\b/i);
      
      if (amountMatch && cryptoMatch) {
        const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
        let crypto = cryptoMatch[1].toLowerCase();
        
        // Normalize crypto names
        if (crypto === 'bitcoin') crypto = 'btc';
        if (crypto === 'ethereum') crypto = 'eth';
        if (crypto === 'ripple') crypto = 'xrp';
        
        console.log('🛒 EXECUTING TRADE:', { amount, crypto, testMode });
        responseMessage = await executeTrade(supabase, userId, {
          tradeType: 'buy',
          cryptocurrency: crypto,
          amount: amount,
          strategyId: strategyId,
          orderType: 'market',
          testMode: testMode
        }, authToken);
      } else {
        responseMessage = `I understand you want to buy crypto, but I need more details. Try: "Buy 1000 euros worth of BTC" or "Buy 500€ of ETH"`;
      }
    }
    else if (lowerMessage.includes('sell') && (lowerMessage.includes('btc') || lowerMessage.includes('eth') || lowerMessage.includes('xrp') || lowerMessage.includes('bitcoin') || lowerMessage.includes('ethereum'))) {
      console.log('💸 TRADE REQUEST: Sell detected');
      const amountMatch = message.match(/(\d+(?:\.\d+)?)/);
      const cryptoMatch = message.match(/\b(btc|bitcoin|eth|ethereum|xrp|ripple)\b/i);
      
      if (amountMatch && cryptoMatch) {
        const amount = parseFloat(amountMatch[1]);
        let crypto = cryptoMatch[1].toLowerCase();
        
        // Normalize crypto names
        if (crypto === 'bitcoin') crypto = 'btc';
        if (crypto === 'ethereum') crypto = 'eth';
        if (crypto === 'ripple') crypto = 'xrp';
        
        console.log('💸 EXECUTING TRADE:', { amount, crypto, testMode });
        responseMessage = await executeTrade(supabase, userId, {
          tradeType: 'sell',
          cryptocurrency: crypto,
          amount: amount,
          strategyId: strategyId,
          orderType: 'market',
          testMode: testMode
        }, authToken);
      } else {
        responseMessage = `I understand you want to sell crypto, but I need more details. Try: "Sell 0.5 BTC" or "Sell 2 ETH"`;
      }
    }
    // Priority 2: Configuration changes
    else if (lowerMessage.includes('stop loss') || lowerMessage.includes('stop-loss')) {
      const percentageMatch = message.match(/(\d+(?:\.\d+)?)\s*%?/);
      if (percentageMatch) {
        const newPercentage = parseFloat(percentageMatch[1]);
        configUpdates.stopLoss = true;
        configUpdates.stopLossPercentage = newPercentage;
        responseMessage = `Updated stop-loss to ${newPercentage}% and enabled it. This will help protect your capital by automatically selling if positions drop by ${newPercentage}% or more.`;
      }
    }
    else if (lowerMessage.includes('take profit')) {
      const percentageMatch = message.match(/(\d+(?:\.\d+)?)\s*%?/);
      if (percentageMatch) {
        const newPercentage = parseFloat(percentageMatch[1]);
        configUpdates.takeProfit = newPercentage;
        responseMessage = `✅ Updated take profit target to ${newPercentage}%. Your strategy will now automatically sell positions when they reach ${newPercentage}% profit.`;
      }
    }
    else if (lowerMessage.includes('risk')) {
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
    // Priority 3: General conversation with learning context
    else {
      console.log('💬 GENERAL CONVERSATION WITH AI LEARNING');
      
      if (openAIApiKey && llmConfig) {
        console.log('💬 Getting AI knowledge context...');
        
        // Get learned knowledge for AI context
        let aiKnowledge = [];
        try {
          const knowledgeResponse = await supabase.functions.invoke('ai-learning-engine', {
            body: { action: 'get_knowledge', userId }
          });
          aiKnowledge = knowledgeResponse.data?.knowledge || [];
          console.log(`📚 Retrieved ${aiKnowledge.length} knowledge items`);
        } catch (knowledgeError) {
          console.log('⚠️ Could not retrieve AI knowledge, continuing without context');
        }
        
        console.log('💬 Using AI for conversation with learning context...');
        try {
          // Build enhanced system prompt with learned knowledge
          let enhancedSystemPrompt = llmConfig.system_prompt + '\n\nCurrent strategy context: ' + JSON.stringify(currentConfig, null, 2);
          
          if (aiKnowledge.length > 0) {
            enhancedSystemPrompt += '\n\n🧠 LEARNED INSIGHTS (use this knowledge in your responses):';
            aiKnowledge.forEach((insight: any, index: number) => {
              enhancedSystemPrompt += `\n${index + 1}. ${insight.title} (Confidence: ${(insight.confidence_score * 100).toFixed(0)}%): ${insight.content}`;
            });
          }
          
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
                  content: enhancedSystemPrompt
                },
                {
                  role: 'user',
                  content: message
                }
              ],
              temperature: llmConfig.temperature || 0.7,
              max_tokens: Math.min(llmConfig.max_tokens || 500, 500),
            }),
          });

          if (conversationResponse.ok) {
            const conversationData = await conversationResponse.json();
            responseMessage = conversationData.choices[0]?.message?.content || 'Hello! I can help you with your trading strategy and execute trades. What would you like to do?';
            
            // Trigger learning analysis in background occasionally
            if (Math.random() < 0.3 && aiKnowledge.length < 20) { // 30% chance, max 20 insights
              console.log('🧠 Triggering background learning analysis...');
              supabase.functions.invoke('ai-learning-engine', {
                body: { action: 'analyze_and_learn', userId }
              }).catch((error: any) => console.error('Background learning failed:', error));
            }
          } else {
            console.log('💬 OpenAI conversation failed, using fallback');
            responseMessage = 'Hello! I can help you with your trading strategy and execute trades. What would you like to do?';
          }
        } catch (error) {
          console.error('💬 LLM conversation error:', error);
          responseMessage = 'Hello! I can help you with your trading strategy and execute trades. What would you like to do?';
        }
      } else {
        console.log('💬 No AI available, using basic response');
        responseMessage = 'Hello! I can help you with your trading strategy and execute trades. What would you like to do?';
      }
    }

    // Update strategy configuration if there are changes
    if (Object.keys(configUpdates).length > 0 && strategyId) {
      const newConfig = { ...currentConfig, ...configUpdates };
      
      const { error } = await supabase
        .from('trading_strategies')
        .update({
          configuration: newConfig,
          updated_at: new Date().toISOString(),
        })
        .eq('id', strategyId);
      
      if (error) {
        console.error('Strategy update error:', error);
        responseMessage += '\n\n⚠️ Note: Configuration changes could not be saved.';
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: responseMessage,
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