/**
 * Strategy Serialization / Deserialization Utilities
 * 
 * Provides deterministic export/import of strategy configurations
 * with schema validation and safe field filtering.
 * 
 * CRITICAL: Only fields that actively affect engine behavior are exported.
 * Deprecated / inactive fields are explicitly excluded.
 */

import { z } from 'zod';
import { PRESET_RISK_FIELDS } from './strategyPresets';

// Current schema version
export const STRATEGY_SCHEMA_VERSION = 'v1';

// ============================================================================
// EXPLICIT WHITELISTS - Only these fields are exported
// ============================================================================

/**
 * The 12 Risk Profile fields (single source of truth from strategyPresets.ts)
 */
export const RISK_FIELDS = PRESET_RISK_FIELDS;

/**
 * Signal configuration fields actually consumed by coordinator
 */
export const SIGNAL_FIELDS = [
  'selectedCoins',
  'enableTechnicalIndicators',
  'enableSignalFusion',
  'signalWeights',
] as const;

/**
 * Execution settings actually consumed by coordinator
 */
export const EXECUTION_FIELDS = [
  'execution_mode',
  'chain_id',
  'slippage_bps_default',
  'preferred_providers',
  'mev_policy',
  'max_gas_cost_pct',
  'max_price_impact_bps',
  'max_quote_age_ms',
] as const;

/**
 * Unified decisions fields actually consumed by coordinator
 */
export const UNIFIED_DECISIONS_FIELDS = [
  'enableUnifiedDecisions',
  'minHoldPeriodMs',
  'cooldownBetweenOppositeActionsMs',
  'confidenceOverrideThreshold',
] as const;

/**
 * Pool exit configuration fields
 */
export const POOL_EXIT_FIELDS = [
  'pool_enabled',
  'secure_pct',
  'secure_tp_pct',
  'secure_sl_pct',
  'runner_trail_pct',
  'runner_arm_pct',
  'qty_tick',
  'price_tick',
  'min_order_notional',
  'maxBullOverrideDurationMs',
] as const;

/**
 * Market quality gate fields
 */
export const MARKET_QUALITY_FIELDS = [
  'spreadThresholdBps',
  'priceStaleMaxMs',
  'minDepthRatio',
] as const;

/**
 * Per-symbol override key (contains nested overrides)
 */
export const OVERRIDE_FIELDS = [
  'symbolOverrides',
] as const;

// ============================================================================
// EXPLICIT EXCLUSIONS - Deprecated / inactive fields
// ============================================================================

/**
 * Deprecated fields that must NEVER be exported.
 * Derived from DeprecatedFieldsPanel.tsx DEPRECATED_FIELDS
 */
export const DEPRECATED_FIELD_KEYS = [
  // Order types (legacy)
  'buyOrderType',
  'sellOrderType',
  'trailingBuyPercentage',
  // DCA settings (not implemented)
  'enableDCA',
  'dcaIntervalHours',
  'dcaSteps',
  // Shorting settings (not implemented)
  'enableShorting',
  'maxShortPositions',
  'shortingMinProfitPercentage',
  'autoCloseShorts',
  // Legacy AI settings
  'learningRate',
  'patternRecognition',
  'sentimentWeight',
  'whaleWeight',
  // Legacy trading limits
  'dailyProfitTarget',
  'dailyLossLimit', // Coming soon, not active
  'maxTradesPerDay',
  'maxTotalTrades',
  'tradeCooldownMinutes',
  'autoCloseAfterHours',
  // Buy scheduling (legacy)
  'buyFrequency',
  'buyIntervalMinutes',
  'buyCooldownMinutes',
  // Advanced legacy
  'resetStopLossAfterFail',
  'useTrailingStopOnly',
  'backtestingMode',
] as const;

/**
 * Fields that should NEVER be exported (security/privacy/runtime)
 */
export const EXCLUDED_RUNTIME_FIELDS = [
  'id',
  'user_id',
  'strategy_id',
  'wallet_id',
  'wallet_address',
  'api_key',
  'api_secret',
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

// ============================================================================
// ZOD SCHEMA - Structured export format
// ============================================================================

const RiskConfigSchema = z.object({
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
});

const SignalsConfigSchema = z.object({
  selectedCoins: z.array(z.string()).optional(),
  enableTechnicalIndicators: z.boolean().optional(),
  enableSignalFusion: z.boolean().optional(),
  signalWeights: z.record(z.string(), z.number()).optional(),
}).passthrough();

const ExecutionConfigSchema = z.object({
  execution_mode: z.enum(['COINBASE', 'ONCHAIN']).optional(),
  chain_id: z.number().optional(),
  slippage_bps_default: z.number().optional(),
  preferred_providers: z.array(z.string()).optional(),
  mev_policy: z.enum(['auto', 'force_private', 'cow_only']).optional(),
  max_gas_cost_pct: z.number().optional(),
  max_price_impact_bps: z.number().optional(),
  max_quote_age_ms: z.number().optional(),
}).passthrough();

const UnifiedDecisionsConfigSchema = z.object({
  enableUnifiedDecisions: z.boolean().optional(),
  minHoldPeriodMs: z.number().optional(),
  cooldownBetweenOppositeActionsMs: z.number().optional(),
  confidenceOverrideThreshold: z.number().optional(),
}).passthrough();

const PoolExitConfigSchema = z.object({
  pool_enabled: z.boolean().optional(),
  secure_pct: z.number().optional(),
  secure_tp_pct: z.number().optional(),
  secure_sl_pct: z.number().optional(),
  runner_trail_pct: z.number().optional(),
  runner_arm_pct: z.number().optional(),
  qty_tick: z.number().optional(),
  price_tick: z.number().optional(),
  min_order_notional: z.number().optional(),
  maxBullOverrideDurationMs: z.number().optional(),
}).passthrough();

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
    risk: RiskConfigSchema,
    signals: SignalsConfigSchema.optional(),
    execution: ExecutionConfigSchema.optional(),
    unifiedDecisions: UnifiedDecisionsConfigSchema.optional(),
    poolExit: PoolExitConfigSchema.optional(),
    symbolOverrides: z.record(z.string(), z.any()).optional(),
  }),
});

export type ExportedStrategy = z.infer<typeof ExportedStrategySchema>;

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serialize a strategy for export - ONLY whitelisted fields
 */
export function serializeStrategy(strategy: {
  strategy_name: string;
  description?: string;
  configuration: Record<string, any>;
  created_at?: string;
}): ExportedStrategy {
  const config = strategy.configuration || {};
  const riskProfile = config.riskProfile || 'custom';
  
  // Extract ONLY the 12 risk fields
  const risk = {
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
  
  // Extract signals config (only whitelisted fields)
  const signals: Record<string, any> = {};
  for (const key of SIGNAL_FIELDS) {
    if (config[key] !== undefined) {
      signals[key] = config[key];
    }
  }
  
  // Extract execution config from nested object or flat config
  const executionSource = config.executionSettings || config;
  const execution: Record<string, any> = {};
  for (const key of EXECUTION_FIELDS) {
    if (executionSource[key] !== undefined) {
      execution[key] = executionSource[key];
    }
  }
  
  // Extract unified decisions config from nested object or flat config
  const unifiedSource = config.unifiedConfig || config;
  const unifiedDecisions: Record<string, any> = {};
  for (const key of UNIFIED_DECISIONS_FIELDS) {
    if (unifiedSource[key] !== undefined) {
      unifiedDecisions[key] = unifiedSource[key];
    }
  }
  
  // Extract pool exit config from nested object or flat config
  const poolSource = config.poolExitConfig || config;
  const poolExit: Record<string, any> = {};
  for (const key of POOL_EXIT_FIELDS) {
    if (poolSource[key] !== undefined) {
      poolExit[key] = poolSource[key];
    }
  }
  
  // Extract symbol overrides if present
  const symbolOverrides = config.symbolOverrides || undefined;
  
  return {
    strategyVersion: STRATEGY_SCHEMA_VERSION,
    metadata: {
      name: strategy.strategy_name,
      riskProfile,
      createdAt: strategy.created_at || new Date().toISOString(),
      exportedAt: new Date().toISOString(),
      notes: strategy.description || undefined,
    },
    configuration: {
      risk,
      signals: Object.keys(signals).length > 0 ? signals : undefined,
      execution: Object.keys(execution).length > 0 ? execution : undefined,
      unifiedDecisions: Object.keys(unifiedDecisions).length > 0 ? unifiedDecisions : undefined,
      poolExit: Object.keys(poolExit).length > 0 ? poolExit : undefined,
      symbolOverrides,
    },
  };
}

// ============================================================================
// DESERIALIZATION
// ============================================================================

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  deprecatedFieldsDetected: string[];
  data?: ExportedStrategy;
}

/**
 * Check if raw JSON contains deprecated fields
 */
function detectDeprecatedFields(json: unknown): string[] {
  const detected: string[] = [];
  
  if (typeof json !== 'object' || json === null) return detected;
  
  const checkObject = (obj: Record<string, any>, path = '') => {
    for (const key of Object.keys(obj)) {
      const fullPath = path ? `${path}.${key}` : key;
      
      if (DEPRECATED_FIELD_KEYS.includes(key as any)) {
        detected.push(fullPath);
      }
      
      // Recurse into nested objects
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        checkObject(obj[key], fullPath);
      }
    }
  };
  
  checkObject(json as Record<string, any>);
  return detected;
}

/**
 * Migrate old flat format to new structured format
 */
function migrateToStructuredFormat(json: any): any {
  // If already in new format, return as-is
  if (json.configuration?.risk) {
    return json;
  }
  
  // Migrate from flat configuration to structured
  const oldConfig = json.configuration || {};
  
  return {
    ...json,
    configuration: {
      risk: {
        maxWalletExposure: oldConfig.maxWalletExposure,
        perTradeAllocation: oldConfig.perTradeAllocation,
        maxActiveCoins: oldConfig.maxActiveCoins,
        takeProfitPercentage: oldConfig.takeProfitPercentage,
        stopLossPercentage: oldConfig.stopLossPercentage,
        trailingStopLossPercentage: oldConfig.trailingStopLossPercentage,
        min_confidence: oldConfig.min_confidence,
        minTrendScoreForBuy: oldConfig.minTrendScoreForBuy,
        minMomentumScoreForBuy: oldConfig.minMomentumScoreForBuy,
        maxVolatilityScoreForBuy: oldConfig.maxVolatilityScoreForBuy,
        stopLossCooldownMs: oldConfig.stopLossCooldownMs,
        minEntrySpacingMs: oldConfig.minEntrySpacingMs,
      },
      signals: {
        selectedCoins: oldConfig.selectedCoins,
        enableTechnicalIndicators: oldConfig.enableTechnicalIndicators,
        enableSignalFusion: oldConfig.enableSignalFusion,
        signalWeights: oldConfig.signalWeights,
      },
      execution: oldConfig.executionSettings,
      unifiedDecisions: oldConfig.unifiedConfig,
      poolExit: oldConfig.poolExitConfig,
      symbolOverrides: oldConfig.symbolOverrides,
    },
  };
}

/**
 * Deserialize and validate an imported strategy
 */
export function deserializeStrategy(json: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Detect deprecated fields in raw JSON (before migration)
  const deprecatedFieldsDetected = detectDeprecatedFields(json);
  
  if (deprecatedFieldsDetected.length > 0) {
    warnings.push(`Detected ${deprecatedFieldsDetected.length} deprecated field(s): ${deprecatedFieldsDetected.join(', ')}. These will be ignored.`);
  }
  
  // Migrate old format if needed
  const migratedJson = migrateToStructuredFormat(json);
  
  // Parse with Zod
  const result = ExportedStrategySchema.safeParse(migratedJson);
  
  if (!result.success) {
    // Extract meaningful error messages
    for (const issue of result.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return { valid: false, errors, warnings, deprecatedFieldsDetected };
  }
  
  const data = result.data;
  
  // Check for version compatibility
  if (data.strategyVersion !== STRATEGY_SCHEMA_VERSION) {
    warnings.push(`Strategy version ${data.strategyVersion} may have compatibility issues with current version ${STRATEGY_SCHEMA_VERSION}`);
  }
  
  // Validate risk profile consistency
  if (data.metadata.riskProfile !== 'custom') {
    const presetName = data.metadata.riskProfile;
    warnings.push(`Strategy claims "${presetName}" risk profile - fields will be locked unless you switch to Custom mode`);
  }
  
  return { valid: true, errors, warnings, deprecatedFieldsDetected, data };
}

// ============================================================================
// CONVERSION HELPERS
// ============================================================================

/**
 * Convert exported strategy to flat form data format (for UI consumption)
 */
export function exportedStrategyToFormData(exported: ExportedStrategy): Record<string, any> {
  const { configuration, metadata } = exported;
  
  return {
    strategyName: metadata.name,
    riskProfile: metadata.riskProfile,
    notes: metadata.notes || '',
    
    // Flatten risk fields
    ...configuration.risk,
    
    // Flatten signals
    ...(configuration.signals || {}),
    
    // Execution settings as nested object (UI expects this)
    executionSettings: configuration.execution,
    
    // Unified config as nested object
    unifiedConfig: configuration.unifiedDecisions,
    
    // Pool exit config as nested object
    poolExitConfig: configuration.poolExit,
    
    // Symbol overrides
    symbolOverrides: configuration.symbolOverrides,
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
  // Handle both flat and nested formats
  const risk = config.risk || config;
  
  return [
    { field: 'maxWalletExposure', label: 'Max Wallet Exposure', value: `${risk.maxWalletExposure}%` },
    { field: 'perTradeAllocation', label: 'Per Trade Allocation', value: `€${risk.perTradeAllocation}` },
    { field: 'maxActiveCoins', label: 'Max Active Coins', value: `${risk.maxActiveCoins}` },
    { field: 'takeProfitPercentage', label: 'Take Profit', value: `${risk.takeProfitPercentage}%` },
    { field: 'stopLossPercentage', label: 'Stop Loss', value: `${risk.stopLossPercentage}%` },
    { field: 'trailingStopLossPercentage', label: 'Trailing Stop', value: `${risk.trailingStopLossPercentage}%` },
    { field: 'min_confidence', label: 'Min Confidence', value: `${(risk.min_confidence * 100).toFixed(0)}%` },
    { field: 'minTrendScoreForBuy', label: 'Min Trend Score', value: `${(risk.minTrendScoreForBuy * 100).toFixed(0)}%` },
    { field: 'minMomentumScoreForBuy', label: 'Min Momentum', value: `${(risk.minMomentumScoreForBuy * 100).toFixed(0)}%` },
    { field: 'maxVolatilityScoreForBuy', label: 'Max Volatility', value: `${(risk.maxVolatilityScoreForBuy * 100).toFixed(0)}%` },
    { field: 'stopLossCooldownMs', label: 'SL Cooldown', value: formatMs(risk.stopLossCooldownMs) },
    { field: 'minEntrySpacingMs', label: 'Entry Spacing', value: formatMs(risk.minEntrySpacingMs) },
  ];
}

function formatMs(ms: number): string {
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(1)}h`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(0)}m`;
  return `${(ms / 1000).toFixed(0)}s`;
}
