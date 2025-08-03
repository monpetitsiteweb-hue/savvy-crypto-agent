import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================
// FIELD DEFINITIONS - CANONICAL SOURCE OF TRUTH
// =============================================
const FIELD_DEFINITIONS: Record<string, any> = {
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
  maxWalletExposure: {
    key: 'maxWalletExposure',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Risk Management → Position Sizing → Wallet Exposure',
    dbPath: 'configuration.riskManagement.maxWalletExposure',
    csvMatch: 'Max Wallet Exposure',
    aiCanExecute: true,
    phrases: ['max wallet exposure', 'wallet exposure', 'exposure limit', 'maximum exposure'],
    description: 'Maximum percentage of wallet that can be exposed to trades'
  }
};

// =============================================
// NATURAL LANGUAGE PROCESSOR
// =============================================
class NaturalLanguageProcessor {
  static detectIntent(message: string): 'command' | 'question' {
    const lowerMessage = message.toLowerCase().trim();
    
    // Direct command patterns
    const commandPatterns = [
      /^(enable|disable|turn on|turn off|activate|deactivate)/,
      /^set .* to/,
      /^change .* to/,
      /^update .*/,
      /^configure/,
      /^adjust/,
      /^make .* (true|false|\d+)/
    ];
    
    // Check for explicit command patterns
    for (const pattern of commandPatterns) {
      if (pattern.test(lowerMessage)) {
        console.log(`🔧 COMMAND_DETECTED via pattern: ${pattern}`);
        return 'command';
      }
    }
    
    // Question patterns
    const questionPatterns = [
      /^(what|how|why|when|where|which|who)/,
      /\?$/,
      /^(is|are|can|could|would|should|do|does)/,
      /^(tell me|show me|explain)/,
      /^(status|health|check)/
    ];
    
    for (const pattern of questionPatterns) {
      if (pattern.test(lowerMessage)) {
        console.log(`❓ QUESTION_DETECTED via pattern: ${pattern}`);
        return 'question';
      }
    }
    
    // Default to question for safety
    console.log(`❓ DEFAULTING_TO_QUESTION`);
    return 'question';
  }

  static extractConfigUpdates(message: string): Record<string, any> {
    const updates: Record<string, any> = {};
    const lowerMessage = message.toLowerCase().trim();
    
    console.log(`🔍 EXTRACTING_CONFIG_UPDATES from: "${message}"`);
    
    // Process each field definition
    for (const [fieldKey, fieldDef] of Object.entries(FIELD_DEFINITIONS)) {
      // Check if any of the field's phrases match
      for (const phrase of fieldDef.phrases) {
        if (lowerMessage.includes(phrase.toLowerCase())) {
          console.log(`🎯 PHRASE_MATCH: "${phrase}" → ${fieldKey}`);
          
          // Extract value based on field type
          if (fieldDef.type === 'boolean') {
            const value = this.extractBooleanValue(lowerMessage, phrase);
            if (value !== null) {
              updates[fieldKey] = value;
              console.log(`✅ EXTRACTED_BOOLEAN: ${fieldKey} = ${value}`);
            }
          } else if (fieldDef.type === 'number') {
            const value = this.extractNumberValue(lowerMessage, phrase, fieldDef.range);
            if (value !== null) {
              updates[fieldKey] = value;
              console.log(`✅ EXTRACTED_NUMBER: ${fieldKey} = ${value}`);
            }
          }
          break; // Found a match for this field, move to next field
        }
      }
    }
    
    console.log(`🎯 FINAL_EXTRACTED_UPDATES: ${JSON.stringify(updates, null, 2)}`);
    return updates;
  }

  private static extractBooleanValue(message: string, phrase: string): boolean | null {
    const lowerMessage = message.toLowerCase();
    
    // Enable patterns
    if (lowerMessage.includes('enable') || lowerMessage.includes('turn on') || 
        lowerMessage.includes('activate') || lowerMessage.includes('on')) {
      return true;
    }
    
    // Disable patterns
    if (lowerMessage.includes('disable') || lowerMessage.includes('turn off') || 
        lowerMessage.includes('deactivate') || lowerMessage.includes('off')) {
      return false;
    }
    
    return null;
  }

  private static extractNumberValue(message: string, phrase: string, range?: [number, number]): number | null {
    const patterns = [
      /(\d+(?:\.\d+)?)\s*%/,  // "30%"
      /(\d+(?:\.\d+)?)/,      // "30"
      /to\s+(\d+(?:\.\d+)?)/,  // "to 30"
    ];
    
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        const value = parseFloat(match[1]);
        if (!isNaN(value)) {
          // Validate range if provided
          if (range && (value < range[0] || value > range[1])) {
            console.log(`⚠️ VALUE_OUT_OF_RANGE: ${value} not in [${range[0]}, ${range[1]}]`);
            continue;
          }
          return value;
        }
      }
    }
    
    return null;
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
    
    const strategyUpdates: any = {};
    const verificationResults: Record<string, any> = {};
    const errors: string[] = [];
    
    // STRICT RULE: Process ONLY the fields explicitly requested - NO SIDE EFFECTS
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
      
      // CRITICAL: No field shall affect another unless explicitly commanded
      // Convert to database path - ONLY touch the exact field requested
      const dbPath = fieldDef.dbPath;
      if (dbPath) {
        this.setNestedValue(strategyUpdates, dbPath, newValue);
        console.log(`✅ MAPPED_TO_DB: ${fieldKey} → ${dbPath} = ${newValue}`);
        
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
    
    if (Object.keys(strategyUpdates).length === 0) {
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
    
    // Detect intent
    const intent = NaturalLanguageProcessor.detectIntent(message);
    console.log(`🧠 DETECTED_INTENT: ${intent}`);
    
    if (intent === 'question') {
      console.log('🤔 QUESTION DETECTED - No config changes will be made');
      return new Response(
        JSON.stringify({ 
          response: ResponseFormatter.formatQuestionResponse(),
          success: true 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Process command
    console.log('⚡ COMMAND DETECTED - Processing potential config changes');
    console.log(`🔍 MAPPING_USER_INTENT: "${message}"`);
    
    const potentialUpdates = NaturalLanguageProcessor.extractConfigUpdates(message);
    
    if (Object.keys(potentialUpdates).length === 0) {
      return new Response(
        JSON.stringify({ 
          response: '❓ I understood this as a command, but couldn\'t identify which configuration to change. Could you be more specific?',
          success: false 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Execute configuration update
    console.log(`🔧 ATTEMPTING_CONFIG_UPDATE for strategy ${strategy.id}...`);
    
    const result = await ConfigManager.updateStrategyConfig(
      strategy.user_id, 
      strategy.id, 
      potentialUpdates,
      strategy
    );

    if (result.success) {
      console.log('✅ CONFIG_UPDATE_SUCCESS');
      return new Response(
        JSON.stringify({ 
          response: ResponseFormatter.formatSuccessResponse(
            'Configuration updated successfully',
            result.verificationResults
          ),
          success: true 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      console.log('❌ CONFIG_UPDATE_FAILED');
      return new Response(
        JSON.stringify({ 
          response: ResponseFormatter.formatErrorResponse(
            'Configuration update failed',
            result.errors
          ),
          success: false 
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