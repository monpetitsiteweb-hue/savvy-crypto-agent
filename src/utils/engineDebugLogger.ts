// Engine Debug Logger - Structured logging for intelligent engine decisions

export interface SymbolDecisionLog {
  symbol: string;
  timestamp: string;
  hasValidBullishSignal: boolean;
  hasValidBearishSignal: boolean;
  blockedByCooldown: boolean;
  cooldownRemainingMs?: number;
  blockedByExposure: boolean;
  exposureDetails?: { current: number; limit: number };
  blockedByMaxActiveCoins: boolean;
  activeCoinsDetails?: { current: number; limit: number };
  signalFusionResult: 'bullish' | 'bearish' | 'neutral' | 'weak' | 'conflicting' | 'no_signals';
  finalDecision: string;
  reason: string;
}

export interface CycleLog {
  cycleId: string;
  timestamp: string;
  mode: 'INTELLIGENT_AUTO' | 'TEST_ALWAYS_BUY' | 'FORCED_DEBUG';
  symbolDecisions: SymbolDecisionLog[];
  intentEmitted: boolean;
  intentSymbol?: string;
  intentSide?: 'BUY' | 'SELL';
}

const DEBUG_HISTORY_KEY = '__INTELLIGENT_DEBUG_HISTORY';
const MAX_HISTORY = 50;

function getHistory(): CycleLog[] {
  if (typeof window === 'undefined') return [];
  return (window as any)[DEBUG_HISTORY_KEY] || [];
}

function setHistory(history: CycleLog[]): void {
  if (typeof window === 'undefined') return;
  (window as any)[DEBUG_HISTORY_KEY] = history.slice(-MAX_HISTORY);
}

/**
 * Log a complete engine cycle with all symbol decisions
 */
export function logEngineCycle(cycle: CycleLog): void {
  const history = getHistory();
  history.push(cycle);
  setHistory(history);
  
  // Console output
  console.log(`[Engine][Cycle ${cycle.cycleId}] Mode: ${cycle.mode}`);
  cycle.symbolDecisions.forEach(d => {
    console.log(`  [${d.symbol}] ${d.finalDecision} - ${d.reason}`);
  });
  if (cycle.intentEmitted) {
    console.log(`  ✅ Intent emitted: ${cycle.intentSide} ${cycle.intentSymbol}`);
  } else {
    console.log(`  ⏸️ No intent emitted this cycle`);
  }
}

/**
 * Create a symbol decision log entry
 */
export function createSymbolDecision(
  symbol: string,
  checks: {
    hasValidBullishSignal?: boolean;
    hasValidBearishSignal?: boolean;
    blockedByCooldown?: boolean;
    cooldownRemainingMs?: number;
    blockedByExposure?: boolean;
    exposureCurrent?: number;
    exposureLimit?: number;
    blockedByMaxActiveCoins?: boolean;
    activeCoins?: number;
    maxActiveCoins?: number;
    signalFusionResult?: SymbolDecisionLog['signalFusionResult'];
  },
  finalDecision: string,
  reason: string
): SymbolDecisionLog {
  return {
    symbol,
    timestamp: new Date().toISOString(),
    hasValidBullishSignal: checks.hasValidBullishSignal ?? false,
    hasValidBearishSignal: checks.hasValidBearishSignal ?? false,
    blockedByCooldown: checks.blockedByCooldown ?? false,
    cooldownRemainingMs: checks.cooldownRemainingMs,
    blockedByExposure: checks.blockedByExposure ?? false,
    exposureDetails: checks.exposureCurrent !== undefined ? {
      current: checks.exposureCurrent,
      limit: checks.exposureLimit ?? 0
    } : undefined,
    blockedByMaxActiveCoins: checks.blockedByMaxActiveCoins ?? false,
    activeCoinsDetails: checks.activeCoins !== undefined ? {
      current: checks.activeCoins,
      limit: checks.maxActiveCoins ?? 0
    } : undefined,
    signalFusionResult: checks.signalFusionResult ?? 'no_signals',
    finalDecision,
    reason
  };
}

/**
 * Get debug history, optionally filtered by symbol
 */
export function getDebugHistory(symbol?: string): CycleLog[] {
  const history = getHistory();
  if (!symbol) return history;
  
  return history.map(cycle => ({
    ...cycle,
    symbolDecisions: cycle.symbolDecisions.filter(d => 
      d.symbol.includes(symbol) || symbol.includes(d.symbol.replace('-EUR', ''))
    )
  })).filter(cycle => cycle.symbolDecisions.length > 0);
}

/**
 * Clear debug history
 */
export function clearDebugHistory(): void {
  setHistory([]);
  console.log('[EngineDebug] History cleared');
}

// Expose globally
if (typeof window !== 'undefined') {
  (window as any).__GET_ENGINE_DEBUG = getDebugHistory;
  (window as any).__CLEAR_ENGINE_DEBUG = clearDebugHistory;
}
