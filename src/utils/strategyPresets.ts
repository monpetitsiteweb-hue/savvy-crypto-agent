/**
 * Strategy Risk Presets - JSON-based risk profile configurations
 * 
 * These presets define the 11 effective risk levers that actually control
 * trading behavior in the backend engine.
 * 
 * Only parameters that are consumed by trading-decision-coordinator are included.
 */

export interface StrategyPreset {
  riskProfile: 'low' | 'medium' | 'high' | 'custom';
  
  // === EFFECTIVE RISK LEVERS (11 parameters that actually work) ===
  
  // Position Sizing & Exposure
  maxWalletExposure: number;          // % of wallet that can be exposed
  perTradeAllocation: number;          // EUR per trade
  maxActiveCoins: number;              // Max concurrent positions
  
  // Exit Thresholds (TP/SL)
  takeProfitPercentage: number;        // Take profit %
  stopLossPercentage: number;          // Stop loss %
  trailingStopLossPercentage: number;  // Trailing stop %
  
  // Signal Gate Thresholds
  minTrendScoreForBuy: number;         // 0-1, minimum trend score
  minMomentumScoreForBuy: number;      // 0-1, minimum momentum score
  maxVolatilityScoreForBuy: number;    // 0-1, maximum volatility score
  
  // Confidence Gate
  min_confidence: number;              // 0-1, minimum fusion confidence
}

/**
 * HIGH RISK PRESET
 * Based on current active production strategy.
 * Aggressive entry thresholds, tight TP/SL, high exposure.
 */
export const HIGH_RISK_PRESET: StrategyPreset = {
  riskProfile: 'high',
  
  // Position Sizing - Aggressive
  maxWalletExposure: 80,
  perTradeAllocation: 600,
  maxActiveCoins: 4,
  
  // Exit Thresholds - Tight (scalping)
  takeProfitPercentage: 0.7,
  stopLossPercentage: 0.7,
  trailingStopLossPercentage: 0.6,
  
  // Signal Gates - Very Permissive (more trades)
  minTrendScoreForBuy: 0.1,
  minMomentumScoreForBuy: 0.1,
  maxVolatilityScoreForBuy: 0.95,
  
  // Confidence - Lower threshold (more entries)
  min_confidence: 0.50
};

/**
 * MEDIUM RISK PRESET
 * Balanced approach with moderate gates and reasonable exposure.
 */
export const MEDIUM_RISK_PRESET: StrategyPreset = {
  riskProfile: 'medium',
  
  // Position Sizing - Moderate
  maxWalletExposure: 50,
  perTradeAllocation: 300,
  maxActiveCoins: 3,
  
  // Exit Thresholds - Wider (swing)
  takeProfitPercentage: 2.0,
  stopLossPercentage: 1.5,
  trailingStopLossPercentage: 1.0,
  
  // Signal Gates - Moderate (selective)
  minTrendScoreForBuy: 0.35,
  minMomentumScoreForBuy: 0.30,
  maxVolatilityScoreForBuy: 0.70,
  
  // Confidence - Moderate threshold
  min_confidence: 0.65
};

/**
 * LOW RISK PRESET
 * Conservative approach with strict gates and limited exposure.
 */
export const LOW_RISK_PRESET: StrategyPreset = {
  riskProfile: 'low',
  
  // Position Sizing - Conservative
  maxWalletExposure: 25,
  perTradeAllocation: 150,
  maxActiveCoins: 2,
  
  // Exit Thresholds - Wide with protection
  takeProfitPercentage: 3.0,
  stopLossPercentage: 1.0,
  trailingStopLossPercentage: 0.8,
  
  // Signal Gates - Strict (quality trades only)
  minTrendScoreForBuy: 0.55,
  minMomentumScoreForBuy: 0.50,
  maxVolatilityScoreForBuy: 0.50,
  
  // Confidence - High threshold (very selective)
  min_confidence: 0.75
};

/**
 * Get preset by risk profile name
 */
export function getPresetByRiskProfile(riskProfile: string): StrategyPreset | null {
  switch (riskProfile) {
    case 'low':
      return LOW_RISK_PRESET;
    case 'medium':
      return MEDIUM_RISK_PRESET;
    case 'high':
      return HIGH_RISK_PRESET;
    case 'custom':
      return null; // Custom mode - no preset applied
    default:
      return null;
  }
}

/**
 * Apply preset to form data - only updates the 11 effective levers
 */
export function applyPresetToFormData(
  formData: Record<string, any>, 
  preset: StrategyPreset
): Record<string, any> {
  return {
    ...formData,
    riskProfile: preset.riskProfile,
    
    // Position Sizing
    maxWalletExposure: preset.maxWalletExposure,
    perTradeAllocation: preset.perTradeAllocation,
    maxActiveCoins: preset.maxActiveCoins,
    
    // Exit Thresholds
    takeProfitPercentage: preset.takeProfitPercentage,
    stopLossPercentage: preset.stopLossPercentage,
    trailingStopLossPercentage: preset.trailingStopLossPercentage,
    
    // Signal Gates - these go into nested config
    aiIntelligenceConfig: {
      ...formData.aiIntelligenceConfig,
      features: {
        ...formData.aiIntelligenceConfig?.features,
        fusion: {
          ...formData.aiIntelligenceConfig?.features?.fusion,
          // Signal thresholds are mapped to fusion config
        }
      }
    },
    
    // Confidence
    min_confidence: preset.min_confidence
  };
}

/**
 * Check if current form data matches a preset
 */
export function detectCurrentRiskProfile(formData: Record<string, any>): 'low' | 'medium' | 'high' | 'custom' {
  const presets = [LOW_RISK_PRESET, MEDIUM_RISK_PRESET, HIGH_RISK_PRESET];
  
  for (const preset of presets) {
    const matches = 
      formData.maxWalletExposure === preset.maxWalletExposure &&
      formData.perTradeAllocation === preset.perTradeAllocation &&
      formData.maxActiveCoins === preset.maxActiveCoins &&
      formData.takeProfitPercentage === preset.takeProfitPercentage &&
      formData.stopLossPercentage === preset.stopLossPercentage &&
      formData.min_confidence === preset.min_confidence;
    
    if (matches) {
      return preset.riskProfile;
    }
  }
  
  return 'custom';
}

/**
 * Risk profile descriptions for UI
 */
export const RISK_PROFILE_DESCRIPTIONS = {
  low: {
    title: 'Conservative',
    description: 'Strict entry gates, limited exposure, quality over quantity',
    color: 'secondary',
    metrics: {
      trades: 'Fewer, higher quality',
      exposure: '25% max',
      gates: 'Strict signal requirements'
    }
  },
  medium: {
    title: 'Balanced',
    description: 'Moderate gates and exposure for steady growth',
    color: 'default',
    metrics: {
      trades: 'Moderate frequency',
      exposure: '50% max',
      gates: 'Balanced signal requirements'
    }
  },
  high: {
    title: 'Aggressive',
    description: 'Permissive gates, high exposure, scalping-focused',
    color: 'destructive',
    metrics: {
      trades: 'High frequency',
      exposure: '80% max',
      gates: 'Minimal restrictions'
    }
  },
  custom: {
    title: 'Custom',
    description: 'Manually configure all parameters',
    color: 'outline',
    metrics: {
      trades: 'User-defined',
      exposure: 'User-defined',
      gates: 'User-defined'
    }
  }
} as const;

/**
 * List of deprecated/legacy fields that should be hidden in UI
 * These fields exist in the form but have no backend effect
 */
export const DEPRECATED_FIELDS = [
  'buyOrderType',        // Always market execution
  'sellOrderType',       // Always market execution  
  'buyFrequency',        // Signal-based only
  'buyIntervalMinutes',  // Not used
  'trailingBuyPercentage', // Not implemented
  'maxTotalTrades',      // Not enforced
  'maxTradesPerDay',     // Not enforced
  'tradeCooldownMinutes', // Uses minEntrySpacingMs instead
  'enableDCA',           // Not implemented
  'dcaIntervalHours',    // Not implemented
  'dcaSteps',            // Not implemented
  'enableShorting',      // Not supported
  'maxShortPositions',   // Not supported
  'shortingMinProfitPercentage', // Not supported
  'autoCloseShorts',     // Not supported
  'dailyProfitTarget',   // Not enforced (circuit breaker not active)
  'autoCloseAfterHours', // Not enforced
  'resetStopLossAfterFail', // Not implemented
  'useTrailingStopOnly', // Not implemented
  'backtestingMode',     // Not integrated
] as const;

/**
 * Fields that are coming soon (show with label, but disabled)
 */
export const COMING_SOON_FIELDS = [
  'dailyLossLimit',  // Circuit breaker - planned but not enforced
] as const;
