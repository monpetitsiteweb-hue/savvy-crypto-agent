import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

// =============================================
// MASTER AI TRADING ASSISTANT V2.0
// FULLY AUTONOMOUS LLM-FIRST ARCHITECTURE
// =============================================

// =============================================
// CONVERSATIONAL MEMORY SYSTEM
// =============================================
class ConversationMemory {
  static async getRecentContext(userId: string, limit: number = 10): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('conversation_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to fetch conversation context:', error);
      return [];
    }
  }

  static async storeMessage(userId: string, messageType: string, content: string, metadata: any = {}) {
    try {
      await supabase
        .from('conversation_history')
        .insert({
          user_id: userId,
          message_type: messageType,
          content,
          metadata
        });
    } catch (error) {
      console.error('Failed to store conversation:', error);
    }
  }

  static buildContextPrompt(history: any[]): string {
    if (!history.length) return 'This is the start of our conversation.';
    
    const recentHistory = history.slice(0, 5).reverse();
    return recentHistory.map(h => 
      `${h.message_type === 'user' ? 'User' : 'Assistant'}: ${h.content.substring(0, 200)}`
    ).join('\n');
  }
}

class ExternalSignalIntegration {
  static async getWhaleAlerts(limit: number = 10): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('whale_signal_events')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to fetch whale alerts:', error);
      return [];
    }
  }

  static async getCryptoNews(limit: number = 5): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('crypto_news')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to fetch crypto news:', error);
      return [];
    }
  }

  static async getLiveSignals(symbols: string[] = []): Promise<any[]> {
    try {
      let query = supabase
        .from('live_signals')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(20);
      
      if (symbols.length > 0) {
        query = query.in('symbol', symbols);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to fetch live signals:', error);
      return [];
    }
  }
}

// =============================================
// INTELLIGENT FIELD MAPPING & INTERFACE AWARENESS
// =============================================
class IntelligentFieldMapper {
  static FIELD_DEFINITIONS = {
    // === BASIC SETTINGS ===
    'strategyName': {
      name: 'Strategy Name',
      description: 'Name of your trading strategy',
      type: 'string',
      uiLocation: 'Strategy Configuration → Basic Settings → Strategy Name',
      examples: ['rename to aggressive trader', 'call it bitcoin scalper', 'change name to growth strategy']
    },
    'description': {
      name: 'Description',
      description: 'Description of your trading strategy',
      type: 'string',
      uiLocation: 'Strategy Configuration → Basic Settings → Description',
      examples: ['add description', 'describe strategy', 'change description to momentum based']
    },

    // === COINS AND AMOUNTS ===
    'perTradeAllocation': {
      name: 'Amount Per Trade',
      description: 'Amount in euros to invest per individual trade',
      type: 'number',
      uiLocation: 'Strategy Configuration → Coins & Amounts → Amount Per Trade',
      examples: ['set minimum trade to 500 euros', 'per trade allocation 1000', 'invest 750 per trade', 'trade with 250 each']
    },
    'selectedCoins': {
      name: 'Selected Cryptocurrencies',
      description: 'Specific cryptocurrencies the strategy will trade',
      type: 'array',
      uiLocation: 'Strategy Configuration → Coins & Amounts → Coin Selection',
      examples: ['only trade BTC and ETH', 'add XRP to my coins', 'remove DOGE from strategy', 'trade all coins']
    },
    'maxActiveCoins': {
      name: 'Max Active Coins',
      description: 'Maximum number of cryptocurrencies to trade simultaneously',
      type: 'number',
      uiLocation: 'Strategy Configuration → Coins & Amounts → Max Active Coins',
      examples: ['set max active coins to 5', 'limit to 3 coins', 'trade up to 8 cryptocurrencies']
    },

    // === BUY/SELL SETTINGS ===
    'buyStrategy': {
      name: 'Buy Strategy',
      description: 'Strategy for when to buy: aggressive, conservative, or balanced',
      type: 'enum',
      values: ['aggressive', 'conservative', 'balanced'],
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Buy Strategy',
      examples: ['set buy strategy to aggressive', 'make buying conservative', 'use balanced buy approach']
    },
    'sellStrategy': {
      name: 'Sell Strategy',
      description: 'Strategy for when to sell: aggressive, conservative, or balanced',
      type: 'enum',
      values: ['aggressive', 'conservative', 'balanced'],
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Sell Strategy',
      examples: ['set sell strategy to conservative', 'aggressive selling', 'balanced sell approach']
    },
    'trailingBuyPercentage': {
      name: 'Trailing Buy %',
      description: 'Percentage for trailing buy orders to optimize entry points',
      type: 'number',
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Trailing Buy %',
      examples: ['set trailing buy to 1%', 'trailing buy percentage 2', 'use 1.5% for trailing buys']
    },
    'trailingSellPercentage': {
      name: 'Trailing Sell %',
      description: 'Percentage for trailing sell orders to maximize profit',
      type: 'number',
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Trailing Sell %',
      examples: ['set trailing sell to 2%', 'trailing sell percentage 1.5', 'use 3% for trailing sells']
    },
    'useTrailingStopOnly': {
      name: 'Use Trailing Stop Only',
      description: 'Only use trailing stop losses instead of fixed stop losses',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Use Trailing Stop Only',
      examples: ['use trailing stop only', 'enable trailing stop only mode', 'trailing stop only']
    },

    // === POSITION MANAGEMENT ===
    'maxPositionSize': {
      name: 'Maximum Position Size',
      description: 'Maximum total amount to invest in any single cryptocurrency',
      type: 'number',
      uiLocation: 'Strategy Configuration → Position Management → Max Position Size',
      examples: ['max position 5000', 'limit exposure to 3000', 'cap investment at 10000']
    },
    'positionSizingMethod': {
      name: 'Position Sizing Method',
      description: 'Method for calculating position sizes: fixed or percentage',
      type: 'enum',
      values: ['fixed', 'percentage'],
      uiLocation: 'Strategy Configuration → Position Management → Position Sizing Method',
      examples: ['use fixed position sizing', 'switch to percentage method', 'position sizing to fixed']
    },

    // === DCA & ADVANCED ===
    'enableDCA': {
      name: 'Dollar Cost Averaging',
      description: 'Enable Dollar Cost Averaging for gradual position building',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → DCA & Advanced → Enable DCA',
      examples: ['enable DCA', 'turn on dollar cost averaging', 'disable DCA', 'use averaging']
    },
    'dcaSteps': {
      name: 'DCA Steps',
      description: 'Number of steps for Dollar Cost Averaging',
      type: 'number',
      uiLocation: 'Strategy Configuration → DCA & Advanced → DCA Steps',
      examples: ['set DCA steps to 5', 'use 3 DCA steps', 'averaging in 4 steps']
    },
    'dcaPercentage': {
      name: 'DCA Percentage',
      description: 'Percentage drop between DCA steps',
      type: 'number',
      uiLocation: 'Strategy Configuration → DCA & Advanced → DCA Percentage',
      examples: ['DCA percentage 2%', 'set averaging drop to 1.5%', 'DCA every 3% down']
    },

    // === SHORTING ===
    'enableShorting': {
      name: 'Enable Shorting',
      description: 'Allow short selling to profit from price declines',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Shorting → Enable Shorting',
      examples: ['enable shorting', 'allow short selling', 'disable shorts', 'turn on short positions']
    },
    'shortingRatio': {
      name: 'Shorting Ratio',
      description: 'Percentage of portfolio that can be used for short positions',
      type: 'number',
      uiLocation: 'Strategy Configuration → Shorting → Shorting Ratio',
      examples: ['shorting ratio 30%', 'allow 20% shorts', 'limit shorts to 10%']
    },

    // === RISK MANAGEMENT ===
    'riskLevel': {
      name: 'Risk Level',
      description: 'Overall risk tolerance: low, medium, or high',
      type: 'enum',
      values: ['low', 'medium', 'high'],
      uiLocation: 'Strategy Configuration → Risk Management → Risk Level',
      examples: ['set risk to high', 'make it more aggressive', 'lower my risk', 'conservative approach', 'medium risk']
    },
    'stopLossPercentage': {
      name: 'Stop Loss %',
      description: 'Automatically sell if price drops by this percentage to limit losses',
      type: 'number',
      uiLocation: 'Strategy Configuration → Risk Management → Stop Loss %',
      examples: ['set stop loss to 3%', 'cut losses at 2%', 'add stop loss protection', 'stop loss 5%']
    },
    'takeProfitPercentage': {
      name: 'Take Profit %',
      description: 'Automatically sell when profit reaches this percentage to lock in gains',
      type: 'number',
      uiLocation: 'Strategy Configuration → Risk Management → Take Profit %',
      examples: ['take profit at 10%', 'secure gains at 15%', 'set profit target', 'take profit 8%']
    },
    'maxDailyLoss': {
      name: 'Max Daily Loss',
      description: 'Maximum amount willing to lose in a single day',
      type: 'number',
      uiLocation: 'Strategy Configuration → Risk Management → Max Daily Loss',
      examples: ['max daily loss 500', 'limit daily losses to 300', 'daily loss cap 1000']
    },
    'portfolioAllocation': {
      name: 'Portfolio Allocation',
      description: 'Percentage of total portfolio to use for this strategy',
      type: 'number',
      uiLocation: 'Strategy Configuration → Risk Management → Portfolio Allocation',
      examples: ['allocate 50% of portfolio', 'use 30% allocation', 'portfolio allocation 75%']
    },

    // === NOTIFICATIONS ===
    'notifications.tradeExecuted': {
      name: 'Trade Executed Notifications',
      description: 'Get notified when trades are executed',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Notifications → Trade Executed',
      examples: ['enable trade notifications', 'notify on trades', 'disable trade alerts']
    },
    'notifications.profitTarget': {
      name: 'Profit Target Notifications',
      description: 'Get notified when profit targets are reached',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Notifications → Profit Target',
      examples: ['notify on profit targets', 'enable profit alerts', 'disable profit notifications']
    },
    'notifications.stopLoss': {
      name: 'Stop Loss Notifications',
      description: 'Get notified when stop losses are triggered',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Notifications → Stop Loss',
      examples: ['notify on stop loss', 'enable loss alerts', 'disable stop loss notifications']
    },
    'notifications.dailySummary': {
      name: 'Daily Summary Notifications',
      description: 'Get daily summary of trading activity',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Notifications → Daily Summary',
      examples: ['enable daily summary', 'send daily reports', 'disable daily notifications']
    },

    // === ADVANCED SETTINGS ===
    'tradingHours.enabled': {
      name: 'Trading Hours Enabled',
      description: 'Enable specific trading hours for the strategy',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Advanced → Trading Hours',
      examples: ['enable trading hours', 'set trading schedule', 'disable time restrictions']
    },
    'tradingHours.start': {
      name: 'Trading Hours Start',
      description: 'Start time for daily trading activity',
      type: 'string',
      uiLocation: 'Strategy Configuration → Advanced → Trading Hours Start',
      examples: ['start trading at 9am', 'begin at 8:00', 'trading start 10:00']
    },
    'tradingHours.end': {
      name: 'Trading Hours End',
      description: 'End time for daily trading activity',
      type: 'string',
      uiLocation: 'Strategy Configuration → Advanced → Trading Hours End',
      examples: ['stop trading at 5pm', 'end at 17:00', 'trading end 18:00']
    },
    'rebalancingFrequency': {
      name: 'Rebalancing Frequency',
      description: 'How often to rebalance the portfolio: daily, weekly, monthly',
      type: 'enum',
      values: ['daily', 'weekly', 'monthly'],
      uiLocation: 'Strategy Configuration → Advanced → Rebalancing Frequency',
      examples: ['rebalance daily', 'weekly rebalancing', 'monthly portfolio rebalance']
    },
    'slippageTolerance': {
      name: 'Slippage Tolerance',
      description: 'Maximum acceptable price slippage for trades',
      type: 'number',
      uiLocation: 'Strategy Configuration → Advanced → Slippage Tolerance',
      examples: ['slippage tolerance 0.5%', 'allow 1% slippage', 'limit slippage to 0.3%']
    },

    // === AI INTELLIGENCE CONFIG ===
    'aiIntelligenceConfig.enableAIOverride': {
      name: 'AI Decision Override',
      description: 'Enable AI to override strategy decisions based on market analysis',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → AI Intelligence → Enable AI Decision Override',
      examples: ['enable AI', 'turn on AI intelligence', 'use AI signals', 'disable AI override', 'AI on', 'AI off']
    },
    'aiIntelligenceConfig.aiAutonomyLevel': {
      name: 'AI Autonomy Level',
      description: 'Level of autonomy for AI decision making (0-100)',
      type: 'number',
      uiLocation: 'Strategy Configuration → AI Intelligence → AI Autonomy Level',
      examples: ['set AI autonomy to 90%', 'AI autonomy level 50', 'autonomy 75%', 'AI control 60%']
    },
    'aiIntelligenceConfig.confidenceThreshold': {
      name: 'AI Confidence Threshold',
      description: 'Minimum confidence level required for AI to make decisions',
      type: 'number',
      uiLocation: 'Strategy Configuration → AI Intelligence → Confidence Threshold',
      examples: ['confidence threshold 80%', 'AI confidence 70%', 'require 90% confidence']
    },
    'aiIntelligenceConfig.riskTolerance': {
      name: 'AI Risk Tolerance',
      description: 'AI risk tolerance level for decision making',
      type: 'string',
      uiLocation: 'Strategy Configuration → AI Intelligence → Risk Tolerance',
      examples: ['AI risk tolerance high', 'conservative AI risk', 'moderate AI risk tolerance']
    },

    // === TECHNICAL INDICATORS ===
    'technicalIndicators.rsi.enabled': {
      name: 'RSI Indicator',
      description: 'Relative Strength Index for momentum analysis',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Technical Analysis → RSI',
      examples: ['enable RSI', 'turn on RSI indicator', 'disable RSI', 'use momentum analysis']
    },
    'technicalIndicators.macd.enabled': {
      name: 'MACD Indicator',
      description: 'Moving Average Convergence Divergence for trend analysis',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Technical Analysis → MACD',
      examples: ['enable MACD', 'turn on MACD indicator', 'disable MACD', 'use trend analysis']
    },
    'technicalIndicators.bollinger.enabled': {
      name: 'Bollinger Bands',
      description: 'Bollinger Bands for volatility and support/resistance analysis',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Technical Analysis → Bollinger Bands',
      examples: ['enable bollinger bands', 'turn on volatility bands', 'disable bollinger', 'use support resistance']
    },
    'technicalIndicators.ema.enabled': {
      name: 'EMA Indicator',
      description: 'Exponential Moving Average for trend following',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Technical Analysis → EMA',
      examples: ['enable EMA', 'turn on exponential moving average', 'disable EMA', 'use trend following']
    },
    'technicalIndicators.sma.enabled': {
      name: 'SMA Indicator',
      description: 'Simple Moving Average for trend analysis',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Technical Analysis → SMA',
      examples: ['enable SMA', 'turn on simple moving average', 'disable SMA', 'use moving averages']
    }
  };

  static async detectIntent(message: string): Promise<'question' | 'command' | 'ambiguous'> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a semantic intent classifier for a crypto trading assistant. Classify user messages into exactly one category:

- "question": User is asking for information, status, or explanation (even if phrased conversationally)
- "command": User wants to change/update configuration or settings
- "ambiguous": Unclear intent that needs clarification

Examples:
- "Is AI enabled?" → question
- "Can you check if AI is turned on?" → question  
- "I want to know whether AI is in use" → question
- "Enable AI" → command
- "Turn on artificial intelligence" → command
- "Set risk to high" → command
- "AI" → ambiguous

Respond with ONLY the category name, no explanation.`
            },
            {
              role: 'user',
              content: message
            }
          ],
          temperature: 0.1,
          max_tokens: 10
        }),
      });

      const data = await response.json();
      const intent = data.choices[0].message.content.trim().toLowerCase();
      
      if (['question', 'command', 'ambiguous'].includes(intent)) {
        return intent as 'question' | 'command' | 'ambiguous';
      }
      
      console.log(`⚠️ INTENT_CLASSIFIER: Unexpected response "${intent}", defaulting to question`);
      return 'question'; // Safe default
    } catch (error) {
      console.error('❌ INTENT_CLASSIFIER: LLM call failed:', error);
      return 'question'; // Safe default on error
    }
  }

  static async mapUserIntent(message: string, currentConfig: any = {}): Promise<any> {
    const intent = await this.detectIntent(message);
    if (intent === 'question') return {}; // No updates for questions
    
    const lowerMessage = message.toLowerCase();
    const updates = {};

    // Use OpenAI to map user intent to specific fields
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a field mapping expert for cryptocurrency trading strategy configuration. 
              
Map user requests to field updates. Available fields and their patterns:

BASIC FIELDS:
- strategyName: "change name to X", "rename strategy"
- riskLevel: "set risk to high/medium/low", "conservative/aggressive approach" (values: high, medium, low)
- perTradeAllocation: "trade 1000 euros", "amount per trade", "allocation 500" (number)
- maxActiveCoins: "max 5 coins", "limit to 3 cryptocurrencies" (number 1-20)

BUY/SELL SETTINGS:
- trailingBuyPercentage: "trailing buy 1.5%", "set trailing buy to 2%" (number)
- trailingSellPercentage: "trailing sell 3%", "trailing sell percentage" (number)
- useTrailingStopOnly: "use trailing stop only", "trailing stop only mode" (boolean)
- stopLossPercentage: "stop loss 5%", "cut losses at 3%" (number 0.1-50)
- takeProfitPercentage: "take profit 10%", "profit target 15%" (number 1-1000)

AI INTELLIGENCE CONFIG (nested in aiIntelligenceConfig):
- enableAIOverride: "enable AI", "turn on AI intelligence", "AI on/off" (boolean)
- aiAutonomyLevel: "AI autonomy 90%", "set autonomy to 75", "AI control level" (number 0-100)
- aiConfidenceThreshold: "confidence threshold 80%", "AI confidence 70%" (number 0-100)
- riskOverrideAllowed: "allow AI risk override", "AI can override risk" (boolean)

COINS & AMOUNTS:
- selectedCoins: "add BTC ETH", "use only XRP ADA", "trade these coins: BTC, ETH" (array)

POSITION MANAGEMENT:
- maxPositionSize: "max position 5000", "position limit 3000" (number)
- maxWalletExposure: "wallet exposure 80%", "exposure limit 60%" (number)

DCA & ADVANCED:
- enableDCA: "enable DCA", "use dollar cost averaging" (boolean)
- dcaSteps: "DCA steps 5", "averaging in 3 steps" (number)

SHORTING:
- enableShorting: "enable shorting", "allow short selling" (boolean)

TECHNICAL INDICATORS (nested):
- technicalIndicators.rsi.enabled: "enable RSI", "use RSI indicator" (boolean)
- technicalIndicators.macd.enabled: "enable MACD", "turn on MACD" (boolean)

Return ONLY a JSON object with field paths and values. For nested fields use dot notation.
Examples:
- "Enable AI" → {"aiIntelligenceConfig.enableAIOverride": true}
- "Set AI autonomy to 90%" → {"aiIntelligenceConfig.aiAutonomyLevel": 90}
- "Trailing buy 1.5%" → {"trailingBuyPercentage": 1.5}
- "Max 5 coins, trade 1000 euros" → {"maxActiveCoins": 5, "perTradeAllocation": 1000}

If no fields match, return {}. Do not explain, only return JSON.`
            },
            {
              role: 'user',
              content: message
            }
          ],
          temperature: 0.1,
          max_tokens: 200
        }),
      });

      const data = await response.json();
      const aiResponse = data.choices[0].message.content.trim();
      
      // Parse AI response as JSON
      try {
        const aiUpdates = JSON.parse(aiResponse);
        console.log('🤖 AI FIELD MAPPING:', JSON.stringify(aiUpdates, null, 2));
        
        // Handle nested field updates (like aiIntelligenceConfig.*)
        for (const [fieldPath, value] of Object.entries(aiUpdates)) {
          if (fieldPath.includes('.')) {
            const parts = fieldPath.split('.');
            if (parts[0] === 'aiIntelligenceConfig') {
              if (!updates.aiIntelligenceConfig) updates.aiIntelligenceConfig = {};
              updates.aiIntelligenceConfig[parts[1]] = value;
            } else if (parts[0] === 'technicalIndicators') {
              if (!updates.technicalIndicators) updates.technicalIndicators = {};
              if (!updates.technicalIndicators[parts[1]]) updates.technicalIndicators[parts[1]] = {};
              updates.technicalIndicators[parts[1]][parts[2]] = value;
            }
          } else {
            updates[fieldPath] = value;
          }
        }
        
        return updates;
      } catch (parseError) {
        console.log('⚠️ AI response not valid JSON, falling back to basic patterns:', aiResponse);
      }
    } catch (error) {
      console.error('❌ AI FIELD MAPPING: Failed, using fallback patterns:', error);
    }

    // Fallback: Basic pattern matching for critical fields
    
    // AI Intelligence Config
    if (lowerMessage.match(/\b(enable|turn on|activate|use)\s+(ai|artificial intelligence)\b/) || 
        lowerMessage.match(/\bai\s+(on|enabled?)\b/)) {
      if (!updates.aiIntelligenceConfig) updates.aiIntelligenceConfig = {};
      updates.aiIntelligenceConfig.enableAIOverride = true;
    }
    if (lowerMessage.match(/\b(disable|turn off|deactivate)\s+(ai|artificial intelligence)\b/) || 
        lowerMessage.match(/\bai\s+(off|disabled?)\b/)) {
      if (!updates.aiIntelligenceConfig) updates.aiIntelligenceConfig = {};
      updates.aiIntelligenceConfig.enableAIOverride = false;
    }

    // AI Autonomy Level
    const autonomyMatch = message.match(/(?:ai\s+)?(?:autonomy|control).*?(\d+)/i);
    if (autonomyMatch) {
      const level = parseInt(autonomyMatch[1]);
      if (level >= 0 && level <= 100) {
        if (!updates.aiIntelligenceConfig) updates.aiIntelligenceConfig = {};
        updates.aiIntelligenceConfig.aiAutonomyLevel = level;
      }
    }

    // Trailing Buy Percentage
    const trailingBuyMatch = message.match(/trailing\s+buy.*?(\d+(?:\.\d+)?)/i);
    if (trailingBuyMatch) {
      updates.trailingBuyPercentage = parseFloat(trailingBuyMatch[1]);
    }

    // Trailing Stop Only
    if (lowerMessage.includes('trailing stop only') || lowerMessage.includes('use trailing stop only')) {
      updates.useTrailingStopOnly = true;
    }

    // Risk level mapping
    if (lowerMessage.includes('risk')) {
      if (lowerMessage.includes('high') || lowerMessage.includes('aggressive')) {
        updates.riskLevel = 'high';
      } else if (lowerMessage.includes('low') || lowerMessage.includes('conservative')) {
        updates.riskLevel = 'low';
      } else if (lowerMessage.includes('medium') || lowerMessage.includes('moderate')) {
        updates.riskLevel = 'medium';
      }
    }

    // Amount per trade
    const amountMatches = [
      message.match(/(\d+)\s*(euros?|eur|€)/i),
      message.match(/€\s*(\d+)/i),
      message.match(/(\d+)\s*per\s*trade/i)
    ];
    
    const amountMatch = amountMatches.find(match => match !== null);
    if (amountMatch && (lowerMessage.includes('trade') || lowerMessage.includes('allocation'))) {
      updates.perTradeAllocation = parseInt(amountMatch[1]);
    }

    // Stop loss and take profit
    const percentageMatch = message.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentageMatch) {
      const percentage = parseFloat(percentageMatch[1]);
      if (lowerMessage.includes('stop') && lowerMessage.includes('loss')) {
        if (percentage > 0 && percentage <= 50) {
          updates.stopLossPercentage = percentage;
        }
      } else if (lowerMessage.includes('profit') || lowerMessage.includes('gain')) {
        if (percentage > 0 && percentage <= 1000) {
          updates.takeProfitPercentage = percentage;
        }
      }
    }

    // Max active coins
    const maxCoinsMatch = message.match(/(?:max|maximum)\s+(?:active\s+)?coins?\s+(?:to\s+)?(\d+)/i);
    if (maxCoinsMatch) {
      const numCoins = parseInt(maxCoinsMatch[1]);
      if (numCoins > 0 && numCoins <= 20) {
        updates.maxActiveCoins = numCoins;
      }
    }

    // Coin selection
    const coinPatterns = ['BTC', 'ETH', 'XRP', 'ADA', 'SOL', 'DOT', 'MATIC', 'AVAX', 'LINK', 'UNI', 'DOGE', 'LTC', 'BCH'];
    const mentionedCoins = coinPatterns.filter(coin => 
      new RegExp(`\\b${coin.toLowerCase()}\\b`).test(lowerMessage)
    );

    if (mentionedCoins.length > 0) {
      if (lowerMessage.includes('only') || lowerMessage.includes('just')) {
        updates.selectedCoins = mentionedCoins;
      } else if (lowerMessage.includes('add')) {
        const current = currentConfig.selectedCoins || [];
        updates.selectedCoins = [...new Set([...current, ...mentionedCoins])];
      } else if (lowerMessage.includes('remove')) {
        const current = currentConfig.selectedCoins || [];
        updates.selectedCoins = current.filter(coin => !mentionedCoins.includes(coin));
      }
    }
      } else if (lowerMessage.includes('remove')) {
        updates.selectedCoins = (currentConfig.selectedCoins || []).filter(coin => 
          !mentionedCoins.includes(coin)
        );
      }
    }

    // AI configuration - Use single source of truth: aiIntelligenceConfig.enableAIOverride
    if (lowerMessage.includes('ai') || 
        (lowerMessage.includes('artificial') && lowerMessage.includes('intelligence')) ||
        (lowerMessage.includes('it') && lowerMessage.includes('disable')) ||
        (lowerMessage.includes('it') && lowerMessage.includes('enable'))) {
      
      if (lowerMessage.includes('enable') || lowerMessage.includes('turn on') || lowerMessage.includes('activate')) {
        updates.aiIntelligenceConfig = {
          ...(currentConfig.aiIntelligenceConfig || {}),
          enableAIOverride: true
        };
      } else if (lowerMessage.includes('disable') || lowerMessage.includes('turn off') || lowerMessage.includes('deactivate')) {
        updates.aiIntelligenceConfig = {
          ...(currentConfig.aiIntelligenceConfig || {}),
          enableAIOverride: false
        };
      }
    }

    return updates;
  }

  static explainField(fieldName: string): string {
    const field = this.FIELD_DEFINITIONS[fieldName];
    if (!field) return `Unknown field: ${fieldName}`;
    
    return `**${field.name}**: ${field.description}\n\n**Location**: ${field.uiLocation}\n\n**Examples**: "${field.examples.join('", "')}"`;
  }
}

// =============================================
// VALIDATION & ACTION FRAMEWORK
// =============================================
class ValidationEngine {
  static validateConfigChange(field: string, newValue: any, currentValue: any): {
    isValid: boolean,
    needsUpdate: boolean,
    message: string
  } {
    console.log(`🔍 VALIDATION CHECK: ${field}`, {
      newValue,
      currentValue,
      currentValueType: typeof currentValue,
      newValueType: typeof newValue
    });
    
    // Check if value is actually changing
    if (JSON.stringify(newValue) === JSON.stringify(currentValue)) {
      return {
        isValid: true,
        needsUpdate: false,
        message: `No change needed — '${IntelligentFieldMapper.FIELD_DEFINITIONS[field]?.name || field}' is already set to ${Array.isArray(newValue) ? newValue.join(', ') : newValue}.`
      };
    }

    // Field-specific validation
    switch (field) {
      case 'perTradeAllocation':
        if (newValue < 1 || newValue > 100000) {
          return { isValid: false, needsUpdate: false, message: 'Amount per trade must be between €1 and €100,000.' };
        }
        break;
      case 'stopLossPercentage':
        if (newValue < 0.1 || newValue > 50) {
          return { isValid: false, needsUpdate: false, message: 'Stop loss must be between 0.1% and 50%.' };
        }
        break;
      case 'takeProfitPercentage':
        if (newValue < 1 || newValue > 1000) {
          return { isValid: false, needsUpdate: false, message: 'Take profit must be between 1% and 1000%.' };
        }
        break;
      case 'maxActiveCoins':
        if (newValue < 1 || newValue > 20) {
          return { isValid: false, needsUpdate: false, message: 'Max active coins must be between 1 and 20.' };
        }
        break;
    }

    return {
      isValid: true,
      needsUpdate: true,
      message: `✅ Updated '${IntelligentFieldMapper.FIELD_DEFINITIONS[field]?.name || field}' from ${Array.isArray(currentValue) ? currentValue.join(', ') : currentValue} to ${Array.isArray(newValue) ? newValue.join(', ') : newValue}.`
    };
  }
}

// =============================================
// EXPERT CRYPTO INTELLIGENCE ENGINE
// =============================================
class CryptoIntelligenceEngine {
  static async generateContextualResponse(
    message: string, 
    strategy: any, 
    signals: any[], 
    news: any[], 
    conversationHistory: any[],
    currentConfig: any = {}
  ): Promise<{ message: string, configUpdates?: any, needsValidation?: boolean }> {
    
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
    
    if (Object.keys(potentialUpdates).length === 0) {
      // No clear config intent - use general AI response
      return { message: await this.handleGeneralIntent(message, strategy, marketContext, memoryContext, interfaceContext) };
    }
    
    // Validate all potential updates
    const validatedUpdates = {};
    const validationMessages = [];
    
    for (const [field, newValue] of Object.entries(potentialUpdates)) {
      const currentValue = currentConfig[field];
      const validation = ValidationEngine.validateConfigChange(field, newValue, currentValue);
      
      if (validation.isValid && validation.needsUpdate) {
        validatedUpdates[field] = newValue;
        validationMessages.push(validation.message);
      } else if (!validation.isValid) {
        validationMessages.push(`❌ ${validation.message}`);
      } else {
        validationMessages.push(validation.message);
      }
    }
    
    
    // Execute validated config updates if any exist
    if (Object.keys(validatedUpdates).length > 0) {
      console.log(`🔄 EXECUTING CONFIG UPDATES:`, validatedUpdates);
      
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
    
    return {
      message: responseMessage,
      configUpdates: undefined
    };
  }

  static async handleQuestionIntent(message: string, strategy: any, marketContext: string, memoryContext: string, interfaceContext: string): Promise<string> {
    // Extract current values for fields the user might be asking about
    const config = strategy?.configuration || {};
    const currentValues = this.extractCurrentValues(config);
    
    const systemPrompt = `You are an expert cryptocurrency trading assistant with complete interface awareness.

CURRENT STRATEGY CONFIGURATION VALUES:
${currentValues}

INTERFACE KNOWLEDGE: ${interfaceContext}
MARKET CONTEXT: ${marketContext}
STRATEGY CONTEXT: ${this.buildStrategyContext(strategy)}
CONVERSATION HISTORY: ${memoryContext}

The user is asking a QUESTION about their strategy configuration or trading setup. 

IMPORTANT: When they ask about specific settings like "What is my AI Autonomy Level?" or "Is AI enabled?", provide the ACTUAL CURRENT VALUE from the configuration above, not generic information.

Answer their questions by:
1. Providing the actual current value if they're asking about a specific setting
2. Explaining what the setting does and how it works
3. Mentioning where they can find it in the interface
4. Providing relevant market context or recommendations if appropriate

Never suggest configuration changes unless explicitly asked. Always reference the actual current values when available.`;

    return await this.callOpenAI(systemPrompt, message);
  }

  static extractCurrentValues(config: any): string {
    const values = [];
    
    // Basic settings
    values.push(`Strategy Name: ${config.strategyName || 'Not set'}`);
    values.push(`Risk Level: ${config.riskLevel || 'Not set'}`);
    values.push(`Per Trade Allocation: €${config.perTradeAllocation || 'Not set'}`);
    values.push(`Max Active Coins: ${config.maxActiveCoins || 'Not set'}`);
    
    // AI Intelligence Config
    const aiConfig = config.aiIntelligenceConfig || {};
    values.push(`AI Decision Override: ${aiConfig.enableAIOverride ? 'Enabled' : 'Disabled'}`);
    values.push(`AI Autonomy Level: ${aiConfig.aiAutonomyLevel || 'Not set'}%`);
    values.push(`AI Confidence Threshold: ${aiConfig.aiConfidenceThreshold || 'Not set'}%`);
    values.push(`AI Risk Override Allowed: ${aiConfig.riskOverrideAllowed ? 'Yes' : 'No'}`);
    
    // Buy/Sell Settings
    values.push(`Trailing Buy Percentage: ${config.trailingBuyPercentage || 'Not set'}%`);
    values.push(`Trailing Sell Percentage: ${config.trailingSellPercentage || 'Not set'}%`);
    values.push(`Use Trailing Stop Only: ${config.useTrailingStopOnly ? 'Yes' : 'No'}`);
    values.push(`Stop Loss Percentage: ${config.stopLossPercentage || 'Not set'}%`);
    values.push(`Take Profit Percentage: ${config.takeProfitPercentage || 'Not set'}%`);
    
    // Position Management
    values.push(`Max Position Size: €${config.maxPositionSize || 'Not set'}`);
    values.push(`Max Wallet Exposure: ${config.maxWalletExposure || 'Not set'}%`);
    
    // Coins
    const selectedCoins = config.selectedCoins || [];
    values.push(`Selected Coins: ${selectedCoins.length > 0 ? selectedCoins.join(', ') : 'None selected'}`);
    
    // DCA
    values.push(`DCA Enabled: ${config.enableDCA ? 'Yes' : 'No'}`);
    values.push(`DCA Steps: ${config.dcaSteps || 'Not set'}`);
    
    // Shorting
    values.push(`Shorting Enabled: ${config.enableShorting ? 'Yes' : 'No'}`);
    
    // Technical Indicators
    const indicators = config.technicalIndicators || {};
    values.push(`RSI Indicator: ${indicators.rsi?.enabled ? 'Enabled' : 'Disabled'}`);
    values.push(`MACD Indicator: ${indicators.macd?.enabled ? 'Enabled' : 'Disabled'}`);
    
    return values.join('\n');
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
    return `Current strategy "${strategy.strategy_name}" with risk level ${config.riskLevel || 'medium'}, ${config.selectedCoins?.length || 0} coins selected, amount per trade: €${config.perTradeAllocation || 'not set'}, AI signals: ${config.aiIntelligenceConfig?.enableAIOverride ? 'enabled' : 'disabled'}.`;
  }

  static buildInterfaceContext(): string {
    const fieldDescriptions = Object.entries(IntelligentFieldMapper.FIELD_DEFINITIONS)
      .map(([key, field]) => `${field.name}: Located in ${field.uiLocation}`)
      .join('\n');
    
    return `Interface locations:\n${fieldDescriptions}`;
  }
}

class StrategyResolver {
  static async getActiveStrategy(userId: string, testMode: boolean): Promise<any> {
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

class ConfigManager {
  static async getFreshConfig(strategyId: string, userId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('configuration')
        .eq('id', strategyId)
        .eq('user_id', userId)
        .single();
      
      if (error) throw error;
      return data?.configuration || {};
    } catch (error) {
      console.error('Failed to fetch fresh config:', error);
      return {};
    }
  }

  static async updateConfig(strategyId: string, userId: string, updates: any): Promise<boolean> {
    try {
      console.log('🔧 [CONFIG_UPDATE] Starting with validated updates:', JSON.stringify(updates, null, 2));
      
      // Get current config
      const currentConfig = await this.getFreshConfig(strategyId, userId);
      console.log('📖 [CONFIG_UPDATE] Current config:', JSON.stringify(currentConfig, null, 2));
      
      // Deep merge for nested objects like aiIntelligenceConfig
      const newConfig = this.deepMerge(currentConfig, updates);
      console.log('🔀 [CONFIG_UPDATE] Merged config:', JSON.stringify(newConfig, null, 2));
      
      // Update database
      const { data, error } = await supabase
        .from('trading_strategies')
        .update({ configuration: newConfig })
        .eq('id', strategyId)
        .eq('user_id', userId)
        .select('configuration')
        .single();
      
      if (error) {
        console.error('❌ [CONFIG_UPDATE] DB update failed:', error);
        return false;
      }
      
      // CRITICAL: Verify the update was actually persisted
      const verificationConfig = await this.getFreshConfig(strategyId, userId);
      console.log('✅ [CONFIG_UPDATE] Verification read-back:', JSON.stringify(verificationConfig, null, 2));
      
      // Verify ONLY the canonical AI flag (aiIntelligenceConfig.enableAIOverride)
      const verificationsToCheck = [
        { field: 'aiIntelligenceConfig.enableAIOverride', expected: updates.aiIntelligenceConfig?.enableAIOverride, actual: verificationConfig.aiIntelligenceConfig?.enableAIOverride }
      ];
      
      for (const check of verificationsToCheck) {
        if (check.expected !== undefined && check.actual !== check.expected) {
          console.error(`❌ [CONFIG_UPDATE] VERIFICATION FAILED for ${check.field}: expected ${check.expected}, got ${check.actual}`);
          return false;
        }
      }
      
      console.log('✅ [CONFIG_UPDATE] All verifications passed - update confirmed persisted');
      return true;
    } catch (error) {
      console.error('❌ [CONFIG_UPDATE] Failed to update config:', error);
      return false;
    }
  }

  // Deep merge utility to handle nested objects properly
  static deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
}

class WelcomeMessageGenerator {
  static generate(strategy: any, testMode: boolean): string {
    const mode = testMode ? 'Test Mode' : 'Live Mode';
    
    if (!strategy) {
      return `🤖 **AI Trading Assistant Ready** (${mode})

I'm here to help you create and manage your cryptocurrency trading strategies. 

**What I can help with:**
• Create new trading strategies
• Explain crypto concepts and indicators  
• Analyze market conditions
• Configure risk settings

How can I assist you today?`;
    }

    const config = strategy.configuration || {};
    const coins = config.selectedCoins?.length || 0;
    const riskLevel = config.riskLevel || 'medium';
    
    return `🤖 **AI Trading Assistant Ready** (${mode})

Currently managing your **${strategy.strategy_name}** strategy:
• **Risk Level:** ${riskLevel}
• **Coins:** ${coins} selected
• **Per Trade:** €${config.perTradeAllocation || 'Not set'}

I can help you adjust settings, explain market conditions, or answer any trading questions. What would you like to know?`;
  }
}

function generateSuccessMessage(configUpdates: any, testMode: boolean): string {
  const updates = Object.entries(configUpdates).map(([key, value]) => {
    switch (key) {
      case 'perTradeAllocation':
        return `• **Amount per trade:** €${value}`;
      case 'riskLevel':
        return `• **Risk level:** ${value}`;
      case 'stopLossPercentage':
        return `• **Stop loss:** ${value}%`;
      case 'takeProfitPercentage':
        return `• **Take profit:** ${value}%`;
      case 'selectedCoins':
        return `• **Selected coins:** ${Array.isArray(value) ? value.join(', ') : value}`;
      case 'aiIntelligenceConfig':
        return `• **AI decision override:** ${value?.enableAIOverride ? 'enabled' : 'disabled'}`;
      default:
        // Handle object values properly to avoid [object Object]
        if (typeof value === 'object' && value !== null) {
          return `• **${key}:** ${JSON.stringify(value)}`;
        }
        return `• **${key}:** ${value}`;
    }
  });

  return `✅ **Configuration Updated Successfully**

**Changes applied:**
${updates.join('\n')}

${testMode ? '🧪 Changes applied to Test Mode strategy.' : '🔴 Changes applied to Live Mode strategy.'}`;
}

serve(async (req) => {
  console.log('🚀 AI_ASSISTANT: Function started');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('📥 AI_ASSISTANT: Parsing request body');
    const requestBody = await req.json();
    console.log('📋 AI_ASSISTANT: Request data:', requestBody);
    
    const {
      message,
      userId,
      strategyId,
      testMode = true,
      currentConfig = {},
      recentTrades = [],
      marketData = {},
      indicatorContext = {},
      indicatorConfig = {}
    } = requestBody;

    if (!message || !userId) {
      console.log('❌ AI_ASSISTANT: Missing required fields');
      return new Response(
        JSON.stringify({ 
          error: 'Missing required fields: message and userId',
          hasConfigUpdates: false,
          verificationResults: { success: false, errors: ['Invalid request'] }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`🤖 AI_ASSISTANT: Request received: "${message}" | StrategyId: ${strategyId} | TestMode: ${testMode}`);

    // Store user message in conversation history
    await ConversationMemory.storeMessage(userId, 'user', message, { strategyId, testMode });

    // Get conversation context
    const conversationHistory = await ConversationMemory.getRecentContext(userId, 5);

    // Fetch strategy
    const strategy = await StrategyResolver.getActiveStrategy(userId, testMode);
    console.log(strategy ? `✅ STRATEGY_RESOLVER: ${strategy.strategy_name}` : `❌ No active strategy`);

    // Get fresh config
    const freshConfig = strategy ? await ConfigManager.getFreshConfig(strategy.id, userId) : {};

    // Handle system health check
    if (message.toLowerCase().includes('system health check')) {
      const welcomeMessage = WelcomeMessageGenerator.generate(strategy, testMode);
      
      await ConversationMemory.storeMessage(userId, 'ai', welcomeMessage, { 
        type: 'welcome',
        strategyId: strategy?.id 
      });

      return new Response(
        JSON.stringify({
          message: welcomeMessage,
          hasConfigUpdates: false,
          verificationResults: { success: true, errors: [] }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // All configuration updates are now handled by the CryptoIntelligenceEngine
    // which includes proper intent detection and validation

    // For complex queries, use crypto intelligence engine with external signals
    console.log(`🧠 Using Crypto Intelligence Engine for: "${message}"`);

    // Gather external signals and context
    const [whaleAlerts, cryptoNews, liveSignals] = await Promise.all([
      ExternalSignalIntegration.getWhaleAlerts(5),
      ExternalSignalIntegration.getCryptoNews(3),
      ExternalSignalIntegration.getLiveSignals(freshConfig.selectedCoins || [])
    ]);

    // Generate intelligent response with the upgraded engine
    const intelligentResponse = await CryptoIntelligenceEngine.generateContextualResponse(
      message, 
      strategy, 
      liveSignals, 
      cryptoNews,
      conversationHistory,
      freshConfig
    );

    let finalMessage = intelligentResponse.message;
    let hasConfigUpdates = false;
    let finalConfigUpdates = {};

    // Handle configuration updates if present
    if (intelligentResponse.configUpdates && Object.keys(intelligentResponse.configUpdates).length > 0) {
      console.log(`🔄 CONFIG_UPDATE: Applying validated updates:`, intelligentResponse.configUpdates);
      
      const success = await ConfigManager.updateConfig(strategy.id, userId, intelligentResponse.configUpdates);
      
      if (success) {
        hasConfigUpdates = true;
        finalConfigUpdates = intelligentResponse.configUpdates;
        
        // Generate success message ONLY after successful database update
        finalMessage = generateSuccessMessage(intelligentResponse.configUpdates, testMode);
        
        // Store successful config update in conversation history
        await ConversationMemory.storeMessage(userId, 'ai', finalMessage, { 
          type: 'config_update_success',
          updates: intelligentResponse.configUpdates,
          strategyId: strategy.id 
        });
      } else {
        // Database update failed - override any success message from AI
        finalMessage = "❌ **Configuration Update Failed**\n\nI tried to update your strategy configuration, but the database operation failed. Please try again or check your connection.";
        
        // Store the failure in conversation history  
        await ConversationMemory.storeMessage(userId, 'ai', finalMessage, { 
          type: 'config_update_failed',
          attempted_updates: intelligentResponse.configUpdates,
          strategyId: strategy.id 
        });
      }
    } else {
      // Store regular AI response in conversation history
      await ConversationMemory.storeMessage(userId, 'ai', finalMessage, { 
        type: 'intelligent_response',
        signals_used: liveSignals.length,
        news_used: cryptoNews.length,
        strategyId: strategy?.id 
      });
    }

    console.log(`📝 AI_ASSISTANT: Response generated - Config updates: ${hasConfigUpdates}`);

    return new Response(
      JSON.stringify({
        message: finalMessage,
        hasConfigUpdates,
        configUpdates: hasConfigUpdates ? finalConfigUpdates : undefined,
        verificationResults: { success: true, errors: [] }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ AI_ASSISTANT: Caught error:', error);
    console.error('❌ AI_ASSISTANT: Error stack:', error.stack);
    
    // Return a safe fallback response
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: `🔧 **System Recovery Mode**\n\nI'm experiencing technical difficulties with: ${error.message}\n\nPlease try a simple command like "system health check" while I recover.`,
        hasConfigUpdates: false,
        verificationResults: { success: false, errors: [error.message] }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});