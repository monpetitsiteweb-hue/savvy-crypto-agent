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
    'maxWalletExposure': {
      name: 'Max Wallet Exposure',
      description: 'Maximum percentage of wallet to use for this strategy',
      type: 'number',
      uiLocation: 'Strategy Configuration → Coins & Amounts → Max Wallet Exposure',
      examples: ['wallet exposure 80%', 'limit exposure to 60%', 'use 90% of wallet']
    },

    // === BUY/SELL SETTINGS ===
    'buyFrequency': {
      name: 'Buy Frequency',
      description: 'How often the strategy should execute buy orders',
      type: 'enum',
      values: ['once', 'daily', 'interval', 'signal_based'],
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Buy Frequency',
      examples: ['buy frequency signal based', 'buy once daily', 'buy on signals only', 'interval buying']
    },
    'buyOrderType': {
      name: 'Buy Order Type',
      description: 'Type of buy orders to use: market, limit, or trailing',
      type: 'enum',
      values: ['market', 'limit', 'trailing_buy'],
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Buy Order Type',
      examples: ['use market orders', 'limit orders only', 'trailing buy orders']
    },
    'trailingBuyPercentage': {
      name: 'Trailing Buy %',
      description: 'Percentage for trailing buy orders to optimize entry points',
      type: 'number',
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Trailing Buy %',
      examples: ['set trailing buy to 1%', 'trailing buy percentage 2', 'use 1.5% for trailing buys']
    },
    'buyCooldownMinutes': {
      name: 'Buy Cooldown',
      description: 'Minutes to wait between buy attempts',
      type: 'number',
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Buy Cooldown',
      examples: ['buy cooldown 60 minutes', 'wait 30 minutes between buys', 'cooldown 90 minutes']
    },
    'sellOrderType': {
      name: 'Sell Order Type',
      description: 'Type of sell orders to use: market, limit, trailing_stop, or auto_close',
      type: 'enum',
      values: ['market', 'limit', 'trailing_stop', 'auto_close'],
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Sell Order Type',
      examples: ['use limit sells', 'market sell orders', 'trailing stop sells']
    },
    'useTrailingStopOnly': {
      name: 'Use Trailing Stop Only',
      description: 'Only use trailing stop losses instead of fixed stop losses',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Use Trailing Stop Only',
      examples: ['use trailing stop only', 'enable trailing stop only mode', 'trailing stop only']
    },
    'trailingStopLossPercentage': {
      name: 'Trailing Stop Loss %',
      description: 'Percentage for trailing stop loss orders',
      type: 'number',
      uiLocation: 'Strategy Configuration → Buy/Sell Settings → Trailing Stop Loss %',
      examples: ['trailing stop loss 2%', 'set trailing stop to 1.5%', 'trail stops at 3%']
    },

    // === RISK MANAGEMENT ===
    'riskProfile': {
      name: 'Risk Profile',
      description: 'Overall risk tolerance: low, medium, or high',
      type: 'enum',
      values: ['low', 'medium', 'high'],
      uiLocation: 'Strategy Configuration → Risk Management → Risk Profile',
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
    'maxPositionSize': {
      name: 'Maximum Position Size',
      description: 'Maximum total amount to invest in any single cryptocurrency',
      type: 'number',
      uiLocation: 'Strategy Configuration → Risk Management → Max Position Size',
      examples: ['max position 5000', 'limit exposure to 3000', 'cap investment at 10000']
    },
    'dailyLossLimit': {
      name: 'Daily Loss Limit',
      description: 'Maximum amount willing to lose in a single day',
      type: 'number',
      uiLocation: 'Strategy Configuration → Risk Management → Daily Loss Limit',
      examples: ['daily loss limit 500', 'limit daily losses to 300', 'daily loss cap 1000']
    },
    'dailyProfitTarget': {
      name: 'Daily Profit Target',
      description: 'Target profit amount for a single day',
      type: 'number',
      uiLocation: 'Strategy Configuration → Risk Management → Daily Profit Target',
      examples: ['daily profit target 100', 'aim for 200 euros daily', 'profit goal 150']
    },
    'maxOpenPositions': {
      name: 'Max Open Positions',
      description: 'Maximum number of open positions at any time',
      type: 'number',
      uiLocation: 'Strategy Configuration → Risk Management → Max Open Positions',
      examples: ['max 5 positions', 'limit open positions to 8', 'allow 10 open trades']
    },
    'resetStopLossAfterFail': {
      name: 'Reset Stop Loss After Fail',
      description: 'Reset stop-loss to original level if it fails to execute',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Risk Management → Reset Stop Loss After Fail',
      examples: ['reset stops if they fail', 'retry failed stop orders', 'reset stop loss after fail']
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
    'dcaIntervalHours': {
      name: 'DCA Interval Hours',
      description: 'Hours between DCA steps',
      type: 'number',
      uiLocation: 'Strategy Configuration → DCA & Advanced → DCA Interval Hours',
      examples: ['DCA every 6 hours', 'interval 12 hours', 'space DCA 24 hours apart']
    },

    // === SHORTING ===
    'enableShorting': {
      name: 'Enable Shorting',
      description: 'Allow short selling to profit from price declines',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Shorting → Enable Shorting',
      examples: ['enable shorting', 'allow short selling', 'disable shorts', 'turn on short positions']
    },
    'maxShortPositions': {
      name: 'Max Short Positions',
      description: 'Maximum number of short positions allowed',
      type: 'number',
      uiLocation: 'Strategy Configuration → Shorting → Max Short Positions',
      examples: ['max 2 shorts', 'allow 3 short positions', 'limit shorts to 1']
    },
    'shortingMinProfitPercentage': {
      name: 'Minimum Short Profit %',
      description: 'Minimum profit percentage required for short positions',
      type: 'number',
      uiLocation: 'Strategy Configuration → Shorting → Min Profit %',
      examples: ['short profit 1.5%', 'minimum short gain 2%', 'short target 3%']
    },
    'autoCloseShorts': {
      name: 'Auto Close Shorts',
      description: 'Automatically close short positions after specified time',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Shorting → Auto Close Shorts',
      examples: ['auto close shorts', 'close shorts automatically', 'disable auto close shorts']
    },

    // === NOTIFICATIONS ===
    'notifyOnTrade': {
      name: 'Trade Notifications',
      description: 'Get notified when trades are executed',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Notifications → Trade Notifications',
      examples: ['enable trade notifications', 'notify on trades', 'disable trade alerts']
    },
    'notifyOnError': {
      name: 'Error Notifications',
      description: 'Get notified when trading errors occur',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Notifications → Error Notifications',
      examples: ['notify on errors', 'enable error alerts', 'disable error notifications']
    },
    'notifyOnTargets': {
      name: 'Target Notifications',
      description: 'Get notified when profit or loss targets are hit',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Notifications → Target Notifications',
      examples: ['notify on targets', 'enable target alerts', 'disable target notifications']
    },

    // === AI INTELLIGENCE CONFIG ===
    'aiIntelligenceConfig.enableAIOverride': {
      name: 'Enable AI',
      description: 'Enable AI-powered trading decisions and market analysis',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → AI Intelligence → Enable AI',
      examples: ['enable AI', 'turn on AI intelligence', 'use AI signals', 'disable AI', 'AI on', 'AI off']
    },
    'aiIntelligenceConfig.aiAutonomyLevel': {
      name: 'AI Autonomy Level',
      description: 'Level of autonomy for AI decision making (0-100)',
      type: 'number',
      uiLocation: 'Strategy Configuration → AI Intelligence → AI Autonomy Level',
      examples: ['set AI autonomy to 90%', 'AI autonomy level 50', 'autonomy 75%', 'AI control 60%']
    },
    'aiIntelligenceConfig.aiConfidenceThreshold': {
      name: 'AI Confidence Threshold',
      description: 'Minimum confidence level required for AI to make decisions',
      type: 'number',
      uiLocation: 'Strategy Configuration → AI Intelligence → Confidence Threshold',
      examples: ['confidence threshold 80%', 'AI confidence 70%', 'require 90% confidence']
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
    'technicalIndicators.ema.enabled': {
      name: 'EMA Indicator',
      description: 'Exponential Moving Average for trend following',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → Technical Analysis → EMA',
      examples: ['enable EMA', 'turn on exponential moving average', 'disable EMA', 'use trend following']
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
- strategyName: "change name to X", "rename strategy" (string)
- riskProfile: "set risk to high/medium/low", "conservative/aggressive approach" (values: high, medium, low)
- perTradeAllocation: "trade 1000 euros", "amount per trade", "allocation 500" (number)
- maxActiveCoins: "max 5 coins", "limit to 3 cryptocurrencies" (number 1-20)
- maxWalletExposure: "wallet exposure 80%", "exposure limit 60%" (number 0-100)

BUY/SELL SETTINGS:
- buyFrequency: "buy frequency signal based", "buy once daily", "signal based buying" (values: once, daily, interval, signal_based)
- trailingBuyPercentage: "trailing buy 1.5%", "set trailing buy to 2%" (number)
- buyCooldownMinutes: "buy cooldown 60 minutes", "wait 30 minutes between buys", "trade cooldown 10 minutes" (number)
- useTrailingStopOnly: "use trailing stop only", "trailing stop only mode" (boolean)
- trailingStopLossPercentage: "trailing stop loss 2%", "trail stops at 1.5%" (number)

RISK MANAGEMENT:
- stopLossPercentage: "stop loss 5%", "cut losses at 3%" (number 0.1-50)
- takeProfitPercentage: "take profit 10%", "profit target 15%" (number 1-1000)
- maxPositionSize: "max position 5000", "position limit 3000" (number)
- dailyLossLimit: "daily loss limit 500", "limit daily losses to 300" (number)
- dailyProfitTarget: "daily profit target 100", "aim for 200 euros daily" (number)
- maxOpenPositions: "max 5 positions", "limit open positions to 8" (number)
- resetStopLossAfterFail: "reset stops if they fail", "reset stop loss after fail" (boolean)

AI INTELLIGENCE CONFIG (CRITICAL - DO NOT CONFUSE THESE FIELDS):
- aiIntelligenceConfig.enableAIOverride: "enable AI", "turn on AI intelligence", "AI on/off" (boolean) - CONTROLS AI SYSTEM ON/OFF
- aiIntelligenceConfig.aiAutonomyLevel: "AI autonomy 90%", "set autonomy to 75", "autonomy level 80", "AI control level" (number 0-100) - ONLY SETS AUTONOMY LEVEL
- aiIntelligenceConfig.aiConfidenceThreshold: "confidence threshold 80%", "AI confidence 70%" (number 0-100) - ONLY SETS CONFIDENCE

NOTIFICATIONS:
- notifyOnTrade: "notify on trades", "enable trade notifications", "disable trade alerts" (boolean)
- notifyOnError: "notify on errors", "enable error alerts", "disable error notifications" (boolean)
- notifyOnTargets: "notify on targets", "enable target alerts", "disable target notifications" (boolean)
- ALL notifications: "disable notifications", "enable all notifications" → affects all 3 notification fields

COINS & AMOUNTS:
- selectedCoins: "add BTC ETH", "use only XRP ADA", "trade these coins: BTC, ETH" (array)

DCA & ADVANCED:
- enableDCA: "enable DCA", "use dollar cost averaging" (boolean)
- dcaSteps: "DCA steps 5", "averaging in 3 steps" (number)
- dcaIntervalHours: "DCA every 6 hours", "interval 12 hours" (number)

SHORTING:
- enableShorting: "enable shorting", "allow short selling" (boolean)
- maxShortPositions: "max 2 shorts", "allow 3 short positions" (number)
- shortingMinProfitPercentage: "short profit 1.5%", "minimum short gain 2%" (number)
- autoCloseShorts: "auto close shorts", "close shorts automatically" (boolean)

TECHNICAL INDICATORS (nested):
- technicalIndicators.rsi.enabled: "enable RSI", "use RSI indicator" (boolean)
- technicalIndicators.macd.enabled: "enable MACD", "turn on MACD" (boolean)
- technicalIndicators.ema.enabled: "enable EMA", "turn on EMA" (boolean)

CRITICAL RULES - NEVER VIOLATE THESE:
1. Setting "AI autonomy" ONLY sets aiIntelligenceConfig.aiAutonomyLevel - NEVER touches aiIntelligenceConfig.enableAIOverride
2. Setting "confidence threshold" ONLY sets aiIntelligenceConfig.aiConfidenceThreshold - NEVER touches other AI fields
3. When user says "disable notifications", set ALL THREE notification fields to false
4. When user says "enable notifications", set ALL THREE notification fields to true
5. resetStopLossAfterFail is a valid field that exists in the system
6. Use riskProfile not riskLevel for risk settings
7. buyCooldownMinutes is for "trade cooldown" or "buy cooldown" settings
8. takeProfitPercentage is the correct field for take profit settings
9. AUTONOMY and OVERRIDE are DIFFERENT - autonomy level changes do NOT affect override settings
10. ONLY USE aiIntelligenceConfig.enableAIOverride for AI enablement - NEVER use is_ai_enabled or ai_override_enabled

Return ONLY a JSON object with field paths and values. For nested fields use dot notation.
Examples:
- "Enable AI" → {"aiIntelligenceConfig.enableAIOverride": true}
- "Set AI autonomy to 90%" → {"aiIntelligenceConfig.aiAutonomyLevel": 90}
- "Set autonomy level to 80%" → {"aiIntelligenceConfig.aiAutonomyLevel": 80}
- "AI autonomy 75%" → {"aiIntelligenceConfig.aiAutonomyLevel": 75}
- "Confidence threshold 80%" → {"aiIntelligenceConfig.aiConfidenceThreshold": 80}
- "Trailing buy 1.5%" → {"trailingBuyPercentage": 1.5}
- "Disable notifications" → {"notifyOnTrade": false, "notifyOnError": false, "notifyOnTargets": false}
- "Reset stop loss after fail" → {"resetStopLossAfterFail": true}

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
        console.log('🤖 AI FIELD MAPPING RAW RESPONSE:', JSON.stringify(aiUpdates, null, 2));
        
        // CRITICAL: Check if this is an autonomy-only request BEFORE processing any fields
        const isAutonomyOnlyRequest = message.toLowerCase().match(/(?:set\s+)?(?:ai\s+)?(?:autonomy|control).*?(\d+)/i) && 
          !message.toLowerCase().match(/\b(enable|disable|turn\s+(?:on|off))\s+(?:ai|artificial intelligence)\b/i);
        
        console.log(`🎯 AUTONOMY CHECK: isAutonomyOnlyRequest = ${isAutonomyOnlyRequest}`);
        console.log(`🎯 AUTONOMY CHECK: message = "${message}"`);
        
        if (isAutonomyOnlyRequest) {
          console.log('🚨 AUTONOMY-ONLY REQUEST DETECTED: Completely filtering OpenAI response to ONLY autonomy fields');
          console.log('🚨 BEFORE CLEANUP - aiUpdates:', JSON.stringify(aiUpdates));
          
          // COMPLETELY REPLACE aiUpdates with ONLY autonomy-related fields
          const autonomyValue = aiUpdates['aiIntelligenceConfig.aiAutonomyLevel'] || 
                              aiUpdates.aiIntelligenceConfig?.aiAutonomyLevel;
          
          if (autonomyValue !== undefined) {
            const cleanedUpdates = {
              'aiIntelligenceConfig.aiAutonomyLevel': autonomyValue
            };
            // COMPLETELY REPLACE the aiUpdates object
            Object.keys(aiUpdates).forEach(key => delete aiUpdates[key]);
            Object.assign(aiUpdates, cleanedUpdates);
            console.log('🚨 COMPLETELY REPLACED aiUpdates with autonomy-only fields:', JSON.stringify(aiUpdates));
          } else {
            console.log('⚠️ No autonomy value found in OpenAI response, keeping original but removing enable flags');
            // Remove any AI enable/disable flags
            delete aiUpdates['aiIntelligenceConfig.enableAIOverride'];
            if (aiUpdates.aiIntelligenceConfig?.enableAIOverride !== undefined) {
              console.log(`🚫 REMOVING enableAIOverride = ${aiUpdates.aiIntelligenceConfig.enableAIOverride} from OpenAI response`);
              delete aiUpdates.aiIntelligenceConfig.enableAIOverride;
            }
          }
          
          console.log('🚨 AFTER CLEANUP - aiUpdates:', JSON.stringify(aiUpdates));
        }
        
        // Handle nested field updates (like aiIntelligenceConfig.*)
        for (const [fieldPath, value] of Object.entries(aiUpdates)) {
          console.log(`🔧 PROCESSING FIELD: ${fieldPath} = ${value}`);
          
          if (fieldPath.includes('.')) {
            const parts = fieldPath.split('.');
            if (parts[0] === 'aiIntelligenceConfig') {
              if (!updates.aiIntelligenceConfig) updates.aiIntelligenceConfig = {};
              
              // CRITICAL: Double-check for autonomy-only requests
              if (parts[1] === 'enableAIOverride' && isAutonomyOnlyRequest) {
                console.log(`🚫 BLOCKING enableAIOverride = ${value} in autonomy-only request`);
                continue; // Skip this field
              }
              
              updates.aiIntelligenceConfig[parts[1]] = value;
              console.log(`🧠 AI CONFIG SET: ${parts[1]} = ${value}`);
            } else if (parts[0] === 'technicalIndicators') {
              if (!updates.technicalIndicators) updates.technicalIndicators = {};
              if (!updates.technicalIndicators[parts[1]]) updates.technicalIndicators[parts[1]] = {};
              updates.technicalIndicators[parts[1]][parts[2]] = value;
            }
          } else {
            // CRITICAL: Log any potential deprecated field usage
            if (fieldPath === 'is_ai_enabled' || fieldPath === 'ai_override_enabled') {
              console.log(`🚨 DEPRECATED FIELD DETECTED: ${fieldPath} = ${value} - THIS SHOULD NOT HAPPEN!`);
              throw new Error(`Deprecated field ${fieldPath} should not be used. Use aiIntelligenceConfig.enableAIOverride instead.`);
            }
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
    
    // AI Autonomy Level - CRITICAL: Process autonomy FIRST to prevent other AI patterns from interfering
    const autonomyMatch = message.match(/(?:set\s+)?(?:ai\s+)?(?:autonomy|control).*?(\d+)/i);
    if (autonomyMatch) {
      const level = parseInt(autonomyMatch[1]);
      if (level >= 0 && level <= 100) {
        if (!updates.aiIntelligenceConfig) updates.aiIntelligenceConfig = {};
        updates.aiIntelligenceConfig.aiAutonomyLevel = level;
        console.log(`🎯 AI AUTONOMY ONLY: Setting autonomy to ${level}% - BLOCKING all other AI patterns`);
        
        // CRITICAL: REMOVE any AI enable/disable flags that might have been set by OpenAI mapping
        delete updates.is_ai_enabled;
        delete updates.ai_override_enabled;
        delete updates.enableAI;
        if (updates.aiIntelligenceConfig.enableAIOverride !== undefined) {
          delete updates.aiIntelligenceConfig.enableAIOverride;
          console.log('🚫 AUTONOMY: Removed enableAIOverride to prevent AI disable');
        }
        
        console.log(`✅ AI AUTONOMY: Final updates - ${JSON.stringify(updates)}`);
        // EARLY RETURN - Don't process any other AI patterns when setting autonomy
        return updates;
      }
    }

    // AI Intelligence Config - Use proper field names (SINGLE SOURCE OF TRUTH) 
    // ONLY process enable/disable if NOT setting autonomy level
    if (lowerMessage.match(/\b(enable|turn on|activate)\s+(ai|artificial intelligence)\b/) && 
        !lowerMessage.match(/autonomy/i)) {
      if (!updates.aiIntelligenceConfig) updates.aiIntelligenceConfig = {};
      updates.aiIntelligenceConfig.enableAIOverride = true;
      console.log('🤖 AI ENABLE: Setting aiIntelligenceConfig.enableAIOverride = true');
    }
    if (lowerMessage.match(/\b(disable|turn off|deactivate)\s+(ai|artificial intelligence)\b/) && 
        !lowerMessage.match(/autonomy/i)) {
      if (!updates.aiIntelligenceConfig) updates.aiIntelligenceConfig = {};
      updates.aiIntelligenceConfig.enableAIOverride = false;
      console.log('🤖 AI DISABLE: Setting aiIntelligenceConfig.enableAIOverride = false');
    }

    // AI Confidence Threshold - CRITICAL: Only set confidence, never touch other AI flags  
    const confidenceMatch = message.match(/(?:confidence|threshold).*?(\d+)/i);
    if (confidenceMatch && !autonomyMatch) { // Don't interfere with autonomy
      const threshold = parseInt(confidenceMatch[1]);
      if (threshold >= 0 && threshold <= 100) {
        if (!updates.aiIntelligenceConfig) updates.aiIntelligenceConfig = {};
        updates.aiIntelligenceConfig.aiConfidenceThreshold = threshold;
        console.log(`🎯 AI CONFIDENCE: Setting confidence to ${threshold}% without touching AI enable flags`);
        console.log(`🔍 AI CONFIDENCE: Before cleanup - updates keys: ${Object.keys(updates).join(', ')}`);
        
        // REMOVE any unwanted AI flags that might have been set by OpenAI mapping
        delete updates.is_ai_enabled;
        delete updates.ai_override_enabled;
        delete updates.enableAI;
        
        console.log(`🔍 AI CONFIDENCE: After cleanup - updates keys: ${Object.keys(updates).join(', ')}`);
        console.log(`🔍 AI CONFIDENCE: aiIntelligenceConfig contents: ${JSON.stringify(updates.aiIntelligenceConfig)}`);
      }
    }

    // Notifications - handle "disable notifications" as special case
    if (lowerMessage.includes('disable notifications') || lowerMessage.includes('turn off notifications')) {
      updates.notifyOnTrade = false;
      updates.notifyOnError = false;
      updates.notifyOnTargets = false;
    } else if (lowerMessage.includes('enable notifications') || lowerMessage.includes('turn on notifications')) {
      updates.notifyOnTrade = true;
      updates.notifyOnError = true;
      updates.notifyOnTargets = true;
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

    // Reset Stop Loss After Fail
    if (lowerMessage.includes('reset stop loss after fail') || lowerMessage.includes('reset stops if they fail')) {
      updates.resetStopLossAfterFail = true;
    }

    // Risk profile mapping (use riskProfile not riskLevel)
    if (lowerMessage.includes('risk')) {
      if (lowerMessage.includes('high') || lowerMessage.includes('aggressive')) {
        updates.riskProfile = 'high';
      } else if (lowerMessage.includes('low') || lowerMessage.includes('conservative')) {
        updates.riskProfile = 'low';
      } else if (lowerMessage.includes('medium') || lowerMessage.includes('moderate')) {
        updates.riskProfile = 'medium';
      }
    }

    // Buy frequency
    if (lowerMessage.includes('buy frequency') || lowerMessage.includes('buy on signals')) {
      if (lowerMessage.includes('signal') || lowerMessage.includes('signals')) {
        updates.buyFrequency = 'signal_based';
      } else if (lowerMessage.includes('daily')) {
        updates.buyFrequency = 'daily';
      } else if (lowerMessage.includes('once')) {
        updates.buyFrequency = 'once';
      } else if (lowerMessage.includes('interval')) {
        updates.buyFrequency = 'interval';
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

    // Trade Cooldown (Minutes) - Fix field mapping
    const cooldownMatch = message.match(/(?:trade\s+)?cooldown.*?(\d+)/i);
    if (cooldownMatch) {
      const minutes = parseInt(cooldownMatch[1]);
      if (minutes >= 1 && minutes <= 1440) { // 1 minute to 24 hours
        updates.buyCooldownMinutes = minutes;
        console.log(`🕐 TRADE COOLDOWN: Setting buyCooldownMinutes to ${minutes}`);
      }
    }

    // Stop loss and take profit
    const percentageMatch = message.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentageMatch) {
      const percentage = parseFloat(percentageMatch[1]);
      if (lowerMessage.includes('stop') && lowerMessage.includes('loss')) {
        if (percentage > 0 && percentage <= 50) {
          updates.stopLossPercentage = percentage;
          console.log(`🛑 STOP LOSS: Setting stopLossPercentage to ${percentage}%`);
        }
      } else if (lowerMessage.includes('take') && (lowerMessage.includes('profit') || lowerMessage.includes('gain'))) {
        if (percentage > 0 && percentage <= 1000) {
          updates.takeProfitPercentage = percentage;
          console.log(`🎯 TAKE PROFIT: Setting takeProfitPercentage to ${percentage}%`);
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

    // FINAL CLEANUP: Remove ALL deprecated fields to ensure single source of truth
    delete updates.is_ai_enabled;
    delete updates.ai_override_enabled;
    delete updates.enableAI;
    
    console.log('🔍 FINAL UPDATES BEFORE CLEANUP:', JSON.stringify(updates, null, 2));
    console.log('🧹 FINAL CLEANUP: Removing all deprecated AI fields');
    console.log('🔍 FINAL UPDATES AFTER CLEANUP:', JSON.stringify(updates, null, 2));

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
    
    // Special handling for aiIntelligenceConfig - compare individual nested fields
    if (field === 'aiIntelligenceConfig') {
      const currentAiConfig = currentValue || {};
      const newAiConfig = newValue || {};
      
      // CRITICAL: Special autonomy-only validation
      if (Object.keys(newAiConfig).length === 1 && newAiConfig.aiAutonomyLevel !== undefined) {
        const currentAutonomyLevel = currentAiConfig.aiAutonomyLevel;
        if (currentAutonomyLevel === newAiConfig.aiAutonomyLevel) {
          return {
            isValid: true,
            needsUpdate: false,
            message: `No change needed — AI Autonomy Level is already set to ${newAiConfig.aiAutonomyLevel}%.`
          };
        } else {
          return {
            isValid: true,
            needsUpdate: true,
            message: `✅ Strategy updated: AI Autonomy Level = ${newAiConfig.aiAutonomyLevel}%`
          };
        }
      }
      
      // Check each nested field individually
      let hasChanges = false;
      const changes = [];
      
      for (const [aiField, aiValue] of Object.entries(newAiConfig)) {
        if (currentAiConfig[aiField] !== aiValue) {
          hasChanges = true;
          changes.push(`${aiField}: ${currentAiConfig[aiField]} → ${aiValue}`);
        }
      }
      
      if (!hasChanges) {
        // Find which field was actually requested to provide better message
        if (newAiConfig.aiAutonomyLevel !== undefined) {
          return {
            isValid: true,
            needsUpdate: false,
            message: `No change needed — AI Autonomy Level is already set to ${newAiConfig.aiAutonomyLevel}%.`
          };
        } else if (newAiConfig.aiConfidenceThreshold !== undefined) {
          return {
            isValid: true,
            needsUpdate: false,
            message: `No change needed — AI Confidence Threshold is already set to ${newAiConfig.aiConfidenceThreshold}%.`
          };
        }
        return {
          isValid: true,
          needsUpdate: false,
          message: `No change needed — AI intelligence settings are already configured as requested.`
        };
      }
      
      return {
        isValid: true,
        needsUpdate: true,
        message: `✅ Updated AI intelligence configuration: ${changes.join(', ')}.`
      };
    }
    
    // Check if value is actually changing for non-nested fields
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
    
    console.log(`🎯 POTENTIAL UPDATES FROM MAPPER:`, JSON.stringify(potentialUpdates, null, 2));
    
    if (Object.keys(potentialUpdates).length === 0) {
      // No clear config intent - use general AI response
      return { message: await this.handleGeneralIntent(message, strategy, marketContext, memoryContext, interfaceContext) };
    }
    
    // 🚨 CRITICAL: Check if this is autonomy-only BEFORE validation
    const isAutonomyOnlyUpdate = Object.keys(potentialUpdates).length === 1 && 
      potentialUpdates.aiIntelligenceConfig && 
      Object.keys(potentialUpdates.aiIntelligenceConfig).length === 1 && 
      potentialUpdates.aiIntelligenceConfig.aiAutonomyLevel !== undefined;
    
    console.log(`🎯 AUTONOMY-ONLY UPDATE CHECK: ${isAutonomyOnlyUpdate}`);
    if (isAutonomyOnlyUpdate) {
      console.log(`🎯 AUTONOMY VALUE: ${potentialUpdates.aiIntelligenceConfig.aiAutonomyLevel}`);
      console.log('🚨 AUTONOMY-ONLY: This should NEVER modify any enable/disable flags!');
    }
    
    // Validate all potential updates
    const validatedUpdates = {};
    const validationMessages = [];
    
    for (const [field, newValue] of Object.entries(potentialUpdates)) {
      console.log(`🔍 VALIDATING FIELD: ${field} = ${JSON.stringify(newValue)}`);
      const currentValue = currentConfig[field];
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
    
    // 🚨 FINAL AUTONOMY SAFETY CHECK: Ensure no enable/disable flags leaked through
    if (isAutonomyOnlyUpdate && validatedUpdates.aiIntelligenceConfig) {
      console.log('🔍 FINAL AUTONOMY SAFETY CHECK: Inspecting validated updates...');
      console.log(`🔍 Validated aiIntelligenceConfig keys: ${Object.keys(validatedUpdates.aiIntelligenceConfig)}`);
      
      if (validatedUpdates.aiIntelligenceConfig.enableAIOverride !== undefined) {
        console.log(`🚨 LEAK DETECTED! enableAIOverride = ${validatedUpdates.aiIntelligenceConfig.enableAIOverride} found in autonomy-only update!`);
        console.log('🚫 REMOVING enableAIOverride from validated updates');
        delete validatedUpdates.aiIntelligenceConfig.enableAIOverride;
        console.log(`🧹 CLEANED: aiIntelligenceConfig now has keys: ${Object.keys(validatedUpdates.aiIntelligenceConfig)}`);
      }
    }
    
    // Execute validated config updates if any exist
    if (Object.keys(validatedUpdates).length > 0) {
      console.log(`🔄 FINAL PAYLOAD BEFORE DATABASE UPDATE:`, JSON.stringify(validatedUpdates, null, 2));
      
      // 🚨 CRITICAL LOG: Check if enableAIOverride is in the final payload
      if (validatedUpdates.aiIntelligenceConfig?.enableAIOverride !== undefined) {
        console.log(`🚨🚨🚨 CRITICAL BUG: enableAIOverride = ${validatedUpdates.aiIntelligenceConfig.enableAIOverride} is in final payload!`);
        console.log('🚨 This will cause AI to be disabled! Removing it now!');
        delete validatedUpdates.aiIntelligenceConfig.enableAIOverride;
        console.log(`🧹 EMERGENCY CLEANED: Final payload:`, JSON.stringify(validatedUpdates, null, 2));
      }
      
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
    values.push(`Risk Profile: ${config.riskProfile || 'Not set'}`);
    values.push(`Per Trade Allocation: €${config.perTradeAllocation || 'Not set'}`);
    values.push(`Max Active Coins: ${config.maxActiveCoins || 'Not set'}`);
    values.push(`Selected Coins Count: ${config.selectedCoins?.length || 0} coins`);
    values.push(`Max Wallet Exposure: ${config.maxWalletExposure || 'Not set'}%`);
    
    // AI Intelligence Config - USING CORRECT SINGLE SOURCE OF TRUTH
    const aiConfig = config.aiIntelligenceConfig || {};
    values.push(`AI Enabled: ${aiConfig.enableAIOverride ? 'Yes' : 'No'}`);
    values.push(`AI Autonomy Level: ${aiConfig.aiAutonomyLevel !== undefined ? aiConfig.aiAutonomyLevel + '%' : 'Not set'}`);
    values.push(`AI Confidence Threshold: ${aiConfig.aiConfidenceThreshold !== undefined ? aiConfig.aiConfidenceThreshold + '%' : 'Not set'}`);
    values.push(`Risk Override Allowed: ${aiConfig.riskOverrideAllowed ? 'Yes' : 'No'}`);
    
    // Trading Intervals
    values.push(`Trade Cooldown: ${config.buyCooldownMinutes || 'Not set'} minutes`);
    
    // Buy/Sell Settings  
    values.push(`Buy Frequency: ${config.buyFrequency ? config.buyFrequency.replace('_', ' ') : 'Not set'}`);
    values.push(`Trailing Buy Percentage: ${config.trailingBuyPercentage !== undefined ? config.trailingBuyPercentage + '%' : 'Not set'}`);
    values.push(`Buy Cooldown Minutes: ${config.buyCooldownMinutes || 'Not set'}`);
    values.push(`Use Trailing Stop Only: ${config.useTrailingStopOnly ? 'Yes' : 'No'}`);
    values.push(`Trailing Stop Loss Percentage: ${config.trailingStopLossPercentage !== undefined ? config.trailingStopLossPercentage + '%' : 'Not set'}`);
    
    // Risk Management
    values.push(`Stop Loss Percentage: ${config.stopLossPercentage !== undefined ? config.stopLossPercentage + '%' : 'Not set'}`);
    values.push(`Take Profit Percentage: ${config.takeProfitPercentage !== undefined ? config.takeProfitPercentage + '%' : 'Not set'}`);
    values.push(`Max Position Size: €${config.maxPositionSize || 'Not set'}`);
    values.push(`Daily Loss Limit: €${config.dailyLossLimit || 'Not set'}`);
    values.push(`Daily Profit Target: €${config.dailyProfitTarget || 'Not set'}`);
    values.push(`Max Open Positions: ${config.maxOpenPositions || 'Not set'}`);
    values.push(`Reset Stop Loss After Fail: ${config.resetStopLossAfterFail ? 'Yes' : 'No'}`);
    
    // Notifications
    values.push(`Trade Notifications: ${config.notifyOnTrade ? 'Enabled' : 'Disabled'}`);
    values.push(`Error Notifications: ${config.notifyOnError ? 'Enabled' : 'Disabled'}`);
    values.push(`Target Notifications: ${config.notifyOnTargets ? 'Enabled' : 'Disabled'}`);
    
    // Coins
    const selectedCoins = config.selectedCoins || [];
    values.push(`Selected Coins: ${selectedCoins.length > 0 ? selectedCoins.join(', ') : 'None selected'}`);
    
    // DCA
    values.push(`DCA Enabled: ${config.enableDCA ? 'Yes' : 'No'}`);
    values.push(`DCA Steps: ${config.dcaSteps || 'Not set'}`);
    values.push(`DCA Interval Hours: ${config.dcaIntervalHours || 'Not set'}`);
    
    // Shorting
    values.push(`Shorting Enabled: ${config.enableShorting ? 'Yes' : 'No'}`);
    values.push(`Max Short Positions: ${config.maxShortPositions || 'Not set'}`);
    values.push(`Shorting Min Profit %: ${config.shortingMinProfitPercentage !== undefined ? config.shortingMinProfitPercentage + '%' : 'Not set'}`);
    values.push(`Auto Close Shorts: ${config.autoCloseShorts ? 'Yes' : 'No'}`);
    
    // Technical Indicators
    const indicators = config.technicalIndicators || {};
    values.push(`RSI Indicator: ${indicators.rsi?.enabled ? 'Enabled' : 'Disabled'}`);
    values.push(`MACD Indicator: ${indicators.macd?.enabled ? 'Enabled' : 'Disabled'}`);
    values.push(`EMA Indicator: ${indicators.ema?.enabled ? 'Enabled' : 'Disabled'}`);
    
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
    return `Current strategy "${strategy.strategy_name}" with risk profile ${config.riskProfile || 'medium'}, ${config.selectedCoins?.length || 0} coins selected, amount per trade: €${config.perTradeAllocation || 'not set'}, AI: ${config.aiIntelligenceConfig?.enableAIOverride ? 'enabled' : 'disabled'}.`;
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
      
      // 🚨 CRITICAL CHECK: Ensure no enableAIOverride in autonomy-only updates
      if (updates.aiIntelligenceConfig && 
          Object.keys(updates.aiIntelligenceConfig).length === 1 && 
          updates.aiIntelligenceConfig.aiAutonomyLevel !== undefined &&
          updates.aiIntelligenceConfig.enableAIOverride !== undefined) {
        console.log('🚨🚨🚨 CRITICAL ERROR: enableAIOverride found in autonomy-only update! Removing it!');
        delete updates.aiIntelligenceConfig.enableAIOverride;
        console.log('🧹 CLEANED updates:', JSON.stringify(updates, null, 2));
      }
      
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
      
      // Verify key fields were updated correctly
      const verificationsToCheck = [];
      
      // Check top-level fields
      for (const [field, expectedValue] of Object.entries(updates)) {
        if (field !== 'aiIntelligenceConfig') {
          verificationsToCheck.push({ 
            field, 
            expected: expectedValue, 
            actual: verificationConfig[field] 
          });
        }
      }
      
      // Check AI intelligence config fields
      if (updates.aiIntelligenceConfig) {
        console.log(`🔍 AI_CONFIG_VERIFICATION: Checking updates - ${JSON.stringify(updates.aiIntelligenceConfig)}`);
        console.log(`🔍 AI_CONFIG_VERIFICATION: Current config AI section - ${JSON.stringify(verificationConfig.aiIntelligenceConfig)}`);
        
        for (const [aiField, expectedValue] of Object.entries(updates.aiIntelligenceConfig)) {
          const actualValue = verificationConfig.aiIntelligenceConfig?.[aiField];
          console.log(`🔍 AI_CONFIG_VERIFICATION: Field ${aiField} - expected: ${expectedValue}, actual: ${actualValue}`);
          
          verificationsToCheck.push({ 
            field: `aiIntelligenceConfig.${aiField}`, 
            expected: expectedValue, 
            actual: actualValue 
          });
        }
      }
      
      for (const check of verificationsToCheck) {
        if (check.expected !== undefined && JSON.stringify(check.actual) !== JSON.stringify(check.expected)) {
          console.error(`❌ [CONFIG_UPDATE] VERIFICATION FAILED for ${check.field}: expected ${JSON.stringify(check.expected)}, got ${JSON.stringify(check.actual)}`);
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
        // CRITICAL: For aiIntelligenceConfig, preserve existing values and only update specified ones
        if (key === 'aiIntelligenceConfig') {
          result[key] = { ...(target[key] || {}), ...source[key] };
          console.log(`🔀 DEEP_MERGE: AI config merge - target: ${JSON.stringify(target[key])}, source: ${JSON.stringify(source[key])}, result: ${JSON.stringify(result[key])}`);
        } else {
          result[key] = this.deepMerge(target[key] || {}, source[key]);
        }
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
        // Handle AI intelligence config fields properly - NEVER mention override when setting autonomy
        const aiUpdates = [];
        if (value?.aiAutonomyLevel !== undefined) {
          aiUpdates.push(`AI autonomy level: ${value.aiAutonomyLevel}%`);
        }
        if (value?.aiConfidenceThreshold !== undefined) {
          aiUpdates.push(`AI confidence threshold: ${value.aiConfidenceThreshold}%`);
        }
        if (value?.enableAIOverride !== undefined) {
          aiUpdates.push(`AI decision override: ${value.enableAIOverride ? 'enabled' : 'disabled'}`);
        }
        if (value?.riskOverrideAllowed !== undefined) {
          aiUpdates.push(`Risk override: ${value.riskOverrideAllowed ? 'enabled' : 'disabled'}`);
        }
        return aiUpdates.length > 0 ? `• **AI settings:** ${aiUpdates.join(', ')}` : `• **AI settings:** updated`;
      case 'buyCooldownMinutes':
        return `• **Trade cooldown:** ${value} minutes`;
      case 'takeProfitPercentage':
        return `• **Take profit:** ${value}%`;
      default:
        // Handle object values properly to avoid [object Object]
        if (typeof value === 'object' && value !== null) {
          if (Array.isArray(value)) {
            return `• **${key}:** ${value.join(', ')}`;
          }
          // For nested objects, try to extract meaningful info
          const entries = Object.entries(value);
          if (entries.length === 1) {
            const [subKey, subValue] = entries[0];
            return `• **${subKey}:** ${subValue}`;
          }
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

    // If no strategy exists, return early with error message
    if (!strategy) {
      console.log('❌ CRITICAL: No active strategy found - cannot process configuration updates');
      return new Response(JSON.stringify({
        message: "❌ **No Active Strategy Found**\n\nYou need to create and activate a trading strategy before I can help you configure it. Please set up your strategy first.",
        configUpdates: {},
        hasConfigUpdates: false
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

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