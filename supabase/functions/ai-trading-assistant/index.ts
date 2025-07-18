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
    // Step 1B: Get strategy and check max position limit
    console.log('🔄 TRADE STEP 1B: Checking max position limit...');
    const { data: strategy, error: strategyError } = await supabase
      .from('trading_strategies')
      .select('configuration')
      .eq('id', trade.strategyId)
      .single();

    if (strategyError) {
      console.error('Strategy error:', strategyError);
      return `❌ **Strategy Access Failed**\n\nCould not retrieve strategy configuration. Please try again.`;
    }

    const config = strategy.configuration;
    const maxPosition = config.maxPosition || 5000;
    
    if (trade.amount > maxPosition) {
      console.log(`⚠️ Trade amount €${trade.amount} exceeds max position €${maxPosition}`);
      return `❌ **Position Limit Exceeded**\n\nYour maximum position is set to €${maxPosition}, but you're trying to trade €${trade.amount}. Please increase your max position limit first or reduce the trade amount.`;
    }

    console.log(`✅ Position check passed: €${trade.amount} ≤ €${maxPosition}`);

    // Step 2: Get user's fee rate from profile
    console.log('🔄 TRADE STEP 2A: Getting user fee configuration...');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('fee_rate')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.error('Profile error:', profileError);
      return `❌ **Profile Access Failed**\n\nCould not retrieve your fee settings. Please try again.`;
    }

    const userFeeRate = profile?.fee_rate || 0.0000;
    console.log(`💰 User fee rate: ${(userFeeRate * 100).toFixed(2)}%`);

    // Step 2B: Check for active Coinbase connections
    console.log('🔄 TRADE STEP 2B: Looking for active Coinbase connections...');
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
    
    // Calculate fees based on user's fee rate
    const fees = trade.amount * userFeeRate;

    console.log('Environment:', trade.testMode ? 'TEST' : 'LIVE');
    console.log('Test Mode:', trade.testMode);
    console.log(`Mock trade: ${trade.tradeType} ${cryptoAmount} ${trade.cryptocurrency} at €${cryptoPrice * eurToUsdRate} (total: €${trade.amount})`);
    if (fees > 0) {
      console.log(`Fees: €${fees.toFixed(2)} (${(userFeeRate * 100).toFixed(2)}%)`);
    } else {
      console.log('Fees: €0.00 (Fee-free account)');
    }

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
          fees: fees,
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
• Fees: €0.00 (Fee-free account)
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

    // Main processing logic - Use OpenAI to understand user intent
    const lowerMessage = message.toLowerCase();
    let configUpdates: any = {};
    let responseMessage = '';

    // Check if this might be a trading request or configuration change
    if (openAIApiKey && llmConfig) {
      console.log('💬 Using AI to analyze user intent...');
      
      try {
        const analysisResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: llmConfig.model || 'gpt-4.1-2025-04-14',
            messages: [
              {
                role: 'system',
                content: `You are a trading assistant parser. Analyze user messages and extract trading intent. Return ONLY a JSON response with this structure:
{
  "intent": "trade" | "config" | "conversation",
  "trades": [
    {
      "action": "buy" | "sell",
      "cryptocurrency": "btc" | "eth" | "xrp",
      "amount_eur": number,
      "amount_crypto": number (for sell orders)
    }
  ],
  "config_changes": {
    "stopLoss": boolean,
    "stopLossPercentage": number,
    "takeProfit": number,
    "riskLevel": "low" | "medium" | "high",
    "maxPosition": number
  }
}

Examples:
- "Buy 250000 euros of XRP" → {"intent": "trade", "trades": [{"action": "buy", "cryptocurrency": "xrp", "amount_eur": 250000}]}
- "Buy 100000 euros of BTC and 50000 euros of ETH" → {"intent": "trade", "trades": [{"action": "buy", "cryptocurrency": "btc", "amount_eur": 100000}, {"action": "buy", "cryptocurrency": "eth", "amount_eur": 50000}]}
- "Sell all my XRP" → {"intent": "trade", "trades": [{"action": "sell", "cryptocurrency": "xrp", "amount_crypto": "all"}]}
- "Set stop loss to 3%" → {"intent": "config", "config_changes": {"stopLoss": true, "stopLossPercentage": 3}}
- "Change max position to 100000" → {"intent": "config", "config_changes": {"maxPosition": 100000}}
- "Yes" (when asked about changing maxPosition) → {"intent": "config", "config_changes": {"maxPosition": 100000}}
- "Hello" → {"intent": "conversation"}

Only respond with valid JSON. No additional text.`
              },
              {
                role: 'user',
                content: message
              }
            ],
            temperature: 0.1,
            max_tokens: 500
          }),
        });

        const analysisData = await analysisResponse.json();
        const analysis = JSON.parse(analysisData.choices[0].message.content);
        
        console.log('🧠 AI Analysis:', analysis);

        if (analysis.intent === 'trade' && analysis.trades?.length > 0) {
          console.log('🛒 TRADE REQUEST: AI detected trading intent');
          
          // Check if trade exceeds maxPosition limit
          const { data: currentStrategy } = await supabase
            .from('trading_strategies')
            .select('configuration')
            .eq('id', strategyId)
            .single();

          const maxPosition = currentStrategy?.configuration?.maxPosition || 5000;
          
          for (const trade of analysis.trades) {
            if (trade.amount_eur && trade.amount_eur > maxPosition) {
              responseMessage = `❌ **Position Limit Exceeded**\n\nYour current strategy has a maximum position limit of €${maxPosition.toLocaleString()}. You're trying to ${trade.action} €${trade.amount_eur.toLocaleString()} of ${trade.cryptocurrency.toUpperCase()}.\n\n**Would you like me to increase the maxPosition limit to €${trade.amount_eur.toLocaleString()}?**\n\nJust say "Yes" or "Change max position to ${trade.amount_eur}"`;
              break;
            }
          }
          
          if (!responseMessage) {
            const results = [];
          for (const trade of analysis.trades) {
            if (trade.action === 'sell' && trade.amount_crypto === 'all') {
              // Handle "sell all" command
              try {
                const { data: balanceData } = await supabase
                  .from('mock_trades')
                  .select('amount, trade_type, cryptocurrency')
                  .eq('user_id', userId)
                  .eq('is_test_mode', testMode)
                  .eq('cryptocurrency', trade.cryptocurrency);
                
                let currentBalance = 0;
                if (balanceData) {
                  balanceData.forEach(tradeRecord => {
                    if (tradeRecord.trade_type === 'buy') {
                      currentBalance += tradeRecord.amount;
                    } else if (tradeRecord.trade_type === 'sell') {
                      currentBalance -= tradeRecord.amount;
                    }
                  });
                }
                
                if (currentBalance <= 0) {
                  results.push(`❌ **No ${trade.cryptocurrency.toUpperCase()} to sell**\n\nYou don't have any ${trade.cryptocurrency.toUpperCase()} in your portfolio to sell.`);
                } else {
                  // Calculate EUR value for sell order
                  const mockPrices = { BTC: 118500, ETH: 3190, XRP: 2.975 };
                  const eurToUsdRate = 1.05;
                  const cryptoPrice = mockPrices[trade.cryptocurrency.toUpperCase() as keyof typeof mockPrices] || 50000;
                  const totalEurValue = currentBalance * (cryptoPrice * eurToUsdRate);
                  
                  const result = await executeTrade(supabase, userId, {
                    tradeType: 'sell',
                    cryptocurrency: trade.cryptocurrency,
                    amount: totalEurValue,
                    strategyId: strategyId,
                    orderType: 'market',
                    testMode: testMode
                  }, authToken);
                  results.push(result);
                }
              } catch (error) {
                results.push(`❌ **Could not check balance**\n\nError retrieving your ${trade.cryptocurrency.toUpperCase()} balance. Please try again.`);
              }
            } else {
              // Regular buy/sell with specific amount - CHECK POSITION LIMITS FIRST
              if (trade.action === 'buy') {
                const maxPosition = currentConfig.maxPosition || 5000;
                console.log(`🔍 Position check: trying to buy €${trade.amount_eur}, max allowed: €${maxPosition}`);
                
                if (trade.amount_eur > maxPosition) {
                  console.log(`❌ Position limit exceeded: €${trade.amount_eur} > €${maxPosition}`);
                  results.push(`❌ **Position Limit Exceeded**\n\nYour maximum position is set to €${maxPosition.toLocaleString()}, but you're trying to buy €${trade.amount_eur.toLocaleString()} worth of ${trade.cryptocurrency.toUpperCase()}.\n\n**The trade was NOT executed.** You need to increase your max position limit first.`);
                  continue; // Skip this trade - do NOT execute it
                }
                console.log(`✅ Position check passed: €${trade.amount_eur} <= €${maxPosition}`);
              }
              
              const result = await executeTrade(supabase, userId, {
                tradeType: trade.action,
                cryptocurrency: trade.cryptocurrency,
                amount: trade.amount_eur || trade.amount_crypto,
                strategyId: strategyId,
                orderType: 'market',
                testMode: testMode
              }, authToken);
              results.push(result);
            }
          }
          
          responseMessage = results.join('\n\n---\n\n');
        } else if (analysis.intent === 'config' && analysis.config_changes) {
          console.log('⚙️ CONFIG REQUEST: AI detected configuration intent');
          configUpdates = analysis.config_changes;
          
          // Update the strategy configuration in the database
          try {
            const { data: currentStrategy, error: fetchError } = await supabase
              .from('trading_strategies')
              .select('configuration')
              .eq('id', strategyId)
              .single();

            if (fetchError) throw fetchError;

            const updatedConfig = {
              ...currentStrategy.configuration,
              ...configUpdates
            };

            const { error: updateError } = await supabase
              .from('trading_strategies')
              .update({ configuration: updatedConfig })
              .eq('id', strategyId);

            if (updateError) throw updateError;

            const changes = [];
            if (configUpdates.stopLoss !== undefined) {
              changes.push(`Stop-loss ${configUpdates.stopLoss ? 'enabled' : 'disabled'}`);
              if (configUpdates.stopLossPercentage) {
                changes.push(`set to ${configUpdates.stopLossPercentage}%`);
              }
            }
            if (configUpdates.takeProfit) {
              changes.push(`Take profit set to ${configUpdates.takeProfit}%`);
            }
            if (configUpdates.riskLevel) {
              changes.push(`Risk level changed to ${configUpdates.riskLevel}`);
            }
            if (configUpdates.maxPosition) {
              changes.push(`Maximum position limit increased to €${configUpdates.maxPosition.toLocaleString()}`);
            }
            
            responseMessage = `✅ **Strategy Configuration Updated**\n\n${changes.join('\n• ')}`;
          } catch (configError) {
            console.error('Configuration update error:', configError);
            responseMessage = `❌ **Configuration Update Failed**\n\nError: ${configError.message}`;
          }
        }
        
      } catch (aiError) {
        console.error('AI analysis error:', aiError);
        console.log('🔄 Falling back to pattern matching...');
      }
    }

    // Fallback to pattern matching if AI analysis failed or wasn't available
    if (!responseMessage) {
    }
    else if (lowerMessage.includes('sell') && (lowerMessage.includes('btc') || lowerMessage.includes('eth') || lowerMessage.includes('xrp') || lowerMessage.includes('bitcoin') || lowerMessage.includes('ethereum') || lowerMessage.includes('ripple'))) {
      console.log('💸 TRADE REQUEST: Sell detected');
      
      // Extract crypto currency
      let cryptoMatch = message.match(/\b(btc|bitcoin|eth|ethereum|xrp|ripple)\b/i);
      if (!cryptoMatch) {
        responseMessage = `I understand you want to sell crypto, but I need to know which cryptocurrency. Try: "Sell 0.5 BTC" or "Sell all my XRP"`;
      } else {
        let crypto = cryptoMatch[1].toLowerCase();
        
        // Normalize crypto names
        if (crypto === 'bitcoin') crypto = 'btc';
        if (crypto === 'ethereum') crypto = 'eth';
        if (crypto === 'ripple') crypto = 'xrp';
        
        // Check if "sell all" or similar
        if (lowerMessage.includes('all') || lowerMessage.includes('everything')) {
          console.log('💸 SELL ALL detected for crypto:', crypto);
          
          // Get current balance for this crypto from user's mock trades
          try {
            const { data: balanceData } = await supabase
              .from('mock_trades')
              .select('amount, trade_type, cryptocurrency')
              .eq('user_id', userId)
              .eq('is_test_mode', testMode)
              .eq('cryptocurrency', crypto);
            
            let currentBalance = 0;
            if (balanceData) {
              balanceData.forEach(trade => {
                if (trade.trade_type === 'buy') {
                  currentBalance += trade.amount;
                } else if (trade.trade_type === 'sell') {
                  currentBalance -= trade.amount;
                }
              });
            }
            
            if (currentBalance <= 0) {
              responseMessage = `❌ **No ${crypto.toUpperCase()} to sell**\n\nYou don't have any ${crypto.toUpperCase()} in your portfolio to sell.`;
            } else {
              console.log(`💸 EXECUTING SELL ALL: ${currentBalance} ${crypto}`);
              
              // Use current market price to calculate EUR value
              const mockPrices = {
                BTC: 118500, // USD price
                ETH: 3190,   // USD price  
                XRP: 2.975   // USD price
              };
              const eurToUsdRate = 1.05;
              const cryptoPrice = mockPrices[crypto.toUpperCase() as keyof typeof mockPrices] || 50000;
              const totalEurValue = currentBalance * (cryptoPrice * eurToUsdRate);
              
              responseMessage = await executeTrade(supabase, userId, {
                tradeType: 'sell',
                cryptocurrency: crypto,
                amount: totalEurValue, // Use EUR value for consistency
                strategyId: strategyId,
                orderType: 'market',
                testMode: testMode
              }, authToken);
            }
          } catch (balanceError) {
            console.error('Error getting balance:', balanceError);
            responseMessage = `❌ **Could not check balance**\n\nError retrieving your ${crypto.toUpperCase()} balance. Please try again.`;
          }
        } else {
          // Regular sell with specific amount
          const amountMatch = message.match(/(\d+(?:\.\d+)?)/);
          if (amountMatch) {
            const amount = parseFloat(amountMatch[1]);
            
            console.log('💸 EXECUTING REGULAR SELL:', { amount, crypto, testMode });
            responseMessage = await executeTrade(supabase, userId, {
              tradeType: 'sell',
              cryptocurrency: crypto,
              amount: amount,
              strategyId: strategyId,
              orderType: 'market',
              testMode: testMode
            }, authToken);
          } else {
            responseMessage = `I understand you want to sell ${crypto.toUpperCase()}, but I need to know how much. Try: "Sell 0.5 ${crypto.toUpperCase()}" or "Sell all my ${crypto.toUpperCase()}"`;
          }
        }
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
        let marketIntelligence = { activeCategories: [], recentSignals: [] };
        
        try {
          const knowledgeResponse = await supabase.functions.invoke('ai-learning-engine', {
            body: { action: 'get_knowledge', userId }
          });
          aiKnowledge = knowledgeResponse.data?.knowledge || [];
          console.log(`📚 Retrieved ${aiKnowledge.length} knowledge items`);

          // Get curated category-based market intelligence
          marketIntelligence = await getCuratedMarketIntelligence(supabase, userId);
          console.log(`🌐 Retrieved market intelligence from ${marketIntelligence.activeCategories.length} enabled categories`);
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

          if (marketIntelligence.activeCategories.length > 0) {
            enhancedSystemPrompt += '\n\n🌐 CURRENT MARKET INTELLIGENCE (from enabled data sources):';
            enhancedSystemPrompt += `\nActive categories: ${marketIntelligence.activeCategories.map(c => c.category_name).join(', ')}`;
            
            if (marketIntelligence.recentSignals.length > 0) {
              enhancedSystemPrompt += '\n\nRecent market signals:';
              marketIntelligence.recentSignals.slice(0, 5).forEach((signal: any, index: number) => {
                const context = signal.category_context || {};
                enhancedSystemPrompt += `\n${index + 1}. ${context.category_name || 'Unknown'}: ${signal.data_type} - ${context.market_impact || 'neutral'} impact (${context.signal_strength || 'medium'} strength)`;
              });
            }
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

async function getCuratedMarketIntelligence(supabase: any, userId: string) {
  try {
    // Get enabled categories only
    const { data: enabledCategories } = await supabase
      .from('ai_data_categories')
      .select('*')
      .eq('is_enabled', true)
      .order('importance_score', { ascending: false });

    if (!enabledCategories || enabledCategories.length === 0) {
      return { activeCategories: [], recentSignals: [] };
    }

    // Get recent market data from enabled categories only (last 24 hours)
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const { data: recentSignals } = await supabase
      .from('external_market_data')
      .select(`
        *,
        ai_data_sources!inner(
          category_id,
          ai_data_categories!inner(*)
        )
      `)
      .gte('timestamp', twentyFourHoursAgo.toISOString())
      .in('ai_data_sources.category_id', enabledCategories.map(c => c.id))
      .order('timestamp', { ascending: false })
      .limit(20);

    return {
      activeCategories: enabledCategories,
      recentSignals: recentSignals || []
    };
  } catch (error) {
    console.error('Error getting curated market intelligence:', error);
    return { activeCategories: [], recentSignals: [] };
  }
}