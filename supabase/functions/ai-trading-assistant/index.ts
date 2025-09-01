import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================
// DYNAMIC COIN LIST FROM COINBASE DATA
// =============================================
const COINBASE_COINS = [
  { symbol: 'BTC', name: 'Bitcoin', category: 'major', tradingPair: 'BTC-EUR' },
  { symbol: 'ETH', name: 'Ethereum', category: 'major', tradingPair: 'ETH-EUR' },
  { symbol: 'XRP', name: 'XRP', category: 'altcoin', tradingPair: 'XRP-EUR' },
  { symbol: 'ADA', name: 'Cardano', category: 'altcoin', tradingPair: 'ADA-EUR' },
  { symbol: 'SOL', name: 'Solana', category: 'altcoin', tradingPair: 'SOL-EUR' },
  { symbol: 'DOT', name: 'Polkadot', category: 'altcoin', tradingPair: 'DOT-EUR' },
  { symbol: 'MATIC', name: 'Polygon', category: 'altcoin', tradingPair: 'MATIC-EUR' },
  { symbol: 'AVAX', name: 'Avalanche', category: 'altcoin', tradingPair: 'AVAX-EUR' },
  { symbol: 'LINK', name: 'Chainlink', category: 'altcoin', tradingPair: 'LINK-EUR' },
  { symbol: 'UNI', name: 'Uniswap', category: 'defi', tradingPair: 'UNI-EUR' },
  { symbol: 'AAVE', name: 'Aave', category: 'defi', tradingPair: 'AAVE-EUR' },
  { symbol: 'CRV', name: 'Curve DAO', category: 'defi', tradingPair: 'CRV-EUR' },
  { symbol: 'COMP', name: 'Compound', category: 'defi', tradingPair: 'COMP-EUR' },
  { symbol: 'SUSHI', name: 'SushiSwap', category: 'defi', tradingPair: 'SUSHI-EUR' },
  { symbol: 'USDC', name: 'USD Coin', category: 'stablecoin', tradingPair: 'USDC-EUR' },
  { symbol: 'USDT', name: 'Tether', category: 'stablecoin', tradingPair: 'USDT-EUR' },
  { symbol: 'DAI', name: 'Dai', category: 'stablecoin', tradingPair: 'DAI-EUR' },
  { symbol: 'LTC', name: 'Litecoin', category: 'altcoin', tradingPair: 'LTC-EUR' },
  { symbol: 'BCH', name: 'Bitcoin Cash', category: 'altcoin', tradingPair: 'BCH-EUR' },
  { symbol: 'XLM', name: 'Stellar', category: 'altcoin', tradingPair: 'XLM-EUR' },
  { symbol: 'ALGO', name: 'Algorand', category: 'altcoin', tradingPair: 'ALGO-EUR' },
  { symbol: 'ATOM', name: 'Cosmos', category: 'altcoin', tradingPair: 'ATOM-EUR' },
  { symbol: 'ICP', name: 'Internet Computer', category: 'altcoin', tradingPair: 'ICP-EUR' },
  { symbol: 'FIL', name: 'Filecoin', category: 'altcoin', tradingPair: 'FIL-EUR' },
];

const VALID_COIN_SYMBOLS = COINBASE_COINS.map(coin => coin.symbol);

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
    validValues: [], // Will be populated dynamically from COINBASE_COINS
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
    phrases: ['sell order type', 'sell order', 'market sell', 'limit sell', 'trailing stop', 'trailing stop order', 'set sell to trailing stop', 'auto close', 'automatic close'],
    description: 'Type of sell order (market, limit, trailing stop, auto close)'
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
  maxTotalTrades: {
    key: 'maxTotalTrades',
    type: 'number',
    range: [10, 1000],
    dbPath: 'configuration.maxTotalTrades',
    aiCanExecute: true,
    phrases: ['max total trades', 'maximum total trades', 'total trade limit', 'trade count limit'],
    description: 'Maximum total number of individual trade records allowed'
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
  trailingStopLossPercentage: {
    key: 'trailingStopLossPercentage',
    type: 'number',
    range: [0.1, 50],
    dbPath: 'configuration.trailingStopLossPercentage',
    aiCanExecute: true,
    phrases: ['trailing stop loss', 'trailing stop percentage', 'set trailing stop'],
    description: 'Trailing stop loss percentage'
  },
  autoCloseAfterHours: {
    key: 'autoCloseAfterHours',
    type: 'number',
    range: [1, 168],
    dbPath: 'configuration.autoCloseAfterHours',
    aiCanExecute: true,
    phrases: ['auto close after', 'close after hours', 'automatic close time'],
    description: 'Auto close trades after X hours'
  },

  // === RISK MANAGEMENT ===
  maxWalletExposure: {
    key: 'maxWalletExposure',
    type: 'number',
    range: [1, 100],
    dbPath: 'configuration.maxWalletExposure',
    aiCanExecute: true,
    phrases: ['max wallet exposure', 'wallet exposure', 'maximum exposure'],
    description: 'Maximum wallet exposure percentage'
  },
  dailyProfitTarget: {
    key: 'dailyProfitTarget',
    type: 'number',
    range: [0.1, 100],
    dbPath: 'configuration.dailyProfitTarget',
    aiCanExecute: true,
    phrases: ['daily profit target', 'profit target', 'daily target'],
    description: 'Daily profit target percentage'
  },
  dailyLossLimit: {
    key: 'dailyLossLimit',
    type: 'number',
    range: [0.1, 100],
    dbPath: 'configuration.dailyLossLimit',
    aiCanExecute: true,
    phrases: ['daily loss limit', 'loss limit', 'daily maximum loss'],
    description: 'Daily loss limit percentage'
  },
  maxTradesPerDay: {
    key: 'maxTradesPerDay',
    type: 'number',
    range: [1, 1000],
    dbPath: 'configuration.maxTradesPerDay',
    aiCanExecute: true,
    phrases: ['max trades per day', 'maximum daily trades', 'trade limit'],
    description: 'Maximum number of trades per day'
  },
  tradeCooldownMinutes: {
    key: 'tradeCooldownMinutes',
    type: 'number',
    range: [0, 1440],
    dbPath: 'configuration.tradeCooldownMinutes',
    aiCanExecute: true,
    phrases: ['trade cooldown', 'cooldown between trades', 'trade interval'],
    description: 'Cooldown between trades in minutes'
  },

  // === NOTIFICATIONS ===
  notifyOnTrade: {
    key: 'notifyOnTrade',
    type: 'boolean',
    dbPath: 'configuration.notifyOnTrade',
    aiCanExecute: true,
    phrases: ['notify on trade', 'trade notifications', 'notify trades'],
    description: 'Send notifications for trades'
  },
  notifyOnError: {
    key: 'notifyOnError',
    type: 'boolean',
    dbPath: 'configuration.notifyOnError',
    aiCanExecute: true,
    phrases: ['notify on error', 'error notifications', 'notify errors'],
    description: 'Send notifications for errors'
  },
  notifyOnTargets: {
    key: 'notifyOnTargets',
    type: 'boolean',
    dbPath: 'configuration.notifyOnTargets',
    aiCanExecute: true,
    phrases: ['notify on targets', 'target notifications', 'notify when targets hit'],
    description: 'Send notifications when targets are hit'
  },

  // === SHORTING ===
  enableShorting: {
    key: 'enableShorting',
    type: 'boolean',
    dbPath: 'configuration.enableShorting',
    aiCanExecute: true,
    phrases: ['enable shorting', 'allow shorting', 'short selling'],
    description: 'Enable short selling'
  },
  maxShortPositions: {
    key: 'maxShortPositions',
    type: 'number',
    range: [1, 20],
    dbPath: 'configuration.maxShortPositions',
    aiCanExecute: true,
    phrases: ['max short positions', 'maximum shorts', 'short limit'],
    description: 'Maximum number of short positions'
  },
  shortingMinProfitPercentage: {
    key: 'shortingMinProfitPercentage',
    type: 'number',
    range: [0.1, 50],
    dbPath: 'configuration.shortingMinProfitPercentage',
    aiCanExecute: true,
    phrases: ['shorting minimum profit', 'min profit for shorts', 'short profit threshold'],
    description: 'Minimum profit percentage for shorting'
  },
  autoCloseShorts: {
    key: 'autoCloseShorts',
    type: 'boolean',
    dbPath: 'configuration.autoCloseShorts',
    aiCanExecute: true,
    phrases: ['auto close shorts', 'automatic short closing', 'close shorts automatically'],
    description: 'Automatically close short positions'
  },

  // === DOLLAR COST AVERAGING ===
  enableDCA: {
    key: 'enableDCA',
    type: 'boolean',
    dbPath: 'configuration.enableDCA',
    aiCanExecute: true,
    phrases: ['enable dca', 'dollar cost averaging', 'dca enabled'],
    description: 'Enable Dollar Cost Averaging'
  },
  dcaSteps: {
    key: 'dcaSteps',
    type: 'number',
    range: [2, 20],
    dbPath: 'configuration.dcaSteps',
    aiCanExecute: true,
    phrases: ['dca steps', 'number of dca steps', 'averaging steps'],
    description: 'Number of DCA steps'
  },
  dcaIntervalHours: {
    key: 'dcaIntervalHours',
    type: 'number',
    range: [1, 720],
    dbPath: 'configuration.dcaIntervalHours',
    aiCanExecute: true,
    phrases: ['dca interval', 'dca hours', 'averaging interval'],
    description: 'DCA interval in hours'
  },

  // === BASIC STRATEGY ===
  maxActiveCoins: {
    key: 'maxActiveCoins',
    type: 'number',
    range: [1, 50],
    dbPath: 'configuration.maxActiveCoins',
    aiCanExecute: true,
    phrases: ['max active coins', 'maximum coins', 'coin limit'],
    description: 'Maximum number of active coins'
  },
  enableAutoCoinSelection: {
    key: 'enableAutoCoinSelection',
    type: 'boolean',
    dbPath: 'configuration.enableAutoCoinSelection',
    aiCanExecute: true,
    phrases: ['enable auto coin selection', 'automatic coin selection', 'auto select coins'],
    description: 'Enable automatic coin selection'
  },
  backtestingMode: {
    key: 'backtestingMode',
    type: 'boolean',
    dbPath: 'configuration.backtestingMode',
    aiCanExecute: true,
    phrases: ['enable backtesting', 'backtesting mode', 'test historical'],
    description: 'Enable backtesting mode'
  },
  category: {
    key: 'category',
    type: 'string',
    validValues: ['trend', 'momentum', 'scalping', 'swing', 'hodl'],
    dbPath: 'configuration.category',
    aiCanExecute: true,
    phrases: ['strategy category', 'set category', 'trading style'],
    description: 'Strategy category'
  },
  tags: {
    key: 'tags',
    type: 'array',
    validValues: ['automated', 'manual', 'scalping', 'swing', 'hodl', 'high-risk', 'conservative'],
    dbPath: 'configuration.tags',
    aiCanExecute: true,
    phrases: ['add tag', 'strategy tags', 'set tags'],
    description: 'Strategy tags'
  },

  // === COINS & AMOUNTS ===
  selectedCoins: {
    key: 'selectedCoins',
    type: 'array',
    validValues: [], // Populated dynamically from COINBASE_COINS
    dbPath: 'configuration.selectedCoins',
    aiCanExecute: true,
    phrases: ['add coin', 'select coin', 'choose coins', 'trade', 'include', 'bitcoin', 'ethereum', 'btc', 'eth', 'xrp', 'ada', 'doge'],
    description: 'Selected cryptocurrencies to trade'
  },
  perTradeAllocation: {
    key: 'perTradeAllocation',
    type: 'number',
    range: [1, 100000],
    dbPath: 'configuration.perTradeAllocation',
    aiCanExecute: true,
    phrases: ['per trade allocation', 'trade amount', 'allocation per trade'],
    description: 'Amount allocated per trade'
  },

  // === ADVANCED ===
  resetStopLossAfterFail: {
    key: 'resetStopLossAfterFail',
    type: 'boolean',
    dbPath: 'configuration.resetStopLossAfterFail',
    aiCanExecute: true,
    phrases: ['reset stop loss after fail', 'reset stop loss', 'restart stop loss'],
    description: 'Reset stop loss after failure'
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
  enableAI: {
    key: 'enableAI',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.enableAIOverride',
    aiCanExecute: true,
    phrases: ['enable AI', 'turn on AI', 'activate AI', 'AI on', 'enable intelligence', 'activate intelligence'],
    description: 'Enable AI to override trading decisions'
  },
  enableAIOverride: {
    key: 'enableAIOverride',
    type: 'boolean',
    dbPath: 'configuration.aiIntelligenceConfig.enableAIOverride',
    aiCanExecute: true,
    phrases: ['enable AI override', 'turn on AI override', 'activate AI override', 'AI override on', 'disable AI override', 'turn off AI override', 'deactivate AI override', 'AI override off'],
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
  static normalizeValue(value: any, fieldDef: any): any {
    if (!value && value !== 0 && value !== false) return value;
    
    // String normalization
    if (typeof value === 'string') {
      value = value.trim();
      
      // Handle percentage notation for numeric fields
      if (fieldDef.type === 'number' && value.includes('%')) {
        value = value.replace(/%/g, '');
      }
      
      // Special normalization based on field type and key
      if (fieldDef.type === 'string') {
        // General enum normalization
        if (fieldDef.key === 'sellOrderType') {
          const normalized = value.toLowerCase();
          if (normalized.includes('auto') && normalized.includes('close')) {
            return 'auto_close';
          } else if (normalized.includes('trailing') && normalized.includes('stop')) {
            return 'trailing_stop';
          } else if (normalized.includes('market')) {
            return 'market';
          } else if (normalized.includes('limit')) {
            return 'limit';
          }
        }
        
        if (fieldDef.key === 'buyOrderType') {
          const normalized = value.toLowerCase();
          if (normalized.includes('trailing') && normalized.includes('buy')) {
            return 'trailing_buy';
          } else if (normalized.includes('market')) {
            return 'market';
          } else if (normalized.includes('limit')) {
            return 'limit';
          }
        }
        
        // For other string enums, check case-insensitive against valid values
        if (fieldDef.validValues) {
          const exactMatch = fieldDef.validValues.find(valid => 
            valid.toLowerCase() === value.toLowerCase()
          );
          if (exactMatch) return exactMatch;
        }
        
        return value.toLowerCase();
      }
      
      // For arrays (like selectedCoins), normalize individual values
      if (fieldDef.type === 'array' && fieldDef.validValues) {
        const upperValue = value.toUpperCase();
        const validMatch = fieldDef.validValues.find(valid => 
          valid.toUpperCase() === upperValue
        );
        return validMatch || value;
      }
    }
    
    return value;
  }

  static validateAndConvert(value: any, fieldDef: any, action: string = 'set'): { 
    valid: boolean; 
    convertedValue?: any; 
    error?: string;
    validationReport: any;
  } {
    const { type, range, validValues, key } = fieldDef;
    
    // Create validation report for debugging
    const validationReport = {
      field: key,
      action,
      input: value,
      normalized: null,
      valid: false,
      reason: null,
      type,
      range: range || null,
      validValues: validValues || null
    };
    
    try {
      // Step 1: Normalize the input
      const normalizedValue = this.normalizeValue(value, fieldDef);
      validationReport.normalized = normalizedValue;
      
      // Step 2: Type-specific validation
      if (type === 'boolean') {
        if (typeof normalizedValue === 'boolean') {
          validationReport.valid = true;
          return { valid: true, convertedValue: normalizedValue, validationReport };
        }
        if (typeof normalizedValue === 'string') {
          const lowerValue = normalizedValue.toLowerCase();
          if (['true', 'yes', 'on', '1', 'enable', 'enabled'].includes(lowerValue)) {
            validationReport.valid = true;
            return { valid: true, convertedValue: true, validationReport };
          }
          if (['false', 'no', 'off', '0', 'disable', 'disabled'].includes(lowerValue)) {
            validationReport.valid = true;
            return { valid: true, convertedValue: false, validationReport };
          }
        }
        validationReport.reason = `Invalid boolean value: ${normalizedValue}`;
        return { valid: false, error: validationReport.reason, validationReport };
      }
      
      if (type === 'number') {
        let numValue: number;
        if (typeof normalizedValue === 'number') {
          numValue = normalizedValue;
        } else if (typeof normalizedValue === 'string') {
          numValue = parseFloat(normalizedValue);
        } else {
          validationReport.reason = `Invalid number value: ${normalizedValue}`;
          return { valid: false, error: validationReport.reason, validationReport };
        }
        
        if (isNaN(numValue)) {
          validationReport.reason = `Cannot convert to number: ${normalizedValue}`;
          return { valid: false, error: validationReport.reason, validationReport };
        }
        
        // Range validation for ALL actions
        if (range && (numValue < range[0] || numValue > range[1])) {
          validationReport.reason = `${numValue} outside valid range [${range[0]}, ${range[1]}]`;
          return { valid: false, error: validationReport.reason, validationReport };
        }
        
        validationReport.valid = true;
        return { valid: true, convertedValue: numValue, validationReport };
      }
      
      if (type === 'string') {
        const stringValue = String(normalizedValue);
        
        // Enum validation for ALL actions
        if (validValues && !validValues.includes(stringValue)) {
          validationReport.reason = `Invalid value "${stringValue}". Valid options: ${validValues.join(', ')}`;
          return { valid: false, error: validationReport.reason, validationReport };
        }
        
        validationReport.valid = true;
        return { valid: true, convertedValue: stringValue, validationReport };
      }
      
      if (type === 'array') {
        // For add/remove operations, validate the individual value
        if (action === 'add' || action === 'remove') {
          // Validate single value against validValues
          if (validValues && !validValues.includes(normalizedValue)) {
            validationReport.reason = `Invalid array item "${normalizedValue}". Valid options: ${validValues.join(', ')}`;
            return { valid: false, error: validationReport.reason, validationReport };
          }
          
          validationReport.valid = true;
          return { valid: true, convertedValue: normalizedValue, validationReport };
        } else {
          // For set operations, validate the entire array
          if (Array.isArray(normalizedValue)) {
            // Validate each item in the array
            if (validValues) {
              for (const item of normalizedValue) {
                if (!validValues.includes(item)) {
                  validationReport.reason = `Invalid array item "${item}". Valid options: ${validValues.join(', ')}`;
                  return { valid: false, error: validationReport.reason, validationReport };
                }
              }
            }
            
            validationReport.valid = true;
            return { valid: true, convertedValue: normalizedValue, validationReport };
          }
          if (typeof normalizedValue === 'string') {
            // Convert string to array (handle comma-separated values)
            const arrayValue = normalizedValue.split(',').map(item => item.trim()).filter(item => item.length > 0);
            
            // Validate each item
            if (validValues) {
              for (const item of arrayValue) {
                const normalizedItem = this.normalizeValue(item, fieldDef);
                if (!validValues.includes(normalizedItem)) {
                  validationReport.reason = `Invalid array item "${normalizedItem}". Valid options: ${validValues.join(', ')}`;
                  return { valid: false, error: validationReport.reason, validationReport };
                }
              }
            }
            
            validationReport.valid = true;
            return { valid: true, convertedValue: arrayValue, validationReport };
          }
          
          validationReport.reason = `Invalid array value: ${normalizedValue}`;
          return { valid: false, error: validationReport.reason, validationReport };
        }
      }
      
      validationReport.reason = `Unknown type: ${type}`;
      return { valid: false, error: validationReport.reason, validationReport };
      
    } catch (error) {
      validationReport.reason = `Validation error: ${error.message}`;
      return { valid: false, error: validationReport.reason, validationReport };
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
      return this.fallbackParse(message);
    }

    const fieldsList = Object.values(FIELD_DEFINITIONS)
      .filter((f: any) => f.aiCanExecute)
      .map((f: any) => `${f.key}: ${f.description} (${f.phrases.slice(0, 3).join(', ')})`)
      .join('\n');

    const prompt = `Parse this user message for trading strategy BULK MODIFICATION commands.

CRITICAL FOR PHASE 3 - BULK MODIFICATIONS:
You MUST extract ALL field operations from complex commands. Break multi-field commands into atomic operations.

Available fields that AI can modify:
${fieldsList}

User message: "${message}"

BULK COMMAND PARSING RULES:
1. Extract EVERY field operation - don't miss any
2. For multi-coin additions like "add BTC and ETH" → create SEPARATE commands for each coin
3. For complex commands like "Enable DCA with 6 steps, add ETH and BTC, stop loss to 5%" → extract ALL operations
4. Parse ALL parts of the command independently

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

BULK PARSING EXAMPLES:
- "Enable DCA with 6 steps" → {"isCommand": true, "commands": [{"action": "enable", "field": "enableDCA", "value": "true", "rawValue": "enable"}, {"action": "set", "field": "dcaSteps", "value": "6", "rawValue": "6 steps"}]}
- "Add BTC and ETH" → {"isCommand": true, "commands": [{"action": "add", "field": "selectedCoins", "value": "BTC", "rawValue": "BTC"}, {"action": "add", "field": "selectedCoins", "value": "ETH", "rawValue": "ETH"}]}
- "Set stop loss to 5% and max trades to 10" → {"isCommand": true, "commands": [{"action": "set", "field": "stopLossPercentage", "value": "5", "rawValue": "5%"}, {"action": "set", "field": "maxTradesPerDay", "value": "10", "rawValue": "10"}]}
- "Enable DCA with 6 steps, set interval to 12h, add ETH and BTC, stop loss to 5%" → Extract 5+ commands

If it's just a question, return: {"isCommand": false}`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a precise command parser that excels at BULK MODIFICATIONS. Extract ALL field operations from complex commands. Create separate commands for each coin in multi-coin additions. Always return valid JSON.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      });

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);
      
      
      return result;
      
    } catch (error) {
      
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
      
      // Handle array operations (add/remove) with FULL VALIDATION
      if (fieldDef.type === 'array') {
        // Get current array state from strategy updates if already modified, otherwise from original strategy
        let baseArray;
        try {
          baseArray = this.getCurrentValue(strategyUpdates, fieldDef.dbPath);
        } catch {
          baseArray = this.getCurrentValue(currentStrategy, fieldDef.dbPath);
        }
        const currentArray = Array.isArray(baseArray) ? baseArray : 
                           (typeof baseArray === 'string' ? baseArray.split(',').map(s => s.trim()).filter(s => s) : []);
        
        if (action === 'add') {
          // ✅ CRITICAL: Validate the value before adding
          const validation = TypeValidator.validateAndConvert(value, fieldDef, action);
          console.log(`🔍 VALIDATION_REPORT (${action}): ${JSON.stringify(validation.validationReport)}`);
          
          if (!validation.valid) {
            errors.push(`${field}: ${validation.error}`);
            continue;
          }
          
          const normalizedValue = validation.convertedValue;
          if (!currentArray.includes(normalizedValue)) {
            finalValue = [...currentArray, normalizedValue];
          } else {
            finalValue = currentArray; // No change needed - already exists
          }
        } else if (action === 'remove') {
          // ✅ CRITICAL: Validate the value before removing
          const validation = TypeValidator.validateAndConvert(value, fieldDef, action);
          console.log(`🔍 VALIDATION_REPORT (${action}): ${JSON.stringify(validation.validationReport)}`);
          
          if (!validation.valid) {
            errors.push(`${field}: ${validation.error}`);
            continue;
          }
          
          const normalizedValue = validation.convertedValue;
          finalValue = currentArray.filter(item => item !== normalizedValue);
        } else {
          // set/enable/disable - replace entire array
          const validation = TypeValidator.validateAndConvert(value, fieldDef, action);
          console.log(`🔍 VALIDATION_REPORT (${action}): ${JSON.stringify(validation.validationReport)}`);
          
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
          // ✅ CRITICAL: Validate and convert ALL other values
          const validation = TypeValidator.validateAndConvert(value, fieldDef, action);
          console.log(`🔍 VALIDATION_REPORT (${action}): ${JSON.stringify(validation.validationReport)}`);
          
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
    
    // Process successful and failed commands separately
    const initialSuccessfulResults = results.filter(result => 
      !errors.some(error => error.includes(result.field))
    );
    const failedCommands = commands.filter(cmd => 
      errors.some(error => error.includes(cmd.field))
    );
    
    console.log(`❌ VALIDATION_ERRORS: ${errors.join(' | ')}`);
    console.log(`❌ FAILED_COMMANDS: ${JSON.stringify(failedCommands)}`);
    console.log(`✅ SUCCESSFUL_COMMANDS: ${initialSuccessfulResults.length}/${commands.length}`);
    
    // If no successful commands, return early
    if (initialSuccessfulResults.length === 0) {
      return {
        success: false,
        message: `❌ All commands failed validation: ${errors.join(' | ')}`,
        results: [],
        errors: errors,
        details: {
          totalCommands: commands.length,
          failedCommands: failedCommands.length,
          validationFailures: errors
        }
      };
    }
    
    // Fix expected values to reflect final cumulative state for verification
    // This prevents false negatives when multiple commands affect the same field
    initialSuccessfulResults.forEach(result => {
      const fieldDef = FIELD_DEFINITIONS[result.field];
      if (fieldDef) {
        result.expected = this.getCurrentValue(strategyUpdates, fieldDef.dbPath);
      }
    });
    
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

    // Return both successful and failed results for atomic processing
    const allResults = results.map(result => ({
      ...result,
      success: !errors.some(error => error.includes(result.field))
    }));
    
    const successfulResults = allResults.filter(r => r.success);
    const failedResults = allResults.filter(r => !r.success);
    
    // Add error details to failed results
    failedResults.forEach(result => {
      const matchingError = errors.find(error => error.includes(result.field));
      if (matchingError) {
        result.error = matchingError.replace(`${result.field}: `, '');
      }
    });

    return { 
      success: successfulResults.length > 0,
      results: allResults,
      errors,
      successfulCount: successfulResults.length,
      failedCount: failedResults.length,
      totalCount: commands.length
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
    results: Array<any>,
    successfulCount?: number,
    failedCount?: number,
    totalCount?: number
  ): string {
    if (results.length === 0) {
      return '✅ Configuration updated successfully.';
    }
    
    let response = '';
    
    const verifiedResults = results.filter(r => r.verified);
    const failedResults = results.filter(r => !r.verified || r.error);
    
    // Use provided counts or calculate from results
    const successCount = successfulCount || verifiedResults.length;
    const failureCount = failedCount || failedResults.length;
    const totalOperations = totalCount || (successCount + failureCount);
    
    // Bulk summary header for multiple operations
    if (totalOperations > 1) {
      response += `📊 **Bulk Update Summary: ${successCount}/${totalOperations} successful**\n\n`;
    }
    
    if (verifiedResults.length > 0) {
      if (totalOperations === 1) {
        response += '✅ **Updated Successfully:**\n\n';
      } else {
        response += '✅ **Successful Operations:**\n\n';
      }
      
      for (const result of verifiedResults) {
        const fieldName = FIELD_DEFINITIONS[result.field]?.description || result.field;
        const newDisplay = Array.isArray(result.newValue) ? result.newValue.join(', ') : result.newValue;
        
        // Format specific responses based on action type
        if (result.action === 'add' && Array.isArray(result.newValue)) {
          const addedItems = Array.isArray(result.oldValue) ? 
            result.newValue.filter(item => !result.oldValue.includes(item)) : [result.rawValue];
          response += `• Added ${addedItems.join(', ')}\n`;
        } else if (result.action === 'remove') {
          response += `• Removed ${result.rawValue} from ${fieldName}\n`;
        } else if (result.action === 'enable') {
          response += `• Enabled ${fieldName}\n`;
        } else if (result.action === 'disable') {
          response += `• Disabled ${fieldName}\n`;
        } else {
          response += `• ${fieldName} set to ${newDisplay}\n`;
        }
      }
      
      // Show final state for selectedCoins
      const coinsResult = verifiedResults.find(r => r.field === 'selectedCoins');
      if (coinsResult && Array.isArray(coinsResult.newValue)) {
        response += `\n💡 **Selected Coins:** ${coinsResult.newValue.join(', ')}\n`;
      }
    }
    
    if (failedResults.length > 0) {
      response += '\n❌ **Failed Operations:**\n\n';
      for (const result of failedResults) {
        const fieldName = FIELD_DEFINITIONS[result.field]?.description || result.field;
        if (result.action === 'add' && result.field === 'selectedCoins') {
          response += `• Failed to add ${result.rawValue}: Not in allowed coin list\n`;
        } else {
          response += `• ${fieldName}: ${result.error || 'Update failed'}\n`;
        }
      }
      
      // Add helpful note for bulk failures
      if (failedResults.length > 1) {
        response += '\n💡 *Tip: Each operation is validated independently - successful ones are still applied.*\n';
      }
    }
    
    return response.trim();
  }

  static formatErrorResponse(message: string, errors?: string[]): string {
    let response = `❌ ${message}`;
    if (errors && errors.length > 0) {
      response += '\n\nErrors:\n' + errors.map(e => `• ${e}`).join('\n');
    }
    return response;
  }

  static formatQuestionResponse(): string {
    return `I can help you configure your trading strategy. Here are examples of what I can do:

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

**🆕 BULK MODIFICATIONS (Phase 3):**
• "Enable DCA with 6 steps, set interval to 12h, add ETH and BTC, stop loss to 5%, max trades per day to 10, and notify on errors only"
• "Add XRP, ADA, and DOGE to my coins and set take profit to 8%"
• "Set stop loss to 3%, enable DCA with 4 steps, add ADA to my coins"

**💡 I can handle complex multi-field commands in a single request!**

What would you like me to configure?`;
  }

  static async formatCryptoExpertResponse(
    message: string,
    marketData: any,
    indicatorContext: any,
    recentTrades: any[],
    strategy: any
  ): Promise<string> {
    
    console.log('🔮 CRYPTO_EXPERT: Analyzing market query:', message);
    
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      console.log('❌ OPENAI_API_KEY not found, falling back to basic response');
      return '❌ AI analysis unavailable. OpenAI API key not configured.';
    }

    const lowerMessage = message.toLowerCase();
    const selectedCoins = strategy?.configuration?.selectedCoins || [];
    
    // Analyze which coins are mentioned or focus on selected coins
    const mentionedCoins = VALID_COIN_SYMBOLS.filter(coin => 
      lowerMessage.includes(coin.toLowerCase())
    );
    const coinsToAnalyze = mentionedCoins.length > 0 ? mentionedCoins : selectedCoins.slice(0, 3);

    // ======================================
    // ENHANCED CONTEXT INTEGRATION 
    // ======================================
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    console.log('🔍 CONTEXT_ENRICHMENT: Collecting ecosystem signals...');
    
    // Collect comprehensive market intelligence
    const enrichedData = await ResponseFormatter.collectMarketIntelligence(
      supabase, 
      coinsToAnalyze, 
      strategy?.user_id
    );
    
    // Prepare ENRICHED market context for OpenAI with full ecosystem data
    const marketContext = {
      userQuestion: message,
      strategyMode: strategy?.configuration?.aiIntelligenceConfig?.decisionMode || 'balanced',
      analysisCoins: coinsToAnalyze,
      marketData: {},
      technicalIndicators: {},
      recentActivity: [],
      // NEW: Full ecosystem intelligence
      whaleAlerts: enrichedData.whaleAlerts,
      newsSignals: enrichedData.newsSignals,
      sentimentAnalysis: enrichedData.sentimentAnalysis,
      liveSignals: enrichedData.liveSignals,
      correlationSignals: enrichedData.correlationSignals,
      alertHistory: enrichedData.alertHistory,
      marketEvents: enrichedData.marketEvents
    };

    // Add market data
    if (marketData && Object.keys(marketData).length > 0) {
      for (const coin of coinsToAnalyze) {
        const coinPair = `${coin}-EUR`;
        const data = marketData[coinPair];
        if (data) {
          marketContext.marketData[coin] = {
            price: data.price,
            volume: data.volume,
            change24h: data.change_percentage_24h || 0
          };
        }
      }
    }

    // Add technical indicators
    if (indicatorContext && Object.keys(indicatorContext).length > 0) {
      for (const coin of coinsToAnalyze) {
        const coinPair = `${coin}-EUR`;
        const indicators = indicatorContext[coinPair];
        if (indicators) {
          marketContext.technicalIndicators[coin] = {
            RSI: {
              value: indicators.RSI?.value?.toFixed(1) || 'N/A',
              signal: indicators.RSI?.signal || 'neutral'
            },
            EMA: {
              direction: indicators.EMA?.direction || 'neutral'
            },
            MACD: {
              crossover: indicators.MACD?.crossover || 'neutral'
            }
          };
        }
      }
    }

    // Add recent trading activity
    if (recentTrades && recentTrades.length > 0) {
      const relevantTrades = recentTrades
        .filter(trade => coinsToAnalyze.some(coin => trade.cryptocurrency.includes(coin)))
        .slice(0, 3);
        
      marketContext.recentActivity = relevantTrades.map(trade => ({
        type: trade.trade_type,
        coin: trade.cryptocurrency,
        value: trade.total_value,
        profitLoss: trade.profit_loss,
        timeAgo: new Date(trade.executed_at).toLocaleString()
      }));
    }

    const systemPrompt = `You are a professional crypto market expert AI assistant with access to comprehensive market intelligence. Based on the user's question and the rich ecosystem data provided, generate a conversational, insightful, and actionable response.

Your response should:
- Be conversational and expert-like (not a data dump)
- Reference specific whale activity, news sentiment, and signal patterns when relevant
- Synthesize insights from multiple data sources (technical indicators, whale alerts, news sentiment, recent signals)
- Provide contextualized guidance based on recent market events and alert history
- Connect current market conditions to recent patterns and user's strategy mode
- Sound like an expert who has been monitoring the market all day
- Be concise but thorough (2-4 paragraphs max)

CRITICAL: You have access to:
- Recent whale transaction data and wallet activity
- Real-time news sentiment and volume spikes  
- Live trading signals (technical, sentiment, volume)
- Alert history and signal patterns from the last 7 days
- Cross-asset correlation signals
- Market events and significant developments

Use this data to provide intelligent, contextual responses that reference specific market activity.

IMPORTANT: Do not give direct financial advice. Use phrases like "might consider", "could be worth monitoring", "appears to suggest", etc.`;

    const userPrompt = `User Question: "${message}"

COMPREHENSIVE MARKET INTELLIGENCE:

Current Market Data:
${JSON.stringify(marketContext.marketData, null, 2)}

Technical Indicators:
${JSON.stringify(marketContext.technicalIndicators, null, 2)}

Recent Trading Activity:
${JSON.stringify(marketContext.recentActivity, null, 2)}

🐋 WHALE ACTIVITY (Last 24h):
${JSON.stringify(marketContext.whaleAlerts, null, 2)}

📰 NEWS SENTIMENT ANALYSIS:
${JSON.stringify(marketContext.newsSignals, null, 2)}

📊 LIVE TRADING SIGNALS:
${JSON.stringify(marketContext.liveSignals, null, 2)}

🔗 CORRELATION SIGNALS:
${JSON.stringify(marketContext.correlationSignals, null, 2)}

📈 ALERT HISTORY (Signal Patterns):
${JSON.stringify(marketContext.alertHistory, null, 2)}

⚡ SIGNIFICANT MARKET EVENTS:
${JSON.stringify(marketContext.marketEvents, null, 2)}

STRATEGY CONTEXT:
- Mode: ${marketContext.strategyMode}
- Focus Coins: ${marketContext.analysisCoins.join(', ')}

Please analyze this comprehensive data and provide expert insights that reference specific whale activity, sentiment trends, signal patterns, and market events. Connect the dots between different data sources to give contextual, intelligent advice.`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 1500
        })
      });

      const data = await response.json();
      const aiResponse = data.choices[0].message.content;
      
      console.log('✅ CRYPTO_EXPERT: OpenAI analysis generated using enriched ecosystem data');
      return `🔮 **Crypto Market Expert Analysis**\n\n${aiResponse}\n\n💡 *This analysis incorporates live whale activity, news sentiment, trading signals, and market events. Always consider your risk tolerance and do your own research.*`;
      
    } catch (error) {
      console.log(`❌ CRYPTO_EXPERT_ERROR: ${error.message}`);
      return `❌ Unable to generate market analysis at this time. Please try again later.\n\nError: ${error.message}`;
    }
  }

  // ======================================
  // MARKET INTELLIGENCE COLLECTION
  // ======================================
  static async collectMarketIntelligence(supabase: any, coins: string[], userId?: string) {
    console.log('🧠 INTELLIGENCE: Collecting signals for coins:', coins.join(', '));
    
    try {
      // Get last 24 hours timeframe
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const last7days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      // 1. Whale Activity & Alerts
      const { data: whaleEvents } = await supabase
        .from('whale_signal_events')
        .select('*')
        .in('symbol', coins)
        .gte('timestamp', last24h)
        .order('timestamp', { ascending: false })
        .limit(10);
      
      // 2. Live Trading Signals (sentiment, technical, volume)
      const { data: liveSignals } = await supabase
        .from('live_signals')
        .select('*')
        .in('symbol', coins)
        .gte('timestamp', last24h)
        .order('timestamp', { ascending: false })
        .limit(20);
      
      // 3. News & Sentiment Analysis
      const { data: newsData } = await supabase
        .from('crypto_news')
        .select('*')
        .in('symbol', coins)
        .gte('timestamp', last24h)
        .order('timestamp', { ascending: false })
        .limit(15);
      
      // 4. Signal History & Patterns (last 7 days for context)
      const { data: signalHistory } = await supabase
        .from('live_signals')
        .select('signal_type, symbol, signal_strength, timestamp')
        .in('symbol', coins)
        .gte('timestamp', last7days)
        .order('timestamp', { ascending: false });
      
      // Process and structure the intelligence
      const intelligence = {
        whaleAlerts: ResponseFormatter.processWhaleAlerts(whaleEvents || []),
        newsSignals: ResponseFormatter.processNewsSignals(newsData || []),
        sentimentAnalysis: ResponseFormatter.processSentimentData(liveSignals || []),
        liveSignals: ResponseFormatter.processLiveSignals(liveSignals || []),
        correlationSignals: ResponseFormatter.processCorrelationSignals(liveSignals || []),
        alertHistory: ResponseFormatter.processAlertHistory(signalHistory || []),
        marketEvents: ResponseFormatter.processMarketEvents(liveSignals || [], newsData || [])
      };
      
      console.log('📊 INTELLIGENCE_SUMMARY:', {
        whaleEvents: whaleEvents?.length || 0,
        liveSignals: liveSignals?.length || 0,
        newsArticles: newsData?.length || 0,
        signalHistory: signalHistory?.length || 0
      });
      
      return intelligence;
      
    } catch (error) {
      console.error('❌ Error collecting market intelligence:', error);
      return {
        whaleAlerts: [],
        newsSignals: [],
        sentimentAnalysis: {},
        liveSignals: [],
        correlationSignals: [],
        alertHistory: [],
        marketEvents: []
      };
    }
  }

  // ======================================
  // SIGNAL PROCESSING METHODS
  // ======================================
  static processWhaleAlerts(whaleEvents: any[]) {
    return whaleEvents.map(event => ({
      timestamp: event.timestamp,
      symbol: event.token_symbol || event.symbol,
      amount: event.amount,
      source: event.from_address,
      destination: event.to_address,
      type: event.event_type,
      blockchain: event.blockchain,
      txHash: event.transaction_hash,
      significance: event.amount > 1000000 ? 'high' : event.amount > 100000 ? 'medium' : 'low'
    }));
  }

  static processNewsSignals(newsData: any[]) {
    const groupedBySymbol = newsData.reduce((acc, news) => {
      if (!acc[news.symbol]) acc[news.symbol] = [];
      acc[news.symbol].push(news);
      return acc;
    }, {});

    return Object.entries(groupedBySymbol).map(([symbol, articles]: [string, any[]]) => ({
      symbol,
      sentiment: articles.reduce((sum, a) => sum + a.sentiment_score, 0) / articles.length,
      volume: articles.length,
      latestHeadlines: articles.slice(0, 3).map(a => a.headline),
      trend: articles.reduce((sum, a) => sum + a.sentiment_score, 0) / articles.length > 0.6 ? 'bullish' : 
             articles.reduce((sum, a) => sum + a.sentiment_score, 0) / articles.length < 0.4 ? 'bearish' : 'neutral'
    }));
  }

  static processSentimentData(signals: any[]) {
    const sentimentSignals = signals.filter(s => s.signal_type.includes('sentiment'));
    const groupedBySymbol = sentimentSignals.reduce((acc, signal) => {
      if (!acc[signal.symbol]) acc[signal.symbol] = [];
      acc[signal.symbol].push(signal);
      return acc;
    }, {});

    return Object.entries(groupedBySymbol).reduce((acc, [symbol, sigs]: [string, any[]]) => {
      acc[symbol] = {
        avgStrength: sigs.reduce((sum, s) => sum + s.signal_strength, 0) / sigs.length,
        signalCount: sigs.length,
        latestTrend: sigs[0]?.signal_type.includes('bullish') ? 'bullish' : 
                     sigs[0]?.signal_type.includes('bearish') ? 'bearish' : 'neutral'
      };
      return acc;
    }, {});
  }

  static processLiveSignals(signals: any[]) {
    return signals.slice(0, 10).map(signal => ({
      symbol: signal.symbol,
      type: signal.signal_type,
      strength: signal.signal_strength,
      timestamp: signal.timestamp,
      source: signal.source,
      description: signal.data?.description || signal.signal_type.replace(/_/g, ' ')
    }));
  }

  static processCorrelationSignals(signals: any[]) {
    const maSignals = signals.filter(s => s.signal_type.includes('ma_cross'));
    return maSignals.slice(0, 5).map(signal => ({
      symbol: signal.symbol,
      direction: signal.signal_type.includes('bullish') ? 'bullish' : 'bearish',
      strength: signal.signal_strength,
      timestamp: signal.timestamp
    }));
  }

  static processAlertHistory(signalHistory: any[]) {
    const last24h = signalHistory.filter(s => 
      new Date(s.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    
    const signalCounts = last24h.reduce((acc, signal) => {
      acc[signal.signal_type] = (acc[signal.signal_type] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(signalCounts)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([type, count]) => ({ signalType: type, count }));
  }

  static processMarketEvents(signals: any[], news: any[]) {
    const significantEvents = [];
    
    // High-strength signals as events
    const strongSignals = signals.filter(s => s.signal_strength > 80);
    strongSignals.forEach(signal => {
      significantEvents.push({
        type: 'signal',
        symbol: signal.symbol,
        description: `Strong ${signal.signal_type} signal detected`,
        strength: signal.signal_strength,
        timestamp: signal.timestamp
      });
    });

    // High-impact news as events
    const highImpactNews = news.filter(n => 
      n.sentiment_score > 0.8 || n.sentiment_score < 0.2
    );
    highImpactNews.forEach(article => {
      significantEvents.push({
        type: 'news',
        symbol: article.symbol,
        description: article.headline,
        sentiment: article.sentiment_score > 0.5 ? 'positive' : 'negative',
        timestamp: article.timestamp
      });
    });

    return significantEvents.slice(0, 8);
  }
}

// =============================================
// DYNAMIC COIN LIST INITIALIZATION
// =============================================
// Initialize selectedCoins validValues dynamically from COINBASE_COINS
FIELD_DEFINITIONS.selectedCoins.validValues = VALID_COIN_SYMBOLS;

console.log(`🪙 Dynamic coin validation initialized with ${VALID_COIN_SYMBOLS.length} coins:`, VALID_COIN_SYMBOLS.join(', '));

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
      
      // This is a market analysis question - provide crypto expert response
      const marketAnalysisResponse = await ResponseFormatter.formatCryptoExpertResponse(
        message, 
        requestData.marketData, 
        requestData.indicatorContext,
        requestData.recentTrades,
        strategy
      );
      
      return new Response(
        JSON.stringify({ 
          response: marketAnalysisResponse,
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
      const response = ResponseFormatter.formatSuccessResponse(
        updateResult.results,
        updateResult.successfulCount,
        updateResult.failedCount,
        updateResult.totalCount
      );
      
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