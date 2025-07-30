import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseClient = createClient(supabaseUrl!, supabaseServiceKey!);

// SEMANTIC FIELD MAPPING - Extracted from UI tooltips
const SEMANTIC_FIELD_MAPPING = {
  // AI Intelligence Fields
  'Enable AI Decision Override': {
    field: 'aiIntelligenceConfig.enableAIOverride',
    type: 'boolean',
    examples: ["Give the AI more control", "Let AI make decisions", "Enable AI override", "Allow AI independence", "disable ai", "turn off ai", "stop ai decisions"]
  },
  'AI Autonomy Level': {
    field: 'aiIntelligenceConfig.aiAutonomyLevel', 
    type: 'number',
    examples: ["Give you more autonomy", "I want you to be more independent", "Make your own decisions", "Be more/less autonomous", "Take more control", "increase autonomy", "more freedom"]
  },
  'Confidence Threshold': {
    field: 'aiIntelligenceConfig.aiConfidenceThreshold',
    type: 'number',
    examples: ["Be more confident before acting", "Only act when you're sure", "Be more/less cautious", "Increase/decrease confidence threshold"]
  },
  'Allow Risk Parameter Override': {
    field: 'aiIntelligenceConfig.riskOverrideAllowed',
    type: 'boolean', 
    examples: ["Override risk settings when needed", "Break risk rules for good opportunities", "Strict risk management only"]
  },
  
  // Basic Settings
  'Strategy Name': {
    field: 'strategyName',
    type: 'string',
    examples: ["Call this my scalping strategy", "Name it medium test bot"]
  },
  'Risk Profile': {
    field: 'riskProfile',
    type: 'select',
    options: ['low', 'medium', 'high', 'custom'],
    examples: ["I want a medium-risk setup", "Make it aggressive", "Use a conservative approach"]
  },
  
  // Coins and Trading
  'Selected Coins': {
    field: 'selectedCoins',
    type: 'array',
    examples: ["Trade Bitcoin and Ethereum", "Add Solana to my portfolio", "Include XRP in the strategy", "only btc and eth", "remove ada", "add link"]
  },
  'Auto Coin Selection': {
    field: 'enableAutoCoinSelection',
    type: 'boolean',
    examples: ["Auto-select best performing coins", "Let AI pick cryptos for me", "Enable automatic coin selection"]
  },
  'Max Active Coins': {
    field: 'maxActiveCoins',
    type: 'number',
    examples: ["Focus on 3 coins max", "Trade up to 5 cryptos simultaneously", "Limit to 2 active coins"]
  },
  'Amount Per Trade': {
    field: 'perTradeAllocation',
    type: 'number',
    examples: ["Use 100 euros per trade", "Risk 5% of portfolio per position", "Allocate 50 euros per trade"]
  },
  
  // Buy Settings
  'Buy Order Type': {
    field: 'buyOrderType',
    type: 'select',
    options: ['market', 'limit', 'trailing_buy'],
    examples: ["Buy instantly", "Use trailing buy", "Set a limit to enter at a lower price"]
  },
  'Buy Frequency': {
    field: 'buyFrequency', 
    type: 'select',
    options: ['once', 'daily', 'interval', 'signal_based'],
    examples: ["Buy once daily", "Trade based on signals only", "Execute trades every hour"]
  },
  'Buy Cooldown': {
    field: 'buyCooldownMinutes',
    type: 'number',
    examples: ["Wait 30 minutes before buying again", "Add a cooldown of 1 hour"]
  },
  
  // Sell Settings  
  'Sell Order Type': {
    field: 'sellOrderType',
    type: 'select',
    options: ['market', 'limit', 'trailing_stop', 'auto_close'],
    examples: ["Sell at market price", "Use a trailing stop to exit", "Set a profit target"]
  },
  'Take Profit Percentage': {
    field: 'takeProfitPercentage',
    type: 'number',
    examples: ["Take profits at 5%", "Sell once I make 3%", "Close when I hit my target"]
  },
  'Stop Loss Percentage': {
    field: 'stopLossPercentage', 
    type: 'number',
    examples: ["Cut my losses at 2%", "Don't let it drop more than 1.5%", "Add a stop-loss"]
  },
  'Trailing Stop Percentage': {
    field: 'trailingStopLossPercentage',
    type: 'number', 
    examples: ["Let the profits ride", "Use a trailing stop of 2%", "Sell if it drops after going up"]
  },
  'Use Trailing Stop Only': {
    field: 'useTrailingStopOnly',
    type: 'boolean',
    examples: ["Only use trailing stops", "Disable fixed stop loss"]
  },
  
  // Position Management
  'Max Open Positions': {
    field: 'maxOpenPositions',
    type: 'number',
    examples: ["Hold max 5 positions", "Limit to 3 open trades"]
  },
  'Max Wallet Exposure': {
    field: 'maxWalletExposure',
    type: 'number',
    examples: ["Use up to 50% of my funds", "Don't go over 20%"]
  },
  'Daily Profit Target': {
    field: 'dailyProfitTarget',
    type: 'number',
    examples: ["Stop trading after 3% gain", "Pause the bot when it earns enough for the day"]
  },
  'Daily Loss Limit': {
    field: 'dailyLossLimit',
    type: 'number', 
    examples: ["Limit daily loss to 2%", "Shut it down if I lose 5%"]
  },
  
  // Notifications
  'Trade Notifications': {
    field: 'notifyOnTrade',
    type: 'boolean',
    examples: ["Let me know when a trade happens", "Notify me on every execution"]
  },
  'Error Notifications': {
    field: 'notifyOnError',
    type: 'boolean',
    examples: ["Tell me if something fails", "Warn me if a trade can't go through"]
  },
  'Target Notifications': {
    field: 'notifyOnTargets',
    type: 'boolean',
    examples: ["Notify me when I hit my profit goal", "Let me know if a stop-loss triggers"]
  },
  
  // Advanced Features
  'Enable Shorting': {
    field: 'enableShorting',
    type: 'boolean',
    examples: ["Allow shorting", "Enable betting against price"]
  },
  'Backtesting Mode': {
    field: 'backtestingMode',
    type: 'boolean',
    examples: ["Test this on historical charts", "Backtest it first"]
  },
  'Trailing Buy Percentage': {
    field: 'trailingBuyPercentage',
    type: 'number',
    examples: ["Trail by 1.5%", "Set trailing buy at 2%"]
  }
};

// Helper function to set nested object fields
const setNestedField = (obj: any, path: string, value: any) => {
  const keys = path.split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current)) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  
  current[keys[keys.length - 1]] = value;
};

// Extract cryptocurrency symbols from user message
const extractCoinsFromMessage = (message: string): string[] => {
  const availableCoins = ['BTC', 'ETH', 'ADA', 'DOGE', 'XRP', 'LTC', 'BCH', 'LINK', 'DOT', 'UNI', 'SOL', 'MATIC', 'AVAX', 'ICP', 'XLM', 'VET', 'ALGO', 'ATOM', 'FIL', 'TRX'];
  const coinAliases = {
    'bitcoin': 'BTC',
    'ethereum': 'ETH', 
    'cardano': 'ADA',
    'dogecoin': 'DOGE',
    'ripple': 'XRP',
    'litecoin': 'LTC',
    'chainlink': 'LINK',
    'polkadot': 'DOT',
    'uniswap': 'UNI',
    'solana': 'SOL',
    'polygon': 'MATIC',
    'avalanche': 'AVAX'
  };
  
  const upperMessage = message.toUpperCase();
  const lowerMessage = message.toLowerCase();
  const foundCoins: string[] = [];
  
  // Check for direct symbol matches
  for (const coin of availableCoins) {
    if (upperMessage.includes(coin)) {
      foundCoins.push(coin);
    }
  }
  
  // Check for alias matches
  for (const [alias, symbol] of Object.entries(coinAliases)) {
    if (lowerMessage.includes(alias) && !foundCoins.includes(symbol)) {
      foundCoins.push(symbol);
    }
  }
  
  return foundCoins;
};

// Smart field mapping function using semantic context
const mapUserIntentToFields = (userMessage: string): { [key: string]: any } => {
  const changes: { [key: string]: any } = {};
  const lowerMessage = userMessage.toLowerCase();
  
  console.log('🧠 AI_ASSISTANT: Mapping user intent:', userMessage);
  
  // Search through semantic mapping for matches
  for (const [fieldLabel, config] of Object.entries(SEMANTIC_FIELD_MAPPING)) {
    const examples = config.examples || [];
    
    // Check if any example phrase matches the user input
    for (const example of examples) {
      const lowerExample = example.toLowerCase();
      
      // Direct phrase matching
      if (lowerMessage.includes(lowerExample)) {
        console.log(`🎯 AI_ASSISTANT: Found match for "${fieldLabel}" via example: "${example}"`);
        
        // Handle field updates based on type
        if (config.type === 'boolean') {
          // Determine boolean value from context
          const enableWords = ['enable', 'turn on', 'activate', 'allow', 'yes', 'true'];
          const disableWords = ['disable', 'turn off', 'deactivate', 'stop', 'no', 'false'];
          
          let boolValue = true; // default
          if (disableWords.some(word => lowerMessage.includes(word))) {
            boolValue = false;
          } else if (enableWords.some(word => lowerMessage.includes(word))) {
            boolValue = true;
          }
          
          setNestedField(changes, config.field, boolValue);
        }
        else if (config.type === 'array' && config.field === 'selectedCoins') {
          // Handle coin selection updates
          const coins = extractCoinsFromMessage(userMessage);
          if (coins.length > 0) {
            setNestedField(changes, config.field, coins);
          }
        }
        else if (config.type === 'number') {
          // Extract numbers from message
          const numbers = userMessage.match(/\d+(?:\.\d+)?/g);
          if (numbers && numbers.length > 0) {
            setNestedField(changes, config.field, parseFloat(numbers[0]));
          }
        }
        else if (config.type === 'select' && config.options) {
          // Find matching option
          for (const option of config.options) {
            if (lowerMessage.includes(option)) {
              setNestedField(changes, config.field, option);
              break;
            }
          }
        }
      }
    }
  }
  
  console.log('🔄 AI_ASSISTANT: Mapped changes:', changes);
  return changes;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, userId, conversationHistory, strategyId, marketContext, indicatorContext, testMode } = await req.json();

    console.log('🤖 AI_ASSISTANT: Request received:', { 
      message, 
      userId, 
      strategyId, 
      testMode,
      hasMarketContext: !!marketContext,
      hasIndicatorContext: !!indicatorContext 
    });

    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    if (!message || !userId) {
      throw new Error('Message and userId are required');
    }

    // Get active strategy and recent context
    let actualStrategy = null;
    let actualConfig = null;
    let recentTrades = null;
    let whaleAlerts = null;

    if (strategyId) {
      console.log('🔍 AI_ASSISTANT: Fetching strategy data for:', strategyId);
      
      // Fetch strategy configuration
      const { data: strategy, error: strategyError } = await supabaseClient
        .from('trading_strategies')
        .select('*')
        .eq('id', strategyId)
        .eq('user_id', userId)
        .single();

      if (strategyError) {
        console.error('❌ AI_ASSISTANT: Error fetching strategy:', strategyError);
      } else {
        actualStrategy = strategy;
        actualConfig = strategy?.configuration;
        console.log('✅ AI_ASSISTANT: Strategy fetched successfully');
      }

      // Fetch recent trades for context
      const { data: trades, error: tradesError } = await supabaseClient
        .from('mock_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('strategy_id', strategyId)
        .order('executed_at', { ascending: false })
        .limit(10);

      if (!tradesError && trades) {
        recentTrades = trades;
        console.log('📊 AI_ASSISTANT: Recent trades fetched:', trades.length);
      }

      // Fetch recent whale alerts
      const { data: whales, error: whaleError } = await supabaseClient
        .from('whale_signal_events')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(5);

      if (!whaleError && whales) {
        whaleAlerts = whales;
        console.log('🐋 AI_ASSISTANT: Whale alerts fetched:', whales.length);
      }
    }

    // Prepare conversation context
    let conversationContext = '';
    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      const recentHistory = conversationHistory.slice(-6).map(entry => 
        `${entry.message_type}: ${entry.content}`
      ).join('\n');
      
      conversationContext = `
RECENT CONVERSATION:
${recentHistory}
`;
    }

    // Prepare whale alerts context
    let whaleContext = '';
    if (whaleAlerts && Array.isArray(whaleAlerts) && whaleAlerts.length > 0) {
      const whaleEntries = whaleAlerts.slice(0, 3).map(alert => 
        `- ${alert.token_symbol}: ${alert.amount?.toLocaleString() || 'N/A'} (${alert.event_type || 'movement'})`
      ).join('\n');
      
      whaleContext = `
RECENT WHALE ALERTS:
${whaleEntries}
`;
    }
    
    // Prepare technical indicators context with structured data
    let indicatorContextText = '';
    if (indicatorContext && typeof indicatorContext === 'object') {
      const indicatorEntries = Object.entries(indicatorContext).map(([symbol, indicators]: [string, any]) => {
        const indicatorsList = [];
        
        if (indicators.RSI) {
          indicatorsList.push(`RSI: ${indicators.RSI.value || 'N/A'} (${indicators.RSI.signal || 'neutral'})`);
        }
        if (indicators.MACD) {
          const crossover = indicators.MACD.crossover ? 'bullish crossover' : 'bearish crossover';
          indicatorsList.push(`MACD: ${crossover}`);
        }
        if (indicators.EMA) {
          const trend = indicators.EMA.short > indicators.EMA.long ? 'bullish' : 'bearish';
          indicatorsList.push(`EMA: ${trend} trend`);
        }
        
        return indicatorsList.length > 0 ? `- ${symbol}: ${indicatorsList.join(', ')}` : null;
      }).filter(Boolean).join('\n');
      
      if (indicatorEntries) {
        indicatorContextText = `
LIVE TECHNICAL INDICATORS:
${indicatorEntries}
`;
      }
    }
    
    // Prepare strategy analysis with REAL database state
    let strategyAnalysis = '';
    let recentTradingContext = '';
    
    if (strategyId && actualConfig) {
      // Use REAL database configuration for truth-bound responses
      const strategyType = actualConfig.strategyType || 'balanced';
      const riskLevel = actualConfig.riskLevel || actualConfig.riskProfile || 'medium';
      const stopLoss = actualConfig.stopLoss || actualConfig.stopLossPercentage || 'not set';
      const takeProfit = actualConfig.takeProfit || actualConfig.takeProfitPercentage || 'not set';
      const maxPositionSize = actualConfig.maxPositionSize || actualConfig.maxOpenPositions || 'not set';
      const isAIEnabled = actualConfig.aiIntelligenceConfig?.enableAIOverride || false;
      const aiOverrideEnabled = actualConfig.aiIntelligenceConfig?.riskOverrideAllowed || false;
      const selectedCoins = actualConfig.selectedCoins || [];
      
      strategyAnalysis = `
CURRENT STRATEGY ANALYSIS (REAL DATABASE STATE):
- Strategy ID: ${strategyId}
- Strategy Name: ${actualStrategy.strategy_name}
- Strategy Type: ${strategyType}
- Risk Profile: ${riskLevel}
- AI Enabled: ${isAIEnabled ? 'YES' : 'NO'}
- AI Override Enabled: ${aiOverrideEnabled ? 'YES' : 'NO'}
- Selected Coins: ${Array.isArray(selectedCoins) ? selectedCoins.join(', ') : 'All coins'}
- Stop Loss: ${stopLoss}${typeof stopLoss === 'number' ? '%' : ''}
- Take Profit: ${takeProfit}${typeof takeProfit === 'number' ? '%' : ''}
- Max Position Size: ${maxPositionSize}
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

    // Enhanced system prompt with truth-bound strategy context
    const systemPrompt = `You are Alex, a seasoned cryptocurrency trader and AI assistant. You have access to REAL LIVE strategy configuration data that you must use to answer questions truthfully.

${conversationContext}
${strategyAnalysis}
${recentTradingContext}
${indicatorContextText}
${whaleContext}

YOUR CRITICAL RESPONSIBILITIES:
1. **TRUTH-BOUND RESPONSES**: When users ask about current settings ("is AI enabled?", "what's my risk level?", etc.), you MUST reference the actual database values shown in the CURRENT STRATEGY ANALYSIS above.

2. **CONFIGURATION CHANGES**: When users request changes ("disable AI", "set risk to high", etc.), you should acknowledge the request naturally and the system will automatically detect and apply the changes.

3. **CONVERSATIONAL STYLE**: 
   - Talk like a knowledgeable trading buddy, not a formal assistant
   - Use contractions and casual language
   - Be confident but humble
   - When someone says "yes please" or "ok do it", just confirm what you're changing

EXAMPLES OF TRUTH-BOUND RESPONSES:
- User: "Is AI enabled?" → Check the "AI Enabled:" field above and respond with that exact value
- User: "What coins am I trading?" → Check the "Selected Coins:" field above and list those exact coins
- User: "What's my current risk level?" → Check the "Risk Profile:" field above and respond with that value

VALID CHANGES YOU CAN ACKNOWLEDGE:
- AI settings (enable/disable AI override, autonomy levels, confidence thresholds)
- Risk management (stop loss, take profit, position sizes, risk levels)
- Coin selection (add/remove specific cryptocurrencies)
- Trading parameters (buy frequency, cooldown periods, order types)
- Notifications (trade alerts, error notifications, target notifications)

Remember: Always be truthful about current settings by referencing the actual database state provided above.`;

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    console.log('🤖 AI_ASSISTANT: Generated response:', aiResponse);

    // SEMANTIC CONFIGURATION UPDATE DETECTION
    let finalResponse;
    
    // Use semantic mapping to detect configuration changes from user input
    const configUpdates: any = mapUserIntentToFields(message);
    
    // Apply configuration updates if any were detected
    if (Object.keys(configUpdates).length > 0 && strategyId) {
      console.log('🔧 AI_ASSISTANT: Applying semantic config updates:', configUpdates);
      
      if (!actualStrategy) {
        console.error('❌ AI_ASSISTANT: No strategy found to update');
        finalResponse = { 
          message: `❌ Could not apply changes: Strategy not found.`,
          configUpdates: {}
        };
      } else {
        // First, attempt the update
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
          console.error('❌ AI_ASSISTANT: Database update failed:', updateError);
          finalResponse = { 
            message: `❌ Configuration update failed: ${updateError.message}`,
            configUpdates: {}
          };
        } else {
          // POST-UPDATE VALIDATION: Re-fetch to verify changes
          const { data: verifyStrategy, error: verifyError } = await supabaseClient
            .from('trading_strategies')
            .select('*')
            .eq('id', strategyId)
            .eq('user_id', userId)
            .single();

          if (verifyError || !verifyStrategy) {
            console.error('❌ AI_ASSISTANT: Could not verify update');
            finalResponse = { 
              message: `❌ Update verification failed. Please check your strategy configuration.`,
              configUpdates: {}
            };
          } else {
            console.log('✅ AI_ASSISTANT: Configuration updated and verified successfully');
            const verifiedConfig = verifyStrategy.configuration || {};
            
            // Verify specific fields were actually updated
            let verificationMessage = '';
            for (const [field, value] of Object.entries(configUpdates)) {
              const actualValue = field.includes('.') ? 
                field.split('.').reduce((obj, key) => obj?.[key], verifiedConfig) :
                verifiedConfig[field];
              
              if (actualValue === value) {
                verificationMessage += `✅ ${field}: ${value}\n`;
              } else {
                verificationMessage += `❌ ${field}: Expected ${value}, got ${actualValue}\n`;
              }
            }
            
            finalResponse = { 
              message: aiResponse,
              configUpdates,
              verification: verificationMessage,
              success: true
            };
          }
        }
      }
    } else {
      // No configuration updates detected
      finalResponse = { 
        message: aiResponse,
        configUpdates: {}
      };
    }

    // Store conversation in history
    if (strategyId) {
      await supabaseClient.from('conversation_history').insert([
        {
          user_id: userId,
          strategy_id: strategyId,
          message_type: 'user',
          content: message,
          metadata: { timestamp: new Date().toISOString() }
        },
        {
          user_id: userId,
          strategy_id: strategyId,
          message_type: 'assistant',
          content: finalResponse.message,
          metadata: { 
            timestamp: new Date().toISOString(),
            configUpdates: finalResponse.configUpdates || {}
          }
        }
      ]);
    }

    console.log('📝 AI_ASSISTANT: Response completed:', {
      hasConfigUpdates: Object.keys(finalResponse.configUpdates || {}).length > 0,
      updateCount: Object.keys(finalResponse.configUpdates || {}).length
    });

    return new Response(JSON.stringify(finalResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ AI_ASSISTANT: Error in ai-trading-assistant function:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      message: "I'm experiencing some technical difficulties. Please try again in a moment."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});