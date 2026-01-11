/**
 * Strategy Serialization / Deserialization Utilities
 * 
 * Provides deterministic export/import of strategy configurations
 * with schema validation and safe field filtering.
 */

import { z } from 'zod';
import { PRESET_RISK_FIELDS } from './strategyPresets';

// Current schema version
export const STRATEGY_SCHEMA_VERSION = 'v1';

/**
 * Exported strategy schema with Zod validation
 */
export const ExportedStrategySchema = z.object({
  strategyVersion: z.literal('v1'),
  metadata: z.object({
    name: z.string().min(1, 'Strategy name is required'),
    riskProfile: z.enum(['low', 'medium', 'high', 'custom']),
    createdAt: z.string(),
    exportedAt: z.string(),
    notes: z.string().optional(),
  }),
  configuration: z.object({
    // The 12 Risk Profile fields
    maxWalletExposure: z.number().min(0).max(100),
    perTradeAllocation: z.number().min(0),
    maxActiveCoins: z.number().min(1).max(50),
    takeProfitPercentage: z.number().min(0),
    stopLossPercentage: z.number().min(0),
    trailingStopLossPercentage: z.number().min(0),
    min_confidence: z.number().min(0).max(1),
    minTrendScoreForBuy: z.number().min(0).max(1),
    minMomentumScoreForBuy: z.number().min(0).max(1),
    maxVolatilityScoreForBuy: z.number().min(0).max(1),
    stopLossCooldownMs: z.number().min(0),
    minEntrySpacingMs: z.number().min(0),
    
    // Selected coins
    selectedCoins: z.array(z.string()).optional(),
    
    // Execution settings (non-risk fields)
    minHoldPeriodMs: z.number().optional(),
    cooldownBetweenOppositeActionsMs: z.number().optional(),
    
    // Pool exit config
    poolExitConfig: z.object({
      pool_enabled: z.boolean(),
      secure_pct: z.number(),
      secure_tp_pct: z.number(),
      secure_sl_pct: z.number().optional(),
      runner_trail_pct: z.number(),
      runner_arm_pct: z.number(),
      qty_tick: z.number(),
      price_tick: z.number(),
      min_order_notional: z.number(),
    }).optional(),
    
    // Unified decisions config
    unifiedConfig: z.object({
      enableUnifiedDecisions: z.boolean(),
      minHoldPeriodMs: z.number(),
      cooldownBetweenOppositeActionsMs: z.number(),
      confidenceOverrideThreshold: z.number(),
    }).optional(),
    
    // Execution settings
    executionSettings: z.object({
      execution_mode: z.enum(['COINBASE', 'ONCHAIN']),
      chain_id: z.number(),
      slippage_bps_default: z.number(),
      preferred_providers: z.array(z.string()),
      mev_policy: z.enum(['auto', 'force_private', 'cow_only']),
      max_gas_cost_pct: z.number(),
      max_price_impact_bps: z.number(),
      max_quote_age_ms: z.number(),
    }).optional(),
    
    // Per-symbol overrides
    symbolOverrides: z.record(z.string(), z.any()).optional(),
    
    // AI intelligence config (optional, non-risk)
    aiIntelligenceConfig: z.any().optional(),
    
    // Technical indicator config (optional)
    technicalIndicatorConfig: z.any().optional(),
    
    // Market quality gates
    spreadThresholdBps: z.number().optional(),
    priceStaleMaxMs: z.number().optional(),
    minDepthRatio: z.number().optional(),
  }).passthrough(), // Allow additional fields for forward compatibility
});

export type ExportedStrategy = z.infer<typeof ExportedStrategySchema>;

/**
 * Fields that should NEVER be exported (security/privacy)
 */
const EXCLUDED_FIELDS = [
  'id',
  'user_id',
  'strategy_id',
  'wallet_id',
  'wallet_address',
  'api_key',
  'api_secret',
  'execution_mode', // Top-level, use executionSettings instead
  'is_active',
  'is_active_test',
  'is_active_live',
  'test_mode',
  'is_test_mode',
  'created_at',
  'updated_at',
  'last_executed_at',
  'open_position_count',
  'total_pnl',
  'win_rate',
] as const;

/**
 * Serialize a strategy for export
 */
export function serializeStrategy(strategy: {
  strategy_name: string;
  description?: string;
  configuration: Record<string, any>;
  created_at?: string;
}): ExportedStrategy {
  const config = strategy.configuration || {};
  
  // Extract the 12 risk profile fields with safe defaults
  const riskProfile = config.riskProfile || 'custom';
  
  // Build clean configuration without excluded fields
  const cleanConfig: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(config)) {
    if (!EXCLUDED_FIELDS.includes(key as any)) {
      cleanConfig[key] = value;
    }
  }
  
  // Ensure all 12 risk fields have values
  const exportedConfig = {
    ...cleanConfig,
    maxWalletExposure: config.maxWalletExposure ?? 50,
    perTradeAllocation: config.perTradeAllocation ?? 100,
    maxActiveCoins: config.maxActiveCoins ?? 5,
    takeProfitPercentage: config.takeProfitPercentage ?? 2.5,
    stopLossPercentage: config.stopLossPercentage ?? 3.0,
    trailingStopLossPercentage: config.trailingStopLossPercentage ?? 2.0,
    min_confidence: config.min_confidence ?? 0.65,
    minTrendScoreForBuy: config.minTrendScoreForBuy ?? 0.3,
    minMomentumScoreForBuy: config.minMomentumScoreForBuy ?? 0.25,
    maxVolatilityScoreForBuy: config.maxVolatilityScoreForBuy ?? 0.65,
    stopLossCooldownMs: config.stopLossCooldownMs ?? 600000,
    minEntrySpacingMs: config.minEntrySpacingMs ?? 900000,
  };
  
  return {
    strategyVersion: STRATEGY_SCHEMA_VERSION,
    metadata: {
      name: strategy.strategy_name,
      riskProfile,
      createdAt: strategy.created_at || new Date().toISOString(),
      exportedAt: new Date().toISOString(),
      notes: strategy.description || undefined,
    },
    configuration: exportedConfig,
  };
}

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: ExportedStrategy;
}

/**
 * Deserialize and validate an imported strategy
 */
export function deserializeStrategy(json: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Parse with Zod
  const result = ExportedStrategySchema.safeParse(json);
  
  if (!result.success) {
    // Extract meaningful error messages
    for (const issue of result.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }
  
  const data = result.data;
  
  // Check for version compatibility
  if (data.strategyVersion !== STRATEGY_SCHEMA_VERSION) {
    warnings.push(`Strategy version ${data.strategyVersion} may have compatibility issues with current version ${STRATEGY_SCHEMA_VERSION}`);
  }
  
  // Validate risk profile consistency
  if (data.metadata.riskProfile !== 'custom') {
    // Check if the 12 risk fields match the claimed preset
    // This is a soft check - just warn if mismatch
    const presetName = data.metadata.riskProfile;
    warnings.push(`Strategy claims "${presetName}" risk profile - fields will be locked unless you switch to Custom mode`);
  }
  
  return { valid: true, errors, warnings, data };
}

/**
 * Convert exported strategy to form data format
 */
export function exportedStrategyToFormData(exported: ExportedStrategy): Record<string, any> {
  return {
    strategyName: exported.metadata.name,
    riskProfile: exported.metadata.riskProfile,
    notes: exported.metadata.notes || '',
    ...exported.configuration,
  };
}

/**
 * Generate a safe filename for download
 */
export function generateExportFilename(strategyName: string): string {
  const safeName = strategyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const timestamp = new Date().toISOString().slice(0, 10);
  return `strategy-${safeName}-${timestamp}.json`;
}

/**
 * Download a strategy as JSON file
 */
export function downloadStrategyAsJson(strategy: ExportedStrategy, filename: string): void {
  const jsonString = JSON.stringify(strategy, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Read a JSON file and parse it
 */
export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const json = JSON.parse(text);
        resolve(json);
      } catch (error) {
        reject(new Error('Invalid JSON file'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsText(file);
  });
}

/**
 * Get summary of the 12 risk profile fields for preview
 */
export function getRiskFieldsSummary(config: Record<string, any>): Array<{
  field: string;
  label: string;
  value: string;
}> {
  return [
    { field: 'maxWalletExposure', label: 'Max Wallet Exposure', value: `${config.maxWalletExposure}%` },
    { field: 'perTradeAllocation', label: 'Per Trade Allocation', value: `€${config.perTradeAllocation}` },
    { field: 'maxActiveCoins', label: 'Max Active Coins', value: `${config.maxActiveCoins}` },
    { field: 'takeProfitPercentage', label: 'Take Profit', value: `${config.takeProfitPercentage}%` },
    { field: 'stopLossPercentage', label: 'Stop Loss', value: `${config.stopLossPercentage}%` },
    { field: 'trailingStopLossPercentage', label: 'Trailing Stop', value: `${config.trailingStopLossPercentage}%` },
    { field: 'min_confidence', label: 'Min Confidence', value: `${(config.min_confidence * 100).toFixed(0)}%` },
    { field: 'minTrendScoreForBuy', label: 'Min Trend Score', value: `${(config.minTrendScoreForBuy * 100).toFixed(0)}%` },
    { field: 'minMomentumScoreForBuy', label: 'Min Momentum', value: `${(config.minMomentumScoreForBuy * 100).toFixed(0)}%` },
    { field: 'maxVolatilityScoreForBuy', label: 'Max Volatility', value: `${(config.maxVolatilityScoreForBuy * 100).toFixed(0)}%` },
    { field: 'stopLossCooldownMs', label: 'SL Cooldown', value: formatMs(config.stopLossCooldownMs) },
    { field: 'minEntrySpacingMs', label: 'Entry Spacing', value: formatMs(config.minEntrySpacingMs) },
  ];
}

function formatMs(ms: number): string {
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(1)}h`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(0)}m`;
  return `${(ms / 1000).toFixed(0)}s`;
}
