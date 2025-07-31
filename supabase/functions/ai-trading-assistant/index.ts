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
const systemPrompt = `You are an expert cryptocurrency trading assistant with deep knowledge of:
- Technical analysis (RSI, MACD, Bollinger Bands, EMA, SMA)
- Market sentiment and whale movements  
- DeFi protocols and institutional flows
- Risk management and position sizing
- Strategy optimization and backtesting

Respond naturally and conversationally. Provide actionable insights and explain your reasoning. 
If suggesting changes, be specific about values and explain why.
Keep responses concise but informative.`;

// =============================================
// LLM-FIRST CONVERSATIONAL ASSISTANT
// =============================================

class ConversationMemory {
  static async getRecentContext(userId: string, limit: number = 5): Promise<any[]> {
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

class IntelligentFieldMapper {
  static FIELD_DEFINITIONS = {
    // Basic Strategy Settings
    'riskLevel': {
      name: 'Risk Level',
      description: 'Controls how aggressively the strategy trades',
      type: 'enum',
      values: ['low', 'medium', 'high'],
      examples: ['set risk to high', 'make it more aggressive', 'lower my risk']
    },
    'perTradeAllocation': {
      name: 'Amount Per Trade',
      description: 'How much money to invest per trade in euros',
      type: 'number',
      examples: ['set minimum trade to 500 euros', 'per trade allocation 1000', 'invest 750 per trade']
    },
    'stopLossPercentage': {
      name: 'Stop Loss',
      description: 'Automatically sell if price drops by this percentage',
      type: 'number',
      examples: ['set stop loss to 3%', 'cut losses at 2%', 'add stop loss protection']
    },
    'takeProfitPercentage': {
      name: 'Take Profit',
      description: 'Automatically sell when profit reaches this percentage',
      type: 'number',
      examples: ['take profit at 10%', 'secure gains at 15%', 'set profit target']
    },
    'maxPositionSize': {
      name: 'Maximum Position Size',
      description: 'Maximum amount to invest in a single cryptocurrency',
      type: 'number',
      examples: ['max position 5000', 'limit exposure to 3000', 'cap investment at 10000']
    },
    'selectedCoins': {
      name: 'Selected Cryptocurrencies',
      description: 'Which cryptocurrencies to trade',
      type: 'array',
      examples: ['only trade BTC and ETH', 'add XRP to my coins', 'remove DOGE from strategy']
    },
    'enableAI': {
      name: 'AI Intelligence',
      description: 'Use AI signals and analysis for trading decisions',
      type: 'boolean',
      examples: ['enable AI trading', 'turn on intelligence', 'use AI signals']
    },
    'technicalIndicators': {
      name: 'Technical Indicators',
      description: 'RSI, MACD, and other technical analysis tools',
      type: 'object',
      examples: ['enable RSI indicator', 'turn on MACD', 'add technical analysis']
    }
  };

  static mapUserIntent(message: string, currentConfig: any = {}): any {
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

    // Amount per trade
    const amountMatch = message.match(/(\d+)\s*(euros?|eur|€)/i);
    if (amountMatch && (lowerMessage.includes('trade') || lowerMessage.includes('allocation') || lowerMessage.includes('minimum'))) {
      updates.perTradeAllocation = parseInt(amountMatch[1]);
    }

    // Stop loss
    const stopLossMatch = message.match(/(\d+(?:\.\d+)?)\s*%/);
    if (stopLossMatch && (lowerMessage.includes('stop') || lowerMessage.includes('loss'))) {
      updates.stopLossPercentage = parseFloat(stopLossMatch[1]);
    }

    // Take profit
    if (stopLossMatch && (lowerMessage.includes('profit') || lowerMessage.includes('gain'))) {
      updates.takeProfitPercentage = parseFloat(stopLossMatch[1]);
    }

    // Coin selection
    const coinPatterns = ['BTC', 'ETH', 'XRP', 'ADA', 'SOL', 'DOT', 'MATIC', 'AVAX', 'LINK', 'UNI'];
    const mentionedCoins = coinPatterns.filter(coin => 
      lowerMessage.includes(coin.toLowerCase())
    );

    if (mentionedCoins.length > 0) {
      if (lowerMessage.includes('only') || lowerMessage.includes('just')) {
        updates.selectedCoins = mentionedCoins;
      } else if (lowerMessage.includes('add')) {
        updates.selectedCoins = [...(currentConfig.selectedCoins || []), ...mentionedCoins];
      } else if (lowerMessage.includes('remove')) {
        updates.selectedCoins = (currentConfig.selectedCoins || []).filter(coin => 
          !mentionedCoins.includes(coin)
        );
      }
    }

    // AI enablement
    if (lowerMessage.includes('ai') || lowerMessage.includes('intelligence')) {
      if (lowerMessage.includes('enable') || lowerMessage.includes('turn on')) {
        updates.enableAI = true;
      } else if (lowerMessage.includes('disable') || lowerMessage.includes('turn off')) {
        updates.enableAI = false;
      }
    }

    return updates;
  }
}

class CryptoIntelligenceEngine {
  static async generateContextualResponse(message: string, strategy: any, signals: any[], news: any[], conversationHistory: any[]): Promise<string> {
    const marketContext = this.buildMarketContext(signals, news);
    const strategyContext = this.buildStrategyContext(strategy);
    const memoryContext = this.buildMemoryContext(conversationHistory);
    
    const contextualPrompt = `${systemPrompt}

Current market context: ${marketContext}
User's strategy: ${strategyContext}
Recent conversation: ${memoryContext}

Respond naturally with specific actionable advice. Reference previous context when relevant.`;

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
            { role: 'system', content: contextualPrompt },
            { role: 'user', content: message }
          ],
          temperature: 0.3,
          max_tokens: 1000
        }),
      });

      const data = await response.json();
      return data.choices?.[0]?.message?.content || 
        "I understand your question about trading strategy. Could you be more specific about what you'd like to adjust?";
    } catch (error) {
      console.error('OpenAI API error:', error);
      return "I'm having trouble accessing my intelligence systems right now. Please try your question again.";
    }
  }

  static buildMarketContext(signals: any[], news: any[]): string {
    const recentSignals = signals.slice(0, 3);
    const recentNews = news.slice(0, 2);
    
    let context = '';
    if (recentSignals.length > 0) {
      context += `Recent signals: ${recentSignals.map(s => `${s.symbol} ${s.signal_type} (strength: ${s.signal_strength})`).join(', ')}. `;
    }
    if (recentNews.length > 0) {
      context += `Recent news: ${recentNews.map(n => n.headline).join('; ')}. `;
    }
    
    return context || 'No recent market signals available.';
  }

  static buildStrategyContext(strategy: any): string {
    if (!strategy) return 'No active strategy configured.';
    
    const config = strategy.configuration || {};
    return `Strategy "${strategy.strategy_name}" with risk level ${config.riskLevel || 'medium'}, ${config.selectedCoins?.length || 0} coins selected, ${config.perTradeAllocation || 'no'} euros per trade.`;
  }

  static buildMemoryContext(history: any[]): string {
    if (!history.length) return 'This is our first conversation.';
    
    const recent = history.slice(0, 3).reverse();
    return recent.map(h => `${h.message_type}: ${h.content.substring(0, 100)}`).join(' | ');
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

    // Generate intelligent response
    const aiMessage = await CryptoIntelligenceEngine.generateContextualResponse(
      message, 
      strategy, 
      liveSignals, 
      cryptoNews,
      conversationHistory
    );

    // Store AI response in conversation history
    await ConversationMemory.storeMessage(userId, 'ai', aiMessage, { 
      type: 'intelligent_response',
      signals_used: liveSignals.length,
      news_used: cryptoNews.length,
      strategyId: strategy?.id 
    });

    console.log(`📝 AI_ASSISTANT: Intelligent response generated`);

    return new Response(
      JSON.stringify({
        message: aiMessage,
        hasConfigUpdates: false,
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