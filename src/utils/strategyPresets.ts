/**
 * Strategy Risk Presets - JSON-based risk profile configurations
 * 
 * These presets define ALL effective risk levers that actually control
 * trading behavior in the backend engine (trading-decision-coordinator).
 * 
 * CANONICAL LIST OF 11 EFFECTIVE LEVERS (consumed by coordinator):
 * 1. maxWalletExposure - % of wallet that can be exposed
 * 2. perTradeAllocation - EUR per trade
 * 3. maxActiveCoins - Max concurrent positions
 * 4. takeProfitPercentage - Take profit %
 * 5. stopLossPercentage - Stop loss %
 * 6. trailingStopLossPercentage - Trailing stop %
 * 7. min_confidence - Minimum fusion confidence (0-1)
 * 8. minTrendScoreForBuy - Minimum trend score gate (0-1)
 * 9. minMomentumScoreForBuy - Minimum momentum score gate (0-1)
 * 10. maxVolatilityScoreForBuy - Maximum volatility score gate (0-1)
 * 11. stopLossCooldownMs - Cooldown after SL exit before re-entry
 * 12. minEntrySpacingMs - Minimum time between entries on same symbol
 */

export interface StrategyPreset {
  riskProfile: 'low' | 'medium' | 'high';
  
  // === ALL 11+ EFFECTIVE RISK LEVERS (consumed by coordinator) ===
  
  // Position Sizing & Exposure
  maxWalletExposure: number;          // % of wallet that can be exposed
  perTradeAllocation: number;          // EUR per trade
  maxActiveCoins: number;              // Max concurrent positions
  
  // Exit Thresholds (TP/SL)
  takeProfitPercentage: number;        // Take profit %
  stopLossPercentage: number;          // Stop loss %
  trailingStopLossPercentage: number;  // Trailing stop %
  
  // Confidence Gate
  min_confidence: number;              // 0-1, minimum fusion confidence
  
  // Signal Gate Thresholds (CRITICAL - enforced by coordinator)
  minTrendScoreForBuy: number;         // 0-1, minimum trend score
  minMomentumScoreForBuy: number;      // 0-1, minimum momentum score
  maxVolatilityScoreForBuy: number;    // 0-1, maximum volatility score
  
  // Timing Gates (anti-churn)
  stopLossCooldownMs: number;          // ms to wait after SL exit before re-entry
  minEntrySpacingMs: number;           // ms minimum between entries on same symbol
}

/**
 * Fields that are locked when a preset is selected (not 'custom' mode).
 * This is the SINGLE SOURCE OF TRUTH used by both UI and AI agent.
 * Keep this list in sync with StrategyPreset interface fields.
 */
export const PRESET_LOCKED_FIELDS = [
  'maxWalletExposure',
  'perTradeAllocation',
  'maxActiveCoins',
  'takeProfitPercentage',
  'stopLossPercentage',
  'trailingStopLossPercentage',
  'min_confidence',
  'minTrendScoreForBuy',
  'minMomentumScoreForBuy',
  'maxVolatilityScoreForBuy',
  'stopLossCooldownMs',
  'minEntrySpacingMs',
] as const;

export type PresetLockedField = typeof PRESET_LOCKED_FIELDS[number];

/**
 * HIGH RISK PRESET
 * Based on CURRENT ACTIVE PRODUCTION STRATEGY (High Risk Momentum Trader).
 * Extracted from DB: trading_strategies.configuration where strategy_name = 'High Risk Momentum Trader'
 * 
 * Characteristics:
 * - Aggressive entry thresholds (low gate scores = more trades)
 * - Tight TP/SL (scalping style)
 * - High exposure (80% wallet)
 * - Short cooldowns (quick re-entry)
 */
export const HIGH_RISK_PRESET: StrategyPreset = {
  riskProfile: 'high',
  
  // Position Sizing - Aggressive (from current live strategy)
  maxWalletExposure: 80,
  perTradeAllocation: 600,
  maxActiveCoins: 4,
  
  // Exit Thresholds - Tight scalping (from current live strategy)
  takeProfitPercentage: 0.7,
  stopLossPercentage: 0.7,
  trailingStopLossPercentage: 1.0,
  
  // Confidence - Lower threshold (from current live strategy)
  min_confidence: 0.50,
  
  // Signal Gates - Very Permissive (from current live strategy)
  minTrendScoreForBuy: 0.1,
  minMomentumScoreForBuy: 0.1,
  maxVolatilityScoreForBuy: 0.8,
  
  // Timing - Short cooldowns (from current live strategy)
  stopLossCooldownMs: 300000,    // 5 minutes
  minEntrySpacingMs: 600000,     // 10 minutes
};

/**
 * MEDIUM RISK PRESET
 * Derived from HIGH baseline with sensible risk reductions.
 * 
 * Changes from HIGH:
 * - Less exposure (50% vs 80%)
 * - Smaller positions (€350 vs €600)
 * - Stricter entry gates (more selective trades)
 * - Wider TP/SL (swing style vs scalping)
 * - Longer cooldowns (less churn)
 */
export const MEDIUM_RISK_PRESET: StrategyPreset = {
  riskProfile: 'medium',
  
  // Position Sizing - Moderate
  maxWalletExposure: 50,           // -30% from HIGH (less at risk)
  perTradeAllocation: 350,         // -42% from HIGH (smaller bets)
  maxActiveCoins: 3,               // -1 from HIGH (fewer concurrent)
  
  // Exit Thresholds - Wider (swing trading)
  takeProfitPercentage: 1.8,       // +157% from HIGH (let winners run more)
  stopLossPercentage: 1.2,         // +71% from HIGH (more room to breathe)
  trailingStopLossPercentage: 1.5, // +50% from HIGH (wider trail)
  
  // Confidence - Moderate threshold
  min_confidence: 0.60,            // +20% from HIGH (more selective)
  
  // Signal Gates - Moderate (selective but not strict)
  minTrendScoreForBuy: 0.30,       // +200% from HIGH (need clearer trend)
  minMomentumScoreForBuy: 0.25,    // +150% from HIGH (need some momentum)
  maxVolatilityScoreForBuy: 0.65,  // -19% from HIGH (avoid chop)
  
  // Timing - Moderate cooldowns
  stopLossCooldownMs: 600000,      // 10 minutes (2x HIGH)
  minEntrySpacingMs: 900000,       // 15 minutes (1.5x HIGH)
};

/**
 * LOW RISK PRESET
 * Conservative approach with strict gates and limited exposure.
 * 
 * Changes from HIGH:
 * - Minimal exposure (25% vs 80%)
 * - Small positions (€150 vs €600)
 * - Very strict entry gates (quality over quantity)
 * - Wide TP/SL (position trading)
 * - Long cooldowns (minimal churn)
 */
export const LOW_RISK_PRESET: StrategyPreset = {
  riskProfile: 'low',
  
  // Position Sizing - Conservative
  maxWalletExposure: 25,           // -69% from HIGH (minimal risk)
  perTradeAllocation: 150,         // -75% from HIGH (small bets)
  maxActiveCoins: 2,               // -50% from HIGH (very focused)
  
  // Exit Thresholds - Wide (position trading)
  takeProfitPercentage: 3.0,       // +329% from HIGH (let winners run)
  stopLossPercentage: 1.5,         // +114% from HIGH (tight risk)
  trailingStopLossPercentage: 2.0, // +100% from HIGH (wide trail)
  
  // Confidence - High threshold
  min_confidence: 0.72,            // +44% from HIGH (high conviction only)
  
  // Signal Gates - Strict (quality trades only)
  minTrendScoreForBuy: 0.50,       // +400% from HIGH (strong trend required)
  minMomentumScoreForBuy: 0.45,    // +350% from HIGH (strong momentum required)
  maxVolatilityScoreForBuy: 0.50,  // -38% from HIGH (avoid volatility)
  
  // Timing - Long cooldowns (no FOMO)
  stopLossCooldownMs: 1200000,     // 20 minutes (4x HIGH)
  minEntrySpacingMs: 1800000,      // 30 minutes (3x HIGH)
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
 * Apply preset to form data - updates ALL effective levers
 * Returns merged config with preset values applied
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
    
    // Confidence
    min_confidence: preset.min_confidence,
    
    // Signal Gates
    minTrendScoreForBuy: preset.minTrendScoreForBuy,
    minMomentumScoreForBuy: preset.minMomentumScoreForBuy,
    maxVolatilityScoreForBuy: preset.maxVolatilityScoreForBuy,
    
    // Timing Gates
    stopLossCooldownMs: preset.stopLossCooldownMs,
    minEntrySpacingMs: preset.minEntrySpacingMs,
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
      formData.min_confidence === preset.min_confidence &&
      formData.minTrendScoreForBuy === preset.minTrendScoreForBuy &&
      formData.minMomentumScoreForBuy === preset.minMomentumScoreForBuy &&
      formData.maxVolatilityScoreForBuy === preset.maxVolatilityScoreForBuy;
    
    if (matches) {
      return preset.riskProfile;
    }
  }
  
  return 'custom';
}

/**
 * Check if a field is locked in the current risk profile
 */
export function isFieldLocked(riskProfile: string, fieldName: string): boolean {
  if (riskProfile === 'custom') {
    return false;
  }
  return PRESET_LOCKED_FIELDS.includes(fieldName as PresetLockedField);
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
