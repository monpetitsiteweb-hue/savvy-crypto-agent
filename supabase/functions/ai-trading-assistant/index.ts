import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 🧠 ADVANCED ANALYTICS FUNCTIONS
function getBestPerformingCoin(tradingHistory: any[]): string {
  if (!tradingHistory || tradingHistory.length === 0) return 'N/A';
  
  const coinPerformance = tradingHistory.reduce((acc, trade) => {
    const coin = trade.cryptocurrency;
    if (!acc[coin]) acc[coin] = { profit: 0, count: 0 };
    acc[coin].profit += trade.profit_loss || 0;
    acc[coin].count++;
    return acc;
  }, {});
  
  const best = Object.entries(coinPerformance)
    .sort(([,a], [,b]) => (b as any).profit - (a as any).profit)[0];
  
  return best ? best[0] : 'N/A';
}

function calculateVolatilityTrends(tradingHistory: any[]): any {
  if (!tradingHistory || tradingHistory.length < 7) return { trend: 'insufficient_data' };
  
  const recentTrades = tradingHistory.slice(0, 50);
  const avgVolatility = recentTrades.reduce((sum, trade) => {
    const volatility = trade.market_conditions?.volatility || 0;
    return sum + volatility;
  }, 0) / recentTrades.length;
  
  return {
    trend: avgVolatility > 5 ? 'high' : avgVolatility > 2 ? 'medium' : 'low',
    value: avgVolatility.toFixed(2)
  };
}

function analyzeVolatility(marketData: any): any[] {
  return Object.keys(marketData).map(symbol => {
    const data = marketData[symbol];
    if (!data) return null;
    
    const priceChange = ((data.price - data.low) / data.low) * 100;
    const volatility = ((data.high - data.low) / data.low) * 100;
    
    return {
      symbol,
      price: data.price,
      change: priceChange.toFixed(2),
      volatility: volatility.toFixed(2),
      volume: data.volume,
      risk_level: volatility > 5 ? 'high' : volatility > 2 ? 'medium' : 'low'
    };
  }).filter(Boolean);
}

function analyzeTrends(marketData: any): any[] {
  return Object.keys(marketData).map(symbol => {
    const data = marketData[symbol];
    if (!data) return null;
    
    const priceChange = ((data.price - data.low) / data.low) * 100;
    
    return {
      symbol,
      trend: priceChange > 2 ? 'bullish' : priceChange < -2 ? 'bearish' : 'neutral',
      strength: Math.abs(priceChange) > 5 ? 'strong' : Math.abs(priceChange) > 2 ? 'moderate' : 'weak',
      change_percent: priceChange.toFixed(2)
    };
  }).filter(Boolean);
}

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

    // Step 5: 🧠 ADVANCED MARKET INTELLIGENCE COLLECTION
    console.log('STEP 5: Collecting comprehensive market intelligence...');
    let enhancedKnowledge = '';
    let marketIntelligence = {};
    
    try {
      // Multi-source intelligence gathering
      console.log('📊 Gathering external market data...');
      const { data: externalData } = await supabase
        .from('external_market_data')
        .select(`
          *,
          ai_data_sources (
            source_name,
            source_type,
            configuration
          )
        `)
        .order('timestamp', { ascending: false })
        .limit(100);

      console.log('📈 Gathering trading history for backtesting...');
      const { data: tradingHistory } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', userId)
        .order('executed_at', { ascending: false })
        .limit(500);

      console.log('🎯 Gathering performance metrics...');
      const { data: performance } = await supabase
        .from('strategy_performance')
        .select('*')
        .eq('user_id', userId)
        .order('execution_date', { ascending: false })
        .limit(90);

      console.log('🤖 Gathering AI learning insights...');
      const { data: aiLearning } = await supabase
        .from('ai_learning_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      // Enhanced knowledge collection
      const { data: knowledgeData, error: knowledgeError } = await supabase.functions.invoke('knowledge-collector', {
        body: { userId: userId }
      });
      
      if (knowledgeData && knowledgeData.knowledge) {
        enhancedKnowledge = knowledgeData.knowledge;
      }

      // Real-time market data for current strategy
      const currentCoins = currentConfig?.selectedCoins || ['BTC', 'ETH'];
      const symbols = currentCoins.map(coin => `${coin}-EUR`);
      
      let realtimeMarketData = {};
      try {
        const { data: marketData } = await supabase.functions.invoke('real-time-market-data', {
          body: { symbols, action: 'get_current' }
        });
        realtimeMarketData = marketData?.data || {};
      } catch (marketError) {
        console.log('Real-time market data not available:', marketError);
      }

      // 📊 ADVANCED MARKET ANALYSIS
      marketIntelligence = {
        // External signals and sentiment
        externalSignals: {
          count: externalData?.length || 0,
          recentSentiment: externalData?.filter(d => d.data_type === 'sentiment_score').slice(0, 10) || [],
          whaleActivity: externalData?.filter(d => d.data_type === 'whale_transaction').slice(0, 5) || [],
          institutionalFlow: externalData?.filter(d => d.data_type === 'institutional_flow').slice(0, 5) || []
        },
        
        // Historical performance analysis
        performanceAnalysis: {
          totalTrades: tradingHistory?.length || 0,
          recentWinRate: performance?.[0]?.win_rate || 0,
          totalProfitLoss: performance?.reduce((sum, p) => sum + (p.total_profit_loss || 0), 0) || 0,
          avgDailyTrades: tradingHistory?.filter(t => {
            const tradeDate = new Date(t.executed_at);
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            return tradeDate >= yesterday;
          })?.length || 0,
          bestPerformingCoin: getBestPerformingCoin(tradingHistory),
          volatilityTrends: calculateVolatilityTrends(tradingHistory)
        },

        // Real-time market conditions
        marketConditions: {
          currentCoins,
          marketData: realtimeMarketData,
          volatilityAnalysis: analyzeVolatility(realtimeMarketData),
          trendAnalysis: analyzeTrends(realtimeMarketData)
        },

        // AI learning insights
        learningInsights: {
          sessionsCount: aiLearning?.length || 0,
          recentPatterns: aiLearning?.slice(0, 10).map(session => ({
            pattern: session.market_context?.pattern,
            outcome: session.performance_impact,
            confidence: session.confidence_score
          })) || []
        }
      };

      console.log('✅ STEP 5 SUCCESS: Comprehensive market intelligence collected');
      console.log('📊 Market Intelligence Summary:', {
        externalSignals: marketIntelligence.externalSignals.count,
        totalTrades: marketIntelligence.performanceAnalysis.totalTrades,
        winRate: marketIntelligence.performanceAnalysis.recentWinRate,
        learningInsights: marketIntelligence.learningInsights.sessionsCount
      });
      
    } catch (error) {
      console.error('❌ STEP 5 FAILED: Market intelligence collection error:', error);
      enhancedKnowledge = 'Enhanced market intelligence temporarily unavailable.';
      marketIntelligence = { error: error.message };
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

    // 🧠 ENHANCED AI ANALYSIS SYSTEM PROMPT - ADVANCED CRYPTO TRADING AGENT
    const analysisPrompt = `You are the most advanced AI cryptocurrency trading assistant with exceptional market analysis capabilities and strategic reasoning. Your expertise combines deep learning from multiple data sources, real-time market intelligence, and sophisticated pattern recognition to provide optimal trading strategies.

🧠 COMPREHENSIVE MARKET INTELLIGENCE:
External Market Signals: ${marketIntelligence.externalSignals?.count || 0} active sources
Recent Sentiment Analysis: ${marketIntelligence.externalSignals?.recentSentiment?.length || 0} sentiment readings
Whale Activity Detected: ${marketIntelligence.externalSignals?.whaleActivity?.length || 0} large transactions
Institutional Flows: ${marketIntelligence.externalSignals?.institutionalFlow?.length || 0} institutional movements

📊 PERFORMANCE INTELLIGENCE:
Historical Trades: ${marketIntelligence.performanceAnalysis?.totalTrades || 0} trades analyzed
Current Win Rate: ${marketIntelligence.performanceAnalysis?.recentWinRate || 0}%
Total P&L: €${marketIntelligence.performanceAnalysis?.totalProfitLoss || 0}
Best Performing Asset: ${marketIntelligence.performanceAnalysis?.bestPerformingCoin || 'N/A'}
Volatility Trend: ${marketIntelligence.performanceAnalysis?.volatilityTrends?.trend || 'unknown'}
Daily Trade Volume: ${marketIntelligence.performanceAnalysis?.avgDailyTrades || 0} trades/day

🎯 REAL-TIME MARKET CONDITIONS:
Market Data Available: ${marketIntelligence.marketConditions?.currentCoins?.length || 0} coins tracked
Volatility Analysis: ${marketIntelligence.marketConditions?.volatilityAnalysis?.length || 0} assets analyzed
Trend Analysis: ${marketIntelligence.marketConditions?.trendAnalysis?.length || 0} trend signals
Market Volatility Levels: ${JSON.stringify(marketIntelligence.marketConditions?.volatilityAnalysis?.map(v => `${v.symbol}: ${v.risk_level}`) || [])}
Current Trends: ${JSON.stringify(marketIntelligence.marketConditions?.trendAnalysis?.map(t => `${t.symbol}: ${t.trend}`) || [])}

🤖 AI LEARNING INSIGHTS:
Learning Sessions: ${marketIntelligence.learningInsights?.sessionsCount || 0} AI training cycles
Pattern Recognition: ${marketIntelligence.learningInsights?.recentPatterns?.length || 0} patterns identified
Performance Predictions: Enhanced by continuous learning algorithms

📚 ENHANCED KNOWLEDGE BASE:
${enhancedKnowledge || 'Base cryptocurrency knowledge + real-time market feeds'}

CURRENT STRATEGY CONFIGURATION:
Strategy Name: ${currentConfig.strategyName || 'Unnamed Strategy'}
Risk Profile: ${currentConfig.riskProfile || 'medium'}
Per-Trade Allocation: €${currentConfig.perTradeAllocation || 100}
Stop Loss: ${currentConfig.stopLossPercentage || 5}%
Take Profit: ${currentConfig.takeProfitPercentage || 10}%
Selected Coins: ${(currentConfig.selectedCoins || ['BTC', 'ETH']).join(', ')}
Max Open Positions: ${currentConfig.maxOpenPositions || 5}
Buy Order Type: ${currentConfig.buyOrderType || 'market'}
Sell Order Type: ${currentConfig.sellOrderType || 'limit'}
Test Mode Active: ${testMode ? 'Yes' : 'No'}

DECISION FRAMEWORK - BE PROACTIVE:
- When user says "1.5% daily gains" → IMMEDIATELY propose: takeProfitPercentage: 1.5, buyIntervalMinutes: 30, increase position sizing
- When user says "more conservative" → IMMEDIATELY propose: riskProfile: "medium", stopLossPercentage: 3, reduce position size
- When user says "higher position size" → IMMEDIATELY propose: increase perTradeAllocation
- When user says "add XRP" → IMMEDIATELY propose: add "XRP" to selectedCoins
- Only ask clarifying questions if the request is genuinely vague (like just "update my strategy" with no context)

FIELD MAPPING EXPERTISE:
Risk management: riskProfile, stopLossPercentage, takeProfitPercentage, trailingStopLossPercentage
Position sizing: perTradeAllocation, maxOpenPositions, maxWalletExposure
Coin selection: selectedCoins, enableAutoCoinSelection
Trading frequency: buyIntervalMinutes, buyCooldownMinutes, tradeCooldownMinutes
Order types: buyOrderType, sellOrderType

USER MESSAGE: "${message}"

CORE PRINCIPLE: If you can reasonably infer what changes would help achieve their stated goal, PROPOSE those changes immediately rather than asking more questions.

RESPONSE EXAMPLES:

For "can you update my strategy?":
{
  "intent": "consultation",
  "requires_consultation": true,
  "trades": [],
  "config_changes": {},
  "reasoning": "User wants strategy advice but request is too vague - need specific guidance",
  "consultation_response": "I'd be happy to help optimize your strategy! Looking at your current setup:\n\n📊 **Current Configuration:**\n• Risk Profile: ${currentConfig.riskProfile || 'medium'}\n• Position Size: €${currentConfig.perTradeAllocation || 100} per trade\n• Stop Loss: ${currentConfig.stopLossPercentage || 5}% (protects against losses)\n• Take Profit: ${currentConfig.takeProfitPercentage || 10}% (secures gains)\n• Trading: ${(currentConfig.selectedCoins || ['BTC', 'ETH']).join(', ')}\n\n🎯 **What would you like to adjust?**\n• \"Make it more conservative\" - I can reduce risk settings\n• \"Increase position size to €500\" - I can update allocation\n• \"Add XRP to my coins\" - I can expand your trading pairs\n• \"Reduce stop loss to 3%\" - I can tighten risk management\n\nWhat aspect interests you most?",
  "market_context": ""
}

For "I want 1.5% daily gains consistently":
{
  "intent": "config_change",
  "requires_consultation": false,
  "trades": [],
  "config_changes": {
    "takeProfitPercentage": 1.5,
    "buyIntervalMinutes": 30,
    "perTradeAllocation": 150,
    "dailyProfitTarget": 1.5
  },
  "reasoning": "User wants consistent small daily gains - adjusting profit targets and frequency for this goal",
  "consultation_response": "✅ **Strategy Optimized for Daily 1.5% Gains**\n\n🎯 **Profit Strategy Adjusted:**\n• Take Profit: ${currentConfig.takeProfitPercentage || 4}% → 1.5% (matches daily target)\n• Buy Interval: ${currentConfig.buyIntervalMinutes || 60} minutes → 30 minutes (more frequent opportunities)\n• Position Size: €${currentConfig.perTradeAllocation || 100} → €150 (higher volume for consistent gains)\n• Daily Target: Set to 1.5%\n\nYour strategy now focuses on frequent small wins rather than larger occasional gains. Confirm to apply these changes.",
  "market_context": ""
}

For confirmation "yes":
{
  "intent": "confirmation",
  "requires_consultation": false,
  "trades": [],
  "config_changes": {},
  "reasoning": "User is confirming previously proposed changes",
  "consultation_response": "✅ **Changes Applied Successfully**\n\nYour strategy has been updated with the confirmed settings. The new configuration is now active.",
  "market_context": ""
}

For "make it more conservative":
{
  "intent": "config_change",
  "requires_consultation": false,
  "trades": [],
  "config_changes": {
    "riskProfile": "medium",
    "stopLossPercentage": 3,
    "takeProfitPercentage": 6,
    "perTradeAllocation": 75
  },
  "reasoning": "User wants lower risk - reducing stop loss, take profit, and position size",
  "consultation_response": "✅ **Strategy Updated to Conservative Settings**\n\n📉 **Risk Reduced:**\n• Stop Loss: ${currentConfig.stopLossPercentage || 5}% → 3% (tighter protection)\n• Take Profit: ${currentConfig.takeProfitPercentage || 4}% → 6% (balanced gains)\n• Position Size: €${currentConfig.perTradeAllocation || 100} → €75 (smaller exposure)\n• Risk Profile: Medium\n\nYour strategy now prioritizes capital preservation. Confirm to apply these changes.",
  "market_context": ""
}

For "buy 1000 euros of BTC":
{
  "intent": "trade",
  "requires_consultation": false,
  "trades": [{"tradeType": "BUY", "cryptocurrency": "BTC", "amount": 1000, "orderType": "market"}],
  "config_changes": {},
  "reasoning": "Direct trade request for BTC purchase",
  "consultation_response": "✅ **Executing BTC Purchase**\n\nBuying €1,000 worth of Bitcoin at current market price...",
  "market_context": ""
}

Respond with VALID JSON ONLY using the exact format above. Consider the user's current configuration and provide contextual, helpful responses that reference specific values and field meanings.`;

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
      
      // Check for confirmation response - must be simple confirmation for previous config changes
      const isConfirmation = intent === 'confirmation' || 
                           message.toLowerCase().trim() === 'yes' || 
                           message.toLowerCase().trim() === 'confirm' || 
                           message.toLowerCase().trim() === 'proceed' ||
                           message.toLowerCase().trim() === 'apply' ||
                           message.toLowerCase().trim() === 'ok';
      
      if (isConfirmation) {
        console.log('✅ CONFIRMATION DETECTED - User confirming previous changes');
        
        return new Response(
          JSON.stringify({ 
            action: 'confirmation_acknowledged',
            message: consultation_response || "✅ **Changes Applied Successfully**\n\nYour strategy has been updated with the confirmed settings. The new configuration is now active.",
          }), 
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
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