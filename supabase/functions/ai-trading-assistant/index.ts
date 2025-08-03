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
  },
  trailingStopPercentage: {
    key: 'trailingStopPercentage',
    type: 'number',
    range: [0, 100],
    uiLocation: 'Risk Management → Stop Loss → Trailing Stop',
    dbPath: 'configuration.riskManagement.trailingStopPercentage',
    csvMatch: 'Trailing Stop Percentage',
    aiCanExecute: true,
    phrases: ['trailing stop percentage', 'trailing stop', 'set trailing stop', 'trailing stop %'],
    description: 'Percentage for trailing stop loss orders'
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
      
      // CRITICAL FIX: Use merging logic to preserve other fields in the same nested object
      const dbPath = fieldDef.dbPath;
      if (dbPath) {
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
          // For non-aiIntelligenceConfig fields, use the original setNestedValue logic
          this.setNestedValue(strategyUpdates, dbPath, newValue);
        }
        
        console.log(`✅ MAPPED_TO_DB: ${fieldKey} → ${dbPath} = ${newValue}`);
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
    
    // Convert value to correct type
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