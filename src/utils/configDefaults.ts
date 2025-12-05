// Configuration Defaults - Centralized defaults to eliminate hardcoded values
// Production-ready values for real trading

export const DEFAULT_VALUES = {
  // Percentage values (percent points)
  TAKE_PROFIT_PCT: 2.5,
  STOP_LOSS_PCT: 1.5,
  
  // Thresholds (normalized 0-1) - 0 means any signal triggers
  ENTER_THRESHOLD: 0.0,
  EXIT_THRESHOLD: 0.0,
  
  // Context Gates - USER CONFIGURABLE (not AI override)
  // These are sensible production defaults
  SPREAD_THRESHOLD_BPS: 25,    // 25 bps = 0.25% spread allowed
  MIN_DEPTH_RATIO: 0.2,        // Low depth requirement for liquidity
  WHALE_CONFLICT_WINDOW_MS: 300000, // 5 minutes
  
  // Validation bounds for UI
  SPREAD_THRESHOLD_BPS_MIN: 0.1,
  SPREAD_THRESHOLD_BPS_MAX: 200,
  MIN_DEPTH_RATIO_MIN: 0,
  MIN_DEPTH_RATIO_MAX: 3,
  
  // Allocation
  PER_TRADE_ALLOCATION: 50,
  ALLOCATION_UNIT: 'euro' as const,
  
  // AI Features
  AUTONOMY_LEVEL: 50,
  CONFIDENCE_THRESHOLD: 0.5,
  
  // Fusion Weights
  FUSION_WEIGHTS: {
    trend: 0.25,
    volatility: 0.20,
    momentum: 0.25,
    whale: 0.15,
    sentiment: 0.15
  },
  
  // Bracket Policy
  BRACKET_POLICY: {
    atrScaled: false,
    stopLossPctWhenNotAtr: 1.5,
    trailBufferPct: 0.5,
    enforceRiskReward: true,
    minTpSlRatio: 1.5,
    atrMultipliers: { tp: 2.0, sl: 1.5 }
  },
  
  // Override Bounds
  OVERRIDE_BOUNDS: {
    slPct: [0.5, 10.0] as [number, number],
    tpOverSlMin: 1.2
  },
  
  // TTL for overrides (15 minutes) 
  OVERRIDE_TTL_MS: 900000,
  
  // Guardrail defaults
  MIN_HOLD_PERIOD_MS: 60000,        // 1 minute minimum hold
  COOLDOWN_BETWEEN_ACTIONS_MS: 30000, // 30 seconds cooldown
  PRICE_STALE_MAX_MS: 60000,        // Price stale after 1 minute
  EPSILON_PNL_BUFFER_PCT: 0.1       // 0.1% buffer
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
