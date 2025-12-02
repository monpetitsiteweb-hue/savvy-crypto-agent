// Configuration Defaults - Centralized defaults to eliminate hardcoded values
// ⚠️ TESTING MODE: All thresholds set to MINIMUM for testing

export const DEFAULT_VALUES = {
  // Percentage values (percent points) - TESTING: very loose
  TAKE_PROFIT_PCT: 0.01, // TESTING: ultra low
  STOP_LOSS_PCT: 0.01,   // TESTING: ultra low
  
  // Thresholds (normalized 0-1) - TESTING: no barriers
  ENTER_THRESHOLD: 0.0,  // TESTING: any signal triggers entry
  EXIT_THRESHOLD: 0.0,   // TESTING: any signal triggers exit
  
  // Context Gates - TESTING: disabled/very loose
  SPREAD_THRESHOLD_BPS: 9999, // TESTING: effectively disabled
  MIN_DEPTH_RATIO: 0.0,       // TESTING: no liquidity check
  WHALE_CONFLICT_WINDOW_MS: 0, // TESTING: no whale conflict check
  
  // Allocation
  PER_TRADE_ALLOCATION: 50,
  ALLOCATION_UNIT: 'euro' as const,
  
  // AI Features - TESTING: lowest thresholds
  AUTONOMY_LEVEL: 100,       // TESTING: full autonomy
  CONFIDENCE_THRESHOLD: 0,   // TESTING: no confidence required
  
  // Fusion Weights
  FUSION_WEIGHTS: {
    trend: 0.25,
    volatility: 0.20,
    momentum: 0.25,
    whale: 0.15,
    sentiment: 0.15
  },
  
  // Bracket Policy - TESTING: very loose
  BRACKET_POLICY: {
    atrScaled: false,
    stopLossPctWhenNotAtr: 0.01,  // TESTING: ultra low
    trailBufferPct: 0.01,
    enforceRiskReward: false,     // TESTING: disabled
    minTpSlRatio: 0.0,            // TESTING: no ratio required
    atrMultipliers: { tp: 0.1, sl: 0.1 }
  },
  
  // Override Bounds - TESTING: very loose
  OVERRIDE_BOUNDS: {
    slPct: [0.0, 100.0] as [number, number],
    tpOverSlMin: 0.0
  },
  
  // TTL for overrides (15 minutes) 
  OVERRIDE_TTL_MS: 900000,
  
  // Guardrail defaults - TESTING: disabled
  MIN_HOLD_PERIOD_MS: 0,           // TESTING: no hold period
  COOLDOWN_BETWEEN_ACTIONS_MS: 0,  // TESTING: no cooldown
  PRICE_STALE_MAX_MS: 9999999,     // TESTING: price never stale
  EPSILON_PNL_BUFFER_PCT: 0.0      // TESTING: no buffer
} as const;

export const ALLOWED_OVERRIDE_KEYS = [
  'tpPct', 
  'slPct', 
  'enterThreshold', 
  'exitThreshold'
] as const;

// Market availability defaults
export const MARKET_DEFAULTS = {
  BASE_CURRENCY: 'EUR',
  UNAVAILABLE_REASON: 'market_unavailable',
  COINBASE_API_BASE: 'https://api.exchange.coinbase.com'
} as const;
