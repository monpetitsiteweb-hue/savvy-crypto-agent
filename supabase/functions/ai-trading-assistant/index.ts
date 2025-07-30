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

// ===== STEP 3: SEPARATE VERIFIER MODULE =====
class ConfigVerifier {
  static deepEquals(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;
    
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
      if (obj1.length !== obj2.length) return false;
      return obj1.every((val, index) => val === obj2[index]);
    }
    
    if (typeof obj1 === 'object' && typeof obj2 === 'object' && obj1 !== null && obj2 !== null) {
      const keys1 = Object.keys(obj1).sort();
      const keys2 = Object.keys(obj2).sort();
      if (keys1.length !== keys2.length) return false;
      return keys1.every(key => this.deepEquals(obj1[key], obj2[key]));
    }
    
    return false;
  }
  
  static verify(expected: any, actual: any, fieldPath: string): { success: boolean; message: string } {
    const isMatch = this.deepEquals(expected, actual);
    
    console.log(`🔍 VERIFIER: Field "${fieldPath}"`);
    console.log(`   Expected: ${JSON.stringify(expected)} (type: ${typeof expected})`);
    console.log(`   Actual: ${JSON.stringify(actual)} (type: ${typeof actual})`);
    console.log(`   Match: ${isMatch}`);
    
    if (isMatch) {
      return {
        success: true,
        message: `✅ ${fieldPath}: Successfully updated to ${JSON.stringify(expected)}`
      };
    } else {
      return {
        success: false,
        message: `❌ ${fieldPath}: Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      };
    }
  }
}

// ===== STEP 1: REBUILD STRATEGY RESOLUTION LOGIC =====
class StrategyResolver {
  static async getActiveStrategy(userId: string, testMode: boolean): Promise<any> {
    console.log(`🔍 STRATEGY_RESOLVER: Finding active strategy for user ${userId}, testMode: ${testMode}`);
    
    // Always start fresh - query database directly
    const activeField = testMode ? 'is_active_test' : 'is_active_live';
    
    const { data: strategies, error } = await supabaseClient
      .from('trading_strategies')
      .select('*')
      .eq('user_id', userId)
      .eq(activeField, true)
      .order('updated_at', { ascending: false });
    
    console.log(`🔍 STRATEGY_RESOLVER: Query result:`, { strategies, error });
    
    if (error) {
      console.error(`❌ STRATEGY_RESOLVER: Database error:`, error);
      return null;
    }
    
    if (!strategies || strategies.length === 0) {
      console.log(`⚠️ STRATEGY_RESOLVER: No active strategy found for ${testMode ? 'test' : 'live'} mode`);
      
      // Debug: Show what strategies exist
      const { data: allStrategies } = await supabaseClient
        .from('trading_strategies')
        .select('*')
        .eq('user_id', userId);
      
      console.log(`📋 STRATEGY_RESOLVER: Available strategies:`, allStrategies?.map(s => ({
        id: s.id,
        name: s.strategy_name,
        is_active_test: s.is_active_test,
        is_active_live: s.is_active_live
      })));
      
      return null;
    }
    
    const strategy = strategies[0];
    console.log(`✅ STRATEGY_RESOLVER: Found active strategy: ${strategy.strategy_name} (${strategy.id})`);
    
    return strategy;
  }
  
  static async getStrategyById(userId: string, strategyId: string): Promise<any> {
    console.log(`🔍 STRATEGY_RESOLVER: Fetching strategy ${strategyId} for user ${userId}`);
    
    const { data: strategy, error } = await supabaseClient
      .from('trading_strategies')
      .select('*')
      .eq('id', strategyId)
      .eq('user_id', userId)
      .single();
    
    if (error) {
      console.error(`❌ STRATEGY_RESOLVER: Error fetching strategy:`, error);
      return null;
    }
    
    console.log(`✅ STRATEGY_RESOLVER: Strategy fetched: ${strategy.strategy_name}`);
    return strategy;
  }
}

// ===== STEP 2: CENTRALIZE CONFIGURATION FETCH =====
class ConfigManager {
  static async getFreshConfig(strategyId: string, userId: string): Promise<any> {
    console.log(`🔄 CONFIG_MANAGER: Fetching fresh config for strategy ${strategyId}`);
    
    const { data: strategy, error } = await supabaseClient
      .from('trading_strategies')
      .select('configuration')
      .eq('id', strategyId)
      .eq('user_id', userId)
      .single();
    
    if (error) {
      console.error(`❌ CONFIG_MANAGER: Error fetching config:`, error);
      return null;
    }
    
    console.log(`✅ CONFIG_MANAGER: Fresh config retrieved`);
    return strategy.configuration;
  }
  
  static async updateConfig(strategyId: string, userId: string, updates: any): Promise<boolean> {
    console.log(`🔄 CONFIG_MANAGER: Updating strategy ${strategyId} with:`, updates);
    
    // First get current config
    const currentConfig = await this.getFreshConfig(strategyId, userId);
    if (!currentConfig) {
      console.error(`❌ CONFIG_MANAGER: Cannot fetch current config for update`);
      return false;
    }
    
    // Apply updates
    const newConfig = { ...currentConfig };
    for (const [path, value] of Object.entries(updates)) {
      this.setNestedField(newConfig, path, value);
    }
    
    console.log(`🔄 CONFIG_MANAGER: Applying config update:`, newConfig);
    
    // Update in database
    const { error } = await supabaseClient
      .from('trading_strategies')
      .update({ 
        configuration: newConfig,
        updated_at: new Date().toISOString()
      })
      .eq('id', strategyId)
      .eq('user_id', userId);
    
    if (error) {
      console.error(`❌ CONFIG_MANAGER: Database update failed:`, error);
      return false;
    }
    
    console.log(`✅ CONFIG_MANAGER: Config updated successfully`);
    return true;
  }
  
  static setNestedField(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
  }
  
  static getNestedField(obj: any, path: string): any {
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
  }
}

// ===== STEP 4: FIX WELCOME MESSAGE GENERATION =====
class WelcomeMessageGenerator {
  static generate(strategy: any, testMode: boolean): string {
    if (!strategy) {
      return testMode 
        ? "Hello! You're in Test Mode but no strategy is currently active. Create a strategy to start simulated trading."
        : "Hello! You're in Live Mode but no strategy is currently active. Create and activate a strategy to start trading.";
    }
    
    const config = strategy.configuration || {};
    const strategyName = strategy.strategy_name || 'Unnamed Strategy';
    const mode = testMode ? 'Test Mode' : 'Live Mode';
    const isActiveInMode = testMode ? strategy.is_active_test : strategy.is_active_live;
    
    console.log(`🎯 WELCOME_GENERATOR: Generating for ${strategyName}`);
    console.log(`   Mode: ${mode}`);
    console.log(`   Active in mode: ${isActiveInMode}`);
    console.log(`   AI enabled: ${config.is_ai_enabled}`);
    console.log(`   Selected coins: ${JSON.stringify(config.selectedCoins)}`);
    
    if (!isActiveInMode) {
      return `Hello! You have the "${strategyName}" strategy but it's not active in ${mode}. Activate it to start ${testMode ? 'simulated' : 'live'} trading.`;
    }
    
    return `Hello! You're in ${mode} with an active strategy "${strategyName}". I'll help monitor and optimize your ${testMode ? 'simulated' : 'live'} trades.`;
  }
}

// Semantic field mapping for user intent detection
const SEMANTIC_FIELD_MAPPING = {
  'AI Decision Override': {
    field: 'aiIntelligenceConfig.enableAIOverride',
    type: 'boolean',
    enableKeywords: ["enable ai", "turn on ai", "activate ai", "start ai", "ai on", "enable override"],
    disableKeywords: ["disable ai", "turn off ai", "stop ai", "ai off", "disable override", "no ai"]
  },
  'Selected Coins': {
    field: 'selectedCoins',
    type: 'coin_array',
    operations: {
      add: ["add", "include", "use", "trade"],
      remove: ["remove", "exclude", "stop trading", "drop"],
      replace: ["only", "just", "switch to", "change to"]
    }
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
  }
};

// Extract cryptocurrency symbols from user message
const extractCoinsFromMessage = (message: string): string[] => {
  const availableCoins = ['BTC', 'ETH', 'ADA', 'DOGE', 'XRP', 'LTC', 'BCH', 'LINK', 'DOT', 'UNI', 'SOL', 'MATIC', 'AVAX', 'ICP', 'XLM', 'VET', 'ALGO', 'ATOM', 'FIL', 'TRX'];
  const coinAliases = {
    'bitcoin': 'BTC', 'ethereum': 'ETH', 'cardano': 'ADA', 'dogecoin': 'DOGE',
    'ripple': 'XRP', 'litecoin': 'LTC', 'chainlink': 'LINK', 'polkadot': 'DOT',
    'uniswap': 'UNI', 'solana': 'SOL', 'polygon': 'MATIC', 'avalanche': 'AVAX'
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

// Map user intent to configuration changes
const mapUserIntentToFields = (userMessage: string, currentConfig: any = {}): { [key: string]: any } => {
  const changes: { [key: string]: any } = {};
  const lowerMessage = userMessage.toLowerCase();
  
  console.log('🧠 INTENT_MAPPER: Processing message:', userMessage);
  console.log('🧠 INTENT_MAPPER: Current config coins:', currentConfig.selectedCoins);
  
  // Search through semantic mapping for matches
  for (const [fieldLabel, config] of Object.entries(SEMANTIC_FIELD_MAPPING)) {
    
    if (config.type === 'boolean') {
      const enableKeywords = config.enableKeywords || [];
      const disableKeywords = config.disableKeywords || [];
      
      const hasEnableMatch = enableKeywords.some(keyword => lowerMessage.includes(keyword));
      const hasDisableMatch = disableKeywords.some(keyword => lowerMessage.includes(keyword));
      
      if (hasEnableMatch && !hasDisableMatch) {
        console.log(`🎯 INTENT_MAPPER: ENABLE detected for "${fieldLabel}"`);
        changes[config.field] = true;
      } else if (hasDisableMatch && !hasEnableMatch) {
        console.log(`🎯 INTENT_MAPPER: DISABLE detected for "${fieldLabel}"`);
        changes[config.field] = false;
      }
    }
    
    else if (config.type === 'coin_array' && config.field === 'selectedCoins') {
      const currentCoins = currentConfig.selectedCoins || [];
      const extractedCoins = extractCoinsFromMessage(userMessage);
      
      if (extractedCoins.length > 0) {
        const operations = config.operations || {};
        
        const isAddOperation = operations.add?.some(op => lowerMessage.includes(op));
        const isRemoveOperation = operations.remove?.some(op => lowerMessage.includes(op));
        const isReplaceOperation = operations.replace?.some(op => lowerMessage.includes(op));
        
        console.log(`🎯 INTENT_MAPPER: Coin operation:`, {
          extractedCoins,
          currentCoins,
          isAddOperation,
          isRemoveOperation,
          isReplaceOperation
        });
        
        if (isReplaceOperation) {
          console.log(`🎯 INTENT_MAPPER: REPLACE coins with:`, extractedCoins);
          changes[config.field] = extractedCoins;
        } else if (isAddOperation) {
          const newCoins = [...new Set([...currentCoins, ...extractedCoins])];
          console.log(`🎯 INTENT_MAPPER: ADD coins:`, extractedCoins, 'Result:', newCoins);
          changes[config.field] = newCoins;
        } else if (isRemoveOperation) {
          const newCoins = currentCoins.filter(coin => !extractedCoins.includes(coin));
          console.log(`🎯 INTENT_MAPPER: REMOVE coins:`, extractedCoins, 'Result:', newCoins);
          changes[config.field] = newCoins;
        }
      }
    }
    
    else if (config.type === 'number') {
      const numbers = userMessage.match(/\d+(?:\.\d+)?/g);
      if (numbers && numbers.length > 0) {
        changes[config.field] = parseFloat(numbers[0]);
      }
    }
  }
  
  console.log('🔄 INTENT_MAPPER: Detected changes:', changes);
  return changes;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, userId, strategyId, testMode } = await req.json();

    console.log('🤖 AI_ASSISTANT: Request received:', { 
      message, 
      userId, 
      strategyId, 
      testMode
    });

    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    if (!message || !userId) {
      throw new Error('Message and userId are required');
    }

    // ===== STEP 1: REBUILD STRATEGY RESOLUTION =====
    let actualStrategy = null;
    
    // Try provided strategyId first, then find active strategy
    if (strategyId) {
      actualStrategy = await StrategyResolver.getStrategyById(userId, strategyId);
    }
    
    if (!actualStrategy) {
      actualStrategy = await StrategyResolver.getActiveStrategy(userId, testMode);
    }

    // ===== STEP 2: CENTRALIZE CONFIGURATION FETCH =====
    let currentConfig = null;
    if (actualStrategy) {
      currentConfig = await ConfigManager.getFreshConfig(actualStrategy.id, userId);
    }

    // ===== STEP 4: GENERATE WELCOME MESSAGE =====
    let welcomeMessage = '';
    if (message.toLowerCase().includes('system health') || !message.trim() || message === 'init') {
      welcomeMessage = WelcomeMessageGenerator.generate(actualStrategy, testMode);
    }

    // Check for explicit configuration commands first
    const lowerMessage = message.toLowerCase();
    const isExplicitConfigCommand = (
      (lowerMessage.includes('enable ai') || lowerMessage.includes('turn on ai') || lowerMessage.includes('activate ai')) ||
      (lowerMessage.includes('disable ai') || lowerMessage.includes('turn off ai') || lowerMessage.includes('deactivate ai')) ||
      (lowerMessage.includes('add') && extractCoinsFromMessage(message).length > 0) ||
      (lowerMessage.includes('remove') && extractCoinsFromMessage(message).length > 0) ||
      (lowerMessage.includes('only') && extractCoinsFromMessage(message).length > 0)
    );

    // Handle confirmation responses
    const isConfirmation = (
      lowerMessage.includes('yes') || 
      lowerMessage.includes('please') || 
      lowerMessage.includes('confirm') ||
      lowerMessage.includes('go ahead') ||
      lowerMessage.includes('do it')
    );

    // Only detect configuration changes for explicit commands
    const configUpdates = isExplicitConfigCommand ? mapUserIntentToFields(message, currentConfig) : {};
    const hasConfigUpdates = Object.keys(configUpdates).length > 0;

    // Check if this is a query about current state
    const isStateQuery = (
      lowerMessage.includes('ai enabled') || 
      lowerMessage.includes('is ai') ||
      lowerMessage.includes('ai status') ||
      lowerMessage.includes('current settings') ||
      lowerMessage.includes('what coins') ||
      lowerMessage.includes('minimum') ||
      lowerMessage.includes('trade size') ||
      lowerMessage.includes('amount')
    ) && !hasConfigUpdates;

    // Generate response based on type of request
    let aiResponse = '';
    let verificationResults = { success: true, errors: [] as string[] };
    
    if (welcomeMessage) {
      // System health check or welcome message
      aiResponse = welcomeMessage;
    } else if (hasConfigUpdates && actualStrategy) {
      // ===== STEP 5: PROOF-BASED CONFIRMATION =====
      console.log('🔄 CONFIG_UPDATE: Applying changes:', configUpdates);
      
      // Apply updates to database
      const updateSuccess = await ConfigManager.updateConfig(actualStrategy.id, userId, configUpdates);
      
      if (updateSuccess) {
        // Re-fetch config for verification
        const updatedConfig = await ConfigManager.getFreshConfig(actualStrategy.id, userId);
        
        // Verify each change
        const verificationErrors: string[] = [];
        for (const [field, expectedValue] of Object.entries(configUpdates)) {
          const actualValue = ConfigManager.getNestedField(updatedConfig, field);
          const verification = ConfigVerifier.verify(expectedValue, actualValue, field);
          
          if (!verification.success) {
            verificationErrors.push(verification.message);
          }
        }
        
        verificationResults = {
          success: verificationErrors.length === 0,
          errors: verificationErrors
        };
        
        // Generate specific success/failure response
        if (verificationResults.success) {
          const changeKeys = Object.keys(configUpdates);
          if (changeKeys.includes('aiIntelligenceConfig.enableAIOverride')) {
            const aiEnabled = ConfigManager.getNestedField(updatedConfig, 'aiIntelligenceConfig.enableAIOverride');
            aiResponse = aiEnabled 
              ? '✅ AI has been enabled. Your strategy is now using AI for trading decisions.'
              : '✅ AI has been disabled. You\'re now in full manual control of your trading decisions.';
          } else if (changeKeys.some(key => key.includes('selectedCoins'))) {
            const coins = ConfigManager.getNestedField(updatedConfig, 'selectedCoins') || [];
            aiResponse = `✅ Coin selection updated. Currently trading: ${JSON.stringify(coins)}`;
          } else {
            aiResponse = '✅ Configuration updated successfully.';
          }
        } else {
          aiResponse = `❌ Configuration update failed: ${verificationResults.errors.join(', ')}`;
        }
      } else {
        verificationResults = { success: false, errors: ['Database update failed'] };
        aiResponse = '❌ Failed to update configuration in database.';
      }
    } else if (isStateQuery && actualStrategy && currentConfig) {
      // ===== ANSWER STATE QUERIES WITH CURRENT DATABASE STATE =====
      const aiEnabled = ConfigManager.getNestedField(currentConfig, 'aiIntelligenceConfig.enableAIOverride') || false;
      const selectedCoins = currentConfig.selectedCoins || [];
      
      if (lowerMessage.includes('ai')) {
        aiResponse = aiEnabled 
          ? 'AI is currently enabled for your trading strategy.'
          : 'AI is currently disabled. Would you like me to enable it?';
      } else if (lowerMessage.includes('coin')) {
        aiResponse = `Currently trading these coins: ${JSON.stringify(selectedCoins)}`;
      } else {
        aiResponse = `Strategy "${actualStrategy.strategy_name}" is active in ${testMode ? 'Test' : 'Live'} mode. AI: ${aiEnabled ? 'Enabled' : 'Disabled'}. Coins: ${JSON.stringify(selectedCoins)}`;
      }
    } else {
      // ===== GENERAL AI RESPONSE =====
      let contextInfo = '';
      if (actualStrategy && currentConfig) {
        const aiEnabled = ConfigManager.getNestedField(currentConfig, 'aiIntelligenceConfig.enableAIOverride') || false;
        contextInfo = `
Current Strategy: "${actualStrategy.strategy_name}"
Mode: ${testMode ? 'Test Mode' : 'Live Mode'}
Active: ${testMode ? actualStrategy.is_active_test : actualStrategy.is_active_live}
AI Override: ${aiEnabled}
Selected Coins: ${JSON.stringify(currentConfig.selectedCoins || [])}
`;
      } else {
        contextInfo = `No active strategy found for ${testMode ? 'test' : 'live'} mode.`;
      }

      const systemPrompt = `You are a cryptocurrency trading assistant. Help users with their trading strategy questions and concerns.

Current Context:
${contextInfo}

IMPORTANT: When users ask about trade sizes, minimum amounts, or configuration settings, explain what controls those values and offer to help adjust them. Don't assume everything is a coin selection change.

If users mention problems like "tiny trades" or "0.00 amounts", address those concerns directly and explain which settings control trade sizing (like perTradeAllocation, maxPositionSize, etc.).

When reporting current state, use the EXACT values shown above. Do not guess or assume.`;

      const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
          max_tokens: 300,
          temperature: 0.3,
        }),
      });

      const openAIData = await openAIResponse.json();
      aiResponse = openAIData.choices[0]?.message?.content || 'I apologize, but I encountered an issue processing your request.';
    }

    console.log('📝 AI_ASSISTANT: Response completed:', { hasConfigUpdates, verificationResults });

    return new Response(
      JSON.stringify({
        message: aiResponse,
        hasConfigUpdates,
        configUpdates,
        verification: verificationResults,
        currentConfig
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('❌ AI_ASSISTANT: Error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});