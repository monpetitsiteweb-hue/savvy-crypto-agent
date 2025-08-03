import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 AI_ASSISTANT: Function started');
    
    console.log('📥 AI_ASSISTANT: Parsing request body');
    const { userId, message, strategyId, testMode = false, debug = false } = await req.json();
    
    console.log(`📋 AI_ASSISTANT: Request data: {
  userId: "${userId}",
  message: "${message}",
  strategyId: "${strategyId}",
  testMode: ${testMode},
  debug: ${debug}
}`);

    console.log(`🤖 AI_ASSISTANT: Request received: "${message}" | StrategyId: ${strategyId} | TestMode: ${testMode}`);
    
    if (!userId || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: userId and message' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get OpenAI API key
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Resolve strategy
    const strategy = strategyId 
      ? await StrategyResolver.getStrategyById(userId, strategyId)
      : await StrategyResolver.getActiveStrategy(userId, testMode);

    if (!strategy) {
      return new Response(
        JSON.stringify({ 
          message: strategyId 
            ? "❌ Strategy not found. Please check the strategy ID or create a new strategy."
            : "❌ No active strategy found. Please activate a strategy first or create a new one.",
          hasConfigUpdates: false
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ STRATEGY_RESOLVER: ${strategy.strategy_name}`);

    // Fetch market data and conversation history
    const [marketSignals, cryptoNews, conversationHistory] = await Promise.all([
      MarketDataFetcher.getRecentSignals(supabase),
      MarketDataFetcher.getRecentNews(supabase),
      ConversationMemory.getRecentHistory(supabase, userId, strategyId)
    ]);

    // Record conversation
    await ConversationMemory.recordUserMessage(supabase, userId, strategyId, message);

    // Process with intelligent crypto engine
    const currentConfig = strategy.configuration || {};
    const engineResponse = await CryptoIntelligenceEngine.generateContextualResponse(
      message, 
      strategy, 
      marketSignals, 
      cryptoNews, 
      conversationHistory,
      currentConfig
    );

    // Record AI response
    await ConversationMemory.recordAIResponse(supabase, userId, strategyId, engineResponse.message);

    return new Response(
      JSON.stringify({
        message: engineResponse.message,
        hasConfigUpdates: engineResponse.hasConfigUpdates || false,
        configUpdates: engineResponse.configUpdates || {}
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('❌ AI_ASSISTANT: Error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message,
        hasConfigUpdates: false
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// ============= COMPLETE FIELD MAPPING SYSTEM =============
// Based on CSV provided by user - source of truth for all field operations
const FIELD_DEFINITIONS = {
  // === NOTIFICATIONS ===
  'tradeNotifications': {
    name: 'Trade Notifications',
    description: 'Get notified when trades are executed',
    type: 'boolean',
    uiLocation: 'General → Notifications → Notification Settings',
    dbPath: 'configuration.notifications.trade',
    csvMatch: 'Trade Notifications',
    examples: ['enable trade notifications', 'notify on trades', 'disable trade alerts']
  },
  'errorNotifications': {
    name: 'Error Notifications',
    description: 'Get notified when trading errors occur',
    type: 'boolean',
    uiLocation: 'General → Notifications → Notification Settings',
    dbPath: 'configuration.notifications.error',
    csvMatch: 'Error Norifications',
    examples: ['notify on errors', 'enable error alerts', 'disable error notifications']
  },
  'targetNotifications': {
    name: 'Target Notifications',
    description: 'Get notified when profit or loss targets are hit',
    type: 'boolean',
    uiLocation: 'General → Notifications → Notification Settings',
    dbPath: 'configuration.notifications.target',
    csvMatch: 'Target Notifications',
    examples: ['notify on targets', 'enable target alerts', 'disable target notifications']
  },

  // === AI INTELLIGENCE SETTINGS ===
  'enableAIIntelligence': {
    name: 'Enable AI Intelligence',
    description: 'Enable AI-powered trading decisions and market analysis',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Settings',
    dbPath: 'configuration.aiIntelligenceConfig.enableAIOverride',
    csvMatch: 'Enable AI Intelligence',
    examples: ['enable AI', 'turn on AI intelligence', 'use AI signals', 'disable AI', 'AI on', 'AI off']
  },
  'aiAutonomyLevel': {
    name: 'AI Autonomy Level',
    description: 'Level of autonomy for AI decision making (0-100%)',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.aiAutonomyLevel',
    csvMatch: 'AI Autonomy Level',
    examples: ['set AI autonomy to 90%', 'AI autonomy level 50', 'autonomy 75%', 'AI control 60%']
  },
  'confidenceThreshold': {
    name: 'Confidence Threshold',
    description: 'Minimum confidence level required for AI to make decisions',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.confidenceThreshold',
    csvMatch: 'Confidence Threshold',
    examples: ['confidence threshold 80%', 'AI confidence 70%', 'require 90% confidence']
  },
  'escalationThreshold': {
    name: 'Escalation Threshold',
    description: 'Threshold for escalating decisions to human oversight',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.escalationThreshold',
    csvMatch: 'Escalation Threshold',
    examples: ['escalation threshold 50%', 'escalate at 90%', 'human oversight threshold']
  },
  'allowRiskParameterOverride': {
    name: 'Allow Risk Parameter Override',
    description: 'Allow AI to override risk management parameters when confident',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.allowRiskParameterOverride',
    csvMatch: 'Allow Risk Parameter Override',
    examples: ['allow risk override', 'AI can override risk', 'disable risk override']
  },
  'decisionMode': {
    name: 'Decision Making Mode',
    description: 'AI decision making approach',
    type: 'enum',
    values: ['Conservative', 'Balanced', 'Aggressive'],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.decisionMode',
    csvMatch: 'Decision Making Mode',
    examples: ['conservative mode', 'balanced decisions', 'aggressive AI', 'set mode to balanced']
  },

  // === PATTERN RECOGNITION & MARKET ANALYSIS ===
  'enablePatternRecognition': {
    name: 'Enable Pattern Recognition',
    description: 'Enable AI pattern recognition for market analysis',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → Pattern Recognition & Market Analysis',
    dbPath: 'configuration.aiIntelligenceConfig.enablePatternRecognition',
    csvMatch: 'Enable Pattern Recognition',
    examples: ['enable pattern recognition', 'turn on pattern analysis', 'disable patterns']
  },
  'patternAnalysisLookback': {
    name: 'Pattern Analysis Lookback',
    description: 'Hours to look back for pattern analysis',
    type: 'number',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → Pattern Recognition & Market Analysis',
    dbPath: 'configuration.aiIntelligenceConfig.patternAnalysisLookback',
    csvMatch: 'Pattern Analysis Lookback',
    examples: ['pattern lookback 24 hours', 'analyze 48 hours', 'lookback 12 hours']
  },
  'crossAssetCorrelationAnalysis': {
    name: 'Cross-Asset Correlation Analysis',
    description: 'Analyze correlations between different assets',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → Pattern Recognition & Market Analysis',
    dbPath: 'configuration.aiIntelligenceConfig.crossAssetCorrelationAnalysis',
    csvMatch: 'Cross-Asset Correlation Analysis',
    examples: ['enable correlation analysis', 'cross asset analysis', 'disable correlation']
  },
  'marketStructureAnalysis': {
    name: 'Market Structure Analysis',
    description: 'Analyze overall market structure and trends',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → Pattern Recognition & Market Analysis',
    dbPath: 'configuration.aiIntelligenceConfig.marketStructureAnalysis',
    csvMatch: 'Market Structure Analysis',
    examples: ['enable market structure', 'analyze market trends', 'disable structure analysis']
  },

  // === EXTERNAL SIGNAL PROCESSING ===
  'enableExternalSignalProcessing': {
    name: 'Enable External Signal Processing',
    description: 'Enable processing of external market signals',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → External Signal Processing',
    dbPath: 'configuration.aiIntelligenceConfig.enableExternalSignalProcessing',
    csvMatch: 'Enable External Signal Processing',
    examples: ['enable external signals', 'process external data', 'disable external signals']
  },
  'whaleActivityWeight': {
    name: 'Whale Activity Weight',
    description: 'Weight given to whale activity signals (%)',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → External Signal Processing',
    dbPath: 'configuration.aiIntelligenceConfig.signalWeights.whaleActivity',
    csvMatch: 'Whale Activity',
    examples: ['whale activity 30%', 'whale weight 25%', 'set whale influence']
  },
  'marketSentimentWeight': {
    name: 'Market Sentiment Weight',
    description: 'Weight given to market sentiment signals (%)',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → External Signal Processing',
    dbPath: 'configuration.aiIntelligenceConfig.signalWeights.marketSentiment',
    csvMatch: 'Market Sentiment',
    examples: ['sentiment weight 20%', 'market sentiment 15%', 'sentiment influence']
  },
  'newsImpactWeight': {
    name: 'News Impact Weight',
    description: 'Weight given to news impact signals (%)',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → External Signal Processing',
    dbPath: 'configuration.aiIntelligenceConfig.signalWeights.newsImpact',
    csvMatch: 'News Impact',
    examples: ['news impact 25%', 'news weight 30%', 'news influence']
  },
  'socialSignalsWeight': {
    name: 'Social Signals Weight',
    description: 'Weight given to social media signals (%)',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → External Signal Processing',
    dbPath: 'configuration.aiIntelligenceConfig.signalWeights.socialSignals',
    csvMatch: 'Social Signals',
    examples: ['social signals 15%', 'social weight 10%', 'social media influence']
  },

  // === LEARNING & ADAPTATION ===
  'enableAILearning': {
    name: 'Enable AI Learning',
    description: 'Enable AI to learn from trading performance',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → Learning & Adaptation',
    dbPath: 'configuration.aiIntelligenceConfig.enableAILearning',
    csvMatch: 'Enable AI Learning',
    examples: ['enable AI learning', 'let AI adapt', 'disable learning']
  },
  'adaptToPerformance': {
    name: 'Adapt to Performance',
    description: 'Adapt strategy based on performance metrics',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → Learning & Adaptation',
    dbPath: 'configuration.aiIntelligenceConfig.adaptToPerformance',
    csvMatch: 'Adapt to Performance',
    examples: ['adapt to performance', 'learn from results', 'disable adaptation']
  },
  'learningRate': {
    name: 'Learning Rate',
    description: 'Rate at which AI learns and adapts (%)',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → Learning & Adaptation',
    dbPath: 'configuration.aiIntelligenceConfig.learningRate',
    csvMatch: 'Learning Rate',
    examples: ['learning rate 5%', 'adapt slowly', 'fast learning 15%']
  },

  // === AI COMMUNICATION & ALERTS ===
  'explainAIDecisions': {
    name: 'Explain AI Decisions',
    description: 'Provide explanations for AI trading decisions',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Communication & Alerts',
    dbPath: 'configuration.aiIntelligenceConfig.explainAIDecisions',
    csvMatch: 'Explain AI Decisions',
    examples: ['explain AI decisions', 'show AI reasoning', 'disable explanations']
  },
  'alertOnAnomalies': {
    name: 'Alert on Anomalies',
    description: 'Alert when market anomalies are detected',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Communication & Alerts',
    dbPath: 'configuration.aiIntelligenceConfig.alertOnAnomalies',
    csvMatch: 'Alert on Anomalies',
    examples: ['alert on anomalies', 'notify anomalies', 'disable anomaly alerts']
  },
  'alertOnRuleOverrides': {
    name: 'Alert on Rule Overrides',
    description: 'Alert when AI overrides predefined rules',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Communication & Alerts',
    dbPath: 'configuration.aiIntelligenceConfig.alertOnRuleOverrides',
    csvMatch: 'Alert on Rule Overrides',
    examples: ['alert on overrides', 'notify rule changes', 'disable override alerts']
  },
  'customAIInstructions': {
    name: 'Custom AI Instructions',
    description: 'Custom instructions for AI behavior',
    type: 'text',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Communication & Alerts',
    dbPath: 'configuration.aiIntelligenceConfig.customAIInstructions',
    csvMatch: 'Custom AI Instructions',
    examples: ['add AI instructions', 'custom AI behavior', 'AI guidelines']
  },

  // === BUY SETTINGS ===
  'buyOrderType': {
    name: 'Buy Order Type',
    description: 'Type of order to use when buying',
    type: 'enum',
    values: ['Market Order', 'Limit Order', 'Trailing Buy'],
    uiLocation: 'Buying → Buy Settings → Buy Settings',
    dbPath: 'configuration.buyOrderType',
    csvMatch: 'Buy Order Type',
    examples: ['use market buys', 'limit buy orders', 'trailing buy', 'instant purchases']
  },
  'buyFrequency': {
    name: 'Buy Frequency',
    description: 'How often to place buy orders',
    type: 'enum',
    values: ['One-time purchase', 'Daily', 'Custom interval', 'Signal based'],
    uiLocation: 'Buying → Buy Settings → Buy Settings',
    dbPath: 'configuration.buyFrequency',
    csvMatch: 'Buy Frequency',
    examples: ['buy once', 'daily purchases', 'buy on signals', 'custom frequency']
  },
  'buyCooldown': {
    name: 'Buy Cooldown',
    description: 'Time to wait between buy orders (minutes)',
    type: 'number',
    uiLocation: 'Buying → Buy Settings → Buy Settings',
    dbPath: 'configuration.buyCooldown',
    csvMatch: 'Buy Cooldown',
    examples: ['buy cooldown 30 minutes', 'wait 1 hour between buys', 'cooldown 2 hours']
  },

  // === COINS AND AMOUNTS ===
  'maxActiveCoins': {
    name: 'Max Active Coins',
    description: 'Maximum number of cryptocurrencies to trade simultaneously',
    type: 'number',
    uiLocation: 'Buying → Coins and Amounts → Coins and Amounts',
    dbPath: 'configuration.maxActiveCoins',
    csvMatch: 'Max Active Coins',
    examples: ['trade 5 coins maximum', 'limit to 3 cryptos', 'max 8 currencies']
  },
  'autoCoinSelection': {
    name: 'Auto Coin Selection',
    description: 'Let AI automatically select which coins to trade',
    type: 'boolean',
    uiLocation: 'Buying → Coins and Amounts → Coins and Amounts',
    dbPath: 'configuration.autoCoinSelection',
    csvMatch: 'Auto Coin Selection',
    examples: ['auto select coins', 'let AI pick currencies', 'enable auto selection', 'manual coin selection']
  },
  'amountPerTrade': {
    name: 'Amount Per Trade',
    description: 'Amount to invest in each trade (EUR)',
    type: 'number',
    uiLocation: 'Buying → Coins and Amounts → Coins and Amounts',
    dbPath: 'configuration.amountPerTrade',
    csvMatch: 'Amount Per Trade',
    examples: ['trade with 100 euros', 'use 50 per trade', 'amount 200', 'invest 500 each']
  },

  // === STRATEGY CONFIGURATION ===
  'maxWalletExposure': {
    name: 'Max Wallet Exposure',
    description: 'Maximum percentage of wallet to expose to trading',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Buying → Strategy → Strategy Configuration',
    dbPath: 'configuration.maxWalletExposure',
    csvMatch: 'Max Wallet Exposure',
    examples: ['max wallet exposure 80%', 'limit exposure to 50%', 'expose 90% of wallet']
  },
  'dailyProfitTarget': {
    name: 'Daily Profit Target',
    description: 'Target profit amount for a single day (EUR)',
    type: 'number',
    uiLocation: 'Buying → Strategy → Strategy',
    dbPath: 'configuration.dailyProfitTarget',
    csvMatch: 'Daily Profit Target',
    examples: ['daily profit target 100', 'aim for 200 euros daily', 'profit goal 150']
  },
  'dailyLossLimit': {
    name: 'Daily Loss Limit',
    description: 'Maximum loss percentage allowed per day',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Buying → Strategy → Strategy',
    dbPath: 'configuration.dailyLossLimit',
    csvMatch: 'Daily Loss Limit',
    examples: ['daily loss limit 5%', 'limit daily losses to 3%', 'daily loss cap 10%']
  },
  'maxTradesPerDay': {
    name: 'Max Trades Per Day',
    description: 'Maximum number of trades allowed per day',
    type: 'number',
    uiLocation: 'Buying → Strategy → Strategy',
    dbPath: 'configuration.maxTradesPerDay',
    csvMatch: 'Max Trades Per Day',
    examples: ['max 10 trades daily', 'limit to 5 trades', 'allow 20 trades per day']
  },
  'backtestingMode': {
    name: 'Backtesting Mode',
    description: 'Enable backtesting mode for strategy validation',
    type: 'boolean',
    uiLocation: 'Buying → Strategy → Strategy',
    dbPath: 'configuration.backtestingMode',
    csvMatch: 'Backtesting Mode',
    examples: ['enable backtesting', 'test mode on', 'disable backtesting']
  },

  // === TRAILING STOP-BUY ===
  'trailingBuyPercentage': {
    name: 'Trailing Buy Percentage',
    description: 'Percentage for trailing buy orders',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Buying → Trailing Stop-Buy → Trailing Stop-Buy',
    dbPath: 'configuration.trailingBuyPercentage',
    csvMatch: 'Trailing Buy Percentage',
    examples: ['trailing buy 2%', 'trail buys at 1.5%', 'trailing buy percentage']
  },

  // === SELL SETTINGS ===
  'sellOrderType': {
    name: 'Sell Order Type',
    description: 'Type of order to use when selling',
    type: 'enum',
    values: ['Market Order (Instant)', 'Limit Order (Set Price)', 'Trailing Stop', 'Auto Close'],
    uiLocation: 'Selling → Sell Settings → Sell Settings',
    dbPath: 'configuration.sellOrderType',
    csvMatch: 'Sell Order Type',
    examples: ['use limit sells', 'market sell orders', 'trailing stop sells', 'auto close orders']
  },
  'autoCloseAfterHours': {
    name: 'Auto Close After (hours)',
    description: 'Automatically close positions after specified hours',
    type: 'number',
    uiLocation: 'Selling → Sell Settings → Sell Settings',
    dbPath: 'configuration.autoCloseAfterHours',
    csvMatch: 'Auto Close After (hours)',
    examples: ['auto close after 24 hours', 'close positions in 12 hours', 'auto close 6 hours']
  },
  'takeProfitPercentage': {
    name: 'Take Profit Percentage',
    description: 'Automatically sell when profit reaches this percentage',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Selling → Sell Settings → Take Profit Strategy',
    dbPath: 'configuration.takeProfitPercentage',
    csvMatch: 'Take Profit Percentage',
    examples: ['take profit at 10%', 'secure gains at 15%', 'set profit target', 'take profit 8%']
  },
  'stopLossPercentage': {
    name: 'Stop Loss Percentage',
    description: 'Automatically sell if price drops by this percentage',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Selling → Sell Settings → Stop Loss Protection',
    dbPath: 'configuration.stopLossPercentage',
    csvMatch: 'Stop Loss Percentage',
    examples: ['set stop loss to 3%', 'cut losses at 2%', 'add stop loss protection', 'stop loss 5%']
  },
  'stopLossTimeout': {
    name: 'Stop Loss Timeout',
    description: 'Enable timeout for stop loss orders',
    type: 'boolean',
    uiLocation: 'Selling → Sell Settings → Stop Loss Protection',
    dbPath: 'configuration.stopLossTimeout',
    csvMatch: 'Stop Loss Timeout',
    examples: ['enable stop loss timeout', 'timeout stop losses', 'disable timeout']
  },
  'timeoutMinutes': {
    name: 'Timeout (minutes)',
    description: 'Timeout duration for stop loss orders in minutes',
    type: 'number',
    uiLocation: 'Selling → Sell Settings → Stop Loss Protection',
    dbPath: 'configuration.timeoutMinutes',
    csvMatch: 'Timeout (minutes)',
    examples: ['timeout 30 minutes', 'stop loss timeout 60 minutes', 'timeout 15 minutes']
  },
  'trailingStopPercentage': {
    name: 'Trailing Stop Percentage',
    description: 'Percentage for trailing stop loss orders',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Selling → Sell Settings → Trailing Stop Loss',
    dbPath: 'configuration.trailingStopPercentage',
    csvMatch: 'Trailing Stop Percentage',
    examples: ['trailing stop 2%', 'trail stops at 1.5%', 'trailing stop loss 3%']
  },
  'useTrailingStopOnly': {
    name: 'Use Trailing Stop Only',
    description: 'Only use trailing stop losses instead of fixed stop losses',
    type: 'boolean',
    uiLocation: 'Selling → Sell Settings → Trailing Stop Loss',
    dbPath: 'configuration.useTrailingStopOnly',
    csvMatch: 'Use Trailing Stop Only',
    examples: ['use trailing stop only', 'trailing stop only mode', 'disable fixed stops']
  },
  'maxOpenPositions': {
    name: 'Max Open Positions',
    description: 'Maximum number of open positions at any time',
    type: 'number',
    uiLocation: 'Selling → Sell Settings → Position Management',
    dbPath: 'configuration.maxOpenPositions',
    csvMatch: 'Max Open Positions',
    examples: ['max 5 positions', 'limit open positions to 8', 'allow 10 open trades']
  },
  'tradeCooldown': {
    name: 'Trade Cooldown',
    description: 'Cooldown period between trades (minutes)',
    type: 'number',
    uiLocation: 'Selling → Sell Settings → Position Management',
    dbPath: 'configuration.tradeCooldown',
    csvMatch: 'Trade Cooldown',
    examples: ['trade cooldown 30 minutes', 'wait 1 hour between trades', 'cooldown 2 hours']
  },

  // === SELL STRATEGY ===
  'trailingStopOnly': {
    name: 'Trailing Stop Only',
    description: 'Use only trailing stops for all sell orders',
    type: 'boolean',
    uiLocation: 'Selling → Sell Strategy → Sell Strategy',
    dbPath: 'configuration.trailingStopOnly',
    csvMatch: 'Trailing Stop Only',
    examples: ['trailing stop only', 'use only trailing stops', 'disable fixed sells']
  },
  'resetStopLossAfterFail': {
    name: 'Reset Stop-Loss After Fail',
    description: 'Reset stop-loss to original level if it fails to execute',
    type: 'boolean',
    uiLocation: 'Selling → Sell Strategy → Sell Strategy',
    dbPath: 'configuration.resetStopLossAfterFail',
    csvMatch: 'Reset Stop-Loss After Fail',
    examples: ['reset stops if they fail', 'retry failed stop orders', 'reset stop loss after fail']
  },

  // === SHORTING SETTINGS ===
  'enableShorting': {
    name: 'Enable Shorting',
    description: 'Allow short selling to profit from price declines',
    type: 'boolean',
    uiLocation: 'Selling → Shorting Settings → Shorting Settings',
    dbPath: 'configuration.enableShorting',
    csvMatch: 'Enable Shorting',
    examples: ['enable shorting', 'allow short selling', 'disable shorts', 'turn on short positions']
  },
  'maxShortPositions': {
    name: 'Max Short Positions',
    description: 'Maximum number of short positions allowed',
    type: 'number',
    uiLocation: 'Selling → Shorting Settings → Shorting Settings',
    dbPath: 'configuration.maxShortPositions',
    csvMatch: 'Max Short Positions',
    examples: ['max 2 shorts', 'allow 3 short positions', 'limit shorts to 1']
  },
  'shortingMinProfit': {
    name: 'Shorting Min Profit',
    description: 'Minimum profit percentage required for short positions',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Selling → Shorting Settings → Shorting Settings',
    dbPath: 'configuration.shortingMinProfit',
    csvMatch: 'Shorting Min Profit',
    examples: ['short profit 1.5%', 'minimum short gain 2%', 'short target 3%']
  },
  'autoCloseShorts': {
    name: 'Auto-Close Shorts',
    description: 'Automatically close short positions after specified time',
    type: 'boolean',
    uiLocation: 'Selling → Shorting Settings → Shorting Settings',
    dbPath: 'configuration.autoCloseShorts',
    csvMatch: 'Auto-Close Shorts',
    examples: ['auto close shorts', 'close shorts automatically', 'disable auto close shorts']
  },

  // === DOLLAR COST AVERAGING ===
  'enableDCA': {
    name: 'Enable DCA',
    description: 'Enable Dollar Cost Averaging for gradual position building',
    type: 'boolean',
    uiLocation: 'Selling → Dollar Cost Averaging → Dollar Cost Averaging',
    dbPath: 'configuration.enableDCA',
    csvMatch: 'Enable DCA',
    examples: ['enable DCA', 'turn on dollar cost averaging', 'disable DCA', 'use averaging']
  },
  'dcaIntervalHours': {
    name: 'DCA Interval (hours)',
    description: 'Hours between DCA steps',
    type: 'number',
    uiLocation: 'Selling → Dollar Cost Averaging → Dollar Cost Averaging',
    dbPath: 'configuration.dcaIntervalHours',
    csvMatch: 'DCA Interval (hours)',
    examples: ['DCA every 6 hours', 'interval 12 hours', 'space DCA 24 hours apart']
  },
  'dcaSteps': {
    name: 'DCA Steps',
    description: 'Number of steps for Dollar Cost Averaging',
    type: 'number',
    uiLocation: 'Selling → Dollar Cost Averaging → Dollar Cost Averaging',
    dbPath: 'configuration.dcaSteps',
    csvMatch: 'DCA Steps',
    examples: ['set DCA steps to 5', 'use 3 DCA steps', 'averaging in 4 steps']
  }
};

// =============================================
// INTELLIGENT FIELD MAPPER
// =============================================
class IntelligentFieldMapper {
  static FIELD_DEFINITIONS = FIELD_DEFINITIONS;

  static async detectIntent(message: string): Promise<'question' | 'command'> {
    const questionPatterns = [
      /what\s+(is|are|does)/i,
      /how\s+(does|do|can|to)/i,
      /why\s+/i,
      /when\s+/i,
      /where\s+/i,
      /can\s+you\s+(tell|explain|show)/i,
      /could\s+you\s+(explain|tell)/i,
      /explain/i,
      /\?$/
    ];
    
    return questionPatterns.some(pattern => pattern.test(message)) ? 'question' : 'command';
  }

  static async mapUserIntent(message: string, currentConfig: any = {}): Promise<any> {
    console.log(`🔍 MAPPING_USER_INTENT: "${message}"`);
    
    const updates = {};
    const msgLower = message.toLowerCase();
    
    // Check each field definition
    for (const [fieldKey, fieldDef] of Object.entries(FIELD_DEFINITIONS)) {
      const examples = fieldDef.examples || [];
      
      // Check if any example pattern matches
      for (const example of examples) {
        if (this.isPatternMatch(msgLower, example.toLowerCase())) {
          console.log(`🎯 PATTERN_MATCH: "${example}" → ${fieldKey}`);
          
          const extractedValue = this.extractValue(message, fieldDef);
          if (extractedValue !== null) {
            this.setNestedValue(updates, fieldKey, extractedValue);
            console.log(`✅ EXTRACTED_VALUE: ${fieldKey} = ${extractedValue}`);
          }
          break;
        }
      }
    }
    
    console.log(`🔍 FINAL_MAPPED_UPDATES: ${JSON.stringify(updates, null, 2)}`);
    return updates;
  }

  static isPatternMatch(message: string, pattern: string): boolean {
    // Simple pattern matching - could be enhanced with more sophisticated NLP
    const patternWords = pattern.split(' ');
    return patternWords.every(word => message.includes(word));
  }

  static extractValue(message: string, fieldDef: any): any {
    const msgLower = message.toLowerCase();
    
    switch (fieldDef.type) {
      case 'boolean':
        if (msgLower.includes('enable') || msgLower.includes('turn on') || msgLower.includes('activate')) {
          return true;
        }
        if (msgLower.includes('disable') || msgLower.includes('turn off') || msgLower.includes('deactivate')) {
          return false;
        }
        break;
        
      case 'number':
        const numberMatch = message.match(/(\d+(?:\.\d+)?)\s*%?/);
        if (numberMatch) {
          const value = parseFloat(numberMatch[1]);
          if (fieldDef.range) {
            return Math.max(fieldDef.range[0], Math.min(fieldDef.range[1], value));
          }
          return value;
        }
        break;
        
      case 'enum':
        if (fieldDef.values) {
          for (const validValue of fieldDef.values) {
            if (msgLower.includes(validValue.toLowerCase())) {
              return validValue;
            }
          }
        }
        break;
        
      case 'text':
        // Extract quoted text or everything after "set" or "to"
        const textMatch = message.match(/["']([^"']+)["']|(?:set|to)\s+(.+)$/i);
        if (textMatch) {
          return textMatch[1] || textMatch[2];
        }
        break;
    }
    
    return null;
  }

  static setNestedValue(obj: any, fieldKey: string, value: any): void {
    if (fieldKey === 'enableAIIntelligence') {
      // Special handling for AI enable/disable
      if (!obj.aiIntelligenceConfig) obj.aiIntelligenceConfig = {};
      obj.aiIntelligenceConfig.enableAIOverride = value;
    } else if (fieldKey.startsWith('ai') || fieldKey.includes('AI') || fieldKey.includes('Pattern') || fieldKey.includes('Learning')) {
      // AI-related fields go into aiIntelligenceConfig
      if (!obj.aiIntelligenceConfig) obj.aiIntelligenceConfig = {};
      obj.aiIntelligenceConfig[fieldKey] = value;
    } else {
      obj[fieldKey] = value;
    }
  }
}

// =============================================
// VALIDATION ENGINE
// =============================================
class ValidationEngine {
  static validateConfigChange(field: string, newValue: any, currentValue: any): { isValid: boolean, needsUpdate: boolean, message: string } {
    console.log(`🔍 VALIDATING: ${field} | Current: ${JSON.stringify(currentValue)} | New: ${JSON.stringify(newValue)}`);
    
    const fieldDef = FIELD_DEFINITIONS[field];
    if (!fieldDef) {
      console.log(`❌ VALIDATION_ERROR: Unknown field "${field}"`);
      return { isValid: false, needsUpdate: false, message: `Unknown field: ${field}` };
    }
    
    // Check if value is actually changing
    if (JSON.stringify(newValue) === JSON.stringify(currentValue)) {
      return {
        isValid: true,
        needsUpdate: false,
        message: `No change needed — '${fieldDef.name}' is already set to ${Array.isArray(newValue) ? newValue.join(', ') : newValue}.`
      };
    }

    // Type and range validation
    switch (fieldDef.type) {
      case 'number':
        if (typeof newValue !== 'number' || isNaN(newValue)) {
          return { isValid: false, needsUpdate: false, message: `${fieldDef.name} must be a valid number.` };
        }
        if (fieldDef.range && (newValue < fieldDef.range[0] || newValue > fieldDef.range[1])) {
          return { isValid: false, needsUpdate: false, message: `${fieldDef.name} must be between ${fieldDef.range[0]} and ${fieldDef.range[1]}.` };
        }
        break;
        
      case 'boolean':
        if (typeof newValue !== 'boolean') {
          return { isValid: false, needsUpdate: false, message: `${fieldDef.name} must be true or false.` };
        }
        break;
        
      case 'enum':
        if (fieldDef.values && !fieldDef.values.includes(newValue)) {
          return { isValid: false, needsUpdate: false, message: `${fieldDef.name} must be one of: ${fieldDef.values.join(', ')}.` };
        }
        break;
    }

    return {
      isValid: true,
      needsUpdate: true,
      message: `✅ Updated '${fieldDef.name}' from ${Array.isArray(currentValue) ? currentValue.join(', ') : currentValue} to ${Array.isArray(newValue) ? newValue.join(', ') : newValue}.`
    };
  }
}

// =============================================
// CONFIG MANAGER - ENHANCED DATABASE OPERATIONS
// =============================================
class ConfigManager {
  static async updateConfig(strategyId: string, userId: string, validatedUpdates: any): Promise<boolean> {
    console.log('🔧 CONFIG_MANAGER: Building strategy updates from validated changes...');
    console.log(`🔍 VALIDATED_UPDATES: ${JSON.stringify(validatedUpdates, null, 2)}`);
    
    const strategyUpdates: any = {};
    
    for (const [fieldName, value] of Object.entries(validatedUpdates)) {
      const fieldDef = FIELD_DEFINITIONS[fieldName];
      
      if (!fieldDef) {
        console.log(`❌ UNKNOWN_FIELD: "${fieldName}" not found in FIELD_DEFINITIONS`);
        continue;
      }
      
      console.log(`🎯 PROCESSING_FIELD: ${fieldName} = ${value}`);
      console.log(`📍 UI_LOCATION: ${fieldDef.uiLocation}`);
      console.log(`🗂️ DB_PATH: ${fieldDef.dbPath}`);
      
      // Build nested object structure based on dbPath
      const dbPath = fieldDef.dbPath;
      const pathParts = dbPath.split('.');
      
      console.log(`🔍 DB_PATH_PARTS: ${JSON.stringify(pathParts)}`);
      
      let target = strategyUpdates;
      for (let i = 0; i < pathParts.length - 1; i++) {
        if (!target[pathParts[i]]) {
          target[pathParts[i]] = {};
          console.log(`🆕 CREATED_OBJECT: ${pathParts.slice(0, i + 1).join('.')}`);
        }
        target = target[pathParts[i]];
      }
      
      const finalKey = pathParts[pathParts.length - 1];
      target[finalKey] = value;
      console.log(`✅ FIELD_SET: ${dbPath} = ${value}`);
    }
    
    console.log(`🏗️ FINAL_STRATEGY_UPDATES: ${JSON.stringify(strategyUpdates, null, 2)}`);
    
    if (Object.keys(strategyUpdates).length === 0) {
      console.log('ℹ️ NO_VALID_UPDATES to apply');
      return true;
    }
    
    // Execute database update
    console.log(`📤 EXECUTING_DB_UPDATE for strategy ${strategyId}...`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: updatedStrategy, error: updateError } = await supabase
      .from('trading_strategies')
      .update(strategyUpdates)
      .eq('id', strategyId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('❌ DB_UPDATE_ERROR:', updateError);
      console.error('❌ ERROR_DETAILS:', JSON.stringify(updateError, null, 2));
      return false;
    }

    if (!updatedStrategy) {
      console.error('❌ NO_STRATEGY_RETURNED after update');
      return false;
    }

    console.log('✅ STRATEGY_UPDATED_SUCCESSFULLY');
    console.log(`✅ UPDATED_STRATEGY: ${JSON.stringify(updatedStrategy, null, 2)}`);
    
    // Verify the update actually took effect
    const updatedFields = [];
    for (const [fieldName] of Object.entries(validatedUpdates)) {
      const fieldDef = FIELD_DEFINITIONS[fieldName];
      if (fieldDef?.dbPath) {
        const pathParts = fieldDef.dbPath.split('.');
        let current = updatedStrategy;
        for (const part of pathParts) {
          current = current?.[part];
        }
        updatedFields.push(`${fieldName}: ${current}`);
      }
    }
    console.log(`🔍 POST_UPDATE_VERIFICATION: ${updatedFields.join(', ')}`);
    
    return true;
  }
}

// =============================================
// CRYPTO INTELLIGENCE ENGINE
// =============================================
class CryptoIntelligenceEngine {
  static async generateContextualResponse(
    message: string, 
    strategy: any, 
    signals: any[], 
    news: any[], 
    conversationHistory: any[],
    currentConfig: any = {}
  ): Promise<{ message: string, configUpdates?: any, hasConfigUpdates?: boolean }> {
    
    // Build comprehensive context
    const marketContext = this.buildMarketContext(signals, news);
    const strategyContext = this.buildStrategyContext(strategy);
    const memoryContext = ConversationMemory.buildContextPrompt(conversationHistory);
    const interfaceContext = this.buildInterfaceContext();
    
    // Detect user intent
    const intent = await IntelligentFieldMapper.detectIntent(message);
    
    // Handle questions vs commands differently
    if (intent === 'question') {
      console.log('🤔 QUESTION DETECTED - No config changes will be made');
      return { message: await this.handleQuestionIntent(message, strategy, marketContext, memoryContext, interfaceContext) };
    }
    
    console.log('⚡ COMMAND DETECTED - Processing potential config changes');
    
    // Handle configuration commands
    const potentialUpdates = await IntelligentFieldMapper.mapUserIntent(message, currentConfig);
    
    console.log(`🎯 POTENTIAL UPDATES FROM MAPPER:`, JSON.stringify(potentialUpdates, null, 2));
    
    if (Object.keys(potentialUpdates).length === 0) {
      // No clear config intent - use general AI response
      return { message: await this.handleGeneralIntent(message, strategy, marketContext, memoryContext, interfaceContext) };
    }
    
    // Check for explicit AI enable/disable commands
    const isExplicitAICommand = message.toLowerCase().includes('enable ai') || 
                               message.toLowerCase().includes('disable ai') ||
                               message.toLowerCase().includes('turn on ai') ||
                               message.toLowerCase().includes('turn off ai');
    
    console.log(`🎯 EXPLICIT AI COMMAND: ${isExplicitAICommand}`);
    
    // Validate all potential updates
    const validatedUpdates = {};
    const validationMessages = [];
    
    for (const [field, newValue] of Object.entries(potentialUpdates)) {
      console.log(`🔍 VALIDATING FIELD: ${field} = ${JSON.stringify(newValue)}`);
      
      // Get current value from config based on field mapping
      let currentValue;
      if (field === 'aiIntelligenceConfig') {
        currentValue = currentConfig.aiIntelligenceConfig || {};
      } else {
        const fieldDef = FIELD_DEFINITIONS[field];
        if (fieldDef?.dbPath) {
          const pathParts = fieldDef.dbPath.replace('configuration.', '').split('.');
          currentValue = currentConfig;
          for (const part of pathParts) {
            currentValue = currentValue?.[part];
          }
        } else {
          currentValue = currentConfig[field];
        }
      }
      
      console.log(`🔍 CURRENT VALUE: ${field} = ${JSON.stringify(currentValue)}`);
      
      const validation = ValidationEngine.validateConfigChange(field, newValue, currentValue);
      
      if (validation.isValid && validation.needsUpdate) {
        validatedUpdates[field] = newValue;
        validationMessages.push(validation.message);
        console.log(`✅ VALIDATED UPDATE: ${field} = ${JSON.stringify(newValue)}`);
      } else if (!validation.isValid) {
        validationMessages.push(`❌ ${validation.message}`);
        console.log(`❌ VALIDATION FAILED: ${field} - ${validation.message}`);
      } else {
        validationMessages.push(validation.message);
        console.log(`⏭️ NO UPDATE NEEDED: ${field} - ${validation.message}`);
      }
    }
    
    // Execute validated config updates if any exist
    if (Object.keys(validatedUpdates).length > 0) {
      console.log(`🔄 FINAL PAYLOAD BEFORE DATABASE UPDATE:`, JSON.stringify(validatedUpdates, null, 2));
      
      const success = await ConfigManager.updateConfig(strategy.id, strategy.user_id, validatedUpdates);
      
      if (success) {
        const successMessage = validationMessages.filter(msg => !msg.startsWith('❌')).join('\n\n');
        return {
          message: successMessage || `✅ Strategy configuration updated successfully.`,
          configUpdates: validatedUpdates,
          hasConfigUpdates: true
        };
      } else {
        return {
          message: "❌ **Configuration Update Failed**\n\nI couldn't save the changes to your strategy. Please try again.",
          configUpdates: validatedUpdates,
          hasConfigUpdates: false
        };
      }
    }
    
    const responseMessage = validationMessages.length > 0 
      ? validationMessages.join('\n\n')
      : await this.handleGeneralIntent(message, strategy, marketContext, memoryContext, interfaceContext);
    
    return { message: responseMessage, hasConfigUpdates: false };
  }

  static async handleQuestionIntent(message: string, strategy: any, marketContext: string, memoryContext: string, interfaceContext: string): Promise<string> {
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    
    const systemPrompt = `You are an expert cryptocurrency trading assistant with complete interface awareness.

INTERFACE KNOWLEDGE: ${interfaceContext}
MARKET CONTEXT: ${marketContext}
STRATEGY CONTEXT: ${this.buildStrategyContext(strategy)}
CONVERSATION HISTORY: ${memoryContext}

Answer the user's question about cryptocurrency trading, technical analysis, or strategy configuration.
Reference specific interface locations when discussing features.
Use market signals to inform your recommendations.
Be educational and helpful.`;

    return await this.callOpenAI(systemPrompt, message);
  }

  static async handleGeneralIntent(message: string, strategy: any, marketContext: string, memoryContext: string, interfaceContext: string): Promise<string> {
    const systemPrompt = `You are an expert cryptocurrency trading assistant with complete interface awareness.

INTERFACE KNOWLEDGE: ${interfaceContext}
MARKET CONTEXT: ${marketContext}
STRATEGY CONTEXT: ${this.buildStrategyContext(strategy)}
CONVERSATION HISTORY: ${memoryContext}

Provide expert guidance on cryptocurrency trading, technical analysis, and strategy optimization.
Reference specific interface locations when discussing features.
Use market signals to inform your recommendations.`;

    return await this.callOpenAI(systemPrompt, message);
  }

  static async callOpenAI(systemPrompt: string, userMessage: string): Promise<string> {
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-2025-04-14',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.3,
          max_tokens: 1500
        }),
      });

      const data = await response.json();
      return data.choices?.[0]?.message?.content || 
        "I understand your request. Could you be more specific about what you'd like to know or change?";
    } catch (error) {
      console.error('OpenAI API error:', error);
      return "I'm experiencing technical difficulties with my AI systems. Please try again in a moment.";
    }
  }

  static buildMarketContext(signals: any[], news: any[]): string {
    const recentSignals = signals.slice(0, 3);
    const recentNews = news.slice(0, 2);
    
    let context = '';
    if (recentSignals.length > 0) {
      context += `Recent market signals: ${recentSignals.map(s => `${s.symbol} ${s.signal_type} (strength: ${s.signal_strength})`).join(', ')}. `;
    }
    if (recentNews.length > 0) {
      context += `Recent crypto news: ${recentNews.map(n => n.headline).join('; ')}. `;
    }
    
    return context || 'No recent market signals available.';
  }

  static buildStrategyContext(strategy: any): string {
    if (!strategy) return 'No active strategy configured.';
    
    const config = strategy.configuration || {};
    return `Current strategy "${strategy.strategy_name}" with risk profile ${config.riskProfile || 'medium'}, ${config.selectedCoins?.length || 0} coins selected, amount per trade: €${config.amountPerTrade || 'not set'}, AI: ${config.aiIntelligenceConfig?.enableAIOverride ? 'enabled' : 'disabled'}.`;
  }

  static buildInterfaceContext(): string {
    const fieldDescriptions = Object.entries(FIELD_DEFINITIONS)
      .map(([key, field]) => `${field.name}: Located in ${field.uiLocation}`)
      .join('\n');
    
    return `Interface locations:\n${fieldDescriptions}`;
  }
}

// =============================================
// STRATEGY RESOLVER
// =============================================
class StrategyResolver {
  static async getActiveStrategy(userId: string, testMode: boolean): Promise<any> {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    try {
      const activeField = testMode ? 'is_active_test' : 'is_active_live';
      
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', userId)
        .eq(activeField, true)
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error(`Failed to fetch active strategy:`, error);
      return null;
    }
  }

  static async getStrategyById(userId: string, strategyId: string): Promise<any> {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    try {
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', userId)
        .eq('id', strategyId)
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error(`Failed to fetch strategy by ID:`, error);
      return null;
    }
  }
}

// =============================================
// MARKET DATA FETCHER
// =============================================
class MarketDataFetcher {
  static async getRecentSignals(supabase: any): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_knowledge_base')
        .select('*')
        .eq('category', 'market_signal')
        .order('created_at', { ascending: false })
        .limit(10);
      
      return data || [];
    } catch (error) {
      console.error('Failed to fetch market signals:', error);
      return [];
    }
  }

  static async getRecentNews(supabase: any): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_knowledge_base')
        .select('*')
        .eq('category', 'crypto_news')
        .order('created_at', { ascending: false })
        .limit(5);
      
      return data || [];
    } catch (error) {
      console.error('Failed to fetch crypto news:', error);
      return [];
    }
  }
}

// =============================================
// CONVERSATION MEMORY
// =============================================
class ConversationMemory {
  static async getRecentHistory(supabase: any, userId: string, strategyId?: string): Promise<any[]> {
    try {
      let query = supabase
        .from('conversation_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (strategyId) {
        query = query.eq('strategy_id', strategyId);
      }
      
      const { data, error } = await query;
      
      return data || [];
    } catch (error) {
      console.error('Failed to fetch conversation history:', error);
      return [];
    }
  }

  static async recordUserMessage(supabase: any, userId: string, strategyId: string | null, message: string): Promise<void> {
    try {
      await supabase
        .from('conversation_history')
        .insert({
          user_id: userId,
          strategy_id: strategyId,
          message_type: 'user',
          content: message
        });
    } catch (error) {
      console.error('Failed to record user message:', error);
    }
  }

  static async recordAIResponse(supabase: any, userId: string, strategyId: string | null, response: string): Promise<void> {
    try {
      await supabase
        .from('conversation_history')
        .insert({
          user_id: userId,
          strategy_id: strategyId,
          message_type: 'assistant',
          content: response
        });
    } catch (error) {
      console.error('Failed to record AI response:', error);
    }
  }

  static buildContextPrompt(conversationHistory: any[]): string {
    if (!conversationHistory || conversationHistory.length === 0) {
      return 'No recent conversation history.';
    }
    
    const recentMessages = conversationHistory
      .slice(0, 5)
      .reverse()
      .map(msg => `${msg.message_type}: ${msg.content}`)
      .join('\n');
    
    return `Recent conversation:\n${recentMessages}`;
  }
}