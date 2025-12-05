import { DEFAULT_VALUES, ALLOWED_OVERRIDE_KEYS } from './configDefaults';

// AI Configuration Helpers - Unified precedence and value source tracking

interface ValueSource {
  source: 'user_config' | 'ai_feature' | 'ai_override';
  timestamp?: number;
}

interface EffectiveConfig {
  tpPct: number;
  slPct: number;
  enterThreshold: number;
  exitThreshold: number;
  spreadThresholdBps: number;
  minDepthRatio: number;
  whaleConflictWindowMs: number;
  perTradeAllocation: number;
  allocationUnit: string;
}

interface EffectiveConfigWithSources extends EffectiveConfig {
  value_sources: Record<keyof EffectiveConfig, ValueSource>;
}

// Compute effective configuration with three-layer precedence
// IMPORTANT: spreadThresholdBps and minDepthRatio are ALWAYS user-controlled
// They are NEVER overridden by AI features
export function computeEffectiveConfig(
  strategyConfig: any,
  aiOverrides?: Record<string, any>
): EffectiveConfigWithSources {
  const now = Date.now();
  
  // Layer 1: User strategy config (baseline)
  // spreadThresholdBps and minDepthRatio come ONLY from user config
  const userConfig = {
    tpPct: strategyConfig.takeProfitPercentage || DEFAULT_VALUES.TAKE_PROFIT_PCT,
    slPct: strategyConfig.stopLossPercentage || DEFAULT_VALUES.STOP_LOSS_PCT,
    enterThreshold: DEFAULT_VALUES.ENTER_THRESHOLD,
    exitThreshold: DEFAULT_VALUES.EXIT_THRESHOLD,
    // These two are USER-CONTROLLED ONLY - check strategy config first, then defaults
    spreadThresholdBps: strategyConfig.spreadThresholdBps ?? DEFAULT_VALUES.SPREAD_THRESHOLD_BPS,
    minDepthRatio: strategyConfig.minDepthRatio ?? DEFAULT_VALUES.MIN_DEPTH_RATIO,
    whaleConflictWindowMs: DEFAULT_VALUES.WHALE_CONFLICT_WINDOW_MS,
    perTradeAllocation: strategyConfig.perTradeAllocation || DEFAULT_VALUES.PER_TRADE_ALLOCATION,
    allocationUnit: strategyConfig.allocationUnit || DEFAULT_VALUES.ALLOCATION_UNIT
  };

  // Layer 2: AI features (if enabled)
  const aiConfig = strategyConfig.aiIntelligenceConfig;
  const effectiveConfig = { ...userConfig };
  const valueSources: Record<string, ValueSource> = {};

  // Initialize all as user_config
  Object.keys(effectiveConfig).forEach(key => {
    valueSources[key] = { source: 'user_config' };
  });

  // Apply AI features if enabled - BUT NOT for spread/depth gates
  if (aiConfig?.features?.fusion?.enabled) {
    effectiveConfig.enterThreshold = aiConfig.features.fusion.enterThreshold ?? effectiveConfig.enterThreshold;
    effectiveConfig.exitThreshold = aiConfig.features.fusion.exitThreshold ?? effectiveConfig.exitThreshold;
    valueSources.enterThreshold = { source: 'ai_feature' };
    valueSources.exitThreshold = { source: 'ai_feature' };
  }

  // NOTE: spreadThresholdBps and minDepthRatio are NEVER overridden by AI features
  // They remain as user_config source always
  // Only whaleConflictWindowMs can be AI-controlled if needed
  if (aiConfig?.features?.contextGates?.whaleConflictWindowMs) {
    effectiveConfig.whaleConflictWindowMs = aiConfig.features.contextGates.whaleConflictWindowMs;
    valueSources.whaleConflictWindowMs = { source: 'ai_feature' };
  }

  if (aiConfig?.features?.bracketPolicy) {
    const brackets = aiConfig.features.bracketPolicy;
    if (brackets.stopLossPctWhenNotAtr) {
      effectiveConfig.slPct = brackets.stopLossPctWhenNotAtr;
      valueSources.slPct = { source: 'ai_feature' };
    }
  }

  // Layer 3: AI overrides (scoped + time-limited, within guardrails)
  if (aiOverrides && aiConfig?.features?.overridesPolicy) {
    const policy = aiConfig.features.overridesPolicy;
    const allowedKeys = policy.allowedKeys || [];
    const bounds = policy.bounds || {};
    const ttlMs = policy.ttlMs || 900000; // 15 minutes default

    Object.entries(aiOverrides).forEach(([key, override]: [string, any]) => {
      if (
        allowedKeys.includes(key) &&
        override.timestamp &&
        (now - override.timestamp) < ttlMs
      ) {
        const value = override.value;
        
        // Apply bounds checking using centralized defaults
        const boundsConfig = DEFAULT_VALUES.OVERRIDE_BOUNDS;
        if (key === 'slPct') {
          const [min, max] = boundsConfig.slPct;
          if (value >= min && value <= max) {
            effectiveConfig.slPct = value;
            valueSources.slPct = { source: 'ai_override', timestamp: override.timestamp };
          }
        } else if (key === 'tpPct') {
          const minTp = effectiveConfig.slPct * boundsConfig.tpOverSlMin;
          if (value >= minTp) {
            effectiveConfig.tpPct = value;
            valueSources.tpPct = { source: 'ai_override', timestamp: override.timestamp };
          }
        } else if (['enterThreshold', 'exitThreshold'].includes(key)) {
          if (value >= 0.1 && value <= 1.0) {
            (effectiveConfig as any)[key] = value;
            valueSources[key] = { source: 'ai_override', timestamp: override.timestamp };
          }
        }
      }
    });
  }

  return {
    ...effectiveConfig,
    value_sources: valueSources as Record<keyof EffectiveConfig, ValueSource>
  };
}

// Backward compatibility helpers
export function getFusionConfig(strategyConfig: any) {
  // New path first, fallback to old
  return strategyConfig.aiIntelligenceConfig?.features?.fusion || strategyConfig.signalFusion;
}

export function getContextGatesConfig(strategyConfig: any) {
  return strategyConfig.aiIntelligenceConfig?.features?.contextGates || strategyConfig.contextGates;
}

export function getBracketPolicyConfig(strategyConfig: any) {
  return strategyConfig.aiIntelligenceConfig?.features?.bracketPolicy || strategyConfig.brackets;
}

// Check if AI features are enabled (replaces "ScalpSmart" checks)
export function isAIFusionEnabled(strategyConfig: any): boolean {
  const fusionConfig = getFusionConfig(strategyConfig);
  return fusionConfig?.enabled === true;
}

// Migration utility - moves old config to new structure
export function migrateToUnifiedConfig(oldConfig: any) {
  const newConfig = { ...oldConfig };
  
  // Only migrate if new structure doesn't exist
  if (!newConfig.aiIntelligenceConfig?.features) {
    newConfig.aiIntelligenceConfig = newConfig.aiIntelligenceConfig || {};
    newConfig.aiIntelligenceConfig.features = {
      fusion: oldConfig.signalFusion || {
        enabled: false,
        weights: DEFAULT_VALUES.FUSION_WEIGHTS,
        enterThreshold: DEFAULT_VALUES.ENTER_THRESHOLD,
        exitThreshold: DEFAULT_VALUES.EXIT_THRESHOLD,
        conflictPenalty: 0.30
      },
      contextGates: oldConfig.contextGates || {
        spreadThresholdBps: DEFAULT_VALUES.SPREAD_THRESHOLD_BPS,
        minDepthRatio: DEFAULT_VALUES.MIN_DEPTH_RATIO,
        whaleConflictWindowMs: DEFAULT_VALUES.WHALE_CONFLICT_WINDOW_MS
      },
      bracketPolicy: oldConfig.brackets || DEFAULT_VALUES.BRACKET_POLICY,
      overridesPolicy: {
        allowedKeys: [...ALLOWED_OVERRIDE_KEYS],
        bounds: DEFAULT_VALUES.OVERRIDE_BOUNDS,
        ttlMs: DEFAULT_VALUES.OVERRIDE_TTL_MS
      }
    };
  }
  
  return newConfig;
}