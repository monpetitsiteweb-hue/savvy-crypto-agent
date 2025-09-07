// Configuration Defaults - Centralized defaults to eliminate hardcoded values

export const DEFAULT_VALUES = {
  // Percentage values (percent points) - Updated for stability
  TAKE_PROFIT_PCT: 1.5, // Increased from 0.65 to prevent instant sells
  STOP_LOSS_PCT: 0.8,   // Increased from 0.40 to prevent instant sells
  
  // Thresholds (normalized 0-1)
  ENTER_THRESHOLD: 0.65,
  EXIT_THRESHOLD: 0.35,
  
  // Context Gates
  SPREAD_THRESHOLD_BPS: 15, // Tightened from 20 for better execution
  MIN_DEPTH_RATIO: 2.0,
  WHALE_CONFLICT_WINDOW_MS: 600000, // 10 minutes
  
  // Allocation
  PER_TRADE_ALLOCATION: 50,
  ALLOCATION_UNIT: 'euro' as const,
  
  // AI Features
  AUTONOMY_LEVEL: 25,
  CONFIDENCE_THRESHOLD: 70,
  
  // Fusion Weights
  FUSION_WEIGHTS: {
    trend: 0.25,
    volatility: 0.20,
    momentum: 0.25,
    whale: 0.15,
    sentiment: 0.15
  },
  
  // Bracket Policy - Updated for stability
  BRACKET_POLICY: {
    atrScaled: false,
    stopLossPctWhenNotAtr: 0.8,  // Increased from 0.40
    trailBufferPct: 0.4,
    enforceRiskReward: true,
    minTpSlRatio: 1.2,
    atrMultipliers: { tp: 2.6, sl: 2.0 }
  },
  
  // Override Bounds
  OVERRIDE_BOUNDS: {
    slPct: [0.15, 1.00] as [number, number],
    tpOverSlMin: 1.2
  },
  
  // TTL for overrides (15 minutes) 
  OVERRIDE_TTL_MS: 900000,
  
  // New guardrail defaults (Phase 2)
  MIN_HOLD_PERIOD_MS: 300000,      // 5 minutes
  COOLDOWN_BETWEEN_ACTIONS_MS: 180000, // 3 minutes  
  PRICE_STALE_MAX_MS: 15000,       // 15 seconds
  EPSILON_PNL_BUFFER_PCT: 0.03     // 0.03% buffer
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