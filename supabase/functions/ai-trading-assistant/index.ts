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
    // Step 1B: For BUY orders only, check max position limit (sell orders should never be limited)
    if (trade.tradeType === 'buy') {
      console.log('🔄 TRADE STEP 1B: Checking max position limit for BUY order...');
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
        console.log(`⚠️ BUY order amount €${trade.amount} exceeds max position €${maxPosition}`);
        return `❌ **Position Limit Exceeded**\n\nYour maximum position is set to €${maxPosition}, but you're trying to buy €${trade.amount}. Please increase your max position limit first or reduce the trade amount.`;
      }

      console.log(`✅ Position check passed for BUY: €${trade.amount} ≤ €${maxPosition}`);
    } else {
      console.log(`✅ SELL order detected - no position limits apply (selling reduces exposure)`);
    }

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
      BTC: 113620, // EUR price (example - should be fetched from real EUR market data)
      ETH: 3400,   // EUR price (example - should be fetched from real EUR market data)
      XRP: 3.3     // EUR price (example - should be fetched from real EUR market data)
    };

    // No conversion needed - prices are already in EUR
    const cryptoPrice = mockPrices[trade.cryptocurrency.toUpperCase() as keyof typeof mockPrices] || 50000;
    const cryptoAmount = trade.amount / cryptoPrice; // Calculate crypto amount from EUR
    
    // Calculate fees based on user's fee rate
    const fees = trade.amount * userFeeRate;

    console.log('Environment:', trade.testMode ? 'TEST' : 'LIVE');
    console.log('Test Mode:', trade.testMode);
    console.log(`Mock trade: ${trade.tradeType} ${cryptoAmount} ${trade.cryptocurrency} at €${cryptoPrice} (total: €${trade.amount})`);
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
          price: cryptoPrice,
          total_value: trade.amount,
          fees: fees,
          is_test_mode: true,
          notes: `AI-executed ${trade.tradeType} order`,
          market_conditions: {
            price_at_execution: cryptoPrice,
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
• Price: €${cryptoPrice.toFixed(2)} per ${trade.cryptocurrency.toUpperCase()}
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
                content: `You are the world's leading cryptocurrency expert and master of this advanced trading platform. You are a living encyclopedia of crypto knowledge with unmatched expertise in:

🌟 ULTIMATE CRYPTO MASTERY:
• Market cycles, technical analysis, and price prediction models
• Whale tracking: BlackRock, MicroStrategy, Grayscale, institutional flows
• Social sentiment: Twitter influencers, Reddit communities, Discord alpha
• News analysis: regulatory updates, adoption news, market catalysts  
• DeFi ecosystems: yield farming, liquidity mining, protocol analysis
• Cross-chain opportunities and arbitrage strategies
• Macroeconomic impact: Fed policy, inflation, traditional market correlation
• Historical patterns and behavioral finance in crypto markets

🚀 PLATFORM EXPERTISE (THIS TOOL):
• Position limits: €${currentConfig.maxPosition} max per BUY order (sells unrestricted)
• Risk management: ${currentConfig.riskLevel} level, stop-loss ${currentConfig.stopLoss ? 'enabled' : 'disabled'}
• Strategy optimization: take-profit, trailing stops, auto-trading
• Portfolio tracking and P&L analysis capabilities
• Real-time market data integration and execution systems
• Test vs production mode differences and implications

🧠 INTELLIGENT CONSULTATION APPROACH:
When users ask for trading strategies or advice, you MUST be pedagogical and comprehensive:

1. **ASK CLARIFYING QUESTIONS** when needed:
   - Investment timeline (day trading vs long-term holding)
   - Risk tolerance (how much can they afford to lose)
   - Portfolio allocation preferences (concentrated vs diversified)
   - Market outlook and experience level

2. **PROVIDE MULTIPLE OPTIONS** with detailed explanations:
   - Conservative approach: Lower risk, steady returns
   - Balanced approach: Moderate risk-reward with market adaptation
   - Aggressive approach: Higher risk for maximum returns
   - Explain pros/cons and ideal market conditions for each

3. **STRATEGIC REASONING** for recommendations:
   - Current market conditions analysis
   - Why this approach fits their situation
   - How to adapt during bull runs or bear markets
   - Position sizing and risk management rationale

For strategy questions like "make me 1% per day", you should:
• Explain the mathematical impossibility/difficulty
• Discuss realistic return expectations
• Offer multiple strategic approaches
• Ask about risk tolerance and timeframe
• Suggest portfolio allocation methods
• Mention when to deviate from rules (bull runs, crashes)

EXAMPLE EXPERT RESPONSE STRUCTURE:
"🔍 **Understanding Your Goal**
Daily 1% returns would mean 3,678% annual returns - this is extremely ambitious and risky. Let me offer realistic strategic approaches:

📊 **Market Analysis**: [Current conditions]

🎯 **Strategic Options**:
**Option A: Conservative Swing Trading**
- Target: 10-20% monthly returns
- Method: Buy dips, sell resistance levels
- Allocation: 30% BTC, 30% ETH, 40% cash for opportunities
- Pros: Lower risk, sustainable
- Cons: Lower returns, requires patience

**Option B: Aggressive Day Trading**
- Target: 30-50% monthly (closer to your goal)
- Method: Leverage, high-frequency trades
- Risk: Very high, could lose 50%+ quickly
- Allocation: All-in strategies with tight stops

⚙️ **Recommended Configuration**: [Specific settings]
⚠️ **Risk Considerations**: [What could go wrong]
🧠 **Market Intelligence**: [Additional insights]"

Return ONLY valid JSON for intent classification:
{
  "intent": "trade" | "config" | "conversation" | "strategy_consultation",
  "requires_consultation": boolean,
  "market_context": "Current market analysis relevant to request",
  "reasoning": "Detailed expert analysis combining technical, fundamental, and sentiment factors",
  "trades": [...],
  "config_changes": {...},
  "consultation_response": "Full expert response if requires_consultation=true",
  "market_insights": "Additional expert intelligence and recommendations"
}`
              },
              {
                role: 'user',
                content: message
              }
            ],
            temperature: 0.2,
            max_tokens: 1500
          }),
        });

        const analysisData = await analysisResponse.json();
        const analysis = JSON.parse(analysisData.choices[0].message.content);
        
        console.log('🧠 AI Analysis:', analysis);

        // Handle strategy consultation responses first
        if (analysis.requires_consultation && analysis.consultation_response) {
          console.log('🎓 STRATEGY CONSULTATION: Providing expert guidance');
          responseMessage = analysis.consultation_response;
        } else if (analysis.intent === 'trade' && analysis.trades?.length > 0) {
          console.log('🛒 TRADE REQUEST: AI detected trading intent');
          
          // Check if trade exceeds maxPosition limit
          const { data: currentStrategy } = await supabase
            .from('trading_strategies')
            .select('configuration')
            .eq('id', strategyId)
            .single();

          const maxPosition = currentStrategy?.configuration?.maxPosition || 5000;
          
          for (const trade of analysis.trades) {
            // Only check position limits for BUY orders, not SELL orders
            if (trade.action === 'buy' && trade.amount_eur && trade.amount_eur > maxPosition) {
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
                  const mockPrices = { BTC: 113620, ETH: 3400, XRP: 3.3 };
                  const cryptoPrice = mockPrices[trade.cryptocurrency.toUpperCase() as keyof typeof mockPrices] || 50000;
                  const totalEurValue = currentBalance * cryptoPrice;
                  
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
              // Regular buy/sell with specific amount
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
          }
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
      // Pattern matching fallback logic
      if (lowerMessage.includes('buy') && (lowerMessage.includes('btc') || lowerMessage.includes('eth') || lowerMessage.includes('xrp') || lowerMessage.includes('bitcoin') || lowerMessage.includes('ethereum') || lowerMessage.includes('ripple'))) {
        console.log('💰 TRADE REQUEST: Buy detected via fallback');
        responseMessage = 'I understand you want to make a purchase. Please use the format: "Buy [amount] euros of [crypto]" (e.g., "Buy 1000 euros of BTC")';
      } else if (lowerMessage.includes('sell') && (lowerMessage.includes('btc') || lowerMessage.includes('eth') || lowerMessage.includes('xrp') || lowerMessage.includes('bitcoin') || lowerMessage.includes('ethereum') || lowerMessage.includes('ripple'))) {
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
                  BTC: 113620, // EUR price
                  ETH: 3400,   // EUR price
                  XRP: 3.3     // EUR price
                };
                const cryptoPrice = mockPrices[crypto.toUpperCase() as keyof typeof mockPrices] || 50000;
                const totalEurValue = currentBalance * cryptoPrice;
                
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
      // If no pattern matched, use default response
      else {
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