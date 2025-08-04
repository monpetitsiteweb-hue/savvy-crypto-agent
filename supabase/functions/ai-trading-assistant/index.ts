import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================
// COMPREHENSIVE FIELD DEFINITIONS - ALL 57 FIELDS
// Based on complete cross-system field mapping analysis
// =============================================
const FIELD_DEFINITIONS: Record<string, any> = {
  // === BASIC STRATEGY FIELDS ===
  strategyName: {
    key: 'strategyName',
    type: 'string',
    dbPath: 'strategy_name',
    aiCanExecute: false, // Safety: Strategy name changes need careful consideration
    phrases: ['strategy name', 'name strategy', 'call strategy'],
    description: 'Strategy name'
  },
  notes: {
    key: 'notes',
    type: 'string',
    dbPath: 'description',
    aiCanExecute: true,
    phrases: ['notes', 'description', 'strategy notes', 'add note'],
    description: 'Strategy description/notes'
  },
  riskProfile: {
    key: 'riskProfile',
    type: 'string',
    validValues: ['low', 'medium', 'high', 'custom'],
    dbPath: 'configuration.riskProfile',
    aiCanExecute: true,
    phrases: ['risk profile', 'risk level', 'risk tolerance', 'low risk', 'medium risk', 'high risk'],
    description: 'Risk profile (conservative, moderate, aggressive)'
  },
  maxWalletExposure: {
    key: 'maxWalletExposure',
    type: 'number',
    range: [1, 100],
    dbPath: 'configuration.maxWalletExposure',
    aiCanExecute: true,
    phrases: ['max wallet exposure', 'wallet exposure', 'exposure limit', 'maximum exposure'],
    description: 'Maximum wallet exposure percentage (0-100)'
  },
  enableLiveTrading: {
    key: 'enableLiveTrading',
    type: 'boolean',
    dbPath: 'configuration.enableLiveTrading',
    aiCanExecute: false, // Safety: Don't allow AI to enable live trading
    phrases: ['enable live trading', 'live trading', 'real trading'],
    description: 'Enable live trading'
  },
  enableTestTrading: {
    key: 'enableTestTrading',
    type: 'boolean',
    dbPath: 'configuration.enableTestTrading',
    aiCanExecute: true,
    phrases: ['enable test trading', 'test trading', 'paper trading', 'demo trading'],
    description: 'Enable test mode trading'
  },
  category: {
    key: 'category',
    type: 'string',
    dbPath: 'configuration.category',
    aiCanExecute: true,
    phrases: ['category', 'strategy category', 'set category'],
    description: 'Strategy category'
  },
  tags: {
    key: 'tags',
    type: 'array',
    dbPath: 'configuration.tags',
    aiCanExecute: true,
    phrases: ['tags', 'strategy tags', 'add tag', 'remove tag'],
    description: 'Strategy tags for organization'
  },

  // === COINS & AMOUNTS ===
  selectedCoins: {
    key: 'selectedCoins',
    type: 'array',
    dbPath: 'configuration.selectedCoins',
    aiCanExecute: true,
    validValues: ['BTC', 'ETH', 'XRP', 'ADA', 'SOL', 'DOT', 'MATIC', 'AVAX', 'LINK', 'UNI', 'AAVE', 'CRV', 'COMP', 'SUSHI', 'USDC', 'USDT', 'DAI', 'LTC', 'BCH', 'XLM', 'ALGO', 'ATOM', 'ICP', 'FIL'],
    phrases: ['selected coins', 'coin selection', 'coins to trade', 'trading pairs', 'add coin', 'remove coin', 'all coins', 'all available coins'],
    description: 'Array of selected cryptocurrency symbols'
  },
  maxActiveCoins: {
    key: 'maxActiveCoins',
    type: 'number',
    range: [1, 10],
    dbPath: 'configuration.maxActiveCoins',
    aiCanExecute: true,
    phrases: ['max active coins', 'maximum coins', 'coin limit', 'active coins'],
    description: 'Maximum number of active coins to trade'
  },
  enableAutoCoinSelection: {
    key: 'enableAutoCoinSelection',
    type: 'boolean',
    dbPath: 'configuration.enableAutoCoinSelection',
    aiCanExecute: true,
    phrases: ['auto coin selection', 'automatic coin selection', 'auto select coins', 'let AI pick coins'],
    description: 'Enable automatic coin selection'
  },
  perTradeAllocation: {
    key: 'perTradeAllocation',
    type: 'number',
    dbPath: 'configuration.perTradeAllocation',
    aiCanExecute: true,
    phrases: ['amount per trade', 'trade amount', 'per trade allocation', 'trade size'],
    description: 'Amount allocated per trade'
  },
  allocationUnit: {
    key: 'allocationUnit',
    type: 'string',
    validValues: ['euro', 'percentage'],
    dbPath: 'configuration.allocationUnit',
    aiCanExecute: true,
    phrases: ['allocation unit', 'trade in euros', 'trade in percentage', 'euro allocation', 'percentage allocation'],
    description: 'Unit for allocation (euro or percentage)'
  },

  // === BUY SETTINGS ===
  buyOrderType: {
    key: 'buyOrderType',
    type: 'string',
    validValues: ['market', 'limit', 'trailing_buy'],
    dbPath: 'configuration.buyOrderType',
    aiCanExecute: true,
    phrases: ['buy order type', 'buy order', 'market buy', 'limit buy', 'limit order'],
    description: 'Type of buy order (market, limit, etc.)'
  },
  trailingBuyPercentage: {
    key: 'trailingBuyPercentage',
    type: 'number',
    range: [0.1, 10],
    dbPath: 'configuration.trailingBuyPercentage',
    aiCanExecute: true,
    phrases: ['trailing buy', 'trailing buy percentage', 'buy trailing'],
    description: 'Trailing buy percentage'
  },
  buyFrequency: {
    key: 'buyFrequency',
    type: 'string',
    validValues: ['once', 'daily', 'interval', 'signal_based'],
    dbPath: 'configuration.buyFrequency',
    aiCanExecute: true,
    phrases: ['buy frequency', 'buy once', 'buy daily', 'buy on signal', 'signal based buying'],
    description: 'Buy frequency (daily, hourly, etc.)'
  },
  buyIntervalMinutes: {
    key: 'buyIntervalMinutes',
    type: 'number',
    range: [1, 1440],
    dbPath: 'configuration.buyIntervalMinutes',
    aiCanExecute: true,
    phrases: ['buy interval', 'buy every', 'interval minutes'],
    description: 'Buy interval in minutes'
  },
  buyCooldownMinutes: {
    key: 'buyCooldownMinutes',
    type: 'number',
    range: [1, 1440],
    dbPath: 'configuration.buyCooldownMinutes',
    aiCanExecute: true,
    phrases: ['buy cooldown', 'cooldown minutes', 'wait between buys'],
    description: 'Buy cooldown in minutes'
  },

  // === SELL SETTINGS ===
  sellOrderType: {
    key: 'sellOrderType',
    type: 'string',
    validValues: ['market', 'limit', 'trailing_stop', 'auto_close'],
    dbPath: 'configuration.sellOrderType',
    aiCanExecute: true,
    phrases: ['sell order type', 'sell order', 'market sell', 'limit sell'],
    description: 'Type of sell order (market, limit, etc.)'
  },
  takeProfitPercentage: {
    key: 'takeProfitPercentage',
    type: 'number',
    range: [0.1, 100],
    dbPath: 'configuration.takeProfitPercentage',
    aiCanExecute: true,
    phrases: ['take profit', 'take profit percentage', 'set take profit', 'profit target'],
    description: 'Take profit percentage threshold'
  },
  stopLossPercentage: {
    key: 'stopLossPercentage',
    type: 'number',
    range: [0.1, 50],
    dbPath: 'configuration.stopLossPercentage',
    aiCanExecute: true,
    phrases: ['stop loss', 'stop loss percentage', 'set stop loss'],
    description: 'Stop loss percentage threshold'
  },
  trailingStopLossPercentage: {
    key: 'trailingStopLossPercentage',
    type: 'number',
    range: [0.1, 50],
    dbPath: 'configuration.trailingStopLossPercentage',
    aiCanExecute: true,
    phrases: ['trailing stop loss', 'trailing stop', 'trailing stop percentage'],
    description: 'Trailing stop loss percentage'
  },
  autoCloseAfterHours: {
    key: 'autoCloseAfterHours',
    type: 'number',
    range: [1, 720],
    dbPath: 'configuration.autoCloseAfterHours',
    aiCanExecute: true,
    phrases: ['auto close after hours', 'close after hours', 'auto close'],
    description: 'Auto close positions after hours'
  },
  maxOpenPositions: {
    key: 'maxOpenPositions',
    type: 'number',
    range: [1, 20],
    dbPath: 'configuration.maxOpenPositions',
    aiCanExecute: true,
    phrases: ['max open positions', 'maximum positions', 'position limit'],
    description: 'Maximum open positions'
  },
  tradeCooldownMinutes: {
    key: 'tradeCooldownMinutes',
    type: 'number',
    range: [1, 1440],
    dbPath: 'configuration.tradeCooldownMinutes',
    aiCanExecute: true,
    phrases: ['trade cooldown', 'cooldown minutes', 'wait between trades'],
    description: 'Trade cooldown in minutes'
  },
  useTrailingStopOnly: {
    key: 'useTrailingStopOnly',
    type: 'boolean',
    dbPath: 'configuration.useTrailingStopOnly',
    aiCanExecute: true,
    phrases: ['use trailing stop only', 'trailing only', 'only trailing'],
    description: 'Use trailing stop only'
  },
  enableStopLossTimeout: {
    key: 'enableStopLossTimeout',
    type: 'boolean',
    dbPath: 'configuration.enableStopLossTimeout',
    aiCanExecute: true,
    phrases: ['enable stop loss timeout', 'stop loss timeout', 'timeout stop loss'],
    description: 'Enable stop loss timeout'
  },
  stopLossTimeoutMinutes: {
    key: 'stopLossTimeoutMinutes',
    type: 'number',
    range: [1, 1440],
    dbPath: 'configuration.stopLossTimeoutMinutes',
    aiCanExecute: true,
    phrases: ['stop loss timeout minutes', 'timeout minutes', 'stop loss timeout'],
    description: 'Stop loss timeout in minutes'
  },
  resetStopLossAfterFail: {
    key: 'resetStopLossAfterFail',
    type: 'boolean',
    dbPath: 'configuration.resetStopLossAfterFail',
    aiCanExecute: true,
    phrases: ['reset stop loss after fail', 'reset after fail', 'reset stop loss'],
    description: 'Reset stop loss after failure'
  },

  // === RISK MANAGEMENT ===
  dailyProfitTarget: {
    key: 'dailyProfitTarget',
    type: 'number',
    range: [0.1, 100],
    dbPath: 'configuration.dailyProfitTarget',
    aiCanExecute: true,
    phrases: ['daily profit target', 'profit target', 'daily target'],
    description: 'Daily profit target'
  },
  dailyLossLimit: {
    key: 'dailyLossLimit',
    type: 'number',
    range: [0.1, 100],
    dbPath: 'configuration.dailyLossLimit',
    aiCanExecute: true,
    phrases: ['daily loss limit', 'loss limit', 'daily limit'],
    description: 'Daily loss limit'
  },
  maxTradesPerDay: {
    key: 'maxTradesPerDay',
    type: 'number',
    range: [1, 100],
    dbPath: 'configuration.maxTradesPerDay',
    aiCanExecute: true,
    phrases: ['max trades per day', 'trades per day', 'daily trade limit'],
    description: 'Maximum trades per day'
  },
  backtestingMode: {
    key: 'backtestingMode',
    type: 'boolean',
    dbPath: 'configuration.backtestingMode',
    aiCanExecute: true,
    phrases: ['backtesting mode', 'enable backtesting', 'backtest'],
    description: 'Enable backtesting mode'
  },

  // === NOTIFICATIONS ===
  notifyOnTrade: {
    key: 'notifyOnTrade',
    type: 'boolean',
    dbPath: 'configuration.notifyOnTrade',
    aiCanExecute: true,
    phrases: ['notify on trade', 'trade notifications', 'notify trades'],
    description: 'Send notifications on trade execution'
  },
  notifyOnError: {
    key: 'notifyOnError',
    type: 'boolean',
    dbPath: 'configuration.notifyOnError',
    aiCanExecute: true,
    phrases: ['notify on error', 'error notifications', 'notify errors'],
    description: 'Send notifications on errors'
  },
  notifyOnTargets: {
    key: 'notifyOnTargets',
    type: 'boolean',
    dbPath: 'configuration.notifyOnTargets',
    aiCanExecute: true,
    phrases: ['notify on targets', 'target notifications', 'notify targets'],
    description: 'Send notifications when targets are hit'
  },

  // === SHORTING ===
  enableShorting: {
    key: 'enableShorting',
    type: 'boolean',
    dbPath: 'configuration.enableShorting',
    aiCanExecute: true,
    phrases: ['enable shorting', 'short selling', 'shorting'],
    description: 'Enable short selling'
  },
  maxShortPositions: {
    key: 'maxShortPositions',
    type: 'number',
    range: [1, 10],
    dbPath: 'configuration.maxShortPositions',
    aiCanExecute: true,
    phrases: ['max short positions', 'maximum shorts', 'short limit'],
    description: 'Maximum short positions'
  },
  shortingMinProfitPercentage: {
    key: 'shortingMinProfitPercentage',
    type: 'number',
    range: [0.1, 50],
    dbPath: 'configuration.shortingMinProfitPercentage',
    aiCanExecute: true,
    phrases: ['shorting min profit', 'min profit percentage', 'minimum profit'],
    description: 'Minimum profit percentage for shorting'
  },
  autoCloseShorts: {
    key: 'autoCloseShorts',
    type: 'boolean',
    dbPath: 'configuration.autoCloseShorts',
    aiCanExecute: true,
    phrases: ['auto close shorts', 'close shorts automatically', 'auto close short positions'],
    description: 'Auto close short positions'
  },

  // === DOLLAR COST AVERAGING ===
  enableDCA: {
    key: 'enableDCA',
    type: 'boolean',
    dbPath: 'configuration.enableDCA',
    aiCanExecute: true,
    phrases: ['enable DCA', 'dollar cost averaging', 'DCA'],
    description: 'Enable Dollar Cost Averaging'
  },
  dcaIntervalHours: {
    key: 'dcaIntervalHours',
    type: 'number',
    range: [1, 168],
    dbPath: 'configuration.dcaIntervalHours',
    aiCanExecute: true,
    phrases: ['DCA interval hours', 'DCA interval', 'interval hours'],
    description: 'DCA interval in hours'
  },
  dcaSteps: {
    key: 'dcaSteps',
    type: 'number',
    range: [2, 20],
    dbPath: 'configuration.dcaSteps',
    aiCanExecute: true,
    phrases: ['DCA steps', 'number of steps', 'DCA stages'],
    description: 'Number of DCA steps'
  },

  // === AI INTELLIGENCE SETTINGS ===
  enableAIOverride: {
    key: 'enableAIOverride',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.enableAIOverride',
    aiCanExecute: true,
    phrases: ['enable AI', 'turn on AI', 'activate AI', 'AI on', 'enable intelligence', 'activate intelligence', 'disable AI', 'turn off AI', 'deactivate AI', 'AI off', 'disable intelligence', 'deactivate intelligence'],
    description: 'Enable AI to override trading decisions'
  },
  aiAutonomyLevel: {
    key: 'aiAutonomyLevel',
    type: 'number',
    range: [0, 100],
    dbPath: 'configuration.aiIntelligenceConfig.aiAutonomyLevel',
    aiCanExecute: true,
    phrases: ['autonomy level', 'AI autonomy', 'set autonomy', 'autonomy'],
    description: 'AI autonomy level (0-100)'
  },
  aiConfidenceThreshold: {
    key: 'aiConfidenceThreshold',
    type: 'number',
    range: [0, 100],
    dbPath: 'configuration.aiIntelligenceConfig.aiConfidenceThreshold',
    aiCanExecute: true,
    phrases: ['confidence threshold', 'AI confidence', 'set confidence', 'confidence level'],
    description: 'AI confidence threshold for decisions (0-100)'
  },
  escalationThreshold: {
    key: 'escalationThreshold',
    type: 'number',
    range: [0, 100],
    dbPath: 'configuration.aiIntelligenceConfig.escalationThreshold',
    aiCanExecute: true,
    phrases: ['escalation threshold', 'escalation', 'escalate threshold', 'set escalation'],
    description: 'Threshold for escalating decisions to human (0-100)'
  },
  riskOverrideAllowed: {
    key: 'riskOverrideAllowed',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.riskOverrideAllowed',
    aiCanExecute: true,
    phrases: ['allow risk parameter override', 'risk override', 'override risk parameters', 'enable risk override', 'disable risk override'],
    description: 'Allow AI to override risk parameters'
  },
  enablePatternRecognition: {
    key: 'enablePatternRecognition',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.enablePatternRecognition',
    aiCanExecute: true,
    phrases: ['enable pattern recognition', 'use pattern recognition', 'analyze patterns', 'pattern analysis'],
    description: 'Enable pattern recognition'
  },
  patternLookbackHours: {
    key: 'patternLookbackHours',
    type: 'number',
    range: [24, 720],
    dbPath: 'configuration.aiIntelligenceConfig.patternLookbackHours',
    aiCanExecute: true,
    phrases: ['pattern lookback', 'lookback hours', 'pattern history', 'analysis period'],
    description: 'Pattern lookback hours'
  },
  crossAssetCorrelation: {
    key: 'crossAssetCorrelation',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.crossAssetCorrelation',
    aiCanExecute: true,
    phrases: ['cross asset correlation', 'asset correlation', 'correlation analysis', 'check correlations'],
    description: 'Enable cross-asset correlation analysis'
  },
  marketStructureAnalysis: {
    key: 'marketStructureAnalysis',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.marketStructureAnalysis',
    aiCanExecute: true,
    phrases: ['market structure', 'structure analysis', 'market depth', 'liquidity analysis'],
    description: 'Enable market structure analysis'
  },
  enableExternalSignals: {
    key: 'enableExternalSignals',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.enableExternalSignals',
    aiCanExecute: true,
    phrases: ['enable external signals', 'use external signals', 'process signals', 'external data'],
    description: 'Enable external signals'
  },
  whaleActivityWeight: {
    key: 'whaleActivityWeight',
    type: 'number',
    range: [0, 100],
    dbPath: 'configuration.aiIntelligenceConfig.whaleActivityWeight',
    aiCanExecute: true,
    phrases: ['whale activity', 'whale weight', 'whale signals', 'whale movements'],
    description: 'Weight for whale activity signals (0-100)'
  },
  sentimentWeight: {
    key: 'sentimentWeight',
    type: 'number',
    range: [0, 100],
    dbPath: 'configuration.aiIntelligenceConfig.sentimentWeight',
    aiCanExecute: true,
    phrases: ['sentiment weight', 'market sentiment', 'sentiment analysis', 'sentiment signals'],
    description: 'Weight for sentiment analysis (0-100)'
  },
  newsImpactWeight: {
    key: 'newsImpactWeight',
    type: 'number',
    range: [0, 100],
    dbPath: 'configuration.aiIntelligenceConfig.newsImpactWeight',
    aiCanExecute: true,
    phrases: ['news impact', 'news weight', 'news signals', 'news analysis'],
    description: 'Weight for news impact (0-100)'
  },
  socialSignalsWeight: {
    key: 'socialSignalsWeight',
    type: 'number',
    range: [0, 100],
    dbPath: 'configuration.aiIntelligenceConfig.socialSignalsWeight',
    aiCanExecute: true,
    phrases: ['social signals', 'social weight', 'social media', 'twitter sentiment'],
    description: 'Weight for social signals (0-100)'
  },
  decisionMode: {
    key: 'decisionMode',
    type: 'string',
    validValues: ['conservative', 'balanced', 'aggressive'],
    dbPath: 'configuration.aiIntelligenceConfig.decisionMode',
    aiCanExecute: true,
    phrases: ['decision mode', 'decision making', 'be conservative', 'be aggressive', 'be balanced'],
    description: 'AI decision mode (conservative, balanced, aggressive)'
  },
  enableLearning: {
    key: 'enableLearning',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.enableLearning',
    aiCanExecute: true,
    phrases: ['enable learning', 'AI learning', 'learn from trades', 'adaptive learning'],
    description: 'Enable AI learning'
  },
  adaptToPerformance: {
    key: 'adaptToPerformance',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.adaptToPerformance',
    aiCanExecute: true,
    phrases: ['adapt to performance', 'performance adaptation', 'adjust based on results'],
    description: 'Adapt AI to performance'
  },
  learningRate: {
    key: 'learningRate',
    type: 'number',
    range: [0, 100],
    dbPath: 'configuration.aiIntelligenceConfig.learningRate',
    aiCanExecute: true,
    phrases: ['learning rate', 'learning speed', 'adaptation rate'],
    description: 'AI learning rate (0-100)'
  },
  explainDecisions: {
    key: 'explainDecisions',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.explainDecisions',
    aiCanExecute: true,
    phrases: ['explain decisions', 'explain AI', 'decision explanations', 'tell me why'],
    description: 'Explain AI decisions'
  },
  alertOnAnomalies: {
    key: 'alertOnAnomalies',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.alertOnAnomalies',
    aiCanExecute: true,
    phrases: ['alert on anomalies', 'anomaly alerts', 'unusual activity alerts'],
    description: 'Alert on market anomalies'
  },
  alertOnOverrides: {
    key: 'alertOnOverrides',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.alertOnOverrides',
    aiCanExecute: true,
    phrases: ['alert on overrides', 'override alerts', 'notify when overriding'],
    description: 'Alert on AI overrides'
  },
  customInstructions: {
    key: 'customInstructions',
    type: 'string',
    dbPath: 'configuration.aiIntelligenceConfig.customInstructions',
    aiCanExecute: true,
    phrases: ['custom instructions', 'special instructions', 'AI instructions', 'additional guidance'],
    description: 'Custom AI instructions'
  }
};

// =============================================
// TYPE VALIDATION AND CONVERSION
// =============================================
class TypeValidator {
  static validateAndConvert(value: any, fieldDef: any): { valid: boolean; convertedValue?: any; error?: string } {
    const { type, range, validValues } = fieldDef;
    
    try {
      if (type === 'boolean') {
        if (typeof value === 'boolean') {
          return { valid: true, convertedValue: value };
        }
        if (typeof value === 'string') {
          const lowerValue = value.toLowerCase();
          if (['true', 'yes', 'on', '1', 'enable', 'enabled'].includes(lowerValue)) {
            return { valid: true, convertedValue: true };
          }
          if (['false', 'no', 'off', '0', 'disable', 'disabled'].includes(lowerValue)) {
            return { valid: true, convertedValue: false };
          }
        }
        return { valid: false, error: `Invalid boolean value: ${value}` };
      }
      
      if (type === 'number') {
        let numValue: number;
        if (typeof value === 'number') {
          numValue = value;
        } else if (typeof value === 'string') {
          // Handle percentage notation
          const cleanValue = value.replace(/%/g, '').trim();
          numValue = parseFloat(cleanValue);
        } else {
          return { valid: false, error: `Invalid number value: ${value}` };
        }
        
        if (isNaN(numValue)) {
          return { valid: false, error: `Cannot convert to number: ${value}` };
        }
        
        if (range && (numValue < range[0] || numValue > range[1])) {
          return { valid: false, error: `Number ${numValue} outside valid range [${range[0]}, ${range[1]}]` };
        }
        
        return { valid: true, convertedValue: numValue };
      }
      
      if (type === 'string') {
        const stringValue = String(value);
        if (validValues && !validValues.includes(stringValue)) {
          return { valid: false, error: `Invalid value "${stringValue}". Valid options: ${validValues.join(', ')}` };
        }
        return { valid: true, convertedValue: stringValue };
      }
      
      if (type === 'array') {
        if (Array.isArray(value)) {
          return { valid: true, convertedValue: value };
        }
        if (typeof value === 'string') {
          // Convert string to array (handle comma-separated values)
          const arrayValue = value.split(',').map(item => item.trim()).filter(item => item.length > 0);
          return { valid: true, convertedValue: arrayValue };
        }
        return { valid: false, error: `Invalid array value: ${value}` };
      }
      
      return { valid: false, error: `Unknown type: ${type}` };
      
    } catch (error) {
      return { valid: false, error: `Validation error: ${error.message}` };
    }
  }
}

// =============================================
// ADVANCED INTENT PROCESSOR
// =============================================
class IntentProcessor {
  static async parseIntent(message: string): Promise<{
    isCommand: boolean;
    commands?: Array<{
      action: string;
      field: string;
      value: any;
      rawValue: string;
    }>;
    error?: string;
  }> {
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      console.log('❌ OPENAI_API_KEY not found, falling back to basic parsing');
      return this.fallbackParse(message);
    }

    const fieldsList = Object.values(FIELD_DEFINITIONS)
      .filter((f: any) => f.aiCanExecute)
      .map((f: any) => `${f.key}: ${f.description} (${f.phrases.slice(0, 3).join(', ')})`)
      .join('\n');

    const prompt = `Parse this user message for trading strategy configuration commands.

Available fields that AI can modify:
${fieldsList}

User message: "${message}"

Extract ALL configuration commands from the message. For each command, identify:
1. The action (set, enable, disable, add, remove)
2. The exact field key from the list above
3. The value to set

Return ONLY a JSON object in this exact format:
{
  "isCommand": true/false,
  "commands": [
    {
      "action": "set|enable|disable|add|remove",
      "field": "exact_field_key_from_list",
      "value": "value_to_set",
      "rawValue": "original_value_from_message"
    }
  ]
}

Examples:
- "Set stop loss to 5%" → {"isCommand": true, "commands": [{"action": "set", "field": "stopLossPercentage", "value": "5", "rawValue": "5%"}]}
- "Enable AI and set confidence to 80%" → {"isCommand": true, "commands": [{"action": "enable", "field": "enableAIOverride", "value": "true", "rawValue": "enable"}, {"action": "set", "field": "aiConfidenceThreshold", "value": "80", "rawValue": "80%"}]}
- "Add BTC to my coins" → {"isCommand": true, "commands": [{"action": "add", "field": "selectedCoins", "value": "BTC", "rawValue": "BTC"}]}

If it's just a question, return: {"isCommand": false}`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-2025-04-14',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 500
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

  private static fallbackParse(message: string): { isCommand: boolean; commands?: any[]; error?: string } {
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
    
    // Basic command detection
    const commandKeywords = ['set', 'enable', 'disable', 'add', 'remove', 'turn on', 'turn off'];
    const hasCommand = commandKeywords.some(keyword => lowerMessage.includes(keyword));
    
    if (hasCommand) {
      return { 
        isCommand: true, 
        commands: [],
        error: 'OpenAI parsing failed, please try a simpler command format'
      };
    }
    
    return { isCommand: false };
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
    commands: Array<any>, 
    currentStrategy: any
  ): Promise<{ success: boolean; results: Array<any>; errors: string[] }> {
    
    console.log(`🔧 CONFIG_MANAGER: Processing ${commands.length} commands for strategy ${strategyId}`);
    
    const results: Array<any> = [];
    const errors: string[] = [];
    
    // Start with current configuration to preserve existing values
    const strategyUpdates: any = {
      configuration: { ...currentStrategy.configuration }
    };
    
    // Ensure nested objects exist
    if (!strategyUpdates.configuration.aiIntelligenceConfig) {
      strategyUpdates.configuration.aiIntelligenceConfig = { ...currentStrategy.configuration?.aiIntelligenceConfig };
    }
    
    for (const command of commands) {
      console.log(`🔍 PROCESSING_COMMAND: ${JSON.stringify(command)}`);
      
      const { action, field, value, rawValue } = command;
      const fieldDef = FIELD_DEFINITIONS[field];
      
      if (!fieldDef) {
        const error = `Unknown field: ${field}`;
        console.log(`❌ ${error}`);
        errors.push(error);
        continue;
      }

      // Check if AI can execute this field
      if (!fieldDef.aiCanExecute) {
        const error = `AI cannot execute field: ${field} (safety restriction)`;
        console.log(`🚫 ${error}`);
        errors.push(error);
        continue;
      }
      
      // Get current value for logging and verification
      const currentValue = this.getCurrentValue(currentStrategy, fieldDef.dbPath);
      console.log(`📊 BEFORE_UPDATE: ${field} = ${JSON.stringify(currentValue)} (at ${fieldDef.dbPath})`);
      
      let finalValue: any;
      
      // Handle array operations (add/remove)
      if (fieldDef.type === 'array') {
        const currentArray = Array.isArray(currentValue) ? currentValue : 
                           (typeof currentValue === 'string' ? currentValue.split(',').map(s => s.trim()).filter(s => s) : []);
        
        if (action === 'add') {
          if (!currentArray.includes(value)) {
            finalValue = [...currentArray, value];
          } else {
            finalValue = currentArray; // No change needed
          }
        } else if (action === 'remove') {
          finalValue = currentArray.filter(item => item !== value);
        } else {
          // set/enable/disable - replace entire array
          const validation = TypeValidator.validateAndConvert(value, fieldDef);
          if (!validation.valid) {
            errors.push(`${field}: ${validation.error}`);
            continue;
          }
          finalValue = validation.convertedValue;
        }
      } else {
        // Handle boolean actions
        if (action === 'enable' && fieldDef.type === 'boolean') {
          finalValue = true;
        } else if (action === 'disable' && fieldDef.type === 'boolean') {
          finalValue = false;
        } else {
          // Validate and convert the value
          const validation = TypeValidator.validateAndConvert(value, fieldDef);
          if (!validation.valid) {
            errors.push(`${field}: ${validation.error}`);
            continue;
          }
          finalValue = validation.convertedValue;
        }
      }
      
      // Apply the update using the correct path
      const dbPath = fieldDef.dbPath;
      console.log(`🎯 APPLYING_UPDATE: ${field} → ${dbPath} = ${JSON.stringify(finalValue)}`);
      
      // Special handling for nested AI intelligence config to preserve other fields
      if (dbPath.includes('aiIntelligenceConfig')) {
        const pathParts = dbPath.split('.');
        const finalProperty = pathParts[pathParts.length - 1];
        strategyUpdates.configuration.aiIntelligenceConfig[finalProperty] = finalValue;
      } else {
        this.setNestedValue(strategyUpdates, dbPath, finalValue);
      }
      
      // Store result for verification
      results.push({
        field,
        action,
        dbPath,
        oldValue: currentValue,
        newValue: finalValue,
        rawValue,
        expected: finalValue
      });
    }
    
    console.log(`📤 FINAL_STRATEGY_UPDATES: ${JSON.stringify(strategyUpdates, null, 2)}`);
    
    if (results.length === 0) {
      console.log('ℹ️ NO_VALID_UPDATES to apply');
      return { success: true, results: [], errors };
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
      return { success: false, results: [], errors };
    }

    if (!updatedStrategy) {
      console.error('❌ NO_STRATEGY_RETURNED after update');
      errors.push('No strategy returned after update');
      return { success: false, results: [], errors };
    }

    console.log(`✅ STRATEGY_UPDATED_SUCCESSFULLY`);
    
    // POST-UPDATE VERIFICATION
    console.log(`🔍 POST_UPDATE_VERIFICATION starting...`);
    
    for (const result of results) {
      const actualValue = this.getCurrentValue(updatedStrategy, result.dbPath);
      console.log(`🔍 VERIFICATION: ${result.field}: expected=${JSON.stringify(result.expected)}, actual=${JSON.stringify(actualValue)}`);
      
      result.actualValue = actualValue;
      result.verified = JSON.stringify(actualValue) === JSON.stringify(result.expected);
      
      if (!result.verified) {
        const error = `Verification failed for ${result.field}: expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(actualValue)}`;
        console.log(`❌ ${error}`);
        errors.push(error);
      } else {
        console.log(`✅ VERIFICATION_SUCCESS: ${result.field}`);
      }
    }

    return { 
      success: errors.length === 0, 
      results, 
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
      console.log(`✅ STRATEGY_RESOLVER: Found active strategy: ${strategy.strategy_name}`);
    }

    return strategy;
  }
}

// =============================================
// RESPONSE FORMATTER
// =============================================
class ResponseFormatter {
  static formatSuccessResponse(
    results: Array<any>
  ): string {
    if (results.length === 0) {
      return '✅ Configuration updated successfully.';
    }
    
    let response = '';
    
    const verifiedResults = results.filter(r => r.verified);
    const failedResults = results.filter(r => !r.verified);
    
    if (verifiedResults.length > 0) {
      response += '✅ **Configuration Updated Successfully:**\n\n';
      for (const result of verifiedResults) {
        const fieldName = FIELD_DEFINITIONS[result.field]?.description || result.field;
        const newDisplay = Array.isArray(result.newValue) ? result.newValue.join(', ') : result.newValue;
        
        // Format specific responses based on field type
        if (result.action === 'add' && Array.isArray(result.newValue)) {
          const addedCoins = Array.isArray(result.oldValue) ? 
            result.newValue.filter(coin => !result.oldValue.includes(coin)) : result.newValue;
          response += `• Added ${addedCoins.join(', ')} to ${fieldName}\n`;
        } else if (result.action === 'remove' && Array.isArray(result.newValue)) {
          response += `• Removed ${result.rawValue} from ${fieldName}\n`;
        } else if (result.action === 'enable') {
          response += `• Enabled ${fieldName}\n`;
        } else if (result.action === 'disable') {
          response += `• Disabled ${fieldName}\n`;
        } else {
          response += `• ${fieldName} set to ${newDisplay}\n`;
        }
      }
    }
    
    if (failedResults.length > 0) {
      response += '\n❌ **Failed Updates:**\n';
      for (const result of failedResults) {
        const fieldName = FIELD_DEFINITIONS[result.field]?.description || result.field;
        response += `• ${fieldName}: Expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actualValue)}\n`;
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
    return `I can help you configure your trading strategy. Here are some examples:

**Basic Commands:**
• "Enable AI" / "Disable AI"
• "Set stop loss to 5%"
• "Set take profit to 10%"
• "Add BTC to my coins"

**Risk Management:**
• "Set daily profit target to 3%"
• "Set max wallet exposure to 50%"
• "Set max trades per day to 10"

**AI Settings:**
• "Set AI autonomy level to 80%"
• "Set confidence threshold to 75%"
• "Enable pattern recognition"

**Multiple Commands:**
• "Set stop loss to 3%, enable DCA with 4 steps, and add ADA to my coins"

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
    
    // Parse intent using advanced processor
    const parsedIntent = await IntentProcessor.parseIntent(message);
    console.log(`🧠 INTENT_RESULT: ${JSON.stringify(parsedIntent, null, 2)}`);
    
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
          const displayValue = currentValue === null || currentValue === undefined ? 'not set' : 
                             Array.isArray(currentValue) ? currentValue.join(', ') : currentValue;
          configResponse += `• ${fieldDef.description}: ${displayValue}\n`;
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
    
    // Process commands
    if (!parsedIntent.commands || parsedIntent.commands.length === 0) {
      if (parsedIntent.error) {
        return new Response(
          JSON.stringify({ 
            response: `❌ ${parsedIntent.error}`,
            success: false 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          response: '❌ Could not understand the command. Please try again with a clearer instruction.',
          success: false 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Execute the configuration updates
    const updateResult = await ConfigManager.updateStrategyConfig(
      userId, 
      strategy.id, 
      parsedIntent.commands, 
      strategy
    );
    
    if (updateResult.success) {
      const response = ResponseFormatter.formatSuccessResponse(updateResult.results);
      
      return new Response(
        JSON.stringify({ 
          response,
          success: true,
          commands: parsedIntent.commands.length,
          results: updateResult.results
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      const response = ResponseFormatter.formatErrorResponse(
        'Configuration update failed',
        updateResult.errors
      );
      
      return new Response(
        JSON.stringify({ 
          response,
          success: false,
          errors: updateResult.errors
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
  } catch (error) {
    console.error('❌ AI_ASSISTANT_ERROR:', error);
    return new Response(
      JSON.stringify({ 
        response: `❌ System error: ${error.message}`,
        success: false 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});