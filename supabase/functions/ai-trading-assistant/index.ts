import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================
// FIELD DEFINITIONS - COMPREHENSIVE CANONICAL SOURCE OF TRUTH
// Based on complete cross-system field mapping analysis
// =============================================
const FIELD_DEFINITIONS: Record<string, any> = {
  // === AI Intelligence Config ===
  enableAIOverride: {
    key: 'enableAIOverride',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.enableAIOverride',
    csvMatch: 'Enable AI Intelligence',
    aiCanExecute: true,
    phrases: ['enable AI', 'turn on AI', 'activate AI', 'AI on', 'enable intelligence', 'activate intelligence', 'disable AI', 'turn off AI', 'deactivate AI', 'AI off', 'disable intelligence', 'deactivate intelligence'],
    description: 'Master switch for AI-driven decision making'
  },
  aiConfidenceThreshold: {
    key: 'aiConfidenceThreshold',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.aiConfidenceThreshold',
    csvMatch: 'Confidence Threshold',
    aiCanExecute: true,
    phrases: ['confidence threshold', 'AI confidence', 'set confidence', 'confidence level'],
    description: 'Minimum confidence level required for AI to execute trades'
  },
  escalationThreshold: {
    key: 'escalationThreshold',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.escalationThreshold',
    csvMatch: 'Escalation Threshold',
    aiCanExecute: true,
    phrases: ['escalation threshold', 'escalation', 'escalate threshold', 'set escalation'],
    description: 'When AI should escalate vs act independently'
  },
  riskOverrideAllowed: {
    key: 'riskOverrideAllowed',
    type: 'boolean',
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.riskOverrideAllowed',
    csvMatch: 'Allow Risk Parameter Override',
    aiCanExecute: true,
    phrases: ['allow risk parameter override', 'risk override', 'override risk parameters', 'enable risk override', 'disable risk override'],
    description: 'Allow AI to override risk parameters when opportunity justifies it'
  },
  aiAutonomyLevel: {
    key: 'aiAutonomyLevel',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.aiAutonomyLevel',
    csvMatch: 'AI Autonomy Level',
    aiCanExecute: true,
    phrases: ['autonomy level', 'AI autonomy', 'set autonomy', 'autonomy'],
    description: 'Level of autonomous decision-making authority granted to AI'
  },
  enablePatternRecognition: {
    key: 'enablePatternRecognition',
    type: 'boolean',
    uiLocation: 'AI Intelligence → Pattern Recognition & Market Analysis',
    dbPath: 'configuration.aiIntelligenceConfig.enablePatternRecognition',
    csvMatch: 'Enable Pattern Recognition',
    aiCanExecute: true,
    phrases: ['enable pattern recognition', 'use pattern recognition', 'analyze patterns', 'pattern analysis'],
    description: 'Enable AI to recognize and act on historical patterns'
  },
  patternLookbackHours: {
    key: 'patternLookbackHours',
    type: 'number',
    range: [24, 720],
    uiLocation: 'AI Intelligence → Pattern Recognition & Market Analysis',
    dbPath: 'configuration.aiIntelligenceConfig.patternLookbackHours',
    csvMatch: 'Pattern Analysis Lookback',
    aiCanExecute: true,
    phrases: ['pattern lookback', 'lookback hours', 'pattern history', 'analysis period'],
    description: 'How far back to analyze for patterns (in hours)'
  },
  crossAssetCorrelation: {
    key: 'crossAssetCorrelation',
    type: 'boolean',
    uiLocation: 'AI Intelligence → Pattern Recognition & Market Analysis',
    dbPath: 'configuration.aiIntelligenceConfig.crossAssetCorrelation',
    csvMatch: 'Cross-Asset Correlation Analysis',
    aiCanExecute: true,
    phrases: ['cross asset correlation', 'asset correlation', 'correlation analysis', 'check correlations'],
    description: 'Analyze correlations between different assets'
  },
  marketStructureAnalysis: {
    key: 'marketStructureAnalysis',
    type: 'boolean',
    uiLocation: 'AI Intelligence → Pattern Recognition & Market Analysis',
    dbPath: 'configuration.aiIntelligenceConfig.marketStructureAnalysis',
    csvMatch: 'Market Structure Analysis',
    aiCanExecute: true,
    phrases: ['market structure', 'structure analysis', 'market depth', 'liquidity analysis'],
    description: 'Analyze market structure and liquidity patterns'
  },
  enableExternalSignals: {
    key: 'enableExternalSignals',
    type: 'boolean',
    uiLocation: 'AI Intelligence → External Signal Processing',
    dbPath: 'configuration.aiIntelligenceConfig.enableExternalSignals',
    csvMatch: 'Enable External Signal Processing',
    aiCanExecute: true,
    phrases: ['enable external signals', 'use external signals', 'process signals', 'external data'],
    description: 'Process and act on external market signals'
  },
  whaleActivityWeight: {
    key: 'whaleActivityWeight',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → External Signal Processing',
    dbPath: 'configuration.aiIntelligenceConfig.whaleActivityWeight',
    csvMatch: 'Whale Activity',
    aiCanExecute: true,
    phrases: ['whale activity', 'whale weight', 'whale signals', 'whale movements'],
    description: 'Weight given to whale activity signals'
  },
  sentimentWeight: {
    key: 'sentimentWeight',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → External Signal Processing',
    dbPath: 'configuration.aiIntelligenceConfig.sentimentWeight',
    csvMatch: 'Market Sentiment',
    aiCanExecute: true,
    phrases: ['sentiment weight', 'market sentiment', 'sentiment analysis', 'sentiment signals'],
    description: 'Weight given to market sentiment signals'
  },
  newsImpactWeight: {
    key: 'newsImpactWeight',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → External Signal Processing',
    dbPath: 'configuration.aiIntelligenceConfig.newsImpactWeight',
    csvMatch: 'News Impact',
    aiCanExecute: true,
    phrases: ['news impact', 'news weight', 'news signals', 'news analysis'],
    description: 'Weight given to news impact signals'
  },
  socialSignalsWeight: {
    key: 'socialSignalsWeight',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → External Signal Processing',
    dbPath: 'configuration.aiIntelligenceConfig.socialSignalsWeight',
    csvMatch: 'Social Signals',
    aiCanExecute: true,
    phrases: ['social signals', 'social weight', 'social media', 'twitter sentiment'],
    description: 'Weight given to social media signals'
  },
  decisionMode: {
    key: 'decisionMode',
    type: 'string',
    validValues: ['conservative', 'balanced', 'aggressive'],
    uiLocation: 'AI Intelligence → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.decisionMode',
    csvMatch: 'Decision Making Mode',
    aiCanExecute: true,
    phrases: ['decision mode', 'decision making', 'be conservative', 'be aggressive', 'be balanced'],
    description: 'AI decision-making style and risk approach'
  },
  enableLearning: {
    key: 'enableLearning',
    type: 'boolean',
    uiLocation: 'AI Intelligence → Learning & Adaptation',
    dbPath: 'configuration.aiIntelligenceConfig.enableLearning',
    csvMatch: 'Enable AI Learning',
    aiCanExecute: true,
    phrases: ['enable learning', 'AI learning', 'learn from trades', 'adaptive learning'],
    description: 'Enable AI to learn from trading results'
  },
  adaptToPerformance: {
    key: 'adaptToPerformance',
    type: 'boolean',
    uiLocation: 'AI Intelligence → Learning & Adaptation',
    dbPath: 'configuration.aiIntelligenceConfig.adaptToPerformance',
    csvMatch: 'Adapt to Performance',
    aiCanExecute: true,
    phrases: ['adapt to performance', 'performance adaptation', 'adjust based on results'],
    description: 'Adapt strategy based on performance results'
  },
  learningRate: {
    key: 'learningRate',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → Learning & Adaptation',
    dbPath: 'configuration.aiIntelligenceConfig.learningRate',
    csvMatch: 'Learning Rate',
    aiCanExecute: true,
    phrases: ['learning rate', 'learning speed', 'adaptation rate'],
    description: 'Speed of AI learning and adaptation'
  },
  explainDecisions: {
    key: 'explainDecisions',
    type: 'boolean',
    uiLocation: 'AI Intelligence → Alerts & Communication',
    dbPath: 'configuration.aiIntelligenceConfig.explainDecisions',
    csvMatch: 'Explain AI Decisions',
    aiCanExecute: true,
    phrases: ['explain decisions', 'explain AI', 'decision explanations', 'tell me why'],
    description: 'Provide explanations for AI decisions'
  },
  alertOnAnomalies: {
    key: 'alertOnAnomalies',
    type: 'boolean',
    uiLocation: 'AI Intelligence → Alerts & Communication',
    dbPath: 'configuration.aiIntelligenceConfig.alertOnAnomalies',
    csvMatch: 'Alert on Anomalies',
    aiCanExecute: true,
    phrases: ['alert on anomalies', 'anomaly alerts', 'unusual activity alerts'],
    description: 'Alert when AI detects anomalous market conditions'
  },
  alertOnOverrides: {
    key: 'alertOnOverrides',
    type: 'boolean',
    uiLocation: 'AI Intelligence → Alerts & Communication',
    dbPath: 'configuration.aiIntelligenceConfig.alertOnOverrides',
    csvMatch: 'Alert on Overrides',
    aiCanExecute: true,
    phrases: ['alert on overrides', 'override alerts', 'notify when overriding'],
    description: 'Alert when AI overrides strategy rules'
  },
  customInstructions: {
    key: 'customInstructions',
    type: 'string',
    uiLocation: 'AI Intelligence → Alerts & Communication',
    dbPath: 'configuration.aiIntelligenceConfig.customInstructions',
    csvMatch: 'Custom Instructions',
    aiCanExecute: true,
    phrases: ['custom instructions', 'special instructions', 'AI instructions', 'additional guidance'],
    description: 'Custom instructions for AI behavior'
  },

  // === Basic Settings ===
  strategyName: {
    key: 'strategyName',
    type: 'string',
    uiLocation: 'Basic Settings',
    dbPath: 'strategy_name',
    csvMatch: 'Strategy Name',
    aiCanExecute: false, // Strategy name changes require careful consideration
    phrases: ['strategy name', 'name strategy', 'call strategy'],
    description: 'Name of the trading strategy'
  },
  riskProfile: {
    key: 'riskProfile',
    type: 'string',
    validValues: ['low', 'medium', 'high', 'custom'],
    uiLocation: 'Basic Settings',
    dbPath: 'configuration.riskProfile',
    csvMatch: 'Risk Profile',
    aiCanExecute: true,
    phrases: ['risk profile', 'risk level', 'risk tolerance', 'low risk', 'medium risk', 'high risk'],
    description: 'Overall risk tolerance level'
  },
  maxWalletExposure: {
    key: 'maxWalletExposure',
    type: 'number',
    range: [1, 100],
    uiLocation: 'Basic Settings',
    dbPath: 'configuration.maxWalletExposure',
    csvMatch: 'Max Wallet Exposure',
    aiCanExecute: true,
    phrases: ['max wallet exposure', 'wallet exposure', 'exposure limit', 'maximum exposure'],
    description: 'Maximum percentage of wallet that can be exposed to trades'
  },
  enableLiveTrading: {
    key: 'enableLiveTrading',
    type: 'boolean',
    uiLocation: 'Basic Settings',
    dbPath: 'configuration.enableLiveTrading',
    csvMatch: 'Enable Live Trading',
    aiCanExecute: false, // Safety: Don't allow AI to enable live trading
    phrases: ['enable live trading', 'live trading', 'real trading'],
    description: 'Enable live trading with real money'
  },
  enableTestTrading: {
    key: 'enableTestTrading',
    type: 'boolean',
    uiLocation: 'Basic Settings',
    dbPath: 'configuration.enableTestTrading',
    csvMatch: 'Enable Test Trading',
    aiCanExecute: true,
    phrases: ['enable test trading', 'test trading', 'paper trading', 'demo trading'],
    description: 'Enable test trading with simulated money'
  },

  // === Coins & Amounts ===
  selectedCoins: {
    key: 'selectedCoins',
    type: 'array',
    uiLocation: 'Coins and Amounts',
    dbPath: 'configuration.selectedCoins',
    csvMatch: 'Selected Coins',
    aiCanExecute: true,
    phrases: ['selected coins', 'coin selection', 'coins to trade', 'trading pairs', 'add coin', 'remove coin'],
    description: 'List of selected cryptocurrencies to trade'
  },
  maxActiveCoins: {
    key: 'maxActiveCoins',
    type: 'number',
    range: [1, 10],
    uiLocation: 'Coins and Amounts',
    dbPath: 'configuration.maxActiveCoins',
    csvMatch: 'Max Active Coins',
    aiCanExecute: true,
    phrases: ['max active coins', 'maximum coins', 'coin limit', 'active coins'],
    description: 'Maximum number of different cryptocurrencies that can be actively traded at once'
  },
  enableAutoCoinSelection: {
    key: 'enableAutoCoinSelection',
    type: 'boolean',
    uiLocation: 'Coins and Amounts',
    dbPath: 'configuration.enableAutoCoinSelection',
    csvMatch: 'Auto Coin Selection',
    aiCanExecute: true,
    phrases: ['auto coin selection', 'automatic coin selection', 'auto select coins', 'let AI pick coins'],
    description: 'Let the AI automatically choose which coins to trade based on market conditions'
  },
  perTradeAllocation: {
    key: 'perTradeAllocation',
    type: 'number',
    uiLocation: 'Coins and Amounts',
    dbPath: 'configuration.perTradeAllocation',
    csvMatch: 'Amount Per Trade',
    aiCanExecute: true,
    phrases: ['amount per trade', 'trade amount', 'per trade allocation', 'trade size'],
    description: 'Amount allocated per individual trade'
  },
  allocationUnit: {
    key: 'allocationUnit',
    type: 'string',
    validValues: ['euro', 'percentage'],
    uiLocation: 'Coins and Amounts',
    dbPath: 'configuration.allocationUnit',
    csvMatch: 'Allocation Unit',
    aiCanExecute: true,
    phrases: ['allocation unit', 'trade in euros', 'trade in percentage', 'euro allocation', 'percentage allocation'],
    description: 'Unit for trade allocation (euro or percentage)'
  },

  // === Buy/Sell Settings ===
  buyOrderType: {
    key: 'buyOrderType',
    type: 'string',
    validValues: ['market', 'limit', 'trailing_buy'],
    uiLocation: 'Buy/Sell Settings',
    dbPath: 'configuration.buyOrderType',
    csvMatch: 'Buy Order Type',
    aiCanExecute: true,
    phrases: ['buy order type', 'buy order', 'market buy', 'limit buy'],
    description: 'Type of order to use for buying'
  },
  trailingBuyPercentage: {
    key: 'trailingBuyPercentage',
    type: 'number',
    range: [0.1, 10],
    uiLocation: 'Buy/Sell Settings',
    dbPath: 'configuration.trailingBuyPercentage',
    csvMatch: 'Trailing Buy Percentage',
    aiCanExecute: true,
    phrases: ['trailing buy', 'trailing buy percentage', 'buy trailing'],
    description: 'Percentage for trailing buy orders'
  },
  buyFrequency: {
    key: 'buyFrequency',
    type: 'string',
    validValues: ['once', 'daily', 'interval', 'signal_based'],
    uiLocation: 'Buy/Sell Settings',
    dbPath: 'configuration.buyFrequency',
    csvMatch: 'Buy Frequency',
    aiCanExecute: true,
    phrases: ['buy frequency', 'buy once', 'buy daily', 'buy on signal', 'signal based buying'],
    description: 'How often to execute buy orders'
  },
  buyIntervalMinutes: {
    key: 'buyIntervalMinutes',
    type: 'number',
    range: [1, 1440],
    uiLocation: 'Buy/Sell Settings',
    dbPath: 'configuration.buyIntervalMinutes',
    csvMatch: 'Buy Interval (minutes)',
    aiCanExecute: true,
    phrases: ['buy interval', 'buy every', 'interval minutes'],
    description: 'Minutes between automated buy orders when using interval buying'
  },
  buyCooldownMinutes: {
    key: 'buyCooldownMinutes',
    type: 'number',
    range: [1, 1440],
    uiLocation: 'Buy/Sell Settings',
    dbPath: 'configuration.buyCooldownMinutes',
    csvMatch: 'Buy Cooldown',
    aiCanExecute: true,
    phrases: ['buy cooldown', 'cooldown minutes', 'wait between buys'],
    description: 'Cooldown period between buy orders'
  },
  sellOrderType: {
    key: 'sellOrderType',
    type: 'string',
    validValues: ['market', 'limit', 'trailing_stop', 'auto_close'],
    uiLocation: 'Buy/Sell Settings',
    dbPath: 'configuration.sellOrderType',
    csvMatch: 'Sell Order Type',
    aiCanExecute: true,
    phrases: ['sell order type', 'sell order', 'market sell', 'limit sell'],
    description: 'Type of order to use for selling'
  },
  takeProfitPercentage: {
    key: 'takeProfitPercentage',
    type: 'number',
    range: [0.1, 100],
    uiLocation: 'Buy/Sell Settings',
    dbPath: 'configuration.takeProfitPercentage',
    csvMatch: 'Take Profit Percentage',
    aiCanExecute: true,
    phrases: ['take profit', 'take profit percentage', 'set take profit', 'profit target'],
    description: 'Take profit percentage for trades'
  },
  stopLossPercentage: {
    key: 'stopLossPercentage',
    type: 'number',
    range: [0.1, 50],
    uiLocation: 'Buy/Sell Settings',
    dbPath: 'configuration.stopLossPercentage',
    csvMatch: 'Stop Loss Percentage',
    aiCanExecute: true,
    phrases: ['stop loss', 'stop loss percentage', 'set stop loss'],
    description: 'Stop loss percentage for trades'
  },
  trailingStopLossPercentage: {
    key: 'trailingStopLossPercentage',
    type: 'number',
    range: [0.1, 20],
    uiLocation: 'Buy/Sell Settings',
    dbPath: 'configuration.trailingStopLossPercentage',
    csvMatch: 'Trailing Stop Loss Percentage',
    aiCanExecute: true,
    phrases: ['trailing stop loss', 'trailing stop', 'set trailing stop'],
    description: 'Percentage for trailing stop loss orders'
  },
  autoCloseAfterHours: {
    key: 'autoCloseAfterHours',
    type: 'number',
    range: [1, 168],
    uiLocation: 'Buy/Sell Settings',
    dbPath: 'configuration.autoCloseAfterHours',
    csvMatch: 'Auto Close After Hours',
    aiCanExecute: true,
    phrases: ['auto close', 'close after hours', 'position timeout'],
    description: 'Automatically close positions after specified hours'
  },

  // === Position Management ===
  maxOpenPositions: {
    key: 'maxOpenPositions',
    type: 'number',
    range: [1, 20],
    uiLocation: 'Position Management',
    dbPath: 'configuration.maxOpenPositions',
    csvMatch: 'Max Open Positions',
    aiCanExecute: true,
    phrases: ['max open positions', 'maximum positions', 'position limit'],
    description: 'Maximum number of open positions at any time'
  },
  dailyProfitTarget: {
    key: 'dailyProfitTarget',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Position Management',
    dbPath: 'configuration.dailyProfitTarget',
    csvMatch: 'Daily Profit Target',
    aiCanExecute: true,
    phrases: ['daily profit target', 'profit target', 'daily goal'],
    description: 'Daily profit target percentage'
  },
  dailyLossLimit: {
    key: 'dailyLossLimit',
    type: 'number',
    range: [0, 50],
    uiLocation: 'Position Management',
    dbPath: 'configuration.dailyLossLimit',
    csvMatch: 'Daily Loss Limit',
    aiCanExecute: true,
    phrases: ['daily loss limit', 'loss limit', 'maximum daily loss'],
    description: 'Maximum daily loss percentage'
  },
  maxTradesPerDay: {
    key: 'maxTradesPerDay',
    type: 'number',
    range: [1, 100],
    uiLocation: 'Position Management',
    dbPath: 'configuration.maxTradesPerDay',
    csvMatch: 'Max Trades Per Day',
    aiCanExecute: true,
    phrases: ['max trades per day', 'daily trade limit', 'trade limit'],
    description: 'Maximum number of trades per day'
  },
  tradeCooldownMinutes: {
    key: 'tradeCooldownMinutes',
    type: 'number',
    range: [1, 1440],
    uiLocation: 'Position Management',
    dbPath: 'configuration.tradeCooldownMinutes',
    csvMatch: 'Trade Cooldown',
    aiCanExecute: true,
    phrases: ['trade cooldown', 'cooldown between trades', 'wait between trades'],
    description: 'Cooldown period between trades'
  },

  // === DCA & Advanced ===
  enableDCA: {
    key: 'enableDCA',
    type: 'boolean',
    uiLocation: 'DCA & Advanced',
    dbPath: 'configuration.enableDCA',
    csvMatch: 'Enable DCA',
    aiCanExecute: true,
    phrases: ['enable DCA', 'dollar cost averaging', 'DCA', 'average down'],
    description: 'Enable Dollar Cost Averaging'
  },
  dcaIntervalHours: {
    key: 'dcaIntervalHours',
    type: 'number',
    range: [1, 168],
    uiLocation: 'DCA & Advanced',
    dbPath: 'configuration.dcaIntervalHours',
    csvMatch: 'DCA Interval Hours',
    aiCanExecute: true,
    phrases: ['DCA interval', 'DCA hours', 'averaging interval'],
    description: 'Hours between DCA purchases'
  },
  dcaSteps: {
    key: 'dcaSteps',
    type: 'number',
    range: [2, 10],
    uiLocation: 'DCA & Advanced',
    dbPath: 'configuration.dcaSteps',
    csvMatch: 'DCA Steps',
    aiCanExecute: true,
    phrases: ['DCA steps', 'averaging steps', 'DCA levels'],
    description: 'Number of DCA steps'
  },
  enableStopLossTimeout: {
    key: 'enableStopLossTimeout',
    type: 'boolean',
    uiLocation: 'DCA & Advanced',
    dbPath: 'configuration.enableStopLossTimeout',
    csvMatch: 'Enable Stop Loss Timeout',
    aiCanExecute: true,
    phrases: ['stop loss timeout', 'timeout stop loss', 'time based stop loss'],
    description: 'Enable time-based stop loss'
  },
  stopLossTimeoutMinutes: {
    key: 'stopLossTimeoutMinutes',
    type: 'number',
    range: [1, 10080],
    uiLocation: 'DCA & Advanced',
    dbPath: 'configuration.stopLossTimeoutMinutes',
    csvMatch: 'Stop Loss Timeout Minutes',
    aiCanExecute: true,
    phrases: ['stop loss timeout minutes', 'timeout minutes'],
    description: 'Minutes before stop loss timeout'
  },
  useTrailingStopOnly: {
    key: 'useTrailingStopOnly',
    type: 'boolean',
    uiLocation: 'DCA & Advanced',
    dbPath: 'configuration.useTrailingStopOnly',
    csvMatch: 'Use Trailing Stop Only',
    aiCanExecute: true,
    phrases: ['trailing stop only', 'only trailing stop', 'disable fixed stop loss'],
    description: 'Use only trailing stop loss'
  },
  resetStopLossAfterFail: {
    key: 'resetStopLossAfterFail',
    type: 'boolean',
    uiLocation: 'DCA & Advanced',
    dbPath: 'configuration.resetStopLossAfterFail',
    csvMatch: 'Reset Stop Loss After Fail',
    aiCanExecute: true,
    phrases: ['reset stop loss', 'reset after fail', 'stop loss reset'],
    description: 'Reset stop loss after failed execution'
  },

  // === Shorting ===
  enableShorting: {
    key: 'enableShorting',
    type: 'boolean',
    uiLocation: 'Shorting',
    dbPath: 'configuration.enableShorting',
    csvMatch: 'Enable Shorting',
    aiCanExecute: true,
    phrases: ['enable shorting', 'short selling', 'shorting'],
    description: 'Enable short selling'
  },
  maxShortPositions: {
    key: 'maxShortPositions',
    type: 'number',
    range: [1, 10],
    uiLocation: 'Shorting',
    dbPath: 'configuration.maxShortPositions',
    csvMatch: 'Max Short Positions',
    aiCanExecute: true,
    phrases: ['max short positions', 'maximum shorts', 'short limit'],
    description: 'Maximum number of short positions'
  },
  shortingMinProfitPercentage: {
    key: 'shortingMinProfitPercentage',
    type: 'number',
    range: [0.1, 20],
    uiLocation: 'Shorting',
    dbPath: 'configuration.shortingMinProfitPercentage',
    csvMatch: 'Shorting Min Profit Percentage',
    aiCanExecute: true,
    phrases: ['shorting profit', 'short profit percentage', 'minimum short profit'],
    description: 'Minimum profit percentage for shorting'
  },
  autoCloseShorts: {
    key: 'autoCloseShorts',
    type: 'boolean',
    uiLocation: 'Shorting',
    dbPath: 'configuration.autoCloseShorts',
    csvMatch: 'Auto Close Shorts',
    aiCanExecute: true,
    phrases: ['auto close shorts', 'automatically close shorts', 'close shorts'],
    description: 'Automatically close short positions'
  },

  // === Notifications ===
  notifyOnTrade: {
    key: 'notifyOnTrade',
    type: 'boolean',
    uiLocation: 'Notifications',
    dbPath: 'configuration.notifyOnTrade',
    csvMatch: 'Notify on Trade',
    aiCanExecute: true,
    phrases: ['notify on trade', 'trade notifications', 'alert on trades'],
    description: 'Send notifications when trades are executed'
  },
  notifyOnError: {
    key: 'notifyOnError',
    type: 'boolean',
    uiLocation: 'Notifications',
    dbPath: 'configuration.notifyOnError',
    csvMatch: 'Notify on Error',
    aiCanExecute: true,
    phrases: ['notify on error', 'error notifications', 'alert on errors'],
    description: 'Send notifications when errors occur'
  },
  notifyOnTargets: {
    key: 'notifyOnTargets',
    type: 'boolean',
    uiLocation: 'Notifications',
    dbPath: 'configuration.notifyOnTargets',
    csvMatch: 'Notify on Targets',
    aiCanExecute: true,
    phrases: ['notify on targets', 'target notifications', 'alert on targets'],
    description: 'Send notifications when targets are hit'
  },

  // === Advanced Settings ===
  backtestingMode: {
    key: 'backtestingMode',
    type: 'boolean',
    uiLocation: 'Advanced Settings',
    dbPath: 'configuration.backtestingMode',
    csvMatch: 'Backtesting Mode',
    aiCanExecute: true,
    phrases: ['backtesting mode', 'backtest', 'test strategy'],
    description: 'Enable backtesting mode'
  },
  category: {
    key: 'category',
    type: 'string',
    uiLocation: 'Advanced Settings',
    dbPath: 'configuration.category',
    csvMatch: 'Category',
    aiCanExecute: true,
    phrases: ['category', 'strategy category', 'set category'],
    description: 'Strategy category'
  },
  tags: {
    key: 'tags',
    type: 'array',
    uiLocation: 'Advanced Settings',
    dbPath: 'configuration.tags',
    csvMatch: 'Tags',
    aiCanExecute: true,
    phrases: ['tags', 'strategy tags', 'add tag', 'remove tag'],
    description: 'Strategy tags'
  },
  notes: {
    key: 'notes',
    type: 'string',
    uiLocation: 'Advanced Settings',
    dbPath: 'description',
    csvMatch: 'Notes',
    aiCanExecute: true,
    phrases: ['notes', 'description', 'strategy notes', 'add note'],
    description: 'Strategy notes and description'
  }
};

// =============================================
// OPENAI INTENT PROCESSOR
// =============================================
class OpenAIIntentProcessor {
  static async parseIntent(message: string): Promise<{
    isCommand: boolean;
    intent?: {
      action: string;
      field: string;
      value: string;
    };
  }> {
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      console.log('❌ OPENAI_API_KEY not found, falling back to basic parsing');
      return this.fallbackParse(message);
    }

    const fieldsList = Object.values(FIELD_DEFINITIONS).map(f => 
      `${f.key}: ${f.description} (${f.phrases.join(', ')})`
    ).join('\n');

    const prompt = `Parse this user message into structured intent for trading strategy configuration.

Available fields:
${fieldsList}

User message: "${message}"

Return ONLY a JSON object in this exact format:
{
  "isCommand": true/false,
  "intent": {
    "action": "set|enable|disable",
    "field": "exact_field_key_from_list",
    "value": "true|false|number_value"
  }
}

If it's not a command (just a question), return: {"isCommand": false}`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 200
        })
      });

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);
      
      console.log(`🧠 OPENAI_PARSED_INTENT: ${JSON.stringify(result, null, 2)}`);
      return result;
      
    } catch (error) {
      console.log(`❌ OPENAI_PARSE_ERROR: ${error.message}`);
      return this.fallbackParse(message);
    }
  }

  private static fallbackParse(message: string): { isCommand: boolean; intent?: any } {
    const lowerMessage = message.toLowerCase().trim();
    
    // Basic question detection
    const questionPatterns = [
      /^(what|how|why|when|where|which|who)/,
      /\?$/,
      /^(show current|current config|get config|display config)/
    ];
    
    for (const pattern of questionPatterns) {
      if (pattern.test(lowerMessage)) {
        return { isCommand: false };
      }
    }
    
    // Default to command for fallback
    return { isCommand: true };
  }
}

// =============================================
// CONFIG MANAGER - HANDLES DB OPERATIONS
// =============================================
class ConfigManager {
  static getCurrentValue(strategy: any, dbPath: string): any {
    const pathSegments = dbPath.split('.');
    let current = strategy;
    
    for (const segment of pathSegments) {
      if (current && typeof current === 'object' && segment in current) {
        current = current[segment];
      } else {
        return null;
      }
    }
    
    return current;
  }

  static setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  static async updateStrategyConfig(
    userId: string, 
    strategyId: string, 
    updates: Record<string, any>, 
    currentStrategy: any
  ): Promise<{ success: boolean; verificationResults: Record<string, any>; errors: string[] }> {
    
    console.log(`🔧 CONFIG_MANAGER: Processing updates for strategy ${strategyId}`);
    console.log(`📋 RAW_UPDATES: ${JSON.stringify(updates, null, 2)}`);
    
    const verificationResults: Record<string, any> = {};
    const errors: string[] = [];
    
    // STRICT RULE: Process ONLY the fields explicitly requested - NO SIDE EFFECTS
    console.log(`🔍 STRATEGY_BEFORE_CHANGES: ${JSON.stringify(currentStrategy.configuration?.aiIntelligenceConfig, null, 2)}`);
    
    // Start with current configuration to preserve existing values
    const strategyUpdates: any = {
      configuration: { ...currentStrategy.configuration }
    };
    
    for (const [fieldKey, newValue] of Object.entries(updates)) {
      console.log(`🔍 PROCESSING_FIELD: ${fieldKey} = ${newValue}`);
      
      const fieldDef = FIELD_DEFINITIONS[fieldKey];
      if (!fieldDef) {
        const error = `Unknown field: ${fieldKey}`;
        console.log(`❌ ${error}`);
        errors.push(error);
        continue;
      }

      // Check if AI can execute this field
      if (!fieldDef.aiCanExecute) {
        const error = `AI cannot execute field: ${fieldKey}`;
        console.log(`🚫 ${error}`);
        errors.push(error);
        continue;
      }
      
      // Get current value for logging and verification
      const currentValue = this.getCurrentValue(currentStrategy, fieldDef.dbPath);
      console.log(`📊 BEFORE_UPDATE: ${fieldKey} = ${currentValue} (at ${fieldDef.dbPath})`);
      
      // CRITICAL FIX: Use proper path handling to avoid incorrect nesting
      const dbPath = fieldDef.dbPath;
      if (dbPath) {
        console.log(`🔍 PROCESSING_PATH: ${fieldKey} → ${dbPath} = ${JSON.stringify(newValue)}`);
        
        // Special handling for nested aiIntelligenceConfig to preserve other fields
        if (dbPath.includes('aiIntelligenceConfig')) {
          // Ensure aiIntelligenceConfig exists
          if (!strategyUpdates.configuration.aiIntelligenceConfig) {
            strategyUpdates.configuration.aiIntelligenceConfig = {};
          }
          
          // Extract the final property name (e.g., 'enableAIOverride' from 'configuration.aiIntelligenceConfig.enableAIOverride')
          const pathParts = dbPath.split('.');
          const finalProperty = pathParts[pathParts.length - 1];
          
          // Merge with existing aiIntelligenceConfig
          strategyUpdates.configuration.aiIntelligenceConfig = {
            ...currentStrategy.configuration?.aiIntelligenceConfig,
            [finalProperty]: newValue
          };
          
          console.log(`✅ MERGED_AI_CONFIG: ${JSON.stringify(strategyUpdates.configuration.aiIntelligenceConfig, null, 2)}`);
        } else {
          // For all other fields, set directly using the exact path specified
          console.log(`🎯 DIRECT_PATH_SET: Using exact path ${dbPath}`);
          this.setNestedValue(strategyUpdates, dbPath, newValue);
        }
        
        console.log(`✅ MAPPED_TO_DB: ${fieldKey} → ${dbPath} = ${JSON.stringify(newValue)}`);
        console.log(`🔍 FIELD_ISOLATION_CHECK: Preserving other fields in nested objects`);
        
        // Store for verification
        verificationResults[fieldKey] = {
          field: fieldKey,
          dbPath: dbPath,
          oldValue: currentValue,
          newValue: newValue,
          expected: newValue
        };
      }
    }
    
    console.log(`📤 FINAL_STRATEGY_UPDATES: ${JSON.stringify(strategyUpdates, null, 2)}`);
    
    if (Object.keys(updates).length === 0) {
      console.log('ℹ️ NO_VALID_UPDATES to apply');
      return { success: true, verificationResults: {}, errors };
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
      errors.push(`Database update failed: ${updateError.message}`);
      return { success: false, verificationResults: {}, errors };
    }

    if (!updatedStrategy) {
      console.error('❌ NO_STRATEGY_RETURNED after update');
      errors.push('No strategy returned after update');
      return { success: false, verificationResults: {}, errors };
    }

    console.log(`✅ STRATEGY_UPDATED_SUCCESSFULLY`);
    console.log(`✅ UPDATED_STRATEGY: ${JSON.stringify(updatedStrategy, null, 2)}`);
    
    // POST-UPDATE VERIFICATION - Read back values to confirm they were written correctly
    console.log(`🔍 POST_UPDATE_VERIFICATION starting...`);
    
    for (const [fieldKey, verification] of Object.entries(verificationResults)) {
      const actualValue = this.getCurrentValue(updatedStrategy, verification.dbPath);
      console.log(`🔍 POST_UPDATE_VERIFICATION: ${fieldKey}: expected=${verification.expected}, actual=${actualValue}`);
      
      verification.actualValue = actualValue;
      verification.verified = actualValue === verification.expected;
      
      if (!verification.verified) {
        const error = `Verification failed for ${fieldKey}: expected ${verification.expected}, got ${actualValue}`;
        console.log(`❌ ${error}`);
        errors.push(error);
      } else {
        console.log(`✅ VERIFICATION_SUCCESS: ${fieldKey}`);
      }
    }

    return { 
      success: errors.length === 0, 
      verificationResults, 
      errors 
    };
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

    const activeField = testMode ? 'is_active_test' : 'is_active_live';
    
    const { data: strategy, error } = await supabase
      .from('trading_strategies')
      .select('*')
      .eq('user_id', userId)
      .eq(activeField, true)
      .single();

    if (error) {
      console.error('❌ STRATEGY_FETCH_ERROR:', error);
      return null;
    }

    if (strategy) {
      console.log(`✅ STRATEGY_RESOLVER: ${strategy.strategy_name}`);
    }

    return strategy;
  }
}

// =============================================
// RESPONSE FORMATTER
// =============================================
class ResponseFormatter {
  static formatSuccessResponse(
    message: string, 
    verificationResults: Record<string, any>
  ): string {
    let response = `✅ ${message}\n\n`;
    
    // Add verification details
    const verifiedFields = Object.values(verificationResults).filter((v: any) => v.verified);
    const failedFields = Object.values(verificationResults).filter((v: any) => !v.verified);
    
    if (verifiedFields.length > 0) {
      response += `**Successfully updated:**\n`;
      for (const field of verifiedFields) {
        response += `• ${field.field}: ${field.oldValue} → ${field.actualValue}\n`;
      }
    }
    
    if (failedFields.length > 0) {
      response += `\n**Verification failed:**\n`;
      for (const field of failedFields) {
        response += `• ${field.field}: Expected ${field.expected}, got ${field.actualValue}\n`;
      }
    }
    
    return response.trim();
  }

  static formatErrorResponse(message: string, errors: string[]): string {
    let response = `❌ ${message}\n\n`;
    
    if (errors.length > 0) {
      response += `**Errors:**\n`;
      for (const error of errors) {
        response += `• ${error}\n`;
      }
    }
    
    return response.trim();
  }

  static formatQuestionResponse(): string {
    return `I'm here to help you configure your trading strategy. You can ask me to:

• Enable or disable AI: "Enable AI" or "Disable AI"
• Set confidence levels: "Set confidence threshold to 80%"
• Adjust autonomy: "Set AI autonomy level to 50%"
• Configure risk: "Set max wallet exposure to 30%"

What would you like me to configure?`;
  }
}

// =============================================
// MAIN HANDLER
// =============================================
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 AI_ASSISTANT: Function started');
    
    // Parse request body
    console.log('📥 AI_ASSISTANT: Parsing request body');
    const requestData = await req.json();
    
    console.log(`📋 AI_ASSISTANT: Request data: ${JSON.stringify(requestData, null, 2)}`);
    
    const { userId, message, strategyId, testMode = true, debug = false } = requestData;
    
    console.log(`🤖 AI_ASSISTANT: Request received: "${message}" | StrategyId: ${strategyId} | TestMode: ${testMode}`);
    
    // Get the active strategy
    const strategy = await StrategyResolver.getActiveStrategy(userId, testMode);
    
    if (!strategy) {
      return new Response(
        JSON.stringify({ 
          response: '❌ No active strategy found. Please create and activate a strategy first.',
          success: false 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Parse intent using OpenAI
    const parsedIntent = await OpenAIIntentProcessor.parseIntent(message);
    console.log(`🧠 OPENAI_INTENT_RESULT: ${JSON.stringify(parsedIntent, null, 2)}`);
    
    if (!parsedIntent.isCommand) {
      console.log('🤔 QUESTION DETECTED - No config changes will be made');
      
      // Check if this is a diagnostic query
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('show current') || lowerMessage.includes('current config') || 
          lowerMessage.includes('get config') || lowerMessage.includes('display config')) {
        
        // Generate current config display
        let configResponse = '📊 **Current Configuration:**\n\n';
        
        for (const [fieldKey, fieldDef] of Object.entries(FIELD_DEFINITIONS)) {
          const currentValue = ConfigManager.getCurrentValue(strategy, fieldDef.dbPath);
          configResponse += `• ${fieldDef.description}: ${currentValue ?? 'not set'}\n`;
        }
        
        return new Response(
          JSON.stringify({ 
            response: configResponse,
            success: true 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          response: ResponseFormatter.formatQuestionResponse(),
          success: true 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Process command using structured intent
    if (!parsedIntent.intent) {
      console.log('❌ NO_INTENT_EXTRACTED');
      return new Response(
        JSON.stringify({ 
          response: '❌ Could not understand the command. Please try again with a clearer instruction.',
          success: false 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { field, value } = parsedIntent.intent;
    console.log(`🎯 STRUCTURED_INTENT: field=${field}, value=${value}`);
    
    // Validate field exists in definitions
    const fieldDef = FIELD_DEFINITIONS[field];
    if (!fieldDef) {
      console.log(`❌ UNKNOWN_FIELD: ${field}`);
      return new Response(
        JSON.stringify({ 
          response: `❌ Unknown field: ${field}`,
          success: false 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Convert value to correct type and handle special array operations
    let typedValue: any = value;
    if (fieldDef.type === 'boolean') {
      typedValue = value === 'true' || value === true;
    } else if (fieldDef.type === 'number') {
      typedValue = parseFloat(value);
      if (isNaN(typedValue)) {
        return new Response(
          JSON.stringify({ 
            response: `❌ Invalid number value: ${value}`,
            success: false 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (fieldDef.type === 'array') {
      // Special handling for array fields like selectedCoins
      const currentValue = ConfigManager.getCurrentValue(strategy, fieldDef.dbPath);
      const currentArray = Array.isArray(currentValue) ? currentValue : [];
      
      // Check if this is an add/remove operation based on the original message
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('add') && lowerMessage.includes('to')) {
        // Add operation: append to existing array if not already present
        if (!currentArray.includes(value)) {
          typedValue = [...currentArray, value];
          console.log(`➕ ARRAY_ADD: Adding "${value}" to existing array [${currentArray.join(', ')}]`);
        } else {
          typedValue = currentArray; // No change if already exists
          console.log(`⏭️ ARRAY_SKIP: "${value}" already exists in array`);
        }
      } else if (lowerMessage.includes('remove') && lowerMessage.includes('from')) {
        // Remove operation: filter out the value
        typedValue = currentArray.filter(item => item !== value);
        console.log(`➖ ARRAY_REMOVE: Removing "${value}" from array [${currentArray.join(', ')}]`);
      } else {
        // Replace operation: set entire array to single value or parse comma-separated
        if (value.includes(',')) {
          typedValue = value.split(',').map(v => v.trim());
        } else {
          typedValue = [value];
        }
        console.log(`🔄 ARRAY_REPLACE: Setting array to [${typedValue.join(', ')}]`);
      }
    }
    
    console.log(`🔧 EXECUTING_UPDATE: ${field} = ${typedValue}`);
    
    // Execute the update
    const result = await ConfigManager.updateStrategyConfig(
      strategy.user_id, 
      strategy.id, 
      { [field]: typedValue },
      strategy
    );

    // Return clean structured response
    if (result.success) {
      const verification = result.verificationResults[field];
      return new Response(
        JSON.stringify({ 
          success: true,
          field: field,
          oldValue: verification?.oldValue ?? null,
          newValue: verification?.actualValue ?? typedValue,
          confirmed: verification?.verified ?? false
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ 
          success: false,
          field: field,
          error: result.errors.join(', '),
          confirmed: false
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('❌ UNEXPECTED_ERROR:', error);
    return new Response(
      JSON.stringify({ 
        response: '❌ An unexpected error occurred while processing your request.',
        success: false,
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});