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
    // Risk Management
    'riskLevel': {
      name: 'Risk Level',
      description: 'Controls trading aggressiveness: low=conservative, medium=balanced, high=aggressive',
      type: 'enum',
      values: ['low', 'medium', 'high'],
      uiLocation: 'Strategy Configuration → Risk Management tab',
      examples: ['set risk to high', 'make it more aggressive', 'lower my risk', 'conservative approach']
    },
    'perTradeAllocation': {
      name: 'Amount Per Trade',
      description: 'Amount in euros to invest per individual trade',
      type: 'number',
      uiLocation: 'Strategy Configuration → Coins & Amounts tab → "Amount Per Trade" field',
      examples: ['set minimum trade to 500 euros', 'per trade allocation 1000', 'invest 750 per trade']
    },
    'stopLossPercentage': {
      name: 'Stop Loss',
      description: 'Automatically sell if price drops by this percentage to limit losses',
      type: 'number',
      uiLocation: 'Strategy Configuration → Risk Management tab → Stop Loss field',
      examples: ['set stop loss to 3%', 'cut losses at 2%', 'add stop loss protection']
    },
    'takeProfitPercentage': {
      name: 'Take Profit',
      description: 'Automatically sell when profit reaches this percentage to lock in gains',
      type: 'number',
      uiLocation: 'Strategy Configuration → Risk Management tab → Take Profit field',
      examples: ['take profit at 10%', 'secure gains at 15%', 'set profit target']
    },
    'maxPositionSize': {
      name: 'Maximum Position Size',
      description: 'Maximum total amount to invest in any single cryptocurrency',
      type: 'number',
      uiLocation: 'Strategy Configuration → Risk Management tab',
      examples: ['max position 5000', 'limit exposure to 3000', 'cap investment at 10000']
    },
    'selectedCoins': {
      name: 'Selected Cryptocurrencies',
      description: 'Specific cryptocurrencies the strategy will trade',
      type: 'array',
      uiLocation: 'Strategy Configuration → Coins & Amounts tab → Coin selection checkboxes',
      examples: ['only trade BTC and ETH', 'add XRP to my coins', 'remove DOGE from strategy']
    },
    'maxActiveCoins': {
      name: 'Max Active Coins',
      description: 'Maximum number of cryptocurrencies to trade simultaneously',
      type: 'number',
      uiLocation: 'Strategy Configuration → Coins & Amounts tab → "Max Active Coins" field',
      examples: ['set max active coins to 5', 'limit to 3 coins', 'trade up to 8 cryptocurrencies']
    },
    'enableAI': {
      name: 'AI Intelligence',
      description: 'Enable AI-powered signals and analysis for trading decisions',
      type: 'boolean',
      uiLocation: 'Strategy Configuration → AI Intelligence Settings',
      examples: ['enable AI trading', 'turn on intelligence', 'use AI signals', 'disable AI']
    },
    'technicalIndicators': {
      name: 'Technical Indicators',
      description: 'RSI, MACD, Bollinger Bands, EMA, SMA for technical analysis',
      type: 'object',
      uiLocation: 'Strategy Configuration → Technical Analysis tab',
      examples: ['enable RSI indicator', 'turn on MACD', 'add technical analysis', 'configure bollinger bands']
    }
  };

  static detectIntent(message: string): 'question' | 'command' | 'ambiguous' {
    const lowerMessage = message.toLowerCase().trim();
    
    // Clear question indicators
    const questionStarters = [
      'what is', 'what does', 'how does', 'where is', 'where can', 'is my', 'do I have',
      'can you explain', 'tell me about', 'what happens', 'why is', 'how much',
      'which', 'when does', 'how to find'
    ];
    
    if (questionStarters.some(starter => lowerMessage.startsWith(starter))) {
      return 'question';
    }
    
    // Clear command indicators  
    const commandStarters = [
      'set', 'change', 'update', 'enable', 'disable', 'turn on', 'turn off',
      'add', 'remove', 'increase', 'decrease', 'make it', 'configure'
    ];
    
    if (commandStarters.some(starter => lowerMessage.startsWith(starter))) {
      return 'command';
    }
    
    // Ambiguous phrases that need clarification
    const ambiguousPatterns = ['ai', 'risk', 'trading', 'strategy'];
    if (ambiguousPatterns.some(pattern => lowerMessage.includes(pattern))) {
      return 'ambiguous';
    }
    
    return 'question'; // Default to safe assumption
  }

  static mapUserIntent(message: string, currentConfig: any = {}): any {
    const intent = this.detectIntent(message);
    if (intent === 'question') return {}; // No updates for questions
    
    const lowerMessage = message.toLowerCase();
    const updates = {};

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

    // Amount per trade with better parsing
    const amountMatches = [
      message.match(/(\d+)\s*(euros?|eur|€)/i),
      message.match(/€\s*(\d+)/i),
      message.match(/(\d+)\s*per\s*trade/i)
    ];
    
    const amountMatch = amountMatches.find(match => match !== null);
    if (amountMatch && (lowerMessage.includes('trade') || lowerMessage.includes('allocation') || lowerMessage.includes('minimum'))) {
      updates.perTradeAllocation = parseInt(amountMatch[1]);
    }

    // Stop loss with validation
    const stopLossMatch = message.match(/(\d+(?:\.\d+)?)\s*%/);
    if (stopLossMatch && (lowerMessage.includes('stop') || lowerMessage.includes('loss'))) {
      const percentage = parseFloat(stopLossMatch[1]);
      if (percentage > 0 && percentage <= 50) { // Reasonable range
        updates.stopLossPercentage = percentage;
      }
    }

    // Take profit
    if (stopLossMatch && (lowerMessage.includes('profit') || lowerMessage.includes('gain'))) {
      const percentage = parseFloat(stopLossMatch[1]);
      if (percentage > 0 && percentage <= 1000) { // Reasonable range
        updates.takeProfitPercentage = percentage;
      }
    }

    // Max active coins detection
    const maxCoinsMatch = message.match(/(?:max|maximum)\s+(?:active\s+)?coins?\s+(?:to\s+)?(\d+)/i);
    if (maxCoinsMatch && (lowerMessage.includes('max') || lowerMessage.includes('active') || lowerMessage.includes('coins'))) {
      const numCoins = parseInt(maxCoinsMatch[1]);
      if (numCoins > 0 && numCoins <= 20) { // Reasonable range
        updates.maxActiveCoins = numCoins;
      }
    }

    // Enhanced coin selection
    const coinPatterns = ['BTC', 'ETH', 'XRP', 'ADA', 'SOL', 'DOT', 'MATIC', 'AVAX', 'LINK', 'UNI', 'DOGE', 'LTC', 'BCH'];
    const mentionedCoins = coinPatterns.filter(coin => 
      new RegExp(`\\b${coin.toLowerCase()}\\b`).test(lowerMessage)
    );

    if (mentionedCoins.length > 0) {
      if (lowerMessage.includes('only') || lowerMessage.includes('just')) {
        updates.selectedCoins = mentionedCoins;
      } else if (lowerMessage.includes('add')) {
        const current = currentConfig.selectedCoins || [];
        updates.selectedCoins = [...new Set([...current, ...mentionedCoins])]; // Remove duplicates
      } else if (lowerMessage.includes('remove')) {
        updates.selectedCoins = (currentConfig.selectedCoins || []).filter(coin => 
          !mentionedCoins.includes(coin)
        );
      }
    }

    // AI enablement with better logic
    if (lowerMessage.includes('ai') || lowerMessage.includes('intelligence')) {
      if (lowerMessage.includes('enable') || lowerMessage.includes('turn on') || lowerMessage.includes('activate')) {
        updates.enableAI = true;
      } else if (lowerMessage.includes('disable') || lowerMessage.includes('turn off') || lowerMessage.includes('deactivate')) {
        updates.enableAI = false;
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
    const intent = IntelligentFieldMapper.detectIntent(message);
    
    // Handle questions vs commands differently
    if (intent === 'question') {
      console.log('🤔 QUESTION DETECTED - No config changes will be made');
      return { message: await this.handleQuestionIntent(message, strategy, marketContext, memoryContext, interfaceContext) };
    }
    
    console.log('⚡ COMMAND DETECTED - Processing potential config changes');
    
    // Handle configuration commands
    const potentialUpdates = IntelligentFieldMapper.mapUserIntent(message, currentConfig);
    
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
    
    const responseMessage = validationMessages.length > 0 
      ? validationMessages.join('\n\n')
      : await this.handleGeneralIntent(message, strategy, marketContext, memoryContext, interfaceContext);
    
    return {
      message: responseMessage,
      configUpdates: Object.keys(validatedUpdates).length > 0 ? validatedUpdates : undefined
    };
  }

  static async handleQuestionIntent(message: string, strategy: any, marketContext: string, memoryContext: string, interfaceContext: string): Promise<string> {
    const systemPrompt = `You are an expert cryptocurrency trading assistant with complete interface awareness.

INTERFACE KNOWLEDGE: ${interfaceContext}
MARKET CONTEXT: ${marketContext}
STRATEGY CONTEXT: ${this.buildStrategyContext(strategy)}
CONVERSATION HISTORY: ${memoryContext}

The user is asking a QUESTION (not making a change). Provide informative answers about:
- Current strategy settings and their locations in the interface
- What specific features do and how they work
- Market analysis and recommendations
- Where to find specific options in the interface

Never suggest configuration changes unless explicitly asked. Reference specific UI locations when relevant.`;

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
    return `Current strategy "${strategy.strategy_name}" with risk level ${config.riskLevel || 'medium'}, ${config.selectedCoins?.length || 0} coins selected, amount per trade: €${config.perTradeAllocation || 'not set'}, AI signals: ${config.enableAI ? 'enabled' : 'disabled'}.`;
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
      const currentConfig = await this.getFreshConfig(strategyId, userId);
      const newConfig = { ...currentConfig, ...updates };
      
      const { error } = await supabase
        .from('trading_strategies')
        .update({ configuration: newConfig })
        .eq('id', strategyId)
        .eq('user_id', userId);
      
      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Failed to update config:', error);
      return false;
    }
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
      case 'enableAI':
        return `• **AI signals:** ${value ? 'enabled' : 'disabled'}`;
      default:
        return `• **${key}:** ${value}`;
    }
  });

  return `✅ **Configuration Updated Successfully**

**Changes applied:**
${updates.join('\n')}

${testMode ? '🧪 Changes applied to Test Mode strategy.' : '🔴 Changes applied to Live Mode strategy.'}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
    } = await req.json();

    if (!message || !userId) {
      return new Response(
        JSON.stringify({ 
          error: 'Missing required fields: message and userId',
          hasConfigUpdates: false,
          verificationResults: { success: false, errors: ['Invalid request'] }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`🤖 AI_ASSISTANT: Request received: "${message}"`);

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

    // Detect configuration changes using intelligent field mapping
    const configUpdates = IntelligentFieldMapper.mapUserIntent(message, freshConfig);
    const hasConfigUpdates = Object.keys(configUpdates).length > 0;

    // Handle configuration updates
    if (hasConfigUpdates && strategy) {
      console.log(`🔄 CONFIG_UPDATE: Applying:`, configUpdates);
      
      const success = await ConfigManager.updateConfig(strategy.id, userId, configUpdates);
      
      if (success) {
        const successMessage = generateSuccessMessage(configUpdates, testMode);
        
        await ConversationMemory.storeMessage(userId, 'ai', successMessage, { 
          type: 'config_update',
          updates: configUpdates,
          strategyId: strategy.id 
        });

        return new Response(
          JSON.stringify({
            message: successMessage,
            hasConfigUpdates: true,
            configUpdates,
            verificationResults: { success: true, errors: [] }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        return new Response(
          JSON.stringify({
            message: "❌ **Configuration Update Failed**\n\nI couldn't save the changes to your strategy. Please try again.",
            hasConfigUpdates: false,
            verificationResults: { success: false, errors: ['Database update failed'] }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

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
    let configUpdates = {};

    // Handle configuration updates if present
    if (intelligentResponse.configUpdates && Object.keys(intelligentResponse.configUpdates).length > 0) {
      console.log(`🔄 CONFIG_UPDATE: Applying validated updates:`, intelligentResponse.configUpdates);
      
      const success = await ConfigManager.updateConfig(strategy.id, userId, intelligentResponse.configUpdates);
      
      if (success) {
        hasConfigUpdates = true;
        configUpdates = intelligentResponse.configUpdates;
        
        // Store successful config update in conversation history
        await ConversationMemory.storeMessage(userId, 'ai', finalMessage, { 
          type: 'config_update_success',
          updates: intelligentResponse.configUpdates,
          strategyId: strategy.id 
        });
      } else {
        finalMessage += "\n\n❌ **Configuration Update Failed**\n\nI couldn't save the changes to your strategy. Please try again or check your connection.";
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
        configUpdates: hasConfigUpdates ? configUpdates : undefined,
        verificationResults: { success: true, errors: [] }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ AI_ASSISTANT: Error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: "I'm experiencing technical difficulties. Please try again in a moment.",
        hasConfigUpdates: false,
        verificationResults: { success: false, errors: [error.message] }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});