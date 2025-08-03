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
    aiCanExecute: true,
    phrases: ['enable trade notifications', 'notify on trades', 'disable trade alerts', 'turn on trade notifications', 'trade alerts'],
    examples: ['enable trade notifications', 'notify on trades', 'disable trade alerts']
  },
  'errorNotifications': {
    name: 'Error Notifications',
    description: 'Get notified when trading errors occur',
    type: 'boolean',
    uiLocation: 'General → Notifications → Notification Settings',
    dbPath: 'configuration.notifications.error',
    csvMatch: 'Error Norifications',
    aiCanExecute: true,
    phrases: ['notify on errors', 'enable error alerts', 'disable error notifications', 'error notifications', 'error alerts'],
    examples: ['notify on errors', 'enable error alerts', 'disable error notifications']
  },
  'targetNotifications': {
    name: 'Target Notifications',
    description: 'Get notified when profit or loss targets are hit',
    type: 'boolean',
    uiLocation: 'General → Notifications → Notification Settings',
    dbPath: 'configuration.notifications.target',
    csvMatch: 'Target Notifications',
    aiCanExecute: true,
    phrases: ['notify on targets', 'enable target alerts', 'disable target notifications', 'target notifications', 'profit alerts'],
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
    aiCanExecute: true,
    phrases: ['enable AI', 'turn on AI', 'activate AI', 'disable AI', 'turn off AI', 'deactivate AI', 'AI on', 'AI off', 'enable AI intelligence'],
    examples: ['enable AI', 'turn on AI intelligence', 'use AI signals', 'disable AI', 'AI on', 'AI off']
  },
  'confidenceThreshold': {
    name: 'Confidence Threshold',
    description: 'Minimum confidence level required for AI to make decisions',
    type: 'number',
    range: [0, 100],
    uiLocation: 'AI Intelligence → AI Intelligence Settings → AI Intelligence Core',
    dbPath: 'configuration.aiIntelligenceConfig.aiConfidenceThreshold',
    csvMatch: 'Confidence Threshold',
    aiCanExecute: true,
    phrases: ['confidence threshold', 'AI confidence', 'set confidence', 'confidence level'],
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
    aiCanExecute: true,
    phrases: ['escalation threshold', 'escalate at', 'human oversight threshold', 'escalation level'],
    examples: ['escalation threshold 50%', 'escalate at 90%', 'human oversight threshold']
  },

  // === STRATEGY CONFIGURATION ===
  'maxWalletExposure': {
    name: 'Max Wallet Exposure',
    description: 'Maximum percentage of wallet to use for trading',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Buying → Strategy → Strategy Configuration',
    dbPath: 'configuration.maxWalletExposure',
    csvMatch: 'Max Wallet Exposure',
    aiCanExecute: true,
    phrases: ['max wallet exposure', 'wallet exposure', 'set wallet exposure', 'maximum exposure'],
    examples: ['set wallet exposure to 50%', 'max exposure 75%', 'limit wallet usage']
  },
  'dailyProfitTarget': {
    name: 'Daily Profit Target',
    description: 'Target profit amount per day (EUR)',
    type: 'number',
    uiLocation: 'Buying → Strategy → Strategy',
    dbPath: 'configuration.dailyProfitTarget',
    csvMatch: 'Daily Profit Target',
    aiCanExecute: true,
    phrases: ['daily profit target', 'profit target', 'daily target', 'target profit'],
    examples: ['daily profit target 100', 'set profit target to 50', 'target 200 profit']
  },
  'maxOpenPositions': {
    name: 'Max Open Positions',
    description: 'Maximum number of open trading positions',
    type: 'number',
    uiLocation: 'Selling → Sell Settings → Position Management',
    dbPath: 'configuration.maxOpenPositions',
    csvMatch: 'Max Open Positions',
    aiCanExecute: true,
    phrases: ['max open positions', 'maximum positions', 'open positions limit', 'position limit'],
    examples: ['max open positions 5', 'limit positions to 3', 'maximum 8 positions']
  },

  // === TAKE PROFIT & STOP LOSS ===
  'takeProfitPercentage': {
    name: 'Take Profit Percentage',
    description: 'Percentage gain at which to take profit',
    type: 'number',
    range: [0, 1000],
    uiLocation: 'Selling → Sell Settings → Take Profit Strategy',
    dbPath: 'configuration.takeProfitPercentage',
    csvMatch: 'Take Profit Percentage',
    aiCanExecute: true,
    phrases: ['take profit', 'profit percentage', 'take profit percentage', 'profit target percentage'],
    examples: ['take profit at 10%', 'profit target 15%', 'take profit 20%']
  },
  'stopLossPercentage': {
    name: 'Stop Loss Percentage',
    description: 'Percentage loss at which to stop trading',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Selling → Sell Settings → Stop Loss Protection',
    dbPath: 'configuration.stopLossPercentage',
    csvMatch: 'Stop Loss Percentage',
    aiCanExecute: true,
    phrases: ['stop loss', 'stop loss percentage', 'loss limit', 'stop at'],
    examples: ['stop loss 5%', 'set stop loss to 10%', 'loss limit 8%']
  },

  // === DCA SETTINGS ===
  'enableDCA': {
    name: 'Enable DCA',
    description: 'Enable Dollar Cost Averaging strategy',
    type: 'boolean',
    uiLocation: 'Selling → Dollar Cost Averaging → Dollar Cost Averaging',
    dbPath: 'configuration.enableDCA',
    csvMatch: 'Enable DCA',
    aiCanExecute: true,
    phrases: ['enable DCA', 'turn on DCA', 'activate DCA', 'disable DCA', 'turn off DCA', 'dollar cost averaging'],
    examples: ['enable DCA', 'turn on dollar cost averaging', 'disable DCA']
  },
  'dcaInterval': {
    name: 'DCA Interval (hours)',
    description: 'Time between DCA purchases in hours',
    type: 'number',
    uiLocation: 'Selling → Dollar Cost Averaging → Dollar Cost Averaging',
    dbPath: 'configuration.dcaInterval',
    csvMatch: 'DCA Interval (hours)',
    aiCanExecute: true,
    phrases: ['DCA interval', 'DCA hours', 'averaging interval', 'DCA frequency'],
    examples: ['DCA interval 24 hours', 'set DCA to 12 hours', 'averaging every 6 hours']
  }
};

// =============================================
// INTELLIGENT FIELD MAPPER - DETERMINISTIC APPROACH
// =============================================
class IntelligentFieldMapper {
  static async detectIntent(message: string): Promise<'question' | 'command'> {
    const msgLower = message.toLowerCase().trim();
    
    // Command indicators - explicit action verbs
    const commandPatterns = [
      /^(enable|disable|turn on|turn off|activate|deactivate)/,
      /^(set|change|update|modify|configure)/,
      /^(use|apply|implement|switch to)/,
      /(to \d+%?|= \d+%?|at \d+%?)/
    ];
    
    // Check if it's clearly a command
    if (commandPatterns.some(pattern => pattern.test(msgLower))) {
      console.log('🔧 COMMAND_DETECTED via explicit patterns');
      return 'command';
    }
    
    // Question indicators - questions about current state or how-to
    const questionPatterns = [
      /^(what|how|why|when|where|which|who)/,
      /\?$/,
      /^(tell me|show me|explain|describe)/,
      /^(is|are|can|will|would|should|do|does)/,
      /^(help|guide)/
    ];
    
    if (questionPatterns.some(pattern => pattern.test(msgLower))) {
      console.log('❓ QUESTION_DETECTED via explicit patterns');
      return 'question';
    }
    
    // Default to command for ambiguous cases with field mentions
    for (const [fieldKey, fieldDef] of Object.entries(FIELD_DEFINITIONS)) {
      if (fieldDef.phrases) {
        for (const phrase of fieldDef.phrases) {
          if (msgLower.includes(phrase.toLowerCase())) {
            console.log(`🔧 COMMAND_DETECTED via field phrase: "${phrase}"`);
            return 'command';
          }
        }
      }
    }
    
    console.log('❓ DEFAULTING_TO_QUESTION');
    return 'question';
  }

  static async mapUserIntent(message: string, currentConfig: any = {}): Promise<any> {
    console.log(`🔍 MAPPING_USER_INTENT: "${message}"`);
    
    const updates = {};
    const msgLower = message.toLowerCase().trim();
    
    // Deterministic phrase matching - check each field's defined phrases
    for (const [fieldKey, fieldDef] of Object.entries(FIELD_DEFINITIONS)) {
      if (!fieldDef.aiCanExecute) {
        console.log(`⚠️ SKIPPING_FIELD: ${fieldKey} (aiCanExecute: false)`);
        continue;
      }
      
      const phrases = fieldDef.phrases || [];
      let matched = false;
      
      // Check if any phrase matches
      for (const phrase of phrases) {
        if (this.isExactPhraseMatch(msgLower, phrase.toLowerCase())) {
          console.log(`🎯 PHRASE_MATCH: "${phrase}" → ${fieldKey}`);
          
          const extractedValue = this.extractValue(message, fieldDef);
          if (extractedValue !== null) {
            updates[fieldKey] = extractedValue;
            console.log(`✅ EXTRACTED_VALUE: ${fieldKey} = ${extractedValue}`);
            matched = true;
            break;
          }
        }
      }
      
      // If no phrase matched, check fallback examples (less reliable)
      if (!matched) {
        const examples = fieldDef.examples || [];
        for (const example of examples) {
          if (this.isPatternMatch(msgLower, example.toLowerCase())) {
            console.log(`🎯 EXAMPLE_MATCH: "${example}" → ${fieldKey}`);
            
            const extractedValue = this.extractValue(message, fieldDef);
            if (extractedValue !== null) {
              updates[fieldKey] = extractedValue;
              console.log(`✅ EXTRACTED_VALUE: ${fieldKey} = ${extractedValue}`);
              break;
            }
          }
        }
      }
    }
    
    console.log(`🔍 FINAL_MAPPED_UPDATES: ${JSON.stringify(updates, null, 2)}`);
    return updates;
  }

  static isExactPhraseMatch(message: string, phrase: string): boolean {
    // Check if the phrase appears as a substring
    return message.includes(phrase);
  }

  static isPatternMatch(message: string, pattern: string): boolean {
    // Simple pattern matching - check if key words from pattern exist in message
    const patternWords = pattern.split(' ').filter(word => word.length > 2);
    return patternWords.every(word => message.includes(word));
  }

  static extractValue(message: string, fieldDef: any): any {
    const msgLower = message.toLowerCase();
    
    switch (fieldDef.type) {
      case 'boolean':
        if (msgLower.includes('enable') || msgLower.includes('turn on') || msgLower.includes('activate') || msgLower.includes(' on')) {
          return true;
        }
        if (msgLower.includes('disable') || msgLower.includes('turn off') || msgLower.includes('deactivate') || msgLower.includes(' off')) {
          return false;
        }
        // Default to true for enable-type commands
        return true;
        
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
    
    // Check if AI can execute this field
    if (!fieldDef.aiCanExecute) {
      console.log(`❌ EXECUTION_BLOCKED: Field "${field}" not executable by AI`);
      return { isValid: false, needsUpdate: false, message: `I cannot modify '${fieldDef.name}' directly. Please update it manually in ${fieldDef.uiLocation}.` };
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
  static async updateStrategyConfig(userId: string, strategyId: string, updates: any, currentStrategy: any): Promise<boolean> {
    console.log(`🔧 CONFIG_MANAGER: Processing updates for strategy ${strategyId}`);
    console.log(`📋 RAW_UPDATES: ${JSON.stringify(updates, null, 2)}`);
    
    // Convert field-based updates to nested config structure
    const strategyUpdates = {};
    const validatedUpdates = {};
    
    for (const [fieldName, newValue] of Object.entries(updates)) {
      console.log(`🔍 PROCESSING_FIELD: ${fieldName} = ${newValue}`);
      
      const fieldDef = FIELD_DEFINITIONS[fieldName];
      if (!fieldDef) {
        console.log(`❌ UNKNOWN_FIELD: ${fieldName}`);
        continue;
      }
      
      // Get current value for validation
      const currentValue = this.getCurrentValue(currentStrategy, fieldDef.dbPath);
      try {
        const validation = ValidationEngine.validateConfigChange(fieldName, newValue, currentValue);
        
        if (!validation.isValid) {
          console.log(`❌ VALIDATION_FAILED: ${fieldName} - ${validation.message}`);
          continue;
        }
        
        if (!validation.needsUpdate) {
          console.log(`ℹ️ NO_UPDATE_NEEDED: ${fieldName} - ${validation.message}`);
          continue;
        }
        
        // Store validated update
        validatedUpdates[fieldName] = newValue;
        
        // Convert to database path
        const dbPath = fieldDef.dbPath;
        if (dbPath) {
          this.setNestedValue(strategyUpdates, dbPath, newValue);
          console.log(`✅ MAPPED_TO_DB: ${fieldName} → ${dbPath} = ${newValue}`);
        }
        
      } catch (error) {
        console.error(`❌ ERROR_PROCESSING_FIELD: ${fieldName}`, error);
      }
    }
    
    console.log(`📤 FINAL_STRATEGY_UPDATES: ${JSON.stringify(strategyUpdates, null, 2)}`);
    
    if (Object.keys(validatedUpdates).length === 0) {
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

  static setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[keys[keys.length - 1]] = value;
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
    console.log(`🧠 DETECTED_INTENT: ${intent}`);
    
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
      console.log('ℹ️ NO_FIELD_MAPPINGS - Treating as general query');
      // No clear config intent - use general AI response
      return { message: await this.handleGeneralIntent(message, strategy, marketContext, memoryContext, interfaceContext) };
    }
    
    // Attempt to apply configuration changes
    console.log(`🔧 ATTEMPTING_CONFIG_UPDATE for strategy ${strategy.id}...`);
    const updateSuccess = await ConfigManager.updateStrategyConfig(
      strategy.user_id, 
      strategy.id, 
      potentialUpdates,
      strategy
    );

    if (updateSuccess) {
      console.log('✅ CONFIG_UPDATE_SUCCESS');
      
      // Generate success response mentioning the changes
      const updateMessages = [];
      for (const [fieldKey, value] of Object.entries(potentialUpdates)) {
        const fieldDef = FIELD_DEFINITIONS[fieldKey];
        if (fieldDef) {
          updateMessages.push(`✅ ${fieldDef.name}: ${value}${fieldDef.type === 'number' && fieldDef.range ? '%' : ''}`);
        }
      }
      
      return {
        message: `Strategy updated successfully!\n\n${updateMessages.join('\n')}`,
        hasConfigUpdates: true,
        configUpdates: potentialUpdates
      };
    } else {
      console.log('❌ CONFIG_UPDATE_FAILED');
      return {
        message: `I attempted to update your strategy settings but encountered an issue. Please check the configuration manually in the strategy settings.`,
        hasConfigUpdates: false
      };
    }
  }

  static async handleQuestionIntent(message: string, strategy: any, marketContext: string, memoryContext: string, interfaceContext: string): Promise<string> {
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    
    const systemPrompt = `You are a cryptocurrency trading assistant. Answer the user's question about their trading strategy, market conditions, or general trading concepts.

CURRENT STRATEGY: ${strategy.strategy_name}
${this.buildStrategyContext(strategy)}

${marketContext}

${memoryContext}

${interfaceContext}

Provide helpful, accurate information. Keep responses concise but informative.`;

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
        max_tokens: 500,
      }),
    });

    const data = await response.json();
    return data.choices[0].message.content;
  }

  static async handleGeneralIntent(message: string, strategy: any, marketContext: string, memoryContext: string, interfaceContext: string): Promise<string> {
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    
    const systemPrompt = `You are a cryptocurrency trading assistant. The user has sent a message that doesn't clearly request a specific configuration change.

CURRENT STRATEGY: ${strategy.strategy_name}
${this.buildStrategyContext(strategy)}

${marketContext}

${memoryContext}

${interfaceContext}

Provide helpful guidance or ask clarifying questions. If the user seems to want to change settings, guide them on how to express their request more clearly.`;

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
        max_tokens: 500,
      }),
    });

    const data = await response.json();
    return data.choices[0].message.content;
  }

  static buildMarketContext(signals: any[], news: any[]): string {
    if (!signals?.length && !news?.length) {
      return 'MARKET DATA: No recent market signals or news available.';
    }

    let context = 'RECENT MARKET DATA:\n';
    
    if (signals?.length > 0) {
      context += `Signals: ${signals.slice(0, 3).map(s => `${s.symbol}: ${s.signal_type} (${s.signal_strength})`).join(', ')}\n`;
    }
    
    if (news?.length > 0) {
      context += `News: ${news.slice(0, 2).map(n => n.headline).join(' | ')}\n`;
    }
    
    return context;
  }

  static buildStrategyContext(strategy: any): string {
    const config = strategy.configuration || {};
    
    return `STRATEGY CONFIGURATION:
- Strategy: ${strategy.strategy_name}
- AI Intelligence: ${config.aiIntelligenceConfig?.enableAIOverride ? 'Enabled' : 'Disabled'}
- Test Mode: ${strategy.test_mode ? 'Yes' : 'No'}
- Active: Test=${strategy.is_active_test}, Live=${strategy.is_active_live}`;
  }

  static buildInterfaceContext(): string {
    return `INTERFACE LOCATIONS:
Available settings can be found in:
- General → Notifications (trade alerts, error alerts)
- AI Intelligence → AI Intelligence Settings (AI controls, thresholds)
- Buying → Strategy (wallet exposure, profit targets)
- Selling → Sell Settings (take profit, stop loss, position management)
- Selling → Dollar Cost Averaging (DCA settings)

When making changes, I can update most settings directly. Just tell me what you want to change!`;
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

    const activeColumn = testMode ? 'is_active_test' : 'is_active_live';
    
    const { data, error } = await supabase
      .from('trading_strategies')
      .select('*')
      .eq('user_id', userId)
      .eq(activeColumn, true)
      .single();

    if (error) {
      console.log(`No active ${testMode ? 'test' : 'live'} strategy found for user ${userId}`);
      return null;
    }

    return data;
  }

  static async getStrategyById(userId: string, strategyId: string): Promise<any> {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from('trading_strategies')
      .select('*')
      .eq('id', strategyId)
      .eq('user_id', userId)
      .single();

    if (error) {
      console.log(`Strategy ${strategyId} not found for user ${userId}`);
      return null;
    }

    return data;
  }
}

// =============================================
// MARKET DATA FETCHER
// =============================================
class MarketDataFetcher {
  static async getRecentSignals(supabase: any): Promise<any[]> {
    const { data, error } = await supabase
      .from('live_signals')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(10);

    if (error) {
      console.log('No market signals available');
      return [];
    }

    return data || [];
  }

  static async getRecentNews(supabase: any): Promise<any[]> {
    const { data, error } = await supabase
      .from('crypto_news')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(5);

    if (error) {
      console.log('No crypto news available');
      return [];
    }

    return data || [];
  }
}

// =============================================
// CONVERSATION MEMORY
// =============================================
class ConversationMemory {
  static async getRecentHistory(supabase: any, userId: string, strategyId?: string): Promise<any[]> {
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

    if (error) {
      console.log('No conversation history available');
      return [];
    }

    return data || [];
  }

  static async recordUserMessage(supabase: any, userId: string, strategyId: string, message: string): Promise<void> {
    await supabase
      .from('conversation_history')
      .insert({
        user_id: userId,
        strategy_id: strategyId,
        message_type: 'user',
        content: message
      });
  }

  static async recordAIResponse(supabase: any, userId: string, strategyId: string, message: string): Promise<void> {
    await supabase
      .from('conversation_history')
      .insert({
        user_id: userId,
        strategy_id: strategyId,
        message_type: 'ai',
        content: message
      });
  }

  static buildContextPrompt(history: any[]): string {
    if (!history?.length) return '';
    
    return `RECENT CONVERSATION:\n${history
      .reverse()
      .slice(-6)
      .map(h => `${h.message_type.toUpperCase()}: ${h.content}`)
      .join('\n')}\n`;
  }
}