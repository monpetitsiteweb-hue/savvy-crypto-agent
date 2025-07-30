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

// SEMANTIC FIELD MAPPING - Fixed version with proper boolean detection
const SEMANTIC_FIELD_MAPPING = {
  // AI Intelligence Fields - FIXED: Cleaner boolean detection
  'AI Decision Override': {
    field: 'aiIntelligenceConfig.enableAIOverride',
    type: 'boolean',
    enableKeywords: ["enable ai", "turn on ai", "activate ai", "start ai", "ai on", "enable override"],
    disableKeywords: ["disable ai", "turn off ai", "stop ai", "ai off", "disable override", "no ai"]
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
  'Risk Parameter Override': {
    field: 'aiIntelligenceConfig.riskOverrideAllowed',
    type: 'boolean',
    enableKeywords: ["allow risk override", "enable risk override", "break risk rules"],
    disableKeywords: ["disable risk override", "strict risk only", "no risk override"]
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
  
  // Coins and Trading - FIXED: Proper array modification handling
  'Selected Coins': {
    field: 'selectedCoins',
    type: 'coin_array',
    operations: {
      add: ["add", "include", "use", "trade"],
      remove: ["remove", "exclude", "stop trading", "drop"],
      replace: ["only", "just", "switch to", "change to"]
    }
  },
  'Auto Coin Selection': {
    field: 'enableAutoCoinSelection',
    type: 'boolean',
    enableKeywords: ["auto-select", "auto select", "enable automatic", "let ai pick"],
    disableKeywords: ["disable auto", "manual selection", "no auto"]
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
    enableKeywords: ["only trailing", "use trailing only", "disable fixed stop"],
    disableKeywords: ["enable fixed stop", "use both stops", "no trailing only"]
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
    enableKeywords: ["notify on trade", "tell me when", "alert on execution"],
    disableKeywords: ["no trade notifications", "disable trade alerts", "quiet trading"]
  },
  'Error Notifications': {
    field: 'notifyOnError',
    type: 'boolean',
    enableKeywords: ["notify on error", "alert on failure", "tell me if fails"],
    disableKeywords: ["no error notifications", "disable error alerts", "quiet errors"]
  },
  'Target Notifications': {
    field: 'notifyOnTargets',
    type: 'boolean',
    enableKeywords: ["notify on targets", "alert on profit", "tell me when stop"],
    disableKeywords: ["no target notifications", "disable target alerts", "quiet targets"]
  },
  
  // Advanced Features
  'Enable Shorting': {
    field: 'enableShorting',
    type: 'boolean',
    enableKeywords: ["allow shorting", "enable shorting", "bet against price"],
    disableKeywords: ["disable shorting", "no shorting", "long only"]
  },
  'Backtesting Mode': {
    field: 'backtestingMode',
    type: 'boolean',
    enableKeywords: ["enable backtest", "test historical", "backtest mode"],
    disableKeywords: ["disable backtest", "no backtest", "live only"]
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

// Helper function to get nested object fields
const getNestedField = (obj: any, path: string): any => {
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  
  return current;
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

// FIXED: Smart field mapping function with proper logic
const mapUserIntentToFields = (userMessage: string, currentConfig: any = {}): { [key: string]: any } => {
  const changes: { [key: string]: any } = {};
  const lowerMessage = userMessage.toLowerCase();
  
  console.log('🧠 AI_ASSISTANT: Mapping user intent:', userMessage);
  console.log('🧠 AI_ASSISTANT: Current config for reference:', JSON.stringify(currentConfig, null, 2));
  
  // Search through semantic mapping for matches
  for (const [fieldLabel, config] of Object.entries(SEMANTIC_FIELD_MAPPING)) {
    
    // FIXED: Handle boolean fields with explicit keyword matching
    if (config.type === 'boolean') {
      const enableKeywords = config.enableKeywords || [];
      const disableKeywords = config.disableKeywords || [];
      
      const hasEnableMatch = enableKeywords.some(keyword => lowerMessage.includes(keyword));
      const hasDisableMatch = disableKeywords.some(keyword => lowerMessage.includes(keyword));
      
      if (hasEnableMatch && !hasDisableMatch) {
        console.log(`🎯 AI_ASSISTANT: ENABLE detected for "${fieldLabel}"`);
        setNestedField(changes, config.field, true);
      } else if (hasDisableMatch && !hasEnableMatch) {
        console.log(`🎯 AI_ASSISTANT: DISABLE detected for "${fieldLabel}"`);
        setNestedField(changes, config.field, false);
      }
    }
    
    // FIXED: Handle coin array operations properly
    else if (config.type === 'coin_array' && config.field === 'selectedCoins') {
      const currentCoins = currentConfig.selectedCoins || [];
      const extractedCoins = extractCoinsFromMessage(userMessage);
      
      if (extractedCoins.length > 0) {
        const operations = config.operations || {};
        
        // Determine operation type
        const isAddOperation = operations.add?.some(op => lowerMessage.includes(op));
        const isRemoveOperation = operations.remove?.some(op => lowerMessage.includes(op));
        const isReplaceOperation = operations.replace?.some(op => lowerMessage.includes(op));
        
        console.log(`🎯 AI_ASSISTANT: Coin operation detected:`, {
          extractedCoins,
          currentCoins,
          isAddOperation,
          isRemoveOperation,
          isReplaceOperation
        });
        
        if (isReplaceOperation) {
          // Replace entire list
          console.log(`🎯 AI_ASSISTANT: REPLACE coins with:`, extractedCoins);
          setNestedField(changes, config.field, extractedCoins);
        } else if (isAddOperation) {
          // Add to existing list
          const newCoins = [...new Set([...currentCoins, ...extractedCoins])];
          console.log(`🎯 AI_ASSISTANT: ADD coins:`, extractedCoins, 'Result:', newCoins);
          setNestedField(changes, config.field, newCoins);
        } else if (isRemoveOperation) {
          // Remove from existing list
          const newCoins = currentCoins.filter(coin => !extractedCoins.includes(coin));
          console.log(`🎯 AI_ASSISTANT: REMOVE coins:`, extractedCoins, 'Result:', newCoins);
          setNestedField(changes, config.field, newCoins);
        } else {
          // Default to replace if operation unclear
          console.log(`🎯 AI_ASSISTANT: DEFAULT REPLACE coins with:`, extractedCoins);
          setNestedField(changes, config.field, extractedCoins);
        }
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

    console.log('🔍 AI_ASSISTANT: Starting strategy resolution...');
    console.log('🔍 AI_ASSISTANT: Received strategyId:', strategyId);
    console.log('🔍 AI_ASSISTANT: Received userId:', userId);
    console.log('🔍 AI_ASSISTANT: Received testMode:', testMode);

    // CRITICAL: Always try to find an active strategy, regardless of strategyId
    console.log('🚨 AI_ASSISTANT: Finding active strategy for user...');
    
    // First, try to use provided strategyId if available
    if (strategyId) {
      console.log('🔍 AI_ASSISTANT: Fetching strategy data for provided strategyId:', strategyId);
      
      const { data: strategy, error: strategyError } = await supabaseClient
        .from('trading_strategies')
        .select('*')
        .eq('id', strategyId)
        .eq('user_id', userId)
        .single();

      if (!strategyError && strategy) {
        actualStrategy = strategy;
        actualConfig = strategy.configuration;
        console.log('✅ AI_ASSISTANT: Strategy fetched successfully:', actualStrategy.strategy_name);
      } else {
        console.error('❌ AI_ASSISTANT: Error fetching strategy by ID:', strategyError);
      }
    }
    
    // If no strategy found yet, search for active strategy based on mode
    if (!actualStrategy) {
      console.log('🔍 AI_ASSISTANT: No strategy loaded, searching for active strategy...');
      const activeField = testMode ? 'is_active_test' : 'is_active_live';
      console.log('🔍 AI_ASSISTANT: Looking for active strategy using field:', activeField);
      
      const { data: activeStrategies, error: activeError } = await supabaseClient
        .from('trading_strategies')
        .select('*')
        .eq('user_id', userId)
        .eq(activeField, true)
        .order('created_at', { ascending: false })
        .limit(1);
        
      console.log('🔍 AI_ASSISTANT: Active strategy query result:', { activeStrategies, activeError });
      
      if (!activeError && activeStrategies && activeStrategies.length > 0) {
        actualStrategy = activeStrategies[0];
        actualConfig = actualStrategy.configuration;
        console.log('✅ AI_ASSISTANT: Found active strategy:', actualStrategy.id, actualStrategy.strategy_name);
      } else {
        console.log('⚠️ AI_ASSISTANT: No active strategy found for mode:', testMode ? 'test' : 'live');
        
        // Check ALL strategies to see what's available for debugging
        const { data: allStrategies, error: allError } = await supabaseClient
          .from('trading_strategies')
          .select('*')
          .eq('user_id', userId);
          
        console.log('📋 AI_ASSISTANT: All user strategies:', allStrategies);
        if (allStrategies && allStrategies.length > 0) {
          console.log('📋 AI_ASSISTANT: Available strategies:');
          allStrategies.forEach((strategy, index) => {
            console.log(`  ${index + 1}. ${strategy.strategy_name} (${strategy.id}):`);
            console.log(`     - is_active_test: ${strategy.is_active_test}`);
            console.log(`     - is_active_live: ${strategy.is_active_live}`);
          });
        }
      }
    }

    // Only proceed with trades and whale alerts if we have a strategy
    if (actualStrategy) {
      // Fetch recent trades for context
      const { data: trades, error: tradesError } = await supabaseClient
        .from('mock_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('strategy_id', actualStrategy.id)
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
    } else {
      console.log('⚠️ AI_ASSISTANT: No strategy available - skipping trades and whale alerts');
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
    
    if (actualStrategy && actualConfig) {
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
- Strategy ID: ${actualStrategy.id}
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

    // FIXED: Generate appropriate welcome message based on ACTUAL strategy context
    let welcomeMessage = '';
    
    console.log('🎯 AI_ASSISTANT: WELCOME MESSAGE GENERATION DEBUG:');
    console.log('🎯 AI_ASSISTANT: actualStrategy exists:', !!actualStrategy);
    console.log('🎯 AI_ASSISTANT: actualConfig exists:', !!actualConfig);
    
    // CRITICAL FIX: actualStrategy should ALWAYS exist if we found one above
    if (actualStrategy) {
      const currentMode = testMode ? 'Test Mode' : 'Live Mode';
      const isActiveInMode = testMode ? actualStrategy.is_active_test : actualStrategy.is_active_live;
      
      console.log('🎯 AI_ASSISTANT: Strategy found:', actualStrategy.strategy_name);
      console.log('🎯 AI_ASSISTANT: Current mode:', currentMode);
      console.log('🎯 AI_ASSISTANT: is_active_test:', actualStrategy.is_active_test);
      console.log('🎯 AI_ASSISTANT: is_active_live:', actualStrategy.is_active_live);
      console.log('🎯 AI_ASSISTANT: isActiveInMode:', isActiveInMode);
      
      if (isActiveInMode) {
        if (testMode) {
          welcomeMessage = `Hello! You're in ${currentMode} with an active strategy "${actualStrategy.strategy_name}". I'll help monitor and optimize your simulated trades.`;
          console.log('🎯 AI_ASSISTANT: Generated test mode welcome message');
        } else {
          welcomeMessage = `Hello! You're running a Live trading strategy "${actualStrategy.strategy_name}". I'm monitoring the markets and executing trades on your behalf.`;
          console.log('🎯 AI_ASSISTANT: Generated live mode welcome message');
        }
      } else {
        welcomeMessage = `Hello! You have a strategy "${actualStrategy.strategy_name}" but it's not currently active in ${currentMode}. Activate it to get started with trading.`;
        console.log('🎯 AI_ASSISTANT: Generated inactive strategy welcome message');
      }
    } else {
      // This should rarely happen now that we have better strategy detection
      welcomeMessage = `Hello! I'm currently on standby. Please activate a strategy in Test or Live Mode to get started.`;
      console.log('🎯 AI_ASSISTANT: Generated no strategy welcome message (this should be rare now)');
    }
    
    console.log('🎯 AI_ASSISTANT: FINAL WELCOME MESSAGE:', welcomeMessage);

    // Enhanced system prompt with truth-bound strategy context
    const systemPrompt = `You are Alex, a seasoned cryptocurrency trader and AI assistant. You have access to REAL LIVE strategy configuration data that you must use to answer questions truthfully.

WELCOME CONTEXT: ${welcomeMessage}

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

4. **APPROPRIATE GREETINGS**: Use the WELCOME CONTEXT above to provide accurate information about the current strategy state when users first interact with you.

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
    const configUpdates: any = mapUserIntentToFields(message, actualConfig);
    
    // Apply configuration updates if any were detected
    if (Object.keys(configUpdates).length > 0 && actualStrategy) {
      console.log('🔧 AI_ASSISTANT: Applying semantic config updates:', configUpdates);
      
      if (!actualStrategy) {
        console.error('❌ AI_ASSISTANT: No strategy found to update');
        finalResponse = { 
          message: `❌ Could not apply changes: Strategy not found.`,
          configUpdates: {}
        };
      } else {
        // Build properly nested configuration update
        const updatedConfig = JSON.parse(JSON.stringify(actualConfig)); // Deep clone
        
        // Apply each nested field update correctly
        for (const [fieldPath, value] of Object.entries(configUpdates)) {
          setNestedField(updatedConfig, fieldPath, value);
        }
        
        console.log('🔧 AI_ASSISTANT: Original config:', JSON.stringify(actualConfig, null, 2));
        console.log('🔧 AI_ASSISTANT: Updated config:', JSON.stringify(updatedConfig, null, 2));
        
        // First, attempt the update
        const { data: updatedStrategy, error: updateError } = await supabaseClient
          .from('trading_strategies')
          .update({
            configuration: updatedConfig,
            updated_at: new Date().toISOString()
          })
          .eq('id', actualStrategy.id)
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
            .eq('id', actualStrategy.id)
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
            
            // Verify specific fields were actually updated using DIRECT field access
            let verificationMessage = '';
            let allUpdatesApplied = true;
            
            console.log('🔬 AI_ASSISTANT: DETAILED VERIFICATION STARTING');
            console.log('🔬 AI_ASSISTANT: Full verified config:', JSON.stringify(verifiedConfig, null, 2));
            console.log('🔬 AI_ASSISTANT: Expected updates:', JSON.stringify(configUpdates, null, 2));
            
            for (const [field, expectedValue] of Object.entries(configUpdates)) {
              const actualValue = getNestedField(verifiedConfig, field);
              
              // FIXED: Use proper deep equality for arrays and objects
              let isMatch = false;
              
              if (Array.isArray(expectedValue) && Array.isArray(actualValue)) {
                // Array comparison: check length and all elements
                isMatch = expectedValue.length === actualValue.length && 
                         expectedValue.every((val, index) => val === actualValue[index]);
                console.log(`🔍 AI_ASSISTANT: Array comparison for "${field}"`);
                console.log(`   Expected: [${expectedValue.join(', ')}] (length: ${expectedValue.length})`);
                console.log(`   Actual: [${actualValue.join(', ')}] (length: ${actualValue.length})`);
              } else if (typeof expectedValue === 'object' && typeof actualValue === 'object' && 
                         expectedValue !== null && actualValue !== null) {
                // Object comparison: compare all keys and values
                const expectedKeys = Object.keys(expectedValue).sort();
                const actualKeys = Object.keys(actualValue).sort();
                isMatch = JSON.stringify(expectedKeys) === JSON.stringify(actualKeys) &&
                         expectedKeys.every(key => expectedValue[key] === actualValue[key]);
                console.log(`🔍 AI_ASSISTANT: Object comparison for "${field}"`);
                console.log(`   Expected: ${JSON.stringify(expectedValue)}`);
                console.log(`   Actual: ${JSON.stringify(actualValue)}`);
              } else {
                // Primitive comparison
                isMatch = actualValue === expectedValue;
                console.log(`🔍 AI_ASSISTANT: Primitive comparison for "${field}"`);
                console.log(`   Expected: ${expectedValue} (type: ${typeof expectedValue})`);
                console.log(`   Actual: ${actualValue} (type: ${typeof actualValue})`);
              }
              
              console.log(`   Match: ${isMatch}`);
              
              if (isMatch) {
                const displayValue = Array.isArray(expectedValue) ? `[${expectedValue.join(', ')}]` : expectedValue;
                verificationMessage += `✅ ${field}: Updated to ${displayValue}\n`;
                console.log(`✅ AI_ASSISTANT: Field "${field}" verified successfully`);
              } else {
                allUpdatesApplied = false;
                const expectedDisplay = Array.isArray(expectedValue) ? `[${expectedValue.join(', ')}]` : expectedValue;
                const actualDisplay = Array.isArray(actualValue) ? `[${actualValue.join(', ')}]` : actualValue;
                verificationMessage += `❌ ${field}: Expected ${expectedDisplay}, got ${actualDisplay}\n`;
                console.log(`❌ AI_ASSISTANT: Field "${field}" verification FAILED`);
              }
            }
            
            console.log('🔬 AI_ASSISTANT: VERIFICATION COMPLETE');
            console.log('🔬 AI_ASSISTANT: All updates applied?', allUpdatesApplied);
            console.log('🔬 AI_ASSISTANT: Verification message:', verificationMessage);
            
            // FIXED: Update AI response based on verification results with clear confirmations
            let finalMessage = aiResponse;
            if (allUpdatesApplied) {
              // Generate specific confirmation messages based on what was changed
              const changeDescriptions = [];
              
              if (configUpdates['aiIntelligenceConfig.enableAIOverride'] === false) {
                changeDescriptions.push("✅ AI Decision Override: DISABLED");
              } else if (configUpdates['aiIntelligenceConfig.enableAIOverride'] === true) {
                changeDescriptions.push("✅ AI Decision Override: ENABLED");
              }
              
              if (configUpdates['aiIntelligenceConfig.riskOverrideAllowed'] === false) {
                changeDescriptions.push("✅ Risk Parameter Override: DISABLED");
              } else if (configUpdates['aiIntelligenceConfig.riskOverrideAllowed'] === true) {
                changeDescriptions.push("✅ Risk Parameter Override: ENABLED");
              }
              
              if (configUpdates['selectedCoins']) {
                changeDescriptions.push(`✅ Selected Coins: Updated to [${configUpdates['selectedCoins'].join(', ')}]`);
              }
              
              if (changeDescriptions.length > 0) {
                finalMessage = `Configuration updated successfully:\n\n${changeDescriptions.join('\n')}`;
              } else {
                finalMessage = "✅ Configuration updated successfully.";
              }
            } else {
              finalMessage = `❌ Some changes didn't apply correctly:\n\n${verificationMessage}`;
            }
            
            finalResponse = { 
              message: finalMessage,
              configUpdates: allUpdatesApplied ? configUpdates : {},
              verification: verificationMessage,
              success: allUpdatesApplied
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