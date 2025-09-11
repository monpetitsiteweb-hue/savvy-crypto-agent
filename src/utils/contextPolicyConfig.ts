// Context-Aware Policy Configuration
// Preparation for moving all gate enforcement to the coordinator

export interface ContextGateThresholds {
  spread: {
    threshold: number;
    enforce: boolean;
  };
  liquidity: {
    threshold: number;
    enforce: boolean;
  };
  freshness: {
    threshold: number;
    enforce: boolean;
  };
  whaleConflict: {
    windowMs: number;
    enforce: boolean;
  };
  cooldown: {
    periodMs: number;
    enforce: boolean;
  };
  holdPeriod: {
    periodMs: number;
    enforce: boolean;
  };
}

export interface ContextPolicyConfig {
  ENTRY: ContextGateThresholds;
  TP: ContextGateThresholds;
  SL: ContextGateThresholds;
  MANUAL: ContextGateThresholds;
}

export const DEFAULT_CONTEXT_POLICY: ContextPolicyConfig = {
  ENTRY: {
    spread: { threshold: 15, enforce: true },
    liquidity: { threshold: 3.0, enforce: true },
    freshness: { threshold: 15000, enforce: true },
    whaleConflict: { windowMs: 600000, enforce: true },
    cooldown: { periodMs: 180000, enforce: true },
    holdPeriod: { periodMs: 300000, enforce: true }
  },
  TP: {
    spread: { threshold: 25, enforce: true }, // Relaxed for TP exits
    liquidity: { threshold: 1.0, enforce: false }, // BYPASSED for TP
    freshness: { threshold: 30000, enforce: true }, // Relaxed for TP
    whaleConflict: { windowMs: 600000, enforce: false }, // BYPASSED for TP
    cooldown: { periodMs: 180000, enforce: false }, // BYPASSED for TP
    holdPeriod: { periodMs: 300000, enforce: false } // BYPASSED for TP
  },
  SL: {
    spread: { threshold: 30, enforce: true }, // Most relaxed for SL
    liquidity: { threshold: 2.0, enforce: true }, // Still enforced for SL
    freshness: { threshold: 20000, enforce: true },
    whaleConflict: { windowMs: 600000, enforce: false }, // BYPASSED for SL
    cooldown: { periodMs: 180000, enforce: false }, // BYPASSED for SL
    holdPeriod: { periodMs: 300000, enforce: false } // BYPASSED for SL
  },
  MANUAL: {
    spread: { threshold: 20, enforce: true },
    liquidity: { threshold: 2.5, enforce: true },
    freshness: { threshold: 20000, enforce: true },
    whaleConflict: { windowMs: 600000, enforce: true },
    cooldown: { periodMs: 90000, enforce: true }, // Reduced for manual trades
    holdPeriod: { periodMs: 150000, enforce: true } // Reduced for manual trades
  }
};

export interface GateEvaluation {
  gateName: string;
  threshold: number;
  value: number;
  pass: boolean;
  enforced: boolean;
  reason?: string;
}

export interface GateTrace {
  context: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  evaluations: GateEvaluation[];
  overallPass: boolean;
  blockingGates: string[];
  timestamp: string;
}

/**
 * Creates a gate trace for comprehensive decision logging
 * This will be used when we centralize policy enforcement in the coordinator
 */
export function createGateTrace(
  context: 'ENTRY' | 'TP' | 'SL' | 'MANUAL',
  symbol: string,
  side: 'BUY' | 'SELL',
  evaluations: GateEvaluation[]
): GateTrace {
  const blockingGates = evaluations
    .filter(e => e.enforced && !e.pass)
    .map(e => e.gateName);

  return {
    context,
    symbol,
    side,
    evaluations,
    overallPass: blockingGates.length === 0,
    blockingGates,
    timestamp: new Date().toISOString()
  };
}

/**
 * Get gate thresholds for a specific context
 */
export function getContextGateConfig(
  context: 'ENTRY' | 'TP' | 'SL' | 'MANUAL',
  customConfig?: Partial<ContextPolicyConfig>
): ContextGateThresholds {
  const baseConfig = customConfig?.[context] || DEFAULT_CONTEXT_POLICY[context];
  return baseConfig;
}