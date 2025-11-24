/**
 * Signal Fusion Module
 * 
 * Computes a fused signal score from multiple live signals for trading decisions.
 * 
 * Architecture:
 * 1. Query recent signals from live_signals table based on symbol and horizon
 * 2. Join with signal_registry for weights and enabled status
 * 3. Apply per-strategy overrides from strategy_signal_weights
 * 4. Normalize signal strengths and compute weighted contributions
 * 5. Return fused score (-100 to +100) and detailed breakdown
 */

// Type definitions for new tables
interface SignalRegistryEntry {
  id: string;
  key: string;
  category: string;
  description: string | null;
  default_weight: number;
  min_weight: number;
  max_weight: number;
  direction_hint: string;
  timeframe_hint: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface StrategySignalWeight {
  id: string;
  strategy_id: string;
  signal_key: string;
  weight: number | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SignalDetail {
  signalId: string;
  signalType: string;
  source: string;
  rawStrength: number;
  normalizedStrength: number;
  appliedWeight: number;
  contribution: number;
  timestamp: string;
}

export interface FusedSignalResult {
  fusedScore: number;  // -100 to +100
  details: SignalDetail[];
  totalSignals: number;
  enabledSignals: number;
}

export interface ComputeFusedSignalParams {
  supabaseClient: any; // Supabase client instance
  userId: string;
  strategyId: string;
  symbol: string;
  side: 'BUY' | 'SELL'; // Added for future directional weighting
  horizon: '15m' | '1h' | '4h' | '24h';
  now?: Date;
}

// Lookback windows based on horizon
const LOOKBACK_WINDOWS: Record<string, number> = {
  '15m': 30 * 60 * 1000,  // 30 minutes in ms
  '1h': 2 * 60 * 60 * 1000,  // 2 hours
  '4h': 8 * 60 * 60 * 1000,  // 8 hours
  '24h': 48 * 60 * 60 * 1000  // 48 hours
};

/**
 * Normalize signal strength to 0-1 scale
 */
function normalizeSignalStrength(rawStrength: number): number {
  // Most signals are 0-100 scale, normalize to 0-1
  if (rawStrength <= 1) {
    // Already 0-1 scale
    return Math.max(0, Math.min(1, rawStrength));
  }
  // 0-100 scale, convert to 0-1
  return Math.max(0, Math.min(1, rawStrength / 100));
}

/**
 * Determine signal direction multiplier based on direction_hint
 */
function getDirectionMultiplier(directionHint: string): number {
  switch (directionHint.toLowerCase()) {
    case 'bullish':
      return 1;
    case 'bearish':
      return -1;
    case 'symmetric':
    case 'contextual':
    default:
      return 1; // For symmetric/contextual, keep the sign from normalized strength
  }
}

/**
 * Compute fused signal score from multiple live signals
 */
export async function computeFusedSignalScore(
  params: ComputeFusedSignalParams
): Promise<FusedSignalResult> {
  const { supabaseClient, userId, strategyId, symbol, side, horizon, now = new Date() } = params;
  
  try {
    // Calculate lookback window
    const windowMs = LOOKBACK_WINDOWS[horizon] || LOOKBACK_WINDOWS['1h'];
    const cutoffTime = new Date(now.getTime() - windowMs).toISOString();

    // Query recent signals for this symbol AND market-wide signals (symbol = 'ALL')
    const { data: signals, error: signalsError } = await supabaseClient
      .from('live_signals')
      .select('id, signal_type, source, signal_strength, timestamp, symbol')
      .in('symbol', [symbol, 'ALL'])
      .gte('timestamp', cutoffTime)
      .order('timestamp', { ascending: false });

    if (signalsError) {
      console.error('[SignalFusion] Error fetching signals:', signalsError);
      throw signalsError;
    }

    if (!signals || signals.length === 0) {
      console.log(`[SignalFusion] No signals found for ${symbol}/${horizon} in lookback window`);
      return {
        fusedScore: 0,
        details: [],
        totalSignals: 0,
        enabledSignals: 0
      };
    }

    console.log(`[SignalFusion] Found ${signals.length} raw signals for ${symbol}/${horizon}`);

    // Get signal registry entries
    const { data: registryEntries, error: registryError } = await supabaseClient
      .from('signal_registry')
      .select('*')
      .in('key', [...new Set(signals.map(s => s.signal_type))]);

    if (registryError) {
      console.error('[SignalFusion] Error fetching registry:', registryError);
      throw registryError;
    }

    // Get per-strategy weight overrides
    const { data: strategyWeights, error: weightsError } = await supabaseClient
      .from('strategy_signal_weights')
      .select('*')
      .eq('strategy_id', strategyId);

    if (weightsError) {
      console.error('[SignalFusion] Error fetching strategy weights:', weightsError);
      // Continue with default weights
    }

    // Build weight override map
    const weightOverrides = new Map<string, { weight?: number; is_enabled: boolean }>();
    if (strategyWeights) {
      (strategyWeights as StrategySignalWeight[]).forEach(sw => {
        weightOverrides.set(sw.signal_key, {
          weight: sw.weight ?? undefined,
          is_enabled: sw.is_enabled
        });
      });
    }

    // Build registry map
    const registryMap = new Map(
      (registryEntries as SignalRegistryEntry[])?.map(r => [r.key, r]) || []
    );

    // Process each signal and compute contributions
    const details: SignalDetail[] = [];
    let totalContribution = 0;
    let enabledCount = 0;

    for (const signal of signals) {
      const registryEntry = registryMap.get(signal.signal_type);
      
      // Skip if no registry entry (shouldn't happen)
      if (!registryEntry) {
        console.warn(`[SignalFusion] No registry entry for signal_type: ${signal.signal_type}`);
        continue;
      }

      // Check if signal is enabled globally
      if (!registryEntry.is_enabled) {
        console.log(`[SignalFusion] Signal ${signal.signal_type} is disabled in registry`);
        continue;
      }

      // Check per-strategy override
      const override = weightOverrides.get(signal.signal_type);
      if (override && !override.is_enabled) {
        console.log(`[SignalFusion] Signal ${signal.signal_type} is disabled for strategy ${strategyId}`);
        continue;
      }

      // Determine effective weight
      const effectiveWeight = override?.weight ?? registryEntry.default_weight;

      // Normalize signal strength
      const normalizedStrength = normalizeSignalStrength(signal.signal_strength);

      // Apply direction multiplier
      const directionMultiplier = getDirectionMultiplier(registryEntry.direction_hint);

      // Compute contribution
      const contribution = normalizedStrength * effectiveWeight * directionMultiplier;

      details.push({
        signalId: signal.id,
        signalType: signal.signal_type,
        source: signal.source,
        rawStrength: signal.signal_strength,
        normalizedStrength,
        appliedWeight: effectiveWeight,
        contribution,
        timestamp: signal.timestamp
      });

      totalContribution += contribution;
      enabledCount++;
    }

    // Fused score: scale to -100 to +100 range
    // With current weights (0-3) and normalized strengths (0-1),
    // typical contribution range per signal is -3 to +3
    // For multiple signals, we'll cap at ±100
    const fusedScore = Math.max(-100, Math.min(100, totalContribution * 20));

    console.log(`[SignalFusion] Fused score for ${symbol}/${horizon}: ${fusedScore.toFixed(2)} from ${enabledCount} signals`);

    return {
      fusedScore,
      details,
      totalSignals: signals.length,
      enabledSignals: enabledCount
    };

  } catch (error) {
    console.error('[SignalFusion] Error computing fused signal:', error);
    // Fail soft: return zero score
    return {
      fusedScore: 0,
      details: [],
      totalSignals: 0,
      enabledSignals: 0
    };
  }
}

/**
 * Check if signal fusion is enabled via configuration
 * Reads from unified config or environment
 */
export function isSignalFusionEnabled(strategyConfig: any): boolean {
  // Check if enableSignalFusion flag is present and true
  // Initially only enable in TEST mode
  const isTestMode = strategyConfig?.is_test_mode === true || 
                    strategyConfig?.execution_mode === 'TEST';
  
  const fusionEnabled = strategyConfig?.enableSignalFusion === true;
  
  return isTestMode && fusionEnabled;
}
