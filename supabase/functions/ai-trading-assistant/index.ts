import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
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

      // Get recent conversation history for context (last 10 exchanges)
      const { data: conversationHistory } = await supabaseClient
        .from('conversation_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20); // Last 20 messages (10 exchanges)

      // Build conversation context from history
      let conversationContext = '';
      if (conversationHistory && conversationHistory.length > 0) {
        const recentHistory = conversationHistory
          .reverse() // Most recent first in time order
          .slice(-10) // Keep only last 10 messages for context
          .map(msg => {
            const isAI = msg.message_type === 'ai_response' || msg.message_type === 'ai_recommendation';
            const role = isAI ? 'Assistant' : 'User';
            const timestamp = new Date(msg.created_at).toLocaleTimeString();
            return `[${timestamp}] ${role}: ${msg.content}`;
          })
          .join('\n');
          
        conversationContext = `
RECENT CONVERSATION HISTORY:
${recentHistory}

CONTEXT NOTES:
- When user says "yes please adjust based on this recommendation" or similar confirmations, reference the last AI recommendation above
- When user asks to "apply the changes" or "implement the suggestion", look for the most recent AI recommendation with configUpdates
- Maintain conversational continuity by referencing previous exchanges when relevant
`;
      }

      // ALWAYS fetch current strategy from database for truth-bound responses
      let actualStrategy = null;
      let actualConfig = null;
      
      if (strategyId) {
        console.log(`🔍 Fetching current strategy ${strategyId} from database for truth-bound response`);
        const { data: strategy, error: strategyError } = await supabaseClient
          .from('trading_strategies')
          .select('*')
          .eq('id', strategyId)
          .eq('user_id', userId)
          .single();
          
        if (strategy && !strategyError) {
          actualStrategy = strategy;
          actualConfig = strategy.configuration;
          console.log(`✅ Fetched real strategy config: AI enabled=${actualConfig?.is_ai_enabled}, Risk=${actualConfig?.riskProfile}, Coins=${actualConfig?.selectedCoins?.length || 0}`);
        } else {
          console.log(`❌ Could not fetch strategy ${strategyId}:`, strategyError);
        }
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
      
      if (strategyId && actualConfig) {
        // Use REAL database configuration for truth-bound responses
        const strategyType = actualConfig.strategyType || 'balanced';
        const riskLevel = actualConfig.riskLevel || actualConfig.riskProfile || 'medium';
        const stopLoss = actualConfig.stopLoss || actualConfig.stop_loss || 'not set';
        const takeProfit = actualConfig.takeProfit || actualConfig.take_profit || 'not set';
        const maxPositionSize = actualConfig.maxPositionSize || actualConfig.max_position_size || 'not set';
        const indicators = actualConfig.indicators || actualConfig.technical_indicators || [];
        const entryRules = actualConfig.entryRules || actualConfig.entry_conditions;
        const exitRules = actualConfig.exitRules || actualConfig.exit_conditions;
        const isAIEnabled = actualConfig.is_ai_enabled || false;
        const aiOverrideEnabled = actualConfig.ai_override_enabled || false;
        const selectedCoins = actualConfig.selectedCoins || [];
        const trailingBuyPercentage = actualConfig.trailingBuyPercentage || 'not set';
        
        strategyAnalysis = `
CURRENT STRATEGY ANALYSIS (REAL DATABASE STATE):
- Strategy ID: ${strategyId}
- Strategy Name: ${actualStrategy.strategy_name}
- Strategy Type: ${strategyType}
- Risk Profile: ${riskLevel}
- AI Enabled: ${isAIEnabled ? 'YES' : 'NO'}
- AI Override Enabled: ${aiOverrideEnabled ? 'YES' : 'NO'}
- Selected Coins: ${Array.isArray(selectedCoins) ? selectedCoins.join(', ') : 'All coins'}
- Trailing Buy %: ${trailingBuyPercentage}${typeof trailingBuyPercentage === 'number' ? '%' : ''}
- Stop Loss: ${stopLoss}${typeof stopLoss === 'number' ? '%' : ''}
- Take Profit: ${takeProfit}${typeof takeProfit === 'number' ? '%' : ''}
- Max Position Size: ${maxPositionSize}
- Technical Indicators: ${Array.isArray(indicators) ? indicators.join(', ') : indicators || 'Standard indicators'}
- Entry Rules: ${entryRules || 'Market-based entry conditions'}
- Exit Rules: ${exitRules || 'Stop-loss and take-profit based exits'}
- Test Mode: ${testMode}
- Active in Test Mode: ${actualStrategy.is_active_test ? 'YES' : 'NO'}
- Active in Live Mode: ${actualStrategy.is_active_live ? 'YES' : 'NO'}

CRITICAL: When answering user questions about current settings, ALWAYS reference these actual database values above.
When user asks "is AI enabled?", the answer is: ${isAIEnabled ? 'YES' : 'NO'}
When user asks "what coins are allowed?", the answer is: ${Array.isArray(selectedCoins) ? selectedCoins.join(', ') : 'All coins available'}
When user asks about risk level, the answer is: ${riskLevel}
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

      // Enhanced system prompt with conversational, human-like tone
      const systemPrompt = `You are Alex, a seasoned cryptocurrency trader with 8+ years of experience. You talk like a real person having a casual but professional conversation about trading.

${conversationContext}
${strategyAnalysis}
${recentTradingContext}
${marketContext}
${whaleContext}
${indicatorContextText}

YOUR PERSONALITY:
- Speak naturally like you're chatting with a trading buddy over coffee
- Use contractions (I'll, you're, we've, etc.) and casual language
- Be confident but not arrogant - you know your stuff but stay humble
- Skip the overly formal explanations - get straight to the point
- When someone says "yes please" or "ok do it", just do it and briefly confirm what you changed
- Don't announce that you're "applying recommendations" - just make the changes naturally

YOUR EXPERTISE:
1. **Strategy Tweaks**: When users want changes, make them and casually mention what you adjusted
2. **Market Analysis**: Share insights like you're explaining to a friend who trades
3. **Technical Indicators**: Reference live data naturally in conversation, not like reading a manual
4. **Trading Decisions**: Explain your reasoning like you're thinking out loud

CONVERSATION STYLE EXAMPLES:

Instead of: "Your message 'yes please' indicates confirmation to apply the most recent recommendation..."
Say: "Got it! I've lowered your take profit to 0.75% so you'll be selling more frequently. Should see more action now."

Instead of: "Based on the current RSI value of 27.2, which indicates oversold conditions..."
Say: "RSI on ETH is sitting at 27 - that's oversold territory, usually a good buying opportunity."

Instead of: "Configuration updated. Your strategy will now..."
Say: "Done! Your stop loss is now at 3% and I bumped take profit to 5%. Better risk management."

WHEN USER CONFIRMS WITH "YES" OR "OK":
- Just make the change and briefly say what you did
- Don't explain the confirmation process
- Don't list out parameters formally
- Keep it natural: "Perfect! I've adjusted your settings..."

TECHNICAL DETAILS:
- Never show JSON code or configuration blocks
- Don't use bullet points unless listing coins or simple items
- Reference live market data and indicators naturally
- When making changes, mention 1-2 key adjustments, not everything

VALID CHANGES YOU CAN MAKE:
- riskLevel: low, medium, high
- stopLoss: percentage (e.g., 2.5 for 2.5%)
- takeProfit: percentage (e.g., 5.0 for 5.0%)
- maxPositionSize: position limits
- strategyType: trend-following, mean-reverting, breakout, scalping
- technicalIndicators: enable/disable RSI, MACD, etc.
- buyCooldownMinutes, tradeCooldownMinutes

Remember: Talk like a real person, not a formal trading system. Be helpful, casual, and confident.`;

      const userPrompt = `User: "${message.replace(/"/g, '\\"')}"

Respond naturally like you're having a casual conversation with a fellow trader. Keep it real, conversational, and helpful.

If they're asking for changes:
- Just make them and briefly mention what you adjusted
- Don't be overly formal or explain the process
- Talk like you're helping a trading buddy

If they're asking about market conditions or indicators:
- Share insights naturally using the live data provided
- Explain things like you're thinking out loud

If they confirm with "yes", "ok", "do it", etc:
- Just make the changes and casually confirm what you did
- Don't announce that you're "applying recommendations"
- Keep it short and natural

Remember: You're Alex, an experienced trader having a friendly chat. No formal language, no JSON, no technical explanations about your process.`;

      // Get LLM configuration from database to respect user's max token settings
      const { data: llmConfig } = await supabaseClient
        .from('llm_configurations')
        .select('*')
        .eq('is_active', true)
        .single();

      // Use configured settings or fallback to defaults
      const modelSettings = {
        model: llmConfig?.model || 'gpt-4.1-2025-04-14',
        temperature: llmConfig?.temperature || 0.3,
        max_tokens: llmConfig?.max_tokens || 2000
      };

      console.log(`🤖 Using LLM config - Model: ${modelSettings.model}, Max Tokens: ${modelSettings.max_tokens}, Temperature: ${modelSettings.temperature}`);

      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelSettings.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: modelSettings.temperature,
            max_tokens: modelSettings.max_tokens,
          }),
        });

        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;

        // Save user message to conversation history
        await supabaseClient.from('conversation_history').insert([{
          user_id: userId,
          strategy_id: strategyId,
          message_type: 'user_message',
          content: message,
          metadata: { timestamp: new Date().toISOString() }
        }]);

        // Try to extract configuration updates from BOTH user message and AI response
        let finalResponse;
        let configUpdates = {};
        
        // First, check the user's original message for direct commands
        const userMessageLower = message.toLowerCase();
        const aiResponseLower = aiResponse.toLowerCase();
        
        // PRIORITY 1: Direct user commands (these override AI response patterns)
        
        // AI Enable/Disable commands from user input
        if (userMessageLower.includes('disable ai') || 
            userMessageLower.includes('turn off ai') || 
            userMessageLower.includes('switch off ai') ||
            (userMessageLower.includes('disable') && userMessageLower.includes('it') && strategyAnalysis.includes('AI Enabled: YES'))) {
          configUpdates.is_ai_enabled = false;
          console.log('🔧 User command detected: Disabling AI');
        }
        if (userMessageLower.includes('enable ai') || 
            userMessageLower.includes('turn on ai') || 
            userMessageLower.includes('switch on ai')) {
          configUpdates.is_ai_enabled = true;
          console.log('🔧 User command detected: Enabling AI');
        }

        // AI Override commands from user input
        if (userMessageLower.includes('disable ai override') || 
            userMessageLower.includes('turn off ai override')) {
          configUpdates.ai_override_enabled = false;
          console.log('🔧 User command detected: Disabling AI Override');
        }
        if (userMessageLower.includes('enable ai override') || 
            userMessageLower.includes('turn on ai override')) {
          configUpdates.ai_override_enabled = true;
          console.log('🔧 User command detected: Enabling AI Override');
        }

        // Risk level commands from user input
        if (userMessageLower.includes('set risk') || userMessageLower.includes('change risk') || userMessageLower.includes('risk level')) {
          if (userMessageLower.includes('high')) {
            configUpdates.riskLevel = 'high';
            configUpdates.riskProfile = 'high';
            console.log('🔧 User command detected: Setting risk to high');
          } else if (userMessageLower.includes('low')) {
            configUpdates.riskLevel = 'low';
            configUpdates.riskProfile = 'low';
            console.log('🔧 User command detected: Setting risk to low');
          } else if (userMessageLower.includes('medium')) {
            configUpdates.riskLevel = 'medium';
            configUpdates.riskProfile = 'medium';
            console.log('🔧 User command detected: Setting risk to medium');
          }
        }

        // Coins/symbols commands from user input
        if (userMessageLower.includes('allow only') || userMessageLower.includes('only allow') || userMessageLower.includes('limit to')) {
          const coinMatches = userMessageLower.match(/\b(btc|eth|xrp|ada|sol|dot|matic|avax|link|uni|doge|ltc|bch|xlm|algo|atom|fil|trx|etc|theta|xmr|xtz|comp|aave|mkr|snx|crv|yfi)\b/gi);
          if (coinMatches) {
            configUpdates.selectedCoins = [...new Set(coinMatches.map(coin => coin.toUpperCase()))];
            console.log('🔧 User command detected: Setting allowed coins to', configUpdates.selectedCoins);
          }
        }

        // Trailing buy percentage from user input
        if (userMessageLower.includes('trailing buy') && /(\d+\.?\d*)%?/.test(userMessageLower)) {
          const match = userMessageLower.match(/trailing buy.*?(\d+\.?\d*)%?/);
          if (match) {
            configUpdates.trailingBuyPercentage = parseFloat(match[1]);
            console.log('🔧 User command detected: Setting trailing buy to', configUpdates.trailingBuyPercentage + '%');
          }
        }

        // PRIORITY 2: AI response patterns (only if no user commands detected)
        if (Object.keys(configUpdates).length === 0) {
          // Extract configuration changes based on AI response patterns
          if (aiResponseLower.includes('stop loss') && /(\d+\.?\d*)%/.test(aiResponseLower)) {
            const match = aiResponseLower.match(/stop loss.*?(\d+\.?\d*)%/);
            if (match) configUpdates.stopLossPercentage = parseFloat(match[1]);
          }
          
          if (aiResponseLower.includes('take profit') && /(\d+\.?\d*)%/.test(aiResponseLower)) {
            const match = aiResponseLower.match(/take profit.*?(\d+\.?\d*)%/);
            if (match) configUpdates.takeProfitPercentage = parseFloat(match[1]);
          }
          
          if (aiResponseLower.includes('position size') && /(\d+)/.test(aiResponseLower)) {
            const match = aiResponseLower.match(/position size.*?(\d+)/);
            if (match) configUpdates.maxPositionSize = parseInt(match[1]);
          }
        }
        
        // Apply configuration updates if any were detected
        if (Object.keys(configUpdates).length > 0 && strategyId) {
          console.log('🔧 Applying extracted config updates:', configUpdates);
          
          if (!actualStrategy) {
            console.error('❌ No strategy found to update');
            finalResponse = { 
              message: `❌ Could not apply changes: Strategy not found.`,
              configUpdates: {}
            };
          } else {
            const { data: updatedStrategy, error: updateError } = await supabaseClient
              .from('trading_strategies')
              .update({
                configuration: { ...actualConfig, ...configUpdates },
                updated_at: new Date().toISOString()
              })
              .eq('id', strategyId)
              .eq('user_id', userId)
              .select()
              .single();

            if (updateError) {
              console.error('Error updating strategy:', updateError);
              finalResponse = { 
                message: `❌ Configuration update failed: ${updateError.message}. Please try again or check your permissions.`,
                configUpdates: {}
              };
            } else {
              // Verify changes were applied by checking the returned data
              console.log('✅ Strategy configuration updated successfully');
              console.log('🔍 Updated configuration:', updatedStrategy.configuration);
              
              // Verify that the changes were actually applied
              const verificationErrors = [];
              for (const [key, value] of Object.entries(configUpdates)) {
                if (updatedStrategy.configuration[key] !== value) {
                  verificationErrors.push(`${key}: expected ${value}, got ${updatedStrategy.configuration[key]}`);
                }
              }
              
              if (verificationErrors.length > 0) {
                console.error('⚠️ Configuration verification failed:', verificationErrors);
                finalResponse = { 
                  message: `⚠️ Configuration update partially failed. Some changes may not have been applied: ${verificationErrors.join(', ')}`,
                  configUpdates: {}
                };
              } else {
                finalResponse = { 
                  message: aiResponse,
                  configUpdates,
                  verifiedConfig: updatedStrategy.configuration
                };
              }
            }
          }
        } else {
          // No configuration updates, just return the message
          finalResponse = { 
            message: aiResponse,
            configUpdates: {}
          };
        }

        // Save AI response to conversation history
        await supabaseClient.from('conversation_history').insert([{
          user_id: userId,
          strategy_id: strategyId,
          message_type: 'ai_response',
          content: finalResponse.message,
          metadata: { 
            configUpdates: finalResponse.configUpdates || {},
            timestamp: new Date().toISOString()
          }
        }]);

        return new Response(JSON.stringify(finalResponse), { 
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