/**
 * Signal Fusion Module v2
 * 
 * Computes a fused signal score from multiple live signals for trading decisions.
 * 
 * v2 changes:
 * - Signal lineage: returns exact signal IDs used in fusion for ML traceability
 * - Source aggregation: aggregates signals per source before fusion to prevent
 *   high-frequency sources from dominating (configurable via useSourceAggregation flag)
 * - Source contributions: returns per-source contribution breakdown
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

/** Compact signal reference for lineage persistence */
export interface SignalUsed {
  signal_id: string;
  source: string;
  signal_type: string;
  strength: number;
}

/** Per-source aggregated contribution */
export interface SourceContribution {
  source: string;
  signal_count: number;
  aggregated_strength: number;
  contribution: number;
}

export interface FusedSignalResult {
  fusedScore: number;  // -100 to +100
  details: SignalDetail[];
  totalSignals: number;
  enabledSignals: number;
  /** v2: exact signals used for ML lineage */
  signals_used: SignalUsed[];
  /** v2: per-source contribution breakdown */
  source_contributions: Record<string, number>;
  /** v2: fusion version for schema evolution */
  fusion_version: string;
}

export interface ComputeFusedSignalParams {
  supabaseClient: any;
  userId: string;
  strategyId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  horizon: '15m' | '1h' | '4h' | '24h';
  now?: Date;
  /** v2: aggregate per source before fusion (default: true) */
  useSourceAggregation?: boolean;
}

// Lookback windows based on horizon
const LOOKBACK_WINDOWS: Record<string, number> = {
  '15m': 30 * 60 * 1000,
  '1h': 2 * 60 * 60 * 1000,
  '4h': 8 * 60 * 60 * 1000,
  '24h': 48 * 60 * 60 * 1000
};

function normalizeSignalStrength(rawStrength: number): number {
  if (rawStrength <= 1) {
    return Math.max(0, Math.min(1, rawStrength));
  }
  return Math.max(0, Math.min(1, rawStrength / 100));
}

function getDirectionMultiplier(directionHint: string): number {
  switch (directionHint.toLowerCase()) {
    case 'bullish':
      return 1;
    case 'bearish':
      return -1;
    case 'symmetric':
    case 'contextual':
    default:
      return 1;
  }
}

/**
 * Source aggregation strategies per source type.
 * - technical_analysis: average (continuous signals)
 * - crypto_news: average (periodic sentiment)
 * - whale_alert_ws: max (sporadic, strongest matters)
 * - fear_greed_index: latest (daily snapshot)
 * - default: average
 */
type AggregationStrategy = 'average' | 'max' | 'latest';

const SOURCE_AGGREGATION_STRATEGY: Record<string, AggregationStrategy> = {
  'technical_analysis': 'average',
  'crypto_news': 'average',
  'whale_alert_ws': 'max',
  'whale_alert_api': 'max',
  'fear_greed_index': 'latest',
  'eodhd': 'latest',
};

function getAggregationStrategy(source: string): AggregationStrategy {
  return SOURCE_AGGREGATION_STRATEGY[source] || 'average';
}

interface ProcessedSignal {
  signal: any;
  registryEntry: SignalRegistryEntry;
  effectiveWeight: number;
  normalizedStrength: number;
  directionMultiplier: number;
  contribution: number;
}

/**
 * Aggregate processed signals per source, producing one contribution per source.
 */
function aggregateBySource(processedSignals: ProcessedSignal[]): {
  aggregatedContributions: Map<string, { contribution: number; strength: number; count: number }>;
} {
  // Group by source
  const bySource = new Map<string, ProcessedSignal[]>();
  for (const ps of processedSignals) {
    const source = ps.signal.source;
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source)!.push(ps);
  }

  const aggregatedContributions = new Map<string, { contribution: number; strength: number; count: number }>();

  for (const [source, signals] of bySource) {
    const strategy = getAggregationStrategy(source);
    let aggregatedContribution: number;
    let aggregatedStrength: number;

    switch (strategy) {
      case 'max': {
        // Pick signal with highest absolute contribution
        const strongest = signals.reduce((best, s) =>
          Math.abs(s.contribution) > Math.abs(best.contribution) ? s : best
        );
        aggregatedContribution = strongest.contribution;
        aggregatedStrength = strongest.normalizedStrength;
        break;
      }
      case 'latest': {
        // Pick most recent signal (signals are already ordered desc by timestamp)
        aggregatedContribution = signals[0].contribution;
        aggregatedStrength = signals[0].normalizedStrength;
        break;
      }
      case 'average':
      default: {
        const sum = signals.reduce((acc, s) => acc + s.contribution, 0);
        aggregatedContribution = sum / signals.length;
        aggregatedStrength = signals.reduce((acc, s) => acc + s.normalizedStrength, 0) / signals.length;
        break;
      }
    }

    aggregatedContributions.set(source, {
      contribution: aggregatedContribution,
      strength: aggregatedStrength,
      count: signals.length,
    });
  }

  return { aggregatedContributions };
}

/** Maximum contribution any single source can have on the final score */
const MAX_SOURCE_CONTRIBUTION = 0.4;

/** Minimum number of unique sources required for a non-HOLD decision */
const MIN_UNIQUE_SOURCES = 2;

/**
 * Deduplicate signals by (source, signal_type) — keep only the strongest.
 */
function deduplicateSignals(signals: any[]): any[] {
  const seen = new Map<string, any>();
  for (const s of signals) {
    const key = `${s.source}::${s.signal_type}`;
    const existing = seen.get(key);
    if (!existing || Math.abs(s.signal_strength) > Math.abs(existing.signal_strength)) {
      seen.set(key, s);
    }
  }
  return Array.from(seen.values());
}

/**
 * Compute fused signal score from multiple live signals
 */
export async function computeFusedSignalScore(
  params: ComputeFusedSignalParams
): Promise<FusedSignalResult> {
  const {
    supabaseClient, userId, strategyId, symbol, side, horizon,
    now = new Date(),
    useSourceAggregation = true,
  } = params;
  
  const FUSION_VERSION = useSourceAggregation ? 'v2_aggregated' : 'v2_raw';

  try {
    const windowMs = LOOKBACK_WINDOWS[horizon] || LOOKBACK_WINDOWS['1h'];
    const cutoffTime = new Date(now.getTime() - windowMs).toISOString();

    const { data: signals, error: signalsError } = await supabaseClient
      .from('live_signals')
      .select('id, signal_type, source, signal_strength, timestamp, symbol')
      .in('symbol', [symbol, `${symbol}-EUR`, 'ALL'])
      .gte('timestamp', cutoffTime)
      .order('timestamp', { ascending: false });

    if (signalsError) throw signalsError;

    if (!signals || signals.length === 0) {
      return {
        fusedScore: 0,
        details: [],
        totalSignals: 0,
        enabledSignals: 0,
        signals_used: [],
        source_contributions: {},
        fusion_version: FUSION_VERSION,
      };
    }

    // === FIX 1: Deduplicate by (source, signal_type) — keep strongest ===
    const rawCount = signals.length;
    const dedupedSignals = deduplicateSignals(signals);

    // Fetch registry and strategy weights in parallel
    const [registryResult, weightsResult] = await Promise.all([
      supabaseClient
        .from('signal_registry')
        .select('*')
        .in('key', [...new Set(dedupedSignals.map((s: any) => s.signal_type))]),
      supabaseClient
        .from('strategy_signal_weights')
        .select('*')
        .eq('strategy_id', strategyId),
    ]);

    if (registryResult.error) throw registryResult.error;

    const weightOverrides = new Map<string, { weight?: number; is_enabled: boolean }>();
    if (weightsResult.data) {
      (weightsResult.data as StrategySignalWeight[]).forEach(sw => {
        weightOverrides.set(sw.signal_key, {
          weight: sw.weight ?? undefined,
          is_enabled: sw.is_enabled,
        });
      });
    }

    const registryMap = new Map(
      (registryResult.data as SignalRegistryEntry[])?.map(r => [r.key, r]) || []
    );

    // Process each deduplicated signal
    const details: SignalDetail[] = [];
    const signalsUsed: SignalUsed[] = [];
    const processedSignals: ProcessedSignal[] = [];
    let maxPossibleScore = 0;

    for (const signal of dedupedSignals) {
      const registryEntry = registryMap.get(signal.signal_type);
      if (!registryEntry || !registryEntry.is_enabled) continue;

      const override = weightOverrides.get(signal.signal_type);
      if (override && !override.is_enabled) continue;

      const effectiveWeight = override?.weight ?? registryEntry.default_weight;
      const normalizedStrength = normalizeSignalStrength(signal.signal_strength);
      const directionMultiplier = getDirectionMultiplier(registryEntry.direction_hint);
      const contribution = normalizedStrength * effectiveWeight * directionMultiplier;

      // Track max possible score (all weights at full strength)
      maxPossibleScore += effectiveWeight;

      const ps: ProcessedSignal = {
        signal,
        registryEntry,
        effectiveWeight,
        normalizedStrength,
        directionMultiplier,
        contribution,
      };
      processedSignals.push(ps);

      details.push({
        signalId: signal.id,
        signalType: signal.signal_type,
        source: signal.source,
        rawStrength: signal.signal_strength,
        normalizedStrength,
        appliedWeight: effectiveWeight,
        contribution,
        timestamp: signal.timestamp,
      });

      signalsUsed.push({
        signal_id: signal.id,
        source: signal.source,
        signal_type: signal.signal_type,
        strength: signal.signal_strength,
      });
    }

    // === FIX 3: Minimum signal diversity check ===
    const uniqueSources = new Set(processedSignals.map(ps => ps.signal.source));
    if (uniqueSources.size < MIN_UNIQUE_SOURCES) {
      return {
        fusedScore: 0,
        details,
        totalSignals: rawCount,
        enabledSignals: processedSignals.length,
        signals_used: signalsUsed,
        source_contributions: {},
        fusion_version: FUSION_VERSION,
        insufficient_diversity: true,
        unique_sources_count: uniqueSources.size,
        deduplicated_signal_count: dedupedSignals.length,
      } as FusedSignalResult;
    }

    // === FIX 2: Per-source contribution cap ===
    const sourceContributions: Record<string, number> = {};
    const perSourceCappedContributions: Record<string, number> = {};

    if (useSourceAggregation && processedSignals.length > 0) {
      const { aggregatedContributions } = aggregateBySource(processedSignals);
      for (const [source, agg] of aggregatedContributions) {
        const raw = agg.contribution;
        const capped = Math.sign(raw) * Math.min(Math.abs(raw), MAX_SOURCE_CONTRIBUTION);
        sourceContributions[source] = Number(capped.toFixed(4));
        perSourceCappedContributions[source] = Number(raw.toFixed(4));
      }
    } else {
      const rawBySource: Record<string, number> = {};
      for (const ps of processedSignals) {
        const src = ps.signal.source;
        rawBySource[src] = (rawBySource[src] || 0) + ps.contribution;
      }
      for (const [src, raw] of Object.entries(rawBySource)) {
        const capped = Math.sign(raw) * Math.min(Math.abs(raw), MAX_SOURCE_CONTRIBUTION);
        sourceContributions[src] = Number(capped.toFixed(4));
        perSourceCappedContributions[src] = Number(raw.toFixed(4));
      }
    }

    // === FIX 4: Score normalization before dominance ===
    // Normalize individual contributions by maxPossibleScore
    const normFactor = maxPossibleScore > 0 ? maxPossibleScore : 1;

    let bullishTotal = 0;
    let bearishTotal = 0;
    for (const ps of processedSignals) {
      const normalizedContribution = ps.contribution / normFactor;
      if (normalizedContribution > 0) bullishTotal += normalizedContribution;
      else bearishTotal += Math.abs(normalizedContribution);
    }

    const totalMass = bullishTotal + bearishTotal;
    const dominance = totalMass === 0 ? 0 : Math.max(bullishTotal, bearishTotal) / totalMass;
    const magnitude = totalMass === 0 ? 0 : Math.max(bullishTotal, bearishTotal);
    const direction = bullishTotal >= bearishTotal ? 1 : -1;
    // conviction = direction * dominance * magnitude (scaled to [-100, +100])
    const convictionScore = direction * dominance * magnitude;

    const fusedScore = Math.max(-100, Math.min(100, convictionScore * 100));

    return {
      fusedScore,
      details,
      totalSignals: rawCount,
      enabledSignals: processedSignals.length,
      signals_used: signalsUsed,
      source_contributions: sourceContributions,
      fusion_version: FUSION_VERSION,
      unique_sources_count: uniqueSources.size,
      deduplicated_signal_count: dedupedSignals.length,
      per_source_capped_contributions: perSourceCappedContributions,
    } as FusedSignalResult;

  } catch (error) {
    return {
      fusedScore: 0,
      details: [],
      totalSignals: 0,
      enabledSignals: 0,
      signals_used: [],
      source_contributions: {},
      fusion_version: 'v2_error',
    };
  }
}

/**
 * Check if signal fusion is enabled via strategy configuration
 */
export function isSignalFusionEnabled(strategyConfig: any): boolean {
  const isTestMode = strategyConfig?.is_test_mode === true || 
                    strategyConfig?.execution_mode === 'TEST';
  const fusionEnabled = strategyConfig?.enableSignalFusion === true;
  return isTestMode && fusionEnabled;
}
