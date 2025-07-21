import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StrategyUpdateRequest {
  message: string;
  userId: string;
  strategyId: string;
  currentConfig: any;
}

interface TradeRequest {
  tradeType: 'BUY' | 'SELL';
  cryptocurrency: string;
  amount: number;
  orderType?: string;
  strategyId: string;
  testMode?: boolean;
}

async function executeTrade(trade: TradeRequest, userId: string, authToken: string): Promise<string> {
  try {
    console.log('🔄 TRADE STEP 1: Validating trade parameters...');
    
    if (!trade.cryptocurrency || !trade.amount || trade.amount <= 0) {
      console.error('❌ TRADE STEP 1 FAILED: Invalid trade parameters');
      return `❌ **Trading Parameters Invalid**\n\nError: Missing or invalid trading parameters\n\nRequired: cryptocurrency and amount > 0`;
    }
    
    console.log('✅ TRADE STEP 1 SUCCESS: Parameters validated');
    console.log('🔄 TRADE STEP 2: Fetching real-time market data...');

    // Step 2: Get market data for validation
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: marketData, error: marketError } = await supabase.functions.invoke('real-time-market-data', {
      body: { symbols: [`${trade.cryptocurrency}-EUR`], action: 'get_current' }
    });

    if (marketError) {
      console.error('❌ TRADE STEP 2 FAILED: Market data fetch error:', marketError);
      return `❌ **Market Data Unavailable**\n\nError: Unable to fetch current market data for ${trade.cryptocurrency}\n\nDetails: ${marketError.message}`;
    }

    console.log('✅ TRADE STEP 2 SUCCESS: Market data received:', marketData);
    const cryptoSymbol = `${trade.cryptocurrency}-EUR`;
    const cryptoData = marketData.data?.[cryptoSymbol];
    const cryptoPrice = parseFloat(cryptoData?.price) || 1; // Fallback price
    const cryptoAmount = trade.amount / cryptoPrice;
    
    console.log('✅ TRADE STEP 2 SUCCESS: Market data retrieved');
    console.log(`📊 Current ${trade.cryptocurrency} price: €${cryptoPrice.toFixed(2)}`);

    // Step 3: Record the trade in mock_trades table for test mode or trading_history for live
    console.log('🔄 TRADE STEP 3: Recording trade...');
    
    if (trade.testMode) {
      // Test mode: insert into mock_trades
      const { error: insertError } = await supabase
        .from('mock_trades')
        .insert({
          user_id: userId,
          strategy_id: trade.strategyId,
          trade_type: trade.tradeType.toLowerCase(),
          cryptocurrency: trade.cryptocurrency,
          amount: cryptoAmount,
          price: cryptoPrice,
          total_value: trade.amount,
          fees: 0, // Fee-free account
          executed_at: new Date().toISOString(),
          is_test_mode: true,
          market_conditions: {
            price: cryptoPrice,
            timestamp: new Date().toISOString()
          }
        });

      if (insertError) {
        console.error('❌ TRADE STEP 3 FAILED: Mock trade recording error:', insertError);
        return `❌ **Trade Recording Failed**\n\nError: Unable to record test trade\n\nDetails: ${insertError.message}`;
      }
      
      console.log('✅ TRADE STEP 3 SUCCESS: Mock trade recorded');
    } else {
      console.log('🔄 TRADE STEP 4: Executing live trade via Coinbase...');
      
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

    // Step 3: Initialize database connection
    console.log('STEP 3: Initializing database connection...');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('STEP 3 FAILED: Missing Supabase configuration');
      return new Response(JSON.stringify({ 
        error: 'Database configuration missing',
        step: 'STEP_3_DATABASE_INIT',
        message: `❌ **Step 3 Failed**: Database configuration is missing\n\n**Required:** Supabase URL and Service Key must be configured`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log('STEP 3 SUCCESS: Database client initialized');

    // Step 4: Load LLM configuration
    console.log('STEP 4: Loading LLM configuration...');
    const { data: llmConfig, error: llmError } = await supabase
      .from('llm_configurations')
      .select('*')
      .eq('is_active', true)
      .single();

    if (llmError || !llmConfig) {
      console.error('STEP 4 FAILED: LLM configuration not found:', llmError);
      return new Response(JSON.stringify({ 
        error: 'LLM configuration missing',
        step: 'STEP_4_LLM_CONFIG',
        message: `❌ **Step 4 Failed**: LLM configuration not found\n\n**Required:** Active LLM configuration must be set up in admin panel`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
     console.log('STEP 4 SUCCESS: LLM configuration loaded');

    // Step 5: Collect enhanced knowledge from user's data sources
    console.log('STEP 5: Collecting enhanced market intelligence...');
    let enhancedKnowledge = '';
    
    try {
      const { data: knowledgeData, error: knowledgeError } = await supabase.functions.invoke('knowledge-collector', {
        body: { userId: userId }
      });
      
      if (knowledgeData && knowledgeData.knowledge) {
        enhancedKnowledge = knowledgeData.knowledge;
        console.log('✅ STEP 5 SUCCESS: Enhanced knowledge collected');
      } else {
        console.log('⚠️ STEP 5 WARNING: No enhanced knowledge available');
        enhancedKnowledge = 'No additional market intelligence sources configured.';
      }
    } catch (knowledgeError) {
      console.error('❌ STEP 5 FAILED: Knowledge collection error:', knowledgeError);
      enhancedKnowledge = 'Enhanced market intelligence temporarily unavailable.';
    }

    // Step 6: Analyze user intent with AI
    console.log('💬 Using AI to analyze user intent...');
    
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      console.error('STEP 5 FAILED: OpenAI API key missing');
      return new Response(JSON.stringify({ 
        error: 'OpenAI API key missing',
        step: 'STEP_5_AI_ANALYSIS',
        message: `❌ **Step 5 Failed**: OpenAI API key not configured\n\n**Required:** OpenAI API key must be set up for AI analysis`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // AI Analysis System Prompt - INTELLIGENT STRATEGY ASSISTANT
    const analysisPrompt = `You are an intelligent cryptocurrency trading assistant. Analyze user requests and provide thoughtful, contextual responses based on their current strategy configuration.

ENHANCED MARKET INTELLIGENCE:
${enhancedKnowledge}

CURRENT STRATEGY CONFIGURATION:
${JSON.stringify(currentConfig, null, 2)}

TEST MODE: ${testMode ? 'Yes - all trades are simulated' : 'No - trades will be executed live'}

TASK: Analyze the user message and determine appropriate action. Consider their current configuration when making recommendations.

USER MESSAGE: "${message}"

RESPONSE GUIDELINES:
1. If user wants to update strategy settings, provide specific config_changes
2. If user wants to execute trades, include trade details
3. If user asks general questions, provide consultation_response
4. Always consider their current strategy when making recommendations
5. Use perTradeAllocation field for position sizing
6. Use appropriate field names that exist in the configuration

AVAILABLE CONFIGURATION FIELDS (use exact names):
- perTradeAllocation: Amount per trade in EUR
- maxOpenPositions: Maximum simultaneous positions
- stopLossPercentage: Stop loss percentage
- takeProfitPercentage: Take profit percentage
- riskProfile: "low", "medium", "high", or "custom"
- trailingStopLossPercentage: Trailing stop loss
- selectedCoins: Array of cryptocurrency symbols
- buyOrderType: "market", "limit", or "trailing"
- sellOrderType: "market", "limit", or "trailing"

Respond with VALID JSON ONLY:
{
  "intent": "config_change|trade|consultation|general",
  "requires_consultation": false,
  "trades": [{"tradeType": "BUY|SELL", "cryptocurrency": "BTC|ETH|XRP", "amount": 1000, "orderType": "market"}],
  "config_changes": {"perTradeAllocation": 1000},
  "reasoning": "Brief explanation of the decision",
  "consultation_response": "Response to show the user",
  "market_context": "Market insights if relevant"
}

EXAMPLES:

"increase my position size to 1000 euros":
{
  "intent": "config_change",
  "requires_consultation": false,
  "trades": [],
  "config_changes": {"perTradeAllocation": 1000},
  "reasoning": "User wants to increase position size per trade to €1000",
  "consultation_response": "✅ Updated position size to €1000 per trade.",
  "market_context": ""
}

"can you update my strategy?":
{
  "intent": "consultation",
  "requires_consultation": true,
  "trades": [],
  "config_changes": {},
  "reasoning": "User wants general strategy advice - need more specific information",
  "consultation_response": "I'd be happy to help update your strategy! What specific aspect would you like to adjust? For example:\n\n• Position size (currently €${currentConfig.perTradeAllocation || 100})\n• Risk settings (stop loss: ${currentConfig.stopLossPercentage || 5}%)\n• Coins to trade (currently: ${(currentConfig.selectedCoins || ['BTC', 'ETH']).join(', ')})\n• Take profit target (currently: ${currentConfig.takeProfitPercentage || 10}%)\n\nWhat would you like to change?",
  "market_context": ""
}`;

    try {
      const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: llmConfig.model || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: analysisPrompt },
            { role: 'user', content: message }
          ],
          temperature: llmConfig.temperature || 0.3,
          max_tokens: llmConfig.max_tokens || 2000,
        }),
      });

      if (!aiResponse.ok) {
        throw new Error(`OpenAI API error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const analysisContent = aiData.choices[0].message.content;
      
      console.log('🧠 AI Analysis:', analysisContent);
      
      // Parse the AI response
      let analysis;
      try {
        analysis = JSON.parse(analysisContent);
      } catch (parseError) {
        console.error('Failed to parse AI response:', parseError);
        analysis = {
          intent: 'general',
          requires_consultation: true,
          consultation_response: analysisContent
        };
      }

      const { intent, requires_consultation, trades, config_changes, consultation_response } = analysis;

      // First, handle config changes if any
      if (config_changes && Object.keys(config_changes).length > 0) {
        console.log('🔧 UPDATING STRATEGY CONFIG:', config_changes);
        
        // Get current strategy configuration
        const { data: currentStrategy, error: fetchError } = await supabase
          .from('trading_strategies')
          .select('configuration')
          .eq('id', strategyId)
          .eq('user_id', userId)
          .single();
          
        if (fetchError) {
          console.error('❌ CONFIG FETCH FAILED:', fetchError);
          return new Response(JSON.stringify({ 
            error: 'Failed to fetch current strategy',
            message: `❌ Could not fetch current strategy configuration: ${fetchError.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        // Merge new config changes with existing configuration
        const updatedConfiguration = {
          ...currentStrategy.configuration,
          ...config_changes
        };
        
        // Update the strategy configuration
        const { error: updateError } = await supabase
          .from('trading_strategies')
          .update({ configuration: updatedConfiguration })
          .eq('id', strategyId)
          .eq('user_id', userId);
          
        if (updateError) {
          console.error('❌ CONFIG UPDATE FAILED:', updateError);
        } else {
          console.log('✅ STRATEGY CONFIG UPDATED SUCCESSFULLY');
        }
      }

      // Check for direct action intent - execute trades immediately
      if ((intent === 'trade' || intent === 'config_change') && !requires_consultation) {
        console.log('💬 Processing direct action request...');
        
        // If there are trades to execute
        if (trades && trades.length > 0) {
          console.log('💬 Executing trade:', trades[0]);
          
          // Update the trade request with new config if needed
          const updatedTrade = {
            ...trades[0],
            strategyId: strategyId,
            testMode: testMode
          };
          
          const tradeResult = await executeTrade(updatedTrade, userId, authToken);
          
          return new Response(
            JSON.stringify({ 
              action: 'trade_executed',
              message: tradeResult,
              config_updated: !!config_changes,
              trades: trades
            }), 
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        // If only config changes (no trades)
        if (config_changes && Object.keys(config_changes).length > 0) {
          return new Response(
            JSON.stringify({ 
              action: 'config_updated',
              message: consultation_response || '✅ Strategy configuration updated successfully.',
              config_changes: config_changes
            }), 
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
      }
      
      // Check for confirmation response
      if (intent === 'confirmation' || message.toLowerCase().includes('yes') || message.toLowerCase().includes('confirm') || message.toLowerCase().includes('proceed')) {
        // Parse the context to find pending trade
        const buyMatch = message.match(/(\d+)\s*euros?\s+of\s+(\w+)/i);
        if (buyMatch) {
          const [, amount, crypto] = buyMatch;
          const trade = {
            tradeType: 'BUY' as const,
            cryptocurrency: crypto.toUpperCase(),
            amount: parseFloat(amount),
            orderType: currentConfig.orderType || 'market',
            strategyId: strategyId,
            testMode: testMode
          };
          
          console.log('💬 Executing confirmed trade:', trade);
          const tradeResult = await executeTrade(trade, userId, authToken);
          
          return new Response(
            JSON.stringify({ 
              action: 'trade_executed',
              message: tradeResult,
              trades: [trade]
            }), 
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
      }

      // For consultation responses or strategy advice
      if (requires_consultation || intent === 'strategy_advice') {
        console.log('🎓 STRATEGY CONSULTATION: Providing expert guidance');
        
        return new Response(
          JSON.stringify({ 
            action: 'consultation',
            message: consultation_response || analysis.consultation_response || analysisContent,
            config_changes: config_changes || {},
            market_insights: analysis.market_context
          }), 
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      // Default response for unhandled cases
      return new Response(
        JSON.stringify({ 
          action: 'general_response',
          message: consultation_response || analysisContent,
        }), 
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );

    } catch (aiError) {
      console.error('AI Analysis Error:', aiError);
      return new Response(JSON.stringify({ 
        error: 'AI analysis failed',
        message: `❌ **AI Analysis Failed**\n\nError: ${aiError.message}\n\nPlease try again or contact support if the issue persists.`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({ 
      error: 'Function execution failed',
      message: `❌ **Function Error**\n\nError: ${error.message}\n\nPlease try again or contact support if the issue persists.`
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});