// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============= SIGNAL FUSION INTEGRATION =============
// Import signal fusion module for Phase 1B READ-ONLY integration
// Inlined from src/engine/signalFusion.ts for Deno compatibility

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

interface SignalDetail {
  signalId: string;
  signalType: string;
  source: string;
  rawStrength: number;
  normalizedStrength: number;
  appliedWeight: number;
  contribution: number;
  timestamp: string;
}

interface FusedSignalResult {
  fusedScore: number;
  details: SignalDetail[];
  totalSignals: number;
  enabledSignals: number;
}

interface ComputeFusedSignalParams {
  supabaseClient: any;
  userId: string;
  strategyId: string;
  symbol: string;
  side: "BUY" | "SELL";
  horizon: "15m" | "1h" | "4h" | "24h";
  now?: Date;
}

const LOOKBACK_WINDOWS: Record<string, number> = {
  "15m": 30 * 60 * 1000,
  "1h": 2 * 60 * 60 * 1000,
  "4h": 8 * 60 * 60 * 1000,
  "24h": 48 * 60 * 60 * 1000,
};

// ============= ANTI-CHURN PROTECTION =============
// EXIT_FLOOR_RATIO: Minimum fraction of takeProfitPercentage required to allow a TAKE_PROFIT exit.
// Rationale: Prevents "stupid trades" where micro-gains slip through due to rounding, timing, or
// volatility spikes. A trade must capture at least 25% of the intended TP threshold before exiting.
// Example: If TP = 2.0%, the derived floor = 0.5%. A TP exit with pnl = 0.3% would be blocked.
// ONLY affects TAKE_PROFIT exits. STOP_LOSS, TRAILING_STOP, and AUTO_CLOSE_TIME are unaffected.
const EXIT_FLOOR_RATIO = 0.25;

function normalizeSignalStrength(rawStrength: number): number {
  if (rawStrength <= 1) {
    return Math.max(0, Math.min(1, rawStrength));
  }
  return Math.max(0, Math.min(1, rawStrength / 100));
}

function getDirectionMultiplier(directionHint: string): number {
  switch (directionHint.toLowerCase()) {
    case "bullish":
      return 1;
    case "bearish":
      return -1;
    case "symmetric":
    case "contextual":
    default:
      return 1;
  }
}

async function computeFusedSignalScore(params: ComputeFusedSignalParams): Promise<FusedSignalResult> {
  const { supabaseClient, userId, strategyId, symbol, side, horizon, now = new Date() } = params;

  try {
    const windowMs = LOOKBACK_WINDOWS[horizon] || LOOKBACK_WINDOWS["1h"];
    const cutoffTime = new Date(now.getTime() - windowMs).toISOString();

    const { data: signals, error: signalsError } = await supabaseClient
      .from("live_signals")
      .select("id, signal_type, source, signal_strength, timestamp, symbol")
      .in("symbol", [symbol, "ALL"])
      .gte("timestamp", cutoffTime)
      .order("timestamp", { ascending: false });

    if (signalsError) {
      console.error("[SignalFusion] Error fetching signals:", signalsError);
      throw signalsError;
    }

    if (!signals || signals.length === 0) {
      console.log(`[SignalFusion] No signals found for ${symbol}/${horizon}`);
      return { fusedScore: 0, details: [], totalSignals: 0, enabledSignals: 0 };
    }

    console.log(`[SignalFusion] Found ${signals.length} signals for ${symbol}/${horizon}`);

    const { data: registryEntries, error: registryError } = await supabaseClient
      .from("signal_registry")
      .select("*")
      .in("key", [...new Set(signals.map((s: any) => s.signal_type))]);

    if (registryError) {
      console.error("[SignalFusion] Error fetching registry:", registryError);
      throw registryError;
    }

    const { data: strategyWeights, error: weightsError } = await supabaseClient
      .from("strategy_signal_weights")
      .select("*")
      .eq("strategy_id", strategyId);

    if (weightsError) {
      console.error("[SignalFusion] Error fetching strategy weights:", weightsError);
    }

    const weightOverrides = new Map<string, { weight?: number; is_enabled: boolean }>();
    if (strategyWeights) {
      (strategyWeights as StrategySignalWeight[]).forEach((sw) => {
        weightOverrides.set(sw.signal_key, {
          weight: sw.weight ?? undefined,
          is_enabled: sw.is_enabled,
        });
      });
    }

    const registryMap = new Map((registryEntries as SignalRegistryEntry[])?.map((r) => [r.key, r]) || []);

    const details: SignalDetail[] = [];
    let totalContribution = 0;
    let enabledCount = 0;

    for (const signal of signals) {
      const registryEntry = registryMap.get(signal.signal_type);

      if (!registryEntry) {
        console.warn(`[SignalFusion] No registry entry for: ${signal.signal_type}`);
        continue;
      }

      if (!registryEntry.is_enabled) {
        console.log(`[SignalFusion] Signal ${signal.signal_type} disabled in registry`);
        continue;
      }

      const override = weightOverrides.get(signal.signal_type);
      if (override && !override.is_enabled) {
        console.log(`[SignalFusion] Signal ${signal.signal_type} disabled for strategy`);
        continue;
      }

      const effectiveWeight = override?.weight ?? registryEntry.default_weight;
      const normalizedStrength = normalizeSignalStrength(signal.signal_strength);
      const directionMultiplier = getDirectionMultiplier(registryEntry.direction_hint);
      const contribution = normalizedStrength * effectiveWeight * directionMultiplier;

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

      totalContribution += contribution;
      enabledCount++;
    }

    const fusedScore = Math.max(-100, Math.min(100, totalContribution * 20));

    console.log(
      `[SignalFusion] Fused score for ${symbol}/${horizon}: ${fusedScore.toFixed(2)} from ${enabledCount} signals`,
    );

    return { fusedScore, details, totalSignals: signals.length, enabledSignals: enabledCount };
  } catch (error) {
    console.error("[SignalFusion] Error computing fused signal:", error);
    return { fusedScore: 0, details: [], totalSignals: 0, enabledSignals: 0 };
  }
}

function isSignalFusionEnabled(strategyConfig: any): boolean {
  // Signal Fusion is enabled purely based on the enableSignalFusion flag
  // execution_target (MOCK/REAL) controls execution mode, not signal fusion availability
  const fusionEnabled =
    strategyConfig?.configuration?.enableSignalFusion === true || strategyConfig?.enableSignalFusion === true;
  return fusionEnabled;
}

// ============= END SIGNAL FUSION INTEGRATION =============

// Symbol normalization utilities (inlined for Deno)
type BaseSymbol = string; // e.g., "BTC"
type PairSymbol = `${string}-EUR`; // e.g., "BTC-EUR"

const toBaseSymbol = (input: string): BaseSymbol => (input.includes("-") ? input.split("-")[0] : input);

const toPairSymbol = (base: BaseSymbol): PairSymbol => `${toBaseSymbol(base)}-EUR` as PairSymbol;

// =============================================================================
// SHARED POSITION HELPER: Calculate net position from all trades (BUYs - SELLs)
// This is the canonical definition of "position exists" used across the coordinator
// =============================================================================
interface TradeRowForPosition {
  trade_type: "buy" | "sell";
  cryptocurrency: string;
  amount: number;
  executed_at?: string;
}

function calculateNetPositionForSymbol(trades: TradeRowForPosition[], baseSymbol: string): number {
  const normalizedBase = toBaseSymbol(baseSymbol);
  let sumBuys = 0;
  let sumSells = 0;

  for (const t of trades) {
    const tradeSymbol = toBaseSymbol(t.cryptocurrency);
    if (tradeSymbol !== normalizedBase) continue;
    if (t.trade_type === "buy") sumBuys += Number(t.amount);
    else if (t.trade_type === "sell") sumSells += Number(t.amount);
  }

  return sumBuys - sumSells;
}
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Enhanced types for the unified trading system
interface TradeIntent {
  userId: string;
  strategyId: string;
  symbol: string;
  side: "BUY" | "SELL";
  source: "automated" | "intelligent" | "pool" | "manual" | "news" | "whale";
  confidence: number;
  reason?: string;
  qtySuggested?: number;
  metadata?: Record<string, any>;
  ts?: string;
  idempotencyKey?: string;
}

// =============================================================================
// MOCK_TRADES TABLE SCHEMA REFERENCE (for type safety and preventing 42703 errors)
// -----------------------------------------------------------------------------
// VALID COLUMNS - use ONLY these in .eq(), .select(), .insert(), etc.:
//   - id: uuid (PK)
//   - user_id: uuid (FK to auth.users)
//   - strategy_id: uuid (FK to trading_strategies, nullable)
//   - trade_type: text ('buy' | 'sell')
//   - cryptocurrency: text (e.g., 'BTC', 'ETH', 'ADA')
//   - amount: numeric (quantity of crypto)
//   - price: numeric (price per unit)
//   - total_value: numeric (amount * price)
//   - executed_at: timestamptz
//   - is_test_mode: boolean
//   - notes: text (optional)
//   - strategy_trigger: text (optional)
//   - original_trade_id: uuid (FK for targeted SELL, optional)
//   - original_purchase_amount: numeric (FIFO snapshot)
//   - original_purchase_price: numeric (FIFO snapshot)
//   - original_purchase_value: numeric (FIFO snapshot)
//   - exit_value: numeric (for SELL trades)
//   - realized_pnl: numeric (for SELL trades)
//   - realized_pnl_pct: numeric (for SELL trades)
//   - buy_fees: numeric
//   - sell_fees: numeric
//   - fees: numeric (legacy)
//   - profit_loss: numeric (legacy)
//
// COLUMNS THAT DO **NOT** EXIST ON mock_trades (use decision_events instead):
//   - source ❌ (exists on decision_events, NOT mock_trades)
//   - engine ❌ (exists on decision_events, NOT mock_trades)
//   - side ❌ (use trade_type instead)
//   - confidence ❌ (exists on decision_events, NOT mock_trades)
// =============================================================================
interface MockTradeRow {
  id: string;
  user_id: string;
  strategy_id: string | null;
  trade_type: "buy" | "sell";
  cryptocurrency: string;
  amount: number;
  price: number;
  total_value: number;
  executed_at: string;
  is_test_mode: boolean;
  notes?: string;
  strategy_trigger?: string;
  original_trade_id?: string;
  original_purchase_amount?: number;
  original_purchase_price?: number;
  original_purchase_value?: number;
  exit_value?: number;
  realized_pnl?: number;
  realized_pnl_pct?: number;
  buy_fees?: number;
  sell_fees?: number;
  fees?: number;
  profit_loss?: number;
}

// STEP 1: Standardized response types
type DecisionAction = "BUY" | "SELL" | "HOLD" | "DEFER" | "BLOCK";
type Reason =
  | "unified_decisions_disabled_direct_path"
  | "no_conflicts_detected"
  | "hold_min_period_not_met"
  | "blocked_by_cooldown"
  | "blocked_by_precedence:POOL_EXIT"
  | "queue_overload_defer"
  | "direct_execution_failed"
  | "internal_error"
  | "atomic_section_busy_defer"
  | "insufficient_price_freshness"
  | "spread_too_wide"
  | "blocked_by_liquidity"
  | "blocked_by_whale_conflict"
  | "tp_hit"
  | "manual_override_precedence"
  | "confidence_override_applied"
  | "tp_execution_failed"
  | "tp_execution_error"
  | "tp_lock_contention"
  | "signal_too_weak"
  | "no_position_to_sell"
  | "insufficient_position_size"
  | "no_position_found"
  // NEW STABILIZATION GATES (Phase: Omniscient AI Agent)
  | "blocked_by_stop_loss_cooldown"
  | "blocked_by_signal_alignment"
  | "blocked_by_high_volatility"
  | "blocked_by_entry_spacing"
  // STRATEGY STATE & POLICY ENFORCEMENT
  | "blocked_real_mode_not_supported"
  | "blocked_strategy_not_active"
  | "blocked_strategy_paused"
  | "blocked_strategy_detached"
  | "blocked_policy_manage_only"
  | "blocked_policy_detached"
  | "blocked_liquidation_batch_mismatch"
  | "blocked_missing_policy"
  | "blocked_liquidation_requires_batch_id"
  | "decision_events_insert_failed"
  | "cash_ledger_settle_failed"
  // PHASE 1: REAL MODE EXECUTION
  | "blocked_panic_active"
  | "blocked_prerequisites_check_failed"
  | "blocked_rules_not_accepted"
  | "blocked_wallet_not_ready"
  | "real_execution_job_queued"
  | "execution_job_insert_failed"
  // TEMPLATE LITERAL PATTERNS for dynamic reasons
  | `blocked_missing_config:${string}`;

// ============= CASH LEDGER SETTLEMENT HELPER =============
// Ensures cash_balance_eur moves correctly after every trade insert
// For BUY: deduct total_value (we don't track fees separately in current data)
// For SELL: credit exit_value (net proceeds after fees, as computed by trigger)
//
// IMPORTANT: In current production data:
// - fees, buy_fees, sell_fees are all 0 (not populated)
// - exit_value = amount × price - implicit_fees (trigger computes this)
// - total_value = amount × price (gross, no fees)
// - realized_pnl = exit_value - original_purchase_value
//
// Therefore:
// - BUY: spend total_value (gross cost)
// - SELL: receive exit_value if available, otherwise total_value (net proceeds)
interface CashSettlementResult {
  success: boolean;
  cash_before?: number;
  delta?: number;
  cash_after?: number;
  error?: string;
}

async function settleCashLedger(
  supabaseClient: any,
  userId: string,
  side: "BUY" | "SELL",
  tradeData: {
    total_value: number;
    exit_value?: number;
    fees?: number;
    buy_fees?: number;
    sell_fees?: number;
  },
  meta?: {
    tradeId?: string;
    path?: "direct_ud_off" | "standard" | "manual" | "per_lot";
    isMockMode?: boolean; // Derived from execution_target === 'MOCK'
    strategyId?: string;
    symbol?: string;
  },
): Promise<CashSettlementResult> {
  const path = meta?.path ?? "standard";
  const tradeId = meta?.tradeId ?? "unknown_trade_id";
  const metaIsMockMode = meta?.isMockMode === true;

  try {
    // First, get current cash balance for logging
    const { data: capitalData, error: capitalError } = await supabaseClient
      .from("portfolio_capital")
      .select("cash_balance_eur")
      .eq("user_id", userId)
      .single();

    if (capitalError) {
      console.error(`❌ CASH LEDGER: Failed to read cash_before (path=${path}, trade_id=${tradeId})`, capitalError);
      if (metaIsMockMode) return { success: false, error: "cash_before_read_failed" };
    }

    const cashBefore = capitalData?.cash_balance_eur ?? null;

    if (side === "BUY") {
      const buyNetSpent =
        (Number(tradeData.total_value) || 0) + (Number(tradeData.fees) || 0) + (Number(tradeData.buy_fees) || 0);

      if (!(buyNetSpent > 0)) {
        console.error(`❌ CASH LEDGER [BUY]: invalid buyNetSpent=${buyNetSpent} (path=${path}, trade_id=${tradeId})`);
        return {
          success: false,
          cash_before: cashBefore ?? undefined,
          delta: -buyNetSpent,
          error: "invalid_buy_spend",
        };
      }

      console.log(
        `💰 CASH LEDGER [BUY] path=${path} trade_id=${tradeId}: cash_before=${cashBefore?.toFixed(2) ?? "N/A"}€, delta=-${buyNetSpent.toFixed(2)}€`,
      );

      const { data: settleResult, error: settleError } = await supabaseClient.rpc("settle_buy_trade", {
        p_user_id: userId,
        p_actual_spent: buyNetSpent,
        p_reserved_amount: 0,
      });

      if (settleError) {
        console.error(
          `❌ CASH LEDGER [BUY]: settle_buy_trade RPC failed (path=${path}, trade_id=${tradeId}):`,
          settleError,
        );
        return {
          success: false,
          cash_before: cashBefore ?? undefined,
          delta: -buyNetSpent,
          error: settleError.message,
        };
      }

      if (settleResult?.success === false) {
        console.error(
          `❌ CASH LEDGER [BUY]: settle_buy_trade returned failure (path=${path}, trade_id=${tradeId}):`,
          settleResult,
        );
        return {
          success: false,
          cash_before: cashBefore ?? undefined,
          delta: -buyNetSpent,
          error: settleResult?.reason || "unknown",
        };
      }

      const cashAfter =
        settleResult?.cash_after ?? settleResult?.cash_balance_eur ?? settleResult?.new_cash_balance_eur ?? null;

      // DRIFT DETECTOR: Verify DB reflects the new cash
      const { data: verifyData, error: verifyError } = await supabaseClient
        .from("portfolio_capital")
        .select("cash_balance_eur")
        .eq("user_id", userId)
        .single();

      const verifiedCash = verifyData?.cash_balance_eur ?? null;
      if (verifyError) {
        console.error(`⚠️ CASH LEDGER [BUY]: verify read failed (path=${path}, trade_id=${tradeId})`, verifyError);
        if (metaIsMockMode) {
          return {
            success: false,
            cash_before: cashBefore ?? undefined,
            delta: -buyNetSpent,
            error: "cash_after_verify_failed",
          };
        }
      }

      const settleDrift =
        cashAfter !== null && verifiedCash !== null ? Math.abs(Number(cashAfter) - Number(verifiedCash)) : null;

      console.log(
        `✅ CASH LEDGER [BUY] path=${path} trade_id=${tradeId}: cash_after=${cashAfter?.toFixed(2) ?? "N/A"}€, verified=${verifiedCash?.toFixed(2) ?? "N/A"}€, settle_drift=${settleDrift?.toFixed(2) ?? "N/A"}€`,
      );

      if (metaIsMockMode && (cashAfter === null || verifiedCash === null)) {
        return {
          success: false,
          cash_before: cashBefore ?? undefined,
          delta: -buyNetSpent,
          cash_after: cashAfter ?? undefined,
          error: "cash_after_missing",
        };
      }

      // DRIFT DETECTION (NO AUTO-REPAIR): Fail hard in MOCK mode if drift > €0.02
      if (metaIsMockMode && settleDrift !== null && settleDrift > 0.02) {
        console.error(
          `❌ CASH LEDGER [BUY]: DRIFT DETECTED > €0.02 (path=${path}, trade_id=${tradeId}, drift=${settleDrift.toFixed(2)}€)`,
        );

        // Log decision_event for auditability
        try {
          if (meta?.strategyId && meta?.symbol) {
            await supabaseClient.from("decision_events").insert({
              user_id: userId,
              strategy_id: meta.strategyId,
              symbol: meta.symbol,
              side,
              source: "cash_ledger",
              reason: "cash_ledger_settle_failed",
              decision_ts: new Date().toISOString(),
              trade_id: meta?.tradeId ?? null,
              metadata: {
                path,
                cash_before: cashBefore,
                delta: -buyNetSpent,
                cash_after: cashAfter,
                verified_cash: verifiedCash,
                drift: settleDrift,
                error: "cash_drift_detected",
              },
            });
          }
        } catch (e) {
          console.error("⚠️ CASH LEDGER [BUY]: failed to log cash_drift_detected decision_event", e);
        }

        return {
          success: false,
          cash_before: cashBefore ?? undefined,
          delta: -buyNetSpent,
          cash_after: cashAfter ?? undefined,
          error: "cash_drift_detected",
        };
      }

      return {
        success: true,
        cash_before: cashBefore ?? undefined,
        delta: -buyNetSpent,
        cash_after: cashAfter ?? undefined,
      };
    }

    // SELL: Credit cash with net proceeds
    let sellNetProceeds: number;
    if (tradeData.exit_value !== undefined && tradeData.exit_value !== null) {
      sellNetProceeds = Number(tradeData.exit_value) || 0;
    } else {
      sellNetProceeds =
        (Number(tradeData.total_value) || 0) - (Number(tradeData.fees) || 0) - (Number(tradeData.sell_fees) || 0);
    }

    if (!(sellNetProceeds > 0)) {
      console.error(
        `❌ CASH LEDGER [SELL]: invalid sellNetProceeds=${sellNetProceeds} (path=${path}, trade_id=${tradeId})`,
      );
      return {
        success: false,
        cash_before: cashBefore ?? undefined,
        delta: sellNetProceeds,
        error: "invalid_sell_proceeds",
      };
    }

    console.log(
      `💰 CASH LEDGER [SELL] path=${path} trade_id=${tradeId}: cash_before=${cashBefore?.toFixed(2) ?? "N/A"}€, delta=+${sellNetProceeds.toFixed(2)}€`,
    );

    const { data: settleResult, error: settleError } = await supabaseClient.rpc("settle_sell_trade", {
      p_user_id: userId,
      p_proceeds_eur: sellNetProceeds,
    });

    if (settleError) {
      console.error(
        `❌ CASH LEDGER [SELL]: settle_sell_trade RPC failed (path=${path}, trade_id=${tradeId}):`,
        settleError,
      );
      return {
        success: false,
        cash_before: cashBefore ?? undefined,
        delta: sellNetProceeds,
        error: settleError.message,
      };
    }

    if (settleResult?.success === false) {
      console.error(
        `❌ CASH LEDGER [SELL]: settle_sell_trade returned failure (path=${path}, trade_id=${tradeId}):`,
        settleResult,
      );
      return {
        success: false,
        cash_before: cashBefore ?? undefined,
        delta: sellNetProceeds,
        error: settleResult?.reason || "unknown",
      };
    }

    const cashAfter =
      settleResult?.cash_after ?? settleResult?.cash_balance_eur ?? settleResult?.new_cash_balance_eur ?? null;

    // DRIFT DETECTOR: Verify DB reflects the new cash
    const { data: verifyData, error: verifyError } = await supabaseClient
      .from("portfolio_capital")
      .select("cash_balance_eur")
      .eq("user_id", userId)
      .single();

    const verifiedCash = verifyData?.cash_balance_eur ?? null;
    if (verifyError) {
      console.error(`⚠️ CASH LEDGER [SELL]: verify read failed (path=${path}, trade_id=${tradeId})`, verifyError);
      if (metaIsMockMode) {
        return {
          success: false,
          cash_before: cashBefore ?? undefined,
          delta: sellNetProceeds,
          error: "cash_after_verify_failed",
        };
      }
    }

    const settleDrift =
      cashAfter !== null && verifiedCash !== null ? Math.abs(Number(cashAfter) - Number(verifiedCash)) : null;

    console.log(
      `✅ CASH LEDGER [SELL] path=${path} trade_id=${tradeId}: cash_after=${cashAfter?.toFixed(2) ?? "N/A"}€, verified=${verifiedCash?.toFixed(2) ?? "N/A"}€, settle_drift=${settleDrift?.toFixed(2) ?? "N/A"}€`,
    );

    if (metaIsMockMode && (cashAfter === null || verifiedCash === null)) {
      return {
        success: false,
        cash_before: cashBefore ?? undefined,
        delta: sellNetProceeds,
        cash_after: cashAfter ?? undefined,
        error: "cash_after_missing",
      };
    }

    // DRIFT DETECTION (NO AUTO-REPAIR): Fail hard in MOCK mode if drift > €0.02
    if (metaIsMockMode && settleDrift !== null && settleDrift > 0.02) {
      console.error(
        `❌ CASH LEDGER [SELL]: DRIFT DETECTED > €0.02 (path=${path}, trade_id=${tradeId}, drift=${settleDrift.toFixed(2)}€)`,
      );

      // Log decision_event for auditability
      try {
        if (meta?.strategyId && meta?.symbol) {
          await supabaseClient.from("decision_events").insert({
            user_id: userId,
            strategy_id: meta.strategyId,
            symbol: meta.symbol,
            side,
            source: "cash_ledger",
            reason: "cash_ledger_settle_failed",
            decision_ts: new Date().toISOString(),
            trade_id: meta?.tradeId ?? null,
            metadata: {
              path,
              cash_before: cashBefore,
              delta: sellNetProceeds,
              cash_after: cashAfter,
              verified_cash: verifiedCash,
              drift: settleDrift,
              error: "cash_drift_detected",
            },
          });
        }
      } catch (e) {
        console.error("⚠️ CASH LEDGER [SELL]: failed to log cash_drift_detected decision_event", e);
      }

      return {
        success: false,
        cash_before: cashBefore ?? undefined,
        delta: sellNetProceeds,
        cash_after: cashAfter ?? undefined,
        error: "cash_drift_detected",
      };
    }

    return {
      success: true,
      cash_before: cashBefore ?? undefined,
      delta: sellNetProceeds,
      cash_after: cashAfter ?? undefined,
    };
  } catch (error) {
    console.error(`❌ CASH LEDGER: Unexpected error in settleCashLedger (path=${path}, trade_id=${tradeId}):`, error);
    return { success: false, error: error?.message || "unexpected_error" };
  }
}

interface TradeDecision {
  action: DecisionAction;
  reason: Reason;
  request_id: string;
  retry_in_ms: number;
  qty?: number;
}

interface UnifiedConfig {
  enableUnifiedDecisions: boolean;
  minHoldPeriodMs: number;
  cooldownBetweenOppositeActionsMs: number;
  confidenceOverrideThreshold: number;
}

// ============= STRICT CANONICAL CONFIG RESOLVER =============
// Checks ONLY root-level canonical keys. No nested path fallbacks.
// UI is responsible for writing canonical keys at root level.
// FAIL-CLOSED: If any required key is missing, block with specific reason.
//
// CANONICAL REQUIRED KEYS (root level):
//   - takeProfitPercentage (number, %)
//   - stopLossPercentage (number, %)
//   - aiConfidenceThreshold (integer, 0-100)
//   - priceStaleMaxMs (integer, ms)
//   - spreadThresholdBps (integer, bps)
//   - minHoldPeriodMs (integer, ms)
//   - cooldownBetweenOppositeActionsMs (integer, ms)
// =============================================================================

interface CanonicalConfig {
  takeProfitPercentage: number;
  stopLossPercentage: number;
  aiConfidenceThreshold: number;
  priceStaleMaxMs: number;
  spreadThresholdBps: number;
  minHoldPeriodMs: number;
  cooldownBetweenOppositeActionsMs: number;
  confidenceOverrideThreshold: number;
  // NOTE: is_test_mode removed - execution mode is driven by strategy.execution_target
}

interface CanonicalConfigResult {
  success: boolean;
  config?: CanonicalConfig;
  missingKeys?: string[];
}

/**
 * SINGLE SOURCE OF TRUTH for canonical config resolution.
 * Used by BOTH executeWithMinimalLock AND executeTradeOrder.
 *
 * @param strategyConfig - Either the raw DB row (with .configuration) or already the configuration object
 * @returns Resolved config with all required canonical keys, or list of missing keys
 */
function resolveCanonicalConfig(strategyConfig: any): CanonicalConfigResult {
  // Normalize: if strategyConfig has .configuration, use that; otherwise use strategyConfig directly
  const cfg = strategyConfig?.configuration || strategyConfig || {};

  const missingKeys: string[] = [];

  // CANONICAL REQUIRED KEYS (STRICT: root-level only, no nested fallbacks)
  const takeProfitPercentage = cfg.takeProfitPercentage;
  const stopLossPercentage = cfg.stopLossPercentage;
  const aiConfidenceThreshold = cfg.aiConfidenceThreshold;
  const priceStaleMaxMs = cfg.priceStaleMaxMs;
  const spreadThresholdBps = cfg.spreadThresholdBps;
  const minHoldPeriodMs = cfg.minHoldPeriodMs;
  const cooldownBetweenOppositeActionsMs = cfg.cooldownBetweenOppositeActionsMs;

  // Check which canonical keys are missing
  if (takeProfitPercentage === undefined || takeProfitPercentage === null) {
    missingKeys.push("takeProfitPercentage");
  }
  if (stopLossPercentage === undefined || stopLossPercentage === null) {
    missingKeys.push("stopLossPercentage");
  }
  if (aiConfidenceThreshold === undefined || aiConfidenceThreshold === null) {
    missingKeys.push("aiConfidenceThreshold");
  }
  if (priceStaleMaxMs === undefined || priceStaleMaxMs === null) {
    missingKeys.push("priceStaleMaxMs");
  }
  if (spreadThresholdBps === undefined || spreadThresholdBps === null) {
    missingKeys.push("spreadThresholdBps");
  }
  if (minHoldPeriodMs === undefined || minHoldPeriodMs === null) {
    missingKeys.push("minHoldPeriodMs");
  }
  if (cooldownBetweenOppositeActionsMs === undefined || cooldownBetweenOppositeActionsMs === null) {
    missingKeys.push("cooldownBetweenOppositeActionsMs");
  }

  if (missingKeys.length > 0) {
    console.log(`❌ [CanonicalConfig] FAIL-CLOSED: Missing required keys: ${missingKeys.join(", ")}`);
    return { success: false, missingKeys };
  }

  // Optional keys with safe defaults
  const confidenceOverrideThreshold = cfg.confidenceOverrideThreshold ?? aiConfidenceThreshold;

  console.log(`✅ [CanonicalConfig] All 7 canonical keys resolved`);

  return {
    success: true,
    config: {
      takeProfitPercentage: Number(takeProfitPercentage),
      stopLossPercentage: Number(stopLossPercentage),
      aiConfidenceThreshold: Number(aiConfidenceThreshold),
      priceStaleMaxMs: Number(priceStaleMaxMs),
      spreadThresholdBps: Number(spreadThresholdBps),
      minHoldPeriodMs: Number(minHoldPeriodMs),
      cooldownBetweenOppositeActionsMs: Number(cooldownBetweenOppositeActionsMs),
      confidenceOverrideThreshold: Number(confidenceOverrideThreshold),
    },
  };
}

// LEGACY ALIAS for backward compatibility (used by some callers)
function resolveStrategyConfig(config: Record<string, any>): {
  success: boolean;
  resolved?: any;
  missingKeys?: string[];
} {
  const result = resolveCanonicalConfig(config);
  if (!result.success) {
    return { success: false, missingKeys: result.missingKeys };
  }
  return { success: true, resolved: result.config };
}

// In-memory caches for performance
const recentDecisionCache = new Map<string, { decision: TradeDecision; timestamp: number }>();
const symbolQueues = new Map<string, TradeIntent[]>();
const processingLocks = new Set<string>();

// Metrics tracking
let metrics = {
  totalRequests: 0,
  blockedByLockCount: 0,
  deferCount: 0,
  executionTimes: [] as number[],
  lastReset: Date.now(),
};

// ============= PHASE A/B: DUAL-ENGINE DETECTION (LOG ONLY) =============
// This helper checks for recent trades on the same user/strategy/symbol
// within a short window to detect potential dual-engine conflicts.
//
// In Phase A/B, this is LOG-ONLY and does NOT block trades.
// It helps identify if frontend and backend engines are both active.
//
// Phase B enhancement: Also detects origin (BACKEND vs FRONTEND_INTELLIGENT vs OTHER)
// based on intent.metadata.context to help distinguish engine sources.
// =======================================================================

// Determine intent origin for dual-engine detection logging
function detectIntentOrigin(intentMetadata: Record<string, any> | undefined): string {
  if (!intentMetadata) return "OTHER";
  const context = intentMetadata.context || "";
  if (typeof context === "string" && context.startsWith("BACKEND_")) {
    return "BACKEND";
  }
  if (intentMetadata.engine === "intelligent") {
    return "FRONTEND_INTELLIGENT";
  }
  return "OTHER";
}

interface DualEngineCheckResult {
  hasRecentTrade: boolean;
  recentTradeId?: string;
  recentTradeAge?: number;
  recentTradeNotes?: string;
  inferredRecentOrigin?: string;
}

async function checkDualEngineConflict(
  supabaseClient: any,
  userId: string,
  strategyId: string,
  symbol: string,
  windowMs: number = 30000, // 30 seconds default
): Promise<DualEngineCheckResult> {
  try {
    const baseSymbol = toBaseSymbol(symbol);
    const cutoffTime = new Date(Date.now() - windowMs).toISOString();

    const { data: recentTrades, error } = await supabaseClient
      .from("mock_trades")
      .select("id, executed_at, notes, strategy_trigger")
      .eq("user_id", userId)
      .eq("strategy_id", strategyId)
      .eq("cryptocurrency", baseSymbol)
      .eq("is_test_mode", true)
      .gte("executed_at", cutoffTime)
      .order("executed_at", { ascending: false })
      .limit(1);

    if (error || !recentTrades || recentTrades.length === 0) {
      return { hasRecentTrade: false };
    }

    const recentTrade = recentTrades[0];
    const ageMs = Date.now() - new Date(recentTrade.executed_at).getTime();

    // Infer origin from stored notes/trigger if possible
    let inferredRecentOrigin = "UNKNOWN";
    const notes = recentTrade.notes || "";
    const trigger = recentTrade.strategy_trigger || "";
    if (notes.includes("BACKEND_LIVE") || trigger.includes("BACKEND_LIVE")) {
      inferredRecentOrigin = "BACKEND";
    } else if (notes.includes("BACKEND_SHADOW") || trigger.includes("BACKEND_SHADOW")) {
      inferredRecentOrigin = "BACKEND_SHADOW";
    } else if (notes.includes("intelligent") || trigger.includes("intelligent")) {
      inferredRecentOrigin = "FRONTEND_INTELLIGENT";
    } else if (notes.includes("manual") || trigger.includes("manual")) {
      inferredRecentOrigin = "MANUAL";
    }

    return {
      hasRecentTrade: true,
      recentTradeId: recentTrade.id,
      recentTradeAge: ageMs,
      recentTradeNotes: notes,
      inferredRecentOrigin,
    };
  } catch (err) {
    console.warn("[DualEngineCheck] Error checking for recent trades:", err);
    return { hasRecentTrade: false };
  }
}

// Enhanced logging helper for dual-engine warnings (Phase B)
function logDualEngineWarning(
  dualCheck: DualEngineCheckResult,
  currentOrigin: string,
  userId: string,
  strategyId: string,
  baseSymbol: string,
): void {
  console.warn(
    `[DualEngineWarning] Recent trade detected for ` +
      `user=${userId.substring(0, 8)}... ` +
      `strategy=${strategyId.substring(0, 8)}... ` +
      `symbol=${baseSymbol} within 30s | ` +
      `currentOrigin=${currentOrigin} | ` +
      `recentTradeOrigin=${dualCheck.inferredRecentOrigin || "UNKNOWN"} | ` +
      `tradeId=${dualCheck.recentTradeId?.substring(0, 8)}... ` +
      `age=${dualCheck.recentTradeAge}ms - ` +
      `proceeding anyway (Phase B log-only)`,
  );
}
// ============= END DUAL-ENGINE DETECTION =============

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  metrics.totalRequests++;

  try {
    // STEP 2: CONFIRM FUNCTION HAS CREDENTIALS
    console.log("[FUNC] env SUPABASE_URL set:", !!Deno.env.get("SUPABASE_URL"));
    console.log("[FUNC] env SERVICE_ROLE set:", !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Parse request body - support both wrapped and direct intent formats
    const body = await req.json();

    // ============= DEBUG ENDPOINT: INTELLIGENT → MOCK_TRADES MAPPING TEST =============
    // READ-ONLY: Does NOT execute trades or modify any data
    // Usage: POST with body { "debug_mode": true, "debug_test": "intelligent_btc_mapping" }
    //
    // This debug handler checks the mapping between:
    //   - decision_events (where source='intelligent', engine='intelligent', symbol='BTC', side='BUY')
    //   - mock_trades (where cryptocurrency='BTC', trade_type='buy', is_test_mode=true)
    //
    // VALID COLUMNS FOR mock_trades queries (DO NOT USE 'source' or 'engine' on mock_trades):
    //   - id, user_id, strategy_id, trade_type ('buy'/'sell'), cryptocurrency
    //   - amount, price, total_value, is_test_mode, executed_at
    //   - original_purchase_amount, original_purchase_price, original_purchase_value
    //   - exit_value, realized_pnl, realized_pnl_pct, buy_fees, sell_fees
    //   - notes, strategy_trigger, original_trade_id
    //
    // VALID COLUMNS FOR decision_events queries:
    //   - id, user_id, strategy_id, symbol, side, source, engine
    //   - confidence, entry_price, tp_pct, sl_pct, expected_pnl_pct
    //   - reason, decision_ts, created_at, trade_id, metadata, raw_intent
    // ==============================================================================
    if (body.debug_mode === true && body.debug_test === "intelligent_btc_mapping") {
      console.log("[DEBUG] intelligent_btc_mapping test requested");

      // Step 1: Fetch last N decision_events for intelligent BTC BUY decisions (last 48h)
      const lookbackHours = 48;
      const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

      // Query decision_events using ONLY valid columns for that table
      // decision_events has: source, engine, symbol, side, created_at
      const { data: decisions, error: decisionsError } = await supabaseClient
        .from("decision_events")
        .select("id, user_id, strategy_id, symbol, side, source, created_at, entry_price, confidence, metadata")
        .eq("source", "intelligent")
        .eq("symbol", "BTC")
        .eq("side", "BUY")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(10);

      if (decisionsError) {
        console.error("[DEBUG] Failed to fetch decision_events:", decisionsError);
        return new Response(
          JSON.stringify({
            debug: "intelligent_btc_mapping",
            error: "decision_events_query_failed",
            details: decisionsError.message,
          }),
          { headers: corsHeaders },
        );
      }

      console.log(`[DEBUG] Found ${decisions?.length || 0} intelligent BTC BUY decisions in last ${lookbackHours}h`);

      // Step 2: For each decision, look for matching mock_trades
      // mock_trades uses: cryptocurrency, trade_type, is_test_mode, executed_at
      // NOTE: mock_trades does NOT have 'source' or 'engine' columns!
      const matches: Array<{
        decision_id: string;
        decision_created_at: string;
        decision_user_id: string;
        decision_strategy_id: string | null;
        decision_entry_price: number | null;
        decision_confidence: number | null;
        matching_trades: Array<{
          mock_trade_id: string;
          executed_at: string;
          total_value: number;
          amount: number;
          price: number;
          time_diff_seconds: number;
        }>;
      }> = [];

      for (const decision of decisions || []) {
        const decisionTime = new Date(decision.created_at).getTime();
        const windowMs = 60 * 1000; // ±60 seconds
        const windowStart = new Date(decisionTime - windowMs).toISOString();
        const windowEnd = new Date(decisionTime + windowMs).toISOString();

        // Query mock_trades using ONLY valid columns: cryptocurrency, trade_type, is_test_mode, executed_at
        // DO NOT use .eq('source', ...) here - mock_trades does not have that column
        const { data: trades, error: tradesError } = await supabaseClient
          .from("mock_trades")
          .select("id, executed_at, total_value, amount, price, user_id, strategy_id")
          .eq("cryptocurrency", "BTC")
          .eq("trade_type", "buy")
          .eq("is_test_mode", true)
          .gte("executed_at", windowStart)
          .lte("executed_at", windowEnd);

        if (tradesError) {
          console.error("[DEBUG] Failed to fetch mock_trades for decision:", decision.id, tradesError);
          continue;
        }

        // Filter by user_id if decision has one
        const filteredTrades = (trades || []).filter((t) => t.user_id === decision.user_id);

        matches.push({
          decision_id: decision.id,
          decision_created_at: decision.created_at,
          decision_user_id: decision.user_id,
          decision_strategy_id: decision.strategy_id,
          decision_entry_price: decision.entry_price,
          decision_confidence: decision.confidence,
          matching_trades: filteredTrades.map((t) => ({
            mock_trade_id: t.id,
            executed_at: t.executed_at,
            total_value: t.total_value,
            amount: t.amount,
            price: t.price,
            time_diff_seconds: Math.abs(new Date(t.executed_at).getTime() - decisionTime) / 1000,
          })),
        });
      }

      // Summary stats
      const decisionsWithMatches = matches.filter((m) => m.matching_trades.length > 0).length;
      const decisionsWithoutMatches = matches.filter((m) => m.matching_trades.length === 0).length;

      console.log(`[DEBUG] Mapping complete: ${decisionsWithMatches} with trades, ${decisionsWithoutMatches} without`);

      return new Response(
        JSON.stringify({
          debug: "intelligent_btc_mapping",
          lookback_hours: lookbackHours,
          decisions_checked: decisions?.length || 0,
          decisions_with_matches: decisionsWithMatches,
          decisions_without_matches: decisionsWithoutMatches,
          matches: matches,
          // Schema documentation for reference
          _schema_notes: {
            decision_events_columns_used: [
              "id",
              "user_id",
              "strategy_id",
              "symbol",
              "side",
              "source",
              "created_at",
              "entry_price",
              "confidence",
              "metadata",
            ],
            mock_trades_columns_used: [
              "id",
              "executed_at",
              "total_value",
              "amount",
              "price",
              "user_id",
              "strategy_id",
              "cryptocurrency",
              "trade_type",
              "is_test_mode",
            ],
            warning: "mock_trades does NOT have source or engine columns - use decision_events for those",
          },
        }),
        { headers: corsHeaders },
      );
    }
    // ============= END DEBUG ENDPOINT =============

    const intent: TradeIntent = body.intent || body;

    // ============= PHASE D: BLOCK FRONTEND AUTOMATIC BUYs =============
    // Frontend intelligent engine is NO LONGER allowed to generate automatic BUYs.
    // Only backend engine (BACKEND_LIVE) and manual UI (UI_MANUAL) can create BUYs.
    //
    // This is a HARD BLOCK at the coordinator level as a safety gate.
    // ===================================================================
    const intentContext = intent?.metadata?.context || "";
    const intentEngine = intent?.metadata?.engine || "";
    const isFrontendIntelligent =
      intentContext === "FRONTEND_INTELLIGENT" ||
      (intentEngine === "intelligent" && !intentContext.startsWith("BACKEND_"));

    if (isFrontendIntelligent && intent?.side === "BUY") {
      console.log("[Coordinator] Blocked frontend BUY (Phase D) - source:", intent?.source, "context:", intentContext);
      return new Response(
        JSON.stringify({
          decision: {
            action: "BLOCK",
            reason: "frontend_buy_disabled",
            fusion_score: 0,
            request_id: `blocked_${Date.now()}`,
            retry_in_ms: 0,
          },
        }),
        { headers: corsHeaders },
      );
    }

    // ============= PHASE S3: BLOCK FRONTEND AUTOMATIC SELLs =============
    // Frontend is NO LONGER allowed to generate automatic SELL exits.
    // Automatic exits (TP/SL/trailing/auto-close) must come from backend engine.
    //
    // Frontend is ONLY allowed:
    //   - Manual SELLs (context = 'MANUAL' or source = 'manual')
    //   - Pool exits (context = 'POOL_EXIT')
    //
    // This ensures that when browser is closed, risk management still works
    // via the backend 5-minute scheduler.
    //
    // ENHANCED GUARD: Also blocks SELLs with auto-exit triggers that have:
    //   - origin = null (frontend doesn't set origin)
    //   - context = null (frontend doesn't set context for auto exits)
    // ===================================================================
    const autoExitContexts = ["AUTO_TP", "AUTO_SL", "AUTO_TRAIL", "AUTO_CLOSE", "TP", "SL"];
    const intentTrigger = intent?.metadata?.trigger || "";
    const autoExitTriggers = ["TAKE_PROFIT", "STOP_LOSS", "TRAILING_STOP", "AUTO_CLOSE_TIME"];
    const intentOrigin = intent?.metadata?.origin || null;

    // Check if this is an automatic exit (based on trigger or context)
    const isAutoExitContext = autoExitContexts.includes(intentContext) || autoExitTriggers.includes(intentTrigger);

    // Backend exits must have explicit origin='BACKEND_LIVE' or context starting with 'BACKEND_' or 'AUTO_'
    const isFromBackend =
      intentContext.startsWith("BACKEND_") || intentContext.startsWith("AUTO_") || intentOrigin === "BACKEND_LIVE";

    // Manual and pool exits are allowed from frontend
    const isManualOrPool =
      intent?.source === "manual" ||
      intentContext === "MANUAL" ||
      intentContext === "POOL_EXIT" ||
      intentContext === "pool";

    // ENHANCED: Block if auto-exit trigger but NO proper backend origin/context
    // This catches the case where frontend sends trigger=AUTO_CLOSE_TIME but origin=null, context=null or empty
    //
    // CRITICAL FIX: intentContext defaults to '' (empty string) from line 664, NOT null
    // So we must check for empty string explicitly in addition to null/undefined
    const isEmptyOrNullContext = !intentContext || intentContext === "";
    const isEmptyOrNullOrigin = !intentOrigin || intentOrigin === null || intentOrigin === undefined;

    const isFrontendAutoExit =
      intent?.side === "SELL" &&
      autoExitTriggers.includes(intentTrigger) &&
      isEmptyOrNullOrigin &&
      isEmptyOrNullContext &&
      intent?.source !== "manual";

    // Also check: any SELL with an auto trigger that doesn't have BACKEND_LIVE origin is blocked
    const hasAutoTriggerButNotBackend =
      intent?.side === "SELL" &&
      autoExitTriggers.includes(intentTrigger) &&
      intentOrigin !== "BACKEND_LIVE" &&
      !isManualOrPool;

    if (
      intent?.side === "SELL" &&
      (isAutoExitContext || isFrontendAutoExit || hasAutoTriggerButNotBackend) &&
      !isFromBackend &&
      !isManualOrPool
    ) {
      console.log("[Coordinator] Blocked frontend auto-exit SELL (Phase S3)", {
        source: intent?.source,
        context: intentContext,
        trigger: intentTrigger,
        origin: intentOrigin,
        reason: "blocked_auto_exit_frontend_origin",
        isFrontendAutoExit,
        isAutoExitContext,
      });
      return new Response(
        JSON.stringify({
          decision: {
            action: "BLOCK",
            reason: "blocked_auto_exit_frontend_origin",
            fusion_score: 0,
            request_id: `blocked_exit_${Date.now()}`,
            retry_in_ms: 0,
            message:
              "Automatic exits (TP/SL/trailing/auto-close) must originate from backend engine with origin=BACKEND_LIVE.",
          },
        }),
        { headers: corsHeaders },
      );
    }

    // Log if no 'mode' field present - default to normal DECIDE flow
    const mode = (intent as any).mode || intent?.metadata?.mode;
    if (!mode) {
      console.log('[coordinator] No "mode" field, defaulting to DECIDE flow');
    }

    // ============= SHADOW MODE DETECTION =============
    // Shadow mode: Run all decision logic but DO NOT insert trades
    // Used by backend-shadow-engine for validation/dry-run
    const isShadowMode = intent?.metadata?.execMode === "SHADOW" || intent?.metadata?.context === "BACKEND_SHADOW";
    if (isShadowMode) {
      console.log("🌑 COORDINATOR: SHADOW MODE DETECTED - will NOT insert trades");
    }

    // ============= PHASE E: BACKEND LIVE DETECTION =============
    const isBackendLive =
      intent?.metadata?.context === "BACKEND_LIVE" || (autoExitContexts.includes(intentContext) && isFromBackend);
    if (isBackendLive) {
      console.log("🔥 COORDINATOR: BACKEND_LIVE MODE - trade will be inserted");
    }

    // ============= ENTRY LOGGING FOR DEBUGGING =============
    // CRITICAL: Log incoming source and debugTag immediately for diagnostics
    console.info("COORDINATOR: received trade intent", {
      source: intent?.source,
      reason: intent?.reason,
      debugTag: intent?.metadata?.debugTag,
      engine: intent?.metadata?.engine,
      symbol: intent?.symbol,
      side: intent?.side,
      idempotencyKey: intent?.idempotencyKey,
      strategyId: intent?.strategyId,
      backend_request_id: intent?.metadata?.backend_request_id,
    });

    // STRUCTURED LOGGING
    console.log(
      "[coordinator] intent",
      JSON.stringify(
        {
          userId: intent?.userId,
          strategyId: intent?.strategyId,
          symbol: intent?.symbol,
          side: intent?.side,
          source: intent?.source,
          mode: mode || "decide",
          qtySuggested: intent?.qtySuggested,
          flags: intent?.metadata?.flags || null,
          force: intent?.metadata?.force === true,
          currentPrice: intent?.metadata?.currentPrice ?? null,
          debugTag: intent?.metadata?.debugTag,
          engine: intent?.metadata?.engine,
          backend_request_id: intent?.metadata?.backend_request_id,
        },
        null,
        2,
      ),
    );

    // STEP 2: COORDINATOR ENTRY LOGS
    console.log("============ STEP 2: COORDINATOR ENTRY ============");
    console.log("received intent (full JSON):", JSON.stringify(intent, null, 2));

    const resolvedSymbol = toBaseSymbol(intent.symbol); // symbol for DB lookups
    console.log("resolvedSymbol (for DB lookups):", resolvedSymbol);
    console.log("mode (mock vs real wallet):", mode || "decide");

    // Generate request ID and idempotency key
    const requestId = generateRequestId();
    // Use provided idempotencyKey from backend or generate new one
    const idempotencyKey = intent?.idempotencyKey || generateIdempotencyKey(intent);
    intent.idempotencyKey = idempotencyKey;

    // ============= PHASE E: IDEMPOTENCY CHECK FOR BACKEND LIVE =============
    // Prevent duplicate trade execution using idempotencyKey
    if (isBackendLive && intent.side === "BUY" && idempotencyKey) {
      console.log(`[BackendLiveDedup] Checking idempotency for key: ${idempotencyKey}`);

      // Check if this exact idempotencyKey has already been executed
      const { data: existingByKey } = await supabaseClient
        .from("mock_trades")
        .select("id, executed_at")
        .eq("user_id", intent.userId)
        .like("strategy_trigger", `%${idempotencyKey}%`)
        .limit(1);

      if (existingByKey && existingByKey.length > 0) {
        console.log(`[BackendLiveDedup] BLOCKED - Duplicate idempotencyKey found: ${existingByKey[0].id}`);
        return new Response(
          JSON.stringify({
            alreadyExecuted: true,
            decision: {
              action: "BLOCK",
              reason: "duplicate_idempotency_key",
              request_id: requestId,
              retry_in_ms: 0,
              existing_trade_id: existingByKey[0].id,
            },
          }),
          { headers: corsHeaders },
        );
      }

      // ============= PHASE E: 5-SECOND TIME WINDOW DEDUP =============
      // Additional dedup: Check for recent trades on same symbol within 5 seconds
      const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
      const { data: recentTrades } = await supabaseClient
        .from("mock_trades")
        .select("id, executed_at")
        .eq("user_id", intent.userId)
        .eq("strategy_id", intent.strategyId)
        .eq("cryptocurrency", resolvedSymbol)
        .eq("trade_type", "buy")
        .gte("executed_at", fiveSecondsAgo)
        .limit(1);

      if (recentTrades && recentTrades.length > 0) {
        console.log(`[BackendLiveDedup] BLOCKED - Duplicate execution within 5s window: ${recentTrades[0].id}`);
        return new Response(
          JSON.stringify({
            alreadyExecuted: true,
            decision: {
              action: "BLOCK",
              reason: "duplicate_time_window",
              request_id: requestId,
              retry_in_ms: 0,
              existing_trade_id: recentTrades[0].id,
              window_seconds: 5,
            },
          }),
          { headers: corsHeaders },
        );
      }

      console.log(`[BackendLiveDedup] No duplicates found - proceeding with trade`);
    }

    // Validate intent - strategyId can be null for forced debug trades from intelligent engine
    const isIntelligentForcedDebug =
      intent?.source === "intelligent" && intent?.metadata?.debugTag === "forced_debug_trade";
    if (!intent?.userId || !intent?.symbol || !intent?.side) {
      console.warn("COORDINATOR: SKIPPING decision_event insert", {
        reason: "missing_required_fields",
        source: intent?.source,
        debugTag: intent?.metadata?.debugTag,
        missingFields: {
          userId: !intent?.userId,
          symbol: !intent?.symbol,
          side: !intent?.side,
        },
      });
      return respond("HOLD", "internal_error", requestId);
    }

    // strategyId is required unless this is a forced debug trade from intelligent engine
    if (!intent?.strategyId && !isIntelligentForcedDebug) {
      console.warn("COORDINATOR: SKIPPING decision_event insert", {
        reason: "missing_strategyId_and_not_debug_trade",
        source: intent?.source,
        debugTag: intent?.metadata?.debugTag,
      });
      return respond("HOLD", "internal_error", requestId);
    }

    // ============= INTELLIGENT ENGINE ENFORCEMENT GATE =============
    // ONLY 'intelligent' and 'manual' sources are allowed
    // The legacy 'automated' engine has been fully deprecated
    // All other sources are silently rejected
    //
    // Allowed sources:
    //   - 'intelligent' : from useIntelligentTradingEngine (frontend)
    //   - 'manual'      : from UI buttons (Test BUY, manual sell, etc.)
    //
    // Rejected sources (deprecated):
    //   - 'automated'   : legacy automated-trading-engine
    //   - 'pool'        : legacy pool exit system
    //   - 'news'        : legacy news-based signals
    //   - 'whale'       : legacy whale signals
    // ==============================================================
    const allowedSourcesToProcess = ["intelligent", "manual"];
    if (!allowedSourcesToProcess.includes(intent.source)) {
      console.warn("🚫 COORDINATOR: Rejecting deprecated source", {
        source: intent.source,
        symbol: intent.symbol,
        side: intent.side,
        reason: "source_deprecated_use_intelligent_engine",
        allowed_sources: allowedSourcesToProcess,
      });

      // Return success response but do NOT process or log
      // This ensures the legacy engine doesn't retry
      return new Response(
        JSON.stringify({
          ok: true,
          deprecated: true,
          decision: {
            action: "HOLD",
            reason: "source_deprecated",
            request_id: requestId,
            retry_in_ms: 0,
            message: `Source '${intent.source}' is deprecated. Only 'intelligent' engine is active.`,
          },
        }),
        {
          headers: corsHeaders,
        },
      );
    }

    // FAST PATH FOR MANUAL TEST BUY (UI-seeded test trades)
    if (
      intent.side === "BUY" &&
      intent.source === "manual" &&
      intent.metadata?.is_test_mode === true &&
      intent.metadata?.ui_seed === true
    ) {
      console.log("[coordinator] FAST PATH: Manual test BUY from UI");

      const baseSymbol = toBaseSymbol(intent.symbol);
      const qty = intent.qtySuggested || 0;
      const price = intent.metadata?.price_used;

      if (!qty || !price || qty <= 0 || price <= 0) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Invalid quantity or price for manual test BUY",
          }),
          {
            status: 400,
            headers: corsHeaders,
          },
        );
      }

      const totalValue = qty * price;

      console.log(`💱 UI TEST BUY: ${qty} ${baseSymbol} at €${price} = €${totalValue}`);

      // Insert BUY mock trade with entry_context for pyramiding model
      const entryContext = intent.metadata?.entry_context || null;

      const mockTrade = {
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        trade_type: "buy",
        cryptocurrency: baseSymbol,
        amount: qty,
        price: price,
        total_value: totalValue,
        executed_at: new Date().toISOString(),
        is_test_mode: true,
        notes: "Manual test BUY via UI",
        strategy_trigger: `ui_manual_test_buy|req:${requestId}`,
        // PYRAMIDING MODEL: Store entry_context in market_conditions
        market_conditions: {
          entry_context: entryContext,
          request_id: requestId,
          origin: "UI_MANUAL",
          executed_at: new Date().toISOString(),
        },
      };

      const { data: insertResult, error: insertError } = await supabaseClient
        .from("mock_trades")
        .insert(mockTrade)
        .select("id");

      if (insertError) {
        console.error("❌ UI TEST BUY: Insert failed:", insertError);
        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "DEFER",
              reason: "direct_execution_failed",
              request_id: requestId,
              retry_in_ms: 5000,
              error: insertError.message,
            },
          }),
          {
            headers: corsHeaders,
          },
        );
      }

      const tradeId = insertResult?.[0]?.id;
      console.log("✅ UI TEST BUY: Trade inserted with id:", tradeId);

      // CRITICAL: Log decision to decision_events for learning loop
      // Fetch strategy config for TP/SL defaults
      const { data: strategyConfig } = await supabaseClient
        .from("trading_strategies")
        .select("configuration")
        .eq("id", intent.strategyId)
        .single();

      const config = strategyConfig?.configuration || {};

      // BACKWARD-COMPATIBLE CONFIG RESOLUTION - supports legacy key paths
      const configResolution = resolveStrategyConfig(config);
      if (!configResolution.success) {
        console.log(`🚫 UI TEST BUY: Missing required config fields: ${configResolution.missingKeys?.join(", ")}`);
        return new Response(
          JSON.stringify({
            ok: false,
            error: `blocked_missing_config:${configResolution.missingKeys?.join(",")}`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const resolvedConfig = configResolution.resolved!;

      // Log the BUY decision
      await logDecisionAsync(
        supabaseClient,
        intent,
        "BUY", // action
        "no_conflicts_detected", // reason
        {
          enableUnifiedDecisions: false,
          minHoldPeriodMs: resolvedConfig.minHoldPeriodMs,
          cooldownBetweenOppositeActionsMs: resolvedConfig.cooldownBetweenOppositeActionsMs,
          confidenceOverrideThreshold: resolvedConfig.confidenceOverrideThreshold,
        }, // unifiedConfig
        requestId,
        undefined, // profitMetadata
        tradeId, // tradeId
        price, // executionPrice
        {
          // strategyConfig
          takeProfitPercentage: resolvedConfig.takeProfitPercentage,
          stopLossPercentage: resolvedConfig.stopLossPercentage,
          minConfidence: resolvedConfig.aiConfidenceThreshold / 100,
          configuration: config,
        },
      );

      console.log("✅ UI TEST BUY: Decision logged to decision_events");

      return new Response(
        JSON.stringify({
          ok: true,
          decision: {
            action: "EXECUTE",
            reason: "ui_manual_test_buy",
            request_id: requestId,
            retry_in_ms: 0,
            qty: qty,
            trade_id: tradeId,
          },
        }),
        {
          headers: corsHeaders,
        },
      );
    }

    // ============= FAST PATH FOR INTELLIGENT ENGINE FORCED DEBUG TRADES =============
    // These are test intents from useIntelligentTradingEngine with debugTag='forced_debug_trade'
    // They may have strategyId=null but MUST be logged to decision_events for learning loop validation
    if (isIntelligentForcedDebug) {
      console.log("[coordinator] FAST PATH: Intelligent engine forced debug trade");
      console.info("🧪 INTELLIGENT FAST PATH: Processing forced debug trade", {
        source: intent.source,
        debugTag: intent.metadata?.debugTag,
        symbol: intent.symbol,
        side: intent.side,
        engine: intent.metadata?.engine,
        idempotencyKey: intent.idempotencyKey,
        strategyId: intent.strategyId,
        userId: intent.userId,
      });

      const baseSymbol = toBaseSymbol(intent.symbol);

      // Get market price for entry_price
      let marketPrice = null;
      try {
        const priceData = await getMarketPrice(baseSymbol, 15000);
        marketPrice = priceData.price;
      } catch (err) {
        console.warn("[coordinator] Could not fetch price for forced debug trade:", err?.message);
        marketPrice = intent.metadata?.price || intent.metadata?.currentPrice || null;
      }

      // Default config for forced debug trades (no strategy lookup since strategyId may be null)
      const debugUnifiedConfig: UnifiedConfig = {
        enableUnifiedDecisions: false,
        minHoldPeriodMs: 300000,
        cooldownBetweenOppositeActionsMs: 180000,
        confidenceOverrideThreshold: 0.7,
      };

      const debugStrategyConfig = {
        takeProfitPercentage: 1.5,
        stopLossPercentage: 0.8,
        minConfidence: 0.5,
        configuration: { is_test_mode: true },
      };

      // Determine action based on side
      const action = intent.side as DecisionAction;
      const reason = "no_conflicts_detected" as Reason;

      // CRITICAL: Log decision to decision_events - THIS IS THE MAIN PURPOSE OF THIS PATH
      console.info("🧪 INTELLIGENT FAST PATH: About to call logDecisionAsync", {
        userId: intent.userId,
        strategyId: intent.strategyId,
        symbol: baseSymbol,
        side: intent.side,
        source: intent.source,
        debugTag: intent.metadata?.debugTag,
        engine: intent.metadata?.engine,
        entry_price: marketPrice,
        action: action,
        reason: reason,
      });

      // CRITICAL: Capture the result to know if insert actually succeeded
      const logResult = await logDecisionAsync(
        supabaseClient,
        intent,
        action,
        reason,
        debugUnifiedConfig,
        requestId,
        undefined, // profitMetadata
        undefined, // tradeId - no trade created for debug
        marketPrice, // executionPrice
        debugStrategyConfig,
      );

      // Check if insert actually succeeded
      if (logResult.logged) {
        console.log("✅ INTELLIGENT DEBUG: Decision successfully logged to decision_events", {
          source: intent.source,
          debugTag: intent.metadata?.debugTag,
          engine: intent.metadata?.engine,
        });

        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: action,
              reason: "intelligent_forced_debug_logged",
              request_id: requestId,
              retry_in_ms: 0,
              debugTag: "forced_debug_trade",
              logged_to_decision_events: true,
            },
          }),
          {
            headers: corsHeaders,
          },
        );
      } else {
        // INSERT FAILED - log error and return honest response
        console.error("❌ INTELLIGENT DEBUG: Failed to log decision to decision_events", {
          error: logResult.error,
          source: intent.source,
          debugTag: intent.metadata?.debugTag,
          strategyId: intent.strategyId,
        });

        return new Response(
          JSON.stringify({
            ok: false,
            decision: {
              action: "HOLD",
              reason: "decision_events_insert_failed",
              request_id: requestId,
              retry_in_ms: 0,
              debugTag: "forced_debug_trade",
              logged_to_decision_events: false,
              error: logResult.error,
            },
          }),
          {
            headers: corsHeaders,
          },
        );
      }
    }

    // ============= FAST PATH FOR NORMAL INTELLIGENT ENGINE TRADES =============
    // These are real trade intents from useIntelligentTradingEngine (not forced debug)
    // They have source='intelligent' but NO debugTag='forced_debug_trade'
    // We MUST log them to decision_events with source='intelligent' for learning loop
    const isNormalIntelligentTrade =
      intent?.source === "intelligent" && intent?.metadata?.debugTag !== "forced_debug_trade";

    // DEBUG INSTRUMENTATION: Track BUY pipeline entry
    console.log("[DEBUG][COORD] ========== INTELLIGENT TRADE PIPELINE ==========");
    console.log("[DEBUG][COORD] isNormalIntelligentTrade:", isNormalIntelligentTrade);
    console.log("[DEBUG][COORD] intent.strategyId:", intent.strategyId);
    console.log("[DEBUG][COORD] intent.side:", intent.side);
    console.log("[DEBUG][COORD] intent.source:", intent.source);
    console.log("[DEBUG][COORD] intent.metadata?.is_test_mode:", intent.metadata?.is_test_mode);

    if (isNormalIntelligentTrade && intent.strategyId) {
      console.log("[DEBUG][COORD] ENTERED normal intelligent trade block");
      console.log("🧠 INTELLIGENT DECISION – normal trade path", {
        source: intent.source,
        symbol: intent.symbol,
        side: intent.side,
        strategyId: intent.strategyId,
        engine: intent.metadata?.engine,
        reason: intent.reason,
        confidence: intent.confidence,
      });

      const baseSymbol = toBaseSymbol(intent.symbol);

      // Get market price for entry_price
      let marketPrice = null;
      try {
        const priceData = await getMarketPrice(baseSymbol, 15000);
        marketPrice = priceData.price;
      } catch (err) {
        console.warn("[coordinator] Could not fetch price for intelligent trade:", err?.message);
        marketPrice = intent.metadata?.price || intent.metadata?.currentPrice || null;
      }

      // Fetch strategy config including state/policy fields
      const { data: strategyConfig, error: stratConfigError } = await supabaseClient
        .from("trading_strategies")
        .select("unified_config, configuration, state, execution_target, on_disable_policy, panic_active")
        .eq("id", intent.strategyId)
        .eq("user_id", intent.userId)
        .single();

      if (stratConfigError || !strategyConfig) {
        console.error("❌ INTELLIGENT: Strategy not found:", stratConfigError);
        return respond("HOLD", "internal_error", requestId);
      }

      // State/execution gate for intelligent trades (early check)
      const intStrategyState = strategyConfig.state || "ACTIVE";
      const intExecutionTarget = strategyConfig.execution_target || "MOCK";
      const intPanicActive = strategyConfig.panic_active === true;

      // Panic gate (hard blocker)
      if (intPanicActive) {
        console.log("🚫 INTELLIGENT: PANIC ACTIVE - trade blocked");
        return new Response(
          JSON.stringify({
            ok: true,
            decision: { action: "BLOCK", reason: "blocked_panic_active", request_id: requestId, retry_in_ms: 0 },
          }),
          { headers: corsHeaders },
        );
      }

      // REAL mode: Let it fall through to the main REAL execution path below
      // The main coordinator REAL gate handles prerequisites and execution_jobs insertion
      if (intExecutionTarget === "REAL") {
        console.log("🔥 INTELLIGENT: REAL mode - falling through to main REAL execution path");
        // Don't block here - let the main flow handle REAL mode with prerequisites check
      }

      if (intent.side === "BUY" && intStrategyState !== "ACTIVE") {
        console.log(`🚫 INTELLIGENT: BUY blocked - strategy state is ${intStrategyState}`);
        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "BLOCK",
              reason: "blocked_strategy_not_active",
              request_id: requestId,
              retry_in_ms: 0,
              strategy_state: intStrategyState,
            },
          }),
          { headers: corsHeaders },
        );
      }

      // BACKWARD-COMPATIBLE CONFIG RESOLUTION - supports legacy key paths
      const configData = strategyConfig.configuration || {};
      const configResolution = resolveStrategyConfig(configData);
      if (!configResolution.success) {
        console.log(`🚫 INTELLIGENT: Missing required config fields: ${configResolution.missingKeys?.join(", ")}`);
        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "BLOCK",
              reason: `blocked_missing_config:${configResolution.missingKeys?.join(",")}` as Reason,
              request_id: requestId,
              retry_in_ms: 0,
              message: `Missing required config fields: ${configResolution.missingKeys?.join(", ")}`,
            },
          }),
          { headers: corsHeaders },
        );
      }
      const resolvedConfig = configResolution.resolved!;

      const unifiedConfig: UnifiedConfig = strategyConfig.unified_config || {
        enableUnifiedDecisions: false,
        minHoldPeriodMs: resolvedConfig.minHoldPeriodMs,
        cooldownBetweenOppositeActionsMs: resolvedConfig.cooldownBetweenOppositeActionsMs,
        confidenceOverrideThreshold: resolvedConfig.confidenceOverrideThreshold,
      };

      const config = configData;

      // Extract effective TP/SL/confidence from resolved config
      const effectiveTpPct = configData.takeProfitPercentage ?? 0.7;
      const effectiveSlPct = configData.stopLossPercentage ?? 0.7;
      const confidenceThreshold = resolvedConfig.aiConfidenceThreshold; // 0-100

      // Determine action based on side
      const action = intent.side as DecisionAction;
      const reason = "no_conflicts_detected" as Reason;

      // 🧪 INTELLIGENT INSERT – PAYLOAD (debug log)
      console.log("🧪 INTELLIGENT INSERT – PAYLOAD", {
        table: "decision_events",
        source: "intelligent",
        userId: intent.userId,
        strategyId: intent.strategyId,
        symbol: baseSymbol,
        side: intent.side,
        debugTag: intent.metadata?.debugTag || null,
        engine: intent.metadata?.engine,
        entry_price: marketPrice,
        confidence: intent.confidence,
      });

      // Log decision to decision_events
      const logResult = await logDecisionAsync(
        supabaseClient,
        intent,
        action,
        reason,
        unifiedConfig,
        requestId,
        undefined, // profitMetadata
        undefined, // tradeId - will be set if trade executes
        marketPrice, // executionPrice
        {
          // strategyConfig
          takeProfitPercentage: effectiveTpPct,
          stopLossPercentage: effectiveSlPct,
          minConfidence: confidenceThreshold / 100,
          configuration: config,
        },
      );

      // 🧪 INTELLIGENT INSERT – RESULT (debug log)
      console.log("🧪 INTELLIGENT INSERT – RESULT", {
        source: "intelligent",
        debugTag: intent.metadata?.debugTag || null,
        engine: intent.metadata?.engine,
        logged: logResult.logged,
        error: logResult.error || null,
      });

      if (!logResult.logged) {
        console.error("❌ INTELLIGENT: Failed to log decision to decision_events", {
          error: logResult.error,
          source: intent.source,
          strategyId: intent.strategyId,
        });
        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "HOLD",
              reason: "decision_events_insert_failed",
              request_id: requestId,
              retry_in_ms: 0,
              logged_to_decision_events: false,
              error: logResult.error,
            },
          }),
          {
            headers: corsHeaders,
          },
        );
      }

      console.log("✅ INTELLIGENT: Decision logged to decision_events", {
        source: intent.source,
        symbol: baseSymbol,
        side: intent.side,
        engine: intent.metadata?.engine,
      });

      // NOTE: We log the decision but let the normal coordinator flow handle execution
      // This ensures all gates, locks, and trading logic are still applied
      // The decision is now recorded for learning loop regardless of execution outcome
      //
      // Fall through to regular coordinator flow for actual trade execution...
      console.log("[DEBUG][COORD] About to fall through to regular coordinator flow for execution");
      console.log("[DEBUG][COORD] intent.side for execution:", intent.side);
    } else {
      console.log("[DEBUG][COORD] SKIPPED normal intelligent trade block");
      console.log(
        "[DEBUG][COORD] Reason: isNormalIntelligentTrade=",
        isNormalIntelligentTrade,
        "strategyId=",
        intent.strategyId,
      );
    }

    // FAST PATH FOR MANUAL/MOCK/FORCE SELL
    // MANUAL SELL semantics:
    // - If metadata.originalTradeId is provided, we close THAT specific BUY.
    // - We pre-fill original_purchase_* from that BUY.
    // - mt_on_sell_snapshot will treat this as a targeted close, not global FIFO.
    if (intent.side === "SELL" && intent.source === "manual" && (intent.metadata?.force === true || mode === "mock")) {
      console.log("[coordinator] fast-path triggered for manual/mock/force");

      const exitPrice = Number(intent?.metadata?.currentPrice);
      if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
        return new Response(JSON.stringify({ ok: false, error: "missing/invalid currentPrice for mock sell" }), {
          status: 400,
          headers: corsHeaders,
        });
      }

      // FIFO snapshot calculation for manual SELL
      const baseSymbol = toBaseSymbol(intent.symbol);
      const sellAmount = intent.qtySuggested || 0;
      const originalTradeId = intent.metadata?.originalTradeId;

      // TARGETED MANUAL SELL: Fetch the specific BUY trade if originalTradeId is provided
      let originalBuy = null;
      if (originalTradeId) {
        console.log(`[coordinator] TARGETED MANUAL SELL: Fetching original BUY with id=${originalTradeId}`);
        const { data: buyData, error: buyError } = await supabaseClient
          .from("mock_trades")
          .select("*")
          .eq("id", originalTradeId)
          .eq("user_id", intent.userId)
          .eq("strategy_id", intent.strategyId)
          .eq("cryptocurrency", baseSymbol)
          .eq("trade_type", "buy")
          .eq("is_test_mode", true)
          .maybeSingle();

        if (buyError) {
          console.error("[coordinator] Failed to fetch original BUY:", buyError);
        } else if (buyData) {
          originalBuy = buyData;
          console.log(`[coordinator] Found original BUY: amount=${originalBuy.amount}, price=${originalBuy.price}`);
        } else {
          console.warn("[coordinator] Original BUY not found with id:", originalTradeId);
        }
      }

      let totalPurchaseAmount: number;
      let totalPurchaseValue: number;
      let originalTradeIdToStore: string | null = null;

      // If we found the target BUY, use its snapshot directly (targeted close)
      if (originalBuy) {
        // Close the exact BUY that was clicked
        totalPurchaseAmount = originalBuy.amount;
        totalPurchaseValue = originalBuy.amount * originalBuy.price;
        originalTradeIdToStore = originalBuy.id;
        console.log(
          `[coordinator] TARGETED CLOSE: Closing BUY id=${originalBuy.id}, amount=${totalPurchaseAmount}, value=${totalPurchaseValue}`,
        );
      } else {
        // Fallback to global FIFO if original BUY not found or not provided
        console.log("[coordinator] FALLBACK TO GLOBAL FIFO (originalTradeId not found or not provided)");

        // Get all BUY trades for this user/strategy/symbol to calculate FIFO
        const { data: buyTrades } = await supabaseClient
          .from("mock_trades")
          .select("*")
          .eq("user_id", intent.userId)
          .eq("strategy_id", intent.strategyId)
          .eq("cryptocurrency", baseSymbol)
          .eq("trade_type", "buy")
          .eq("is_test_mode", true)
          .order("executed_at", { ascending: true });

        // Get existing SELL trades to calculate remaining amounts in each BUY
        const { data: sellTrades } = await supabaseClient
          .from("mock_trades")
          .select("original_purchase_amount, executed_at")
          .eq("user_id", intent.userId)
          .eq("strategy_id", intent.strategyId)
          .eq("cryptocurrency", baseSymbol)
          .eq("trade_type", "sell")
          .eq("is_test_mode", true)
          .not("original_purchase_amount", "is", null);

        // Calculate FIFO snapshot fields
        totalPurchaseAmount = 0;
        totalPurchaseValue = 0;
        let needAmount = sellAmount;

        for (const buyTrade of buyTrades || []) {
          if (needAmount <= 0) break;

          // Calculate how much of this BUY has been consumed by previous SELLs
          const consumedByPreviousSells = (sellTrades || [])
            .filter((sell) => new Date(sell.executed_at) >= new Date(buyTrade.executed_at))
            .reduce((sum, sell) => sum + (sell.original_purchase_amount || 0), 0);

          const remainingAmount = buyTrade.amount - consumedByPreviousSells;

          if (remainingAmount > 0) {
            const takeAmount = Math.min(needAmount, remainingAmount);
            totalPurchaseAmount += takeAmount;
            totalPurchaseValue += takeAmount * buyTrade.price;
            needAmount -= takeAmount;
          }
        }
      }

      const exitValue = sellAmount * exitPrice;
      const avgPurchasePrice = totalPurchaseAmount > 0 ? totalPurchaseValue / totalPurchaseAmount : 0;
      const realizedPnL = exitValue - totalPurchaseValue;
      const realizedPnLPct = totalPurchaseValue > 0 ? (realizedPnL / totalPurchaseValue) * 100 : 0;

      // Insert mock SELL with snapshot fields and original_trade_id
      const executedAtTs = new Date().toISOString();
      const payload = {
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        trade_type: "sell",
        cryptocurrency: baseSymbol,
        amount: sellAmount,
        price: exitPrice,
        total_value: exitValue,
        executed_at: executedAtTs,
        original_trade_id: originalTradeIdToStore, // Link to specific BUY if targeted
        original_purchase_amount: totalPurchaseAmount,
        original_purchase_price: avgPurchasePrice,
        original_purchase_value: totalPurchaseValue,
        exit_value: exitValue,
        realized_pnl: realizedPnL,
        realized_pnl_pct: realizedPnLPct,
        buy_fees: 0,
        sell_fees: 0,
        notes: originalTradeIdToStore
          ? `Manual mock SELL via force override (coordinator fast-path) | original_trade_id=${originalTradeIdToStore}`
          : "Manual mock SELL via force override (coordinator fast-path)",
        is_test_mode: true,
        // UNIFIED LEDGER: Explicit mock execution fields
        execution_source: "mock_engine",
        execution_confirmed: true,
        execution_ts: executedAtTs,
      };

      // PHASE B: Dual-engine detection with origin tracking (log only, no blocking)
      const currentOrigin = detectIntentOrigin(intent.metadata);
      const dualCheck = await checkDualEngineConflict(supabaseClient, intent.userId, intent.strategyId, baseSymbol);
      if (dualCheck.hasRecentTrade) {
        logDualEngineWarning(dualCheck, currentOrigin, intent.userId, intent.strategyId, baseSymbol);
      }

      const { error: insErr } = await supabaseClient.from("mock_trades").insert([payload]);
      if (insErr) {
        console.error("[coordinator] mock sell insert failed", insErr);
        return new Response(JSON.stringify({ ok: false, error: insErr.message }), {
          status: 500,
          headers: corsHeaders,
        });
      }

      // ============= CASH LEDGER UPDATE: Manual SELL proceeds (via helper) =============
      const cashResult = await settleCashLedger(
        supabaseClient,
        intent.userId,
        "SELL",
        {
          total_value: exitValue,
          exit_value: exitValue, // For manual SELL, exitValue is already computed correctly
          fees: 0,
          sell_fees: 0,
        },
        {
          tradeId: "manual_sell_unknown_trade_id",
          path: "manual",
          isTestMode: true,
          strategyId: intent.strategyId,
          symbol: baseSymbol,
        },
      );

      if (!cashResult.success) {
        // Trade inserted but cash not updated - log decision_event for audit
        console.error(`⚠️ COORDINATOR: Manual SELL cash settlement failed: ${cashResult.error}`);
        await supabaseClient.from("decision_events").insert({
          user_id: intent.userId,
          strategy_id: intent.strategyId,
          symbol: baseSymbol,
          side: "SELL",
          source: "coordinator_manual_sell",
          reason: "cash_ledger_settle_failed",
          decision_ts: new Date().toISOString(),
          metadata: {
            cash_before: cashResult.cash_before,
            delta: cashResult.delta,
            error: cashResult.error,
            trade_inserted: true,
          },
        });
      }
      // ============= END CASH LEDGER UPDATE =============

      // Add symbol quarantine to prevent automation races
      await supabaseClient.from("execution_holds").upsert({
        user_id: intent.userId,
        symbol: baseSymbol,
        hold_until: new Date(Date.now() + 5000).toISOString(), // 5 second hold
        reason: "manual_sell_quarantine",
      });

      console.log("[coordinator] mock sell inserted", payload);

      // CRITICAL: Log SELL decision to decision_events for learning loop
      // Fetch strategy config for TP/SL defaults
      const { data: strategyConfig } = await supabaseClient
        .from("trading_strategies")
        .select("configuration")
        .eq("id", intent.strategyId)
        .single();

      const config = strategyConfig?.configuration || {};

      // BACKWARD-COMPATIBLE CONFIG RESOLUTION - supports legacy key paths
      const configResolution = resolveStrategyConfig(config);
      if (!configResolution.success) {
        console.log(`🚫 MANUAL SELL: Missing required config fields: ${configResolution.missingKeys?.join(", ")}`);
        return new Response(
          JSON.stringify({
            ok: false,
            error: `blocked_missing_config:${configResolution.missingKeys?.join(",")}`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const resolvedConfig = configResolution.resolved!;

      // Log the SELL decision
      await logDecisionAsync(
        supabaseClient,
        intent,
        "SELL", // action
        "no_conflicts_detected", // reason
        {
          enableUnifiedDecisions: false,
          minHoldPeriodMs: resolvedConfig.minHoldPeriodMs,
          cooldownBetweenOppositeActionsMs: resolvedConfig.cooldownBetweenOppositeActionsMs,
          confidenceOverrideThreshold: resolvedConfig.confidenceOverrideThreshold,
        }, // unifiedConfig
        requestId,
        {
          // profitMetadata
          entry_price: avgPurchasePrice,
          exit_price: exitPrice,
          profit_loss_fiat: realizedPnL,
          profit_loss_pct: realizedPnLPct,
          currentPrice: exitPrice,
        },
        undefined, // tradeId
        exitPrice, // executionPrice
        {
          // strategyConfig
          takeProfitPercentage: resolvedConfig.takeProfitPercentage,
          stopLossPercentage: resolvedConfig.stopLossPercentage,
          minConfidence: resolvedConfig.aiConfidenceThreshold / 100,
          configuration: config,
        },
      );

      console.log("✅ MANUAL SELL: Decision logged to decision_events");

      return new Response(
        JSON.stringify({
          ok: true,
          decision: { action: "SELL", reason: "manual_fast_path" },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // STEP 4: GATE OVERRIDES FOR MANUAL SELL (force debugging path)
    const force = intent.source === "manual" && intent.metadata?.force === true;
    if (force) {
      console.log("🔥 MANUAL FORCE OVERRIDE: bypassing all gates for debugging");
      const base = toBaseSymbol(intent.symbol);
      const qty = intent.qtySuggested || 0.001;
      const priceData = await getMarketPrice(base, 15000);
      const exec = await executeTradeOrder(
        supabaseClient,
        { ...intent, symbol: base, qtySuggested: qty },
        {},
        requestId,
        priceData,
      );
      return exec.success
        ? (logDecisionAsync(
            supabaseClient,
            intent,
            "SELL",
            "manual_override_precedence",
            { enableUnifiedDecisions: false } as UnifiedConfig,
            requestId,
            undefined,
            exec.tradeId,
            priceData?.price,
            exec.effectiveConfig || {},
          ),
          respond("SELL", "manual_override_precedence", requestId, 0, { qty: exec.qty }))
        : new Response(
            JSON.stringify({
              ok: true,
              decision: {
                action: "DEFER",
                reason: `Guards tripped: executionFailed - manual force override failed`,
              },
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
    }

    // Check for duplicate/idempotent request
    const cachedDecision = getCachedDecision(idempotencyKey);
    if (cachedDecision) {
      console.log(`🔄 COORDINATOR: Returning cached decision for key: ${idempotencyKey}`);
      return respond(
        cachedDecision.decision.action,
        cachedDecision.decision.reason,
        cachedDecision.decision.request_id,
        cachedDecision.decision.retry_in_ms,
        cachedDecision.decision.qty ? { qty: cachedDecision.decision.qty } : {},
      );
    }

    // Get strategy configuration including state/policy fields + panic_active
    const { data: strategy, error: strategyError } = await supabaseClient
      .from("trading_strategies")
      .select(
        "unified_config, configuration, state, execution_target, on_disable_policy, liquidation_batch_id, panic_active",
      )
      .eq("id", intent.strategyId)
      .eq("user_id", intent.userId)
      .single();

    if (strategyError || !strategy) {
      console.error("❌ COORDINATOR: Strategy not found:", strategyError);
      return respond("HOLD", "internal_error", requestId);
    }

    // ============= STRATEGY STATE & EXECUTION MODE ENFORCEMENT =============
    // New columns: state, execution_target, on_disable_policy, liquidation_batch_id, panic_active
    const strategyState = strategy.state || "ACTIVE"; // Default ACTIVE for legacy rows
    const strategyExecutionTarget = strategy.execution_target || "MOCK";
    const liquidationBatchId = strategy.liquidation_batch_id || null;
    const panicActive = strategy.panic_active === true;

    // =============================================================================
    // CANONICAL EXECUTION MODE (SINGLE SOURCE OF TRUTH)
    // =============================================================================
    // Manual trades with real wallet → REAL mode
    // Everything else → derives from strategy.execution_target
    // This is the ONLY place execution mode is determined for this request
    // =============================================================================
    type ExecutionMode = "REAL" | "MOCK";
    const canonicalExecutionMode: ExecutionMode =
      intent.source === "manual" && intent.metadata?.execution_wallet_id
        ? "REAL"
        : strategyExecutionTarget === "REAL"
          ? "REAL"
          : "MOCK";

    // =============================================================================
    // SINGLE CANONICAL EXECUTION FLAG (the ONLY isMockExecution in this file)
    // =============================================================================
    const isMockExecution = canonicalExecutionMode === "MOCK";
    const canonicalIsTestMode = isMockExecution; // Alias for passing to sub-functions

    console.log("[Coordinator] MODE =", canonicalExecutionMode, {
      execution_wallet_id: intent.metadata?.execution_wallet_id,
      execution_target: strategyExecutionTarget,
    });

    // ============= PANIC GATE (hard blocker) =============
    if (panicActive) {
      console.log("🚫 COORDINATOR: PANIC ACTIVE - all trades blocked for this strategy");
      return new Response(
        JSON.stringify({
          ok: true,
          decision: {
            action: "BLOCK",
            reason: "blocked_panic_active",
            request_id: requestId,
            retry_in_ms: 0,
            message: "Strategy panic mode is active. All trades are blocked until panic is cleared.",
          },
        }),
        { headers: corsHeaders },
      );
    }

    // FAIL-CLOSED: If state != ACTIVE and on_disable_policy IS NULL, BLOCK
    // No silent default to MANAGE_ONLY - require explicit policy
    const onDisablePolicy = strategy.on_disable_policy;
    if (strategyState !== "ACTIVE" && !onDisablePolicy) {
      console.log(`🚫 COORDINATOR: Missing policy - strategy state is ${strategyState} but on_disable_policy is NULL`);
      return new Response(
        JSON.stringify({
          ok: true,
          decision: {
            action: "BLOCK",
            reason: "blocked_missing_policy",
            request_id: requestId,
            retry_in_ms: 0,
            strategy_state: strategyState,
            message: "Strategy is not ACTIVE but on_disable_policy is not set. Set policy before proceeding.",
          },
        }),
        { headers: corsHeaders },
      );
    }

    console.log(
      "[Coordinator][StateGate] state:",
      strategyState,
      "executionTarget:",
      strategyExecutionTarget,
      "policy:",
      onDisablePolicy || "N/A (ACTIVE)",
      "panicActive:",
      panicActive,
    );

    // ============= REAL MODE EXECUTION PATH (Phase 1) =============
    // REAL mode: Check prerequisites, then route to execution_jobs (async)
    if (canonicalExecutionMode === "REAL") {
      console.log("🔥 COORDINATOR: REAL mode detected - checking prerequisites");

      // Check live trading prerequisites via RPC
      const { data: prereqResult, error: prereqError } = await supabaseClient.rpc("check_live_trading_prerequisites", {
        p_user_id: intent.userId,
      });

      if (prereqError) {
        console.error("❌ COORDINATOR: Prerequisites check failed:", prereqError);
        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "BLOCK",
              reason: "blocked_prerequisites_check_failed",
              request_id: requestId,
              retry_in_ms: 0,
              message: "Failed to verify live trading prerequisites.",
            },
          }),
          { headers: corsHeaders },
        );
      }

      // Hard blocker: rules_accepted must be true
      if (!prereqResult?.rules_accepted) {
        console.log("🚫 COORDINATOR: REAL mode blocked - rules not accepted");
        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "BLOCK",
              reason: "blocked_rules_not_accepted",
              request_id: requestId,
              retry_in_ms: 0,
              message: "You must accept trading rules before executing REAL trades.",
            },
          }),
          { headers: corsHeaders },
        );
      }

      // Hard blocker: wallet must be active and funded
      if (!prereqResult?.wallet_ok) {
        console.log("🚫 COORDINATOR: REAL mode blocked - wallet not ready");
        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "BLOCK",
              reason: "blocked_wallet_not_ready",
              request_id: requestId,
              retry_in_ms: 0,
              message: "Your execution wallet is not active or funded.",
            },
          }),
          { headers: corsHeaders },
        );
      }

      // All prerequisites passed - insert execution_job (async execution)
      console.log("✅ COORDINATOR: Prerequisites OK - inserting execution_job");

      // Get market price for the payload
      const baseSymbol = toBaseSymbol(intent.symbol);
      let marketPrice = null;
      try {
        const priceData = await getMarketPrice(baseSymbol, 15000);
        marketPrice = priceData?.price;
      } catch (err) {
        console.warn("[Coordinator] Could not fetch price for REAL trade:", err?.message);
        marketPrice = intent.metadata?.currentPrice || intent.metadata?.price || null;
      }

      const qty = intent.qtySuggested || 0;
      const totalValue = marketPrice && qty ? qty * marketPrice : null;

      // Generate idempotency key for REAL trades
      const realIdempotencyKey = `real_${intent.strategyId}_${baseSymbol}_${intent.side}_${Date.now()}`;

      // Insert READY job into execution_jobs
      const { data: jobResult, error: jobError } = await supabaseClient
        .from("execution_jobs")
        .insert({
          user_id: intent.userId,
          strategy_id: intent.strategyId,
          execution_target: "REAL",
          execution_mode: "ONCHAIN", // Default; signer can override based on config
          kind: "SWAP",
          side: intent.side,
          symbol: baseSymbol,
          amount: qty,
          status: "READY",
          idempotency_key: realIdempotencyKey,
          payload: {
            intent_source: intent.source,
            intent_reason: intent.reason,
            confidence: intent.confidence,
            market_price: marketPrice,
            total_value_eur: totalValue,
            wallet_address: prereqResult.wallet_address,
            request_id: requestId,
            metadata: intent.metadata,
            created_at: new Date().toISOString(),
          },
        })
        .select("id")
        .single();

      if (jobError) {
        console.error("❌ COORDINATOR: Failed to insert execution_job:", jobError);
        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "DEFER",
              reason: "execution_job_insert_failed",
              request_id: requestId,
              retry_in_ms: 5000,
              error: jobError.message,
            },
          }),
          { headers: corsHeaders },
        );
      }

      console.log("✅ COORDINATOR: REAL execution_job inserted:", jobResult?.id);

      // Log decision_event for audit
      await supabaseClient.from("decision_events").insert({
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        symbol: baseSymbol,
        side: intent.side,
        source: intent.source,
        confidence: intent.confidence,
        entry_price: marketPrice,
        reason: "real_execution_job_queued",
        decision_ts: new Date().toISOString(),
        metadata: {
          execution_job_id: jobResult?.id,
          idempotency_key: realIdempotencyKey,
          wallet_address: prereqResult.wallet_address,
          execution_status: "QUEUED",
          intent_side: intent.side,
        },
      });

      return new Response(
        JSON.stringify({
          ok: true,
          decision: {
            action: intent.side,
            reason: "real_execution_job_queued",
            request_id: requestId,
            retry_in_ms: 0,
            execution_job_id: jobResult?.id,
            message: "REAL trade queued for async execution.",
          },
        }),
        { headers: corsHeaders },
      );
    }

    // ============= STRATEGY STATE GATE =============
    // BUY is blocked when strategy is not ACTIVE
    // SELL is allowed based on state and policy
    if (intent.side === "BUY" && strategyState !== "ACTIVE") {
      console.log(`🚫 COORDINATOR: BUY blocked - strategy state is ${strategyState} (not ACTIVE)`);
      return new Response(
        JSON.stringify({
          ok: true,
          decision: {
            action: "BLOCK",
            reason: "blocked_strategy_not_active",
            request_id: requestId,
            retry_in_ms: 0,
            strategy_state: strategyState,
            message: `BUY orders are blocked when strategy is in ${strategyState} state.`,
          },
        }),
        { headers: corsHeaders },
      );
    }

    // ============= SELL POLICY ENFORCEMENT =============
    // When strategy is not ACTIVE, SELL behavior depends on on_disable_policy:
    // - MANAGE_ONLY: Allow TP/SL/trailing/auto-close (managed exits) + manual SELLs
    // - CLOSE_ALL: All SELLs allowed (liquidation in progress)
    // - DETACH_TO_MANUAL: Only manual SELLs allowed (no auto exits)
    // - PAUSED state: Only manual SELLs allowed
    if (intent.side === "SELL" && strategyState !== "ACTIVE") {
      const isManualSell =
        intent.source === "manual" || intent.metadata?.context === "MANUAL" || intent.metadata?.context === "POOL_EXIT";
      const isManagedExit = ["TAKE_PROFIT", "STOP_LOSS", "TRAILING_STOP", "AUTO_CLOSE_TIME"].includes(
        intent.metadata?.trigger || "",
      );
      const isLiquidationSell = intent.metadata?.liquidation_batch_id != null;

      // PAUSED state: only manual allowed
      if (strategyState === "PAUSED" && !isManualSell) {
        console.log(`🚫 COORDINATOR: SELL blocked - strategy is PAUSED, only manual SELLs allowed`);
        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "BLOCK",
              reason: "blocked_strategy_paused",
              request_id: requestId,
              retry_in_ms: 0,
              message: "Strategy is PAUSED. Only manual SELLs are allowed.",
            },
          }),
          { headers: corsHeaders },
        );
      }

      // DETACHED state: only manual allowed
      if (strategyState === "DETACHED" && !isManualSell) {
        console.log(`🚫 COORDINATOR: SELL blocked - strategy is DETACHED, only manual SELLs allowed`);
        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "BLOCK",
              reason: "blocked_strategy_detached",
              request_id: requestId,
              retry_in_ms: 0,
              message: "Strategy is DETACHED. Positions are unmanaged - only manual SELLs allowed.",
            },
          }),
          { headers: corsHeaders },
        );
      }

      // PAUSED_MANAGE_ONLY state: policy-based enforcement
      if (strategyState === "PAUSED_MANAGE_ONLY") {
        if (onDisablePolicy === "MANAGE_ONLY" && !isManualSell && !isManagedExit) {
          console.log(`🚫 COORDINATOR: SELL blocked - policy MANAGE_ONLY, but SELL is not a managed exit or manual`);
          return new Response(
            JSON.stringify({
              ok: true,
              decision: {
                action: "BLOCK",
                reason: "blocked_policy_manage_only",
                request_id: requestId,
                retry_in_ms: 0,
                message: "Strategy policy is MANAGE_ONLY. Only TP/SL/trailing exits and manual SELLs are allowed.",
              },
            }),
            { headers: corsHeaders },
          );
        }

        if (onDisablePolicy === "DETACH_TO_MANUAL" && !isManualSell) {
          console.log(`🚫 COORDINATOR: SELL blocked - policy DETACH_TO_MANUAL, only manual SELLs allowed`);
          return new Response(
            JSON.stringify({
              ok: true,
              decision: {
                action: "BLOCK",
                reason: "blocked_policy_detached",
                request_id: requestId,
                retry_in_ms: 0,
                message: "Strategy policy is DETACH_TO_MANUAL. Only manual SELLs are allowed.",
              },
            }),
            { headers: corsHeaders },
          );
        }

        // CLOSE_ALL policy: all SELLs allowed, but track liquidation batch
        if (onDisablePolicy === "CLOSE_ALL") {
          console.log(`[Coordinator][Liquidation] CLOSE_ALL policy - SELL allowed`);

          // If liquidation_batch_id is active, ALL managed/auto SELLs must include batch_id
          // Manual SELLs can bypass this (user-initiated emergency exit)
          if (liquidationBatchId) {
            const intentBatchId = intent.metadata?.liquidation_batch_id;

            // Case 1: intent has batch_id but it doesn't match active batch → stale request
            if (intentBatchId && intentBatchId !== liquidationBatchId) {
              console.log(
                `🚫 COORDINATOR: SELL blocked - liquidation_batch_id mismatch (intent: ${intentBatchId}, active: ${liquidationBatchId})`,
              );
              return new Response(
                JSON.stringify({
                  ok: true,
                  decision: {
                    action: "BLOCK",
                    reason: "blocked_liquidation_batch_mismatch",
                    request_id: requestId,
                    retry_in_ms: 0,
                    message: "Liquidation batch ID mismatch. This is a stale liquidation request.",
                  },
                }),
                { headers: corsHeaders },
              );
            }

            // Case 2: managed exit without batch_id during active liquidation → block
            // This prevents auto-exits that weren't initiated by the liquidation flow
            if (!intentBatchId && isManagedExit && !isManualSell) {
              console.log(`🚫 COORDINATOR: SELL blocked - managed exit during CLOSE_ALL requires liquidation_batch_id`);
              return new Response(
                JSON.stringify({
                  ok: true,
                  decision: {
                    action: "BLOCK",
                    reason: "blocked_liquidation_requires_batch_id",
                    request_id: requestId,
                    retry_in_ms: 0,
                    message: "During CLOSE_ALL liquidation, managed exits must include liquidation_batch_id.",
                  },
                }),
                { headers: corsHeaders },
              );
            }
          }
        }
      }

      console.log(
        `[Coordinator][StateGate] SELL allowed - state: ${strategyState}, policy: ${onDisablePolicy}, isManual: ${isManualSell}, isManaged: ${isManagedExit}`,
      );
    }
    // ============= END STATE/POLICY ENFORCEMENT =============

    const unifiedConfig: UnifiedConfig = strategy.unified_config || {
      enableUnifiedDecisions: false,
      minHoldPeriodMs: 120000,
      cooldownBetweenOppositeActionsMs: 30000,
      confidenceOverrideThreshold: 0.7,
    };

    // DEBUG INSTRUMENTATION: Track UD mode branching
    console.log("[DEBUG][COORD] ========== UD MODE DECISION ==========");
    console.log("[DEBUG][COORD] enableUnifiedDecisions:", unifiedConfig.enableUnifiedDecisions);
    console.log("[DEBUG][COORD] intent.side:", intent.side);
    console.log(
      "[DEBUG][COORD] strategy.configuration:",
      JSON.stringify(strategy.configuration || {}).substring(0, 500),
    );

    // 🚨 HARD GATE: If unified decisions disabled, bypass ALL coordinator logic
    if (!unifiedConfig.enableUnifiedDecisions) {
      console.log("[DEBUG][COORD] ENTERING UD_MODE=OFF branch (direct execution)");
      console.log("🎯 UD_MODE=OFF → DIRECT EXECUTION: bypassing all locks and conflict detection");

      // Execute trade directly without any coordinator gating
      // Pass canonical execution mode so all downstream uses the same source of truth
      console.log("[DEBUG][COORD] Calling executeTradeDirectly...");
      const executionResult = await executeTradeDirectly(
        supabaseClient,
        intent,
        { ...strategy.configuration, canonicalExecutionMode, canonicalIsTestMode },
        requestId,
      );
      console.log("[DEBUG][COORD] executeTradeDirectly result:", JSON.stringify(executionResult));

      if (executionResult.success) {
        console.log("[DEBUG][COORD] UD_MODE=OFF SUCCESS - trade executed");
        console.log(`🎯 UD_MODE=OFF → DIRECT EXECUTION: action=${intent.side} symbol=${intent.symbol} lock=NONE`);
        // Log decision for audit (async, non-blocking) with execution price
        logDecisionAsync(
          supabaseClient,
          intent,
          intent.side,
          "unified_decisions_disabled_direct_path",
          unifiedConfig,
          requestId,
          undefined,
          executionResult.tradeId,
          executionResult.executed_price,
          strategy.configuration,
        );
        return respond(intent.side, "unified_decisions_disabled_direct_path", requestId, 0, {
          qty: executionResult.qty,
        });
      } else {
        console.log("[DEBUG][COORD] UD_MODE=OFF FAILED:", executionResult.error);
        const guardReport = {
          minNotionalFail: false,
          cooldownActive: false,
          riskLimitExceeded: false,
          positionNotFound: false,
          qtyMismatch: false,
          marketClosed: false,
          executionFailed: true,
          other: executionResult.error,
        };
        console.log("[coordinator] defer", guardReport);

        console.error(`❌ UD_MODE=OFF → DIRECT EXECUTION FAILED: ${executionResult.error}`);
        // Log decision for audit (async, non-blocking) - pass price even for DEFER
        const priceForLog = intent.metadata?._coordinator_price || null;
        logDecisionAsync(
          supabaseClient,
          intent,
          "DEFER",
          "direct_execution_failed",
          unifiedConfig,
          requestId,
          undefined,
          undefined,
          priceForLog,
          strategy.configuration,
        );

        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "DEFER",
              reason: `Guards tripped: executionFailed - ${executionResult.error}`,
            },
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // Check for manual quarantine before proceeding (only for automated traffic)
    if (intent.source !== "manual") {
      const { data: holdData } = await supabaseClient
        .from("execution_holds")
        .select("hold_until")
        .eq("user_id", intent.userId)
        .eq("symbol", resolvedSymbol)
        .gt("hold_until", new Date().toISOString())
        .maybeSingle();

      if (holdData) {
        const guardReport = {
          minNotionalFail: false,
          cooldownActive: false,
          riskLimitExceeded: false,
          positionNotFound: false,
          qtyMismatch: false,
          marketClosed: false,
          holdPeriodNotMet: false,
          manualQuarantine: true,
          other: null,
        };
        console.log("[coordinator] defer", guardReport);

        console.log(`🎯 UD_MODE=ON → DEFER: reason=manual_quarantine symbol=${intent.symbol}`);

        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "DEFER",
              reason: `Guards tripped: manualQuarantine`,
            },
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // PHASE 3.1: PRE-EXECUTION CIRCUIT BREAKER GATE
    const breakerCheck = await checkCircuitBreakers(supabaseClient, intent);
    if (breakerCheck.blocked) {
      console.log(`🚫 COORDINATOR: Blocked by circuit breaker - ${breakerCheck.reason}`);
      const guardReport = { circuitBreakerActive: true };
      console.log("[coordinator] defer", guardReport);

      // Get current price for context
      const baseSymbol = toBaseSymbol(intent.symbol);
      const priceData = await getMarketPrice(baseSymbol, 15000);

      logDecisionAsync(
        supabaseClient,
        intent,
        "DEFER",
        "blocked_by_circuit_breaker",
        unifiedConfig,
        requestId,
        { breaker_types: breakerCheck.breaker_types },
        undefined,
        priceData.price,
        strategy.configuration,
      );
      return new Response(
        JSON.stringify({
          ok: true,
          decision: {
            action: "DEFER",
            reason: `Guards tripped: circuitBreakerActive - ${breakerCheck.reason}`,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ============= CONFIDENCE GATE =============
    // Extract base confidence threshold from config
    const rawThreshold = strategy.configuration?.aiIntelligenceConfig?.aiConfidenceThreshold ?? 60;
    const baseMinConfidence = rawThreshold / 100;

    // Get dynamic min_confidence from strategy_parameters
    const confidenceConfig = await getEffectiveMinConfidenceForDecision({
      supabaseClient,
      userId: intent.userId,
      strategyId: intent.strategyId,
      symbol: resolvedSymbol,
      baseMinConfidence,
    });

    const confidenceThreshold = confidenceConfig.effectiveMinConfidence;
    const effectiveConfidence = normalizeConfidence(intent.confidence);

    console.log("[coordinator] Confidence gate:", {
      threshold: confidenceThreshold,
      effectiveConfidence,
      source: confidenceConfig.source,
      optimizer: confidenceConfig.optimizer,
    });

    // Apply confidence gate (unless confidence is null)
    try {
      if (effectiveConfidence !== null && effectiveConfidence < confidenceThreshold) {
        console.log("[coordinator] 🚫 Decision blocked by confidence gate", {
          symbol: intent.symbol,
          side: intent.side,
          effectiveConfidence,
          threshold: confidenceThreshold,
        });

        // Get current price for context
        const baseSymbol = toBaseSymbol(intent.symbol);
        const priceData = await getMarketPrice(baseSymbol, 15000);

        // Log decision event with confidence_below_threshold reason
        await logDecisionAsync(
          supabaseClient,
          intent,
          "HOLD",
          "signal_too_weak",
          unifiedConfig,
          requestId,
          { effectiveConfidence, confidenceThreshold },
          undefined,
          priceData.price,
          strategy.configuration,
          confidenceConfig, // Pass confidence source/optimizer info
        );

        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "HOLD",
              reason: "confidence_below_threshold",
              request_id: requestId,
              retry_in_ms: 0,
            },
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    } catch (err) {
      console.error("[coordinator] ⚠️ Confidence gate failure:", {
        symbol: intent.symbol,
        side: intent.side,
        error: err?.message || String(err),
      });

      // Return HOLD response without throwing (skip logging on error)
      return new Response(
        JSON.stringify({
          ok: true,
          decision: {
            action: "HOLD",
            reason: "confidence_below_threshold",
            request_id: requestId,
            retry_in_ms: 0,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Unified Decisions ON - Use conflict detection approach
    console.log("🎯 UD_MODE=ON → CONFLICT DETECTION: checking for holds and conflicts");

    const symbolKey = `${intent.userId}_${intent.strategyId}_${intent.symbol}`;

    // Check micro-queue for this symbol
    const queueLength = getQueueLength(symbolKey);
    if (queueLength > 1) {
      // Too many concurrent requests for this symbol - defer with jitter
      const retryMs = 300 + Math.random() * 500; // 300-800ms jitter
      metrics.deferCount++;

      const guardReport = {
        minNotionalFail: false,
        cooldownActive: false,
        riskLimitExceeded: false,
        positionNotFound: false,
        qtyMismatch: false,
        marketClosed: false,
        queueOverload: true,
        other: null,
      };
      console.log("[coordinator] defer", guardReport);

      console.log(`🎯 UD_MODE=ON → DEFER: reason=queue_overload_defer symbol=${intent.symbol} retry=${retryMs}ms`);

      return new Response(
        JSON.stringify({
          ok: true,
          decision: {
            action: "DEFER",
            reason: `Guards tripped: queueOverload`,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Add to queue and process
    addToQueue(symbolKey, intent);

    try {
      // Use timestamp-based conflict detection (NO DB LOCKS)
      // PHASE 5: Pass strategy config for exposure check
      const conflictResult = await detectConflicts(supabaseClient, intent, unifiedConfig, strategy);

      if (conflictResult.hasConflict) {
        const guardReport = conflictResult.guardReport || {};
        console.log("[coordinator] defer", guardReport);

        const guardNames =
          Object.entries(guardReport)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(", ") || "unknown";

        const reasonWithGuards = `Guards tripped: ${guardNames}`;

        console.log(`🎯 UD_MODE=ON → DEFER: reason=${conflictResult.reason} symbol=${intent.symbol}`);
        cacheDecision(idempotencyKey, {
          action: "DEFER",
          reason: conflictResult.reason as Reason,
          request_id: requestId,
          retry_in_ms: 0,
        });

        // Get current price for context
        const baseSymbol = toBaseSymbol(intent.symbol);
        const priceData = await getMarketPrice(baseSymbol, 15000);

        logDecisionAsync(
          supabaseClient,
          intent,
          "DEFER",
          conflictResult.reason as Reason,
          unifiedConfig,
          requestId,
          undefined,
          undefined,
          priceData.price,
          strategy.configuration,
        );

        return new Response(
          JSON.stringify({
            ok: true,
            decision: {
              action: "DEFER",
              reason: reasonWithGuards,
            },
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // No conflicts - proceed with execution using advisory lock ONLY for atomic section
      // Pass canonical execution mode so all downstream uses the same source of truth
      const decision = await executeWithMinimalLock(
        supabaseClient,
        intent,
        unifiedConfig,
        { ...strategy.configuration, canonicalExecutionMode, canonicalIsTestMode },
        requestId,
      );

      cacheDecision(idempotencyKey, decision);

      // Track metrics
      const executionTime = Date.now() - startTime;
      metrics.executionTimes.push(executionTime);
      if (metrics.executionTimes.length > 100) {
        metrics.executionTimes = metrics.executionTimes.slice(-50);
      }

      return respond(
        decision.action,
        decision.reason,
        decision.request_id,
        decision.retry_in_ms,
        decision.qty ? { qty: decision.qty } : {},
      );
    } finally {
      removeFromQueue(symbolKey, intent);
    }
  } catch (error) {
    console.error("❌ COORDINATOR: Error:", error);
    console.error("❌ COORDINATOR: Error stack:", error?.stack || "no stack");
    console.error("❌ COORDINATOR: Error message:", error?.message || String(error));
    return respond("HOLD", "internal_error", generateRequestId());
  }
});

// ============= HELPER FUNCTIONS =============

// Normalize confidence values (handles both 0-1 and 0-100 formats)
function normalizeConfidence(input: number | undefined | null): number | null {
  if (input == null || Number.isNaN(input)) return null;
  // If it looks like 0-100, convert to 0-1
  if (input > 1.0) return Math.min(100, Math.max(0, input)) / 100;
  // Already in 0-1 range
  return Math.min(1, Math.max(0, input));
}

// Generate unique request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Generate idempotency key based on intent contents
function generateIdempotencyKey(intent: TradeIntent): string {
  // 1) If client provided one (FE buckets to seconds), use it.
  if (intent.idempotencyKey) return intent.idempotencyKey;

  // 2) Otherwise, bucket ts to seconds to avoid millisecond churn.
  const tsSec = intent.ts
    ? Math.floor(new Date(intent.ts).getTime() / 1000).toString()
    : Math.floor(Date.now() / 1000).toString();

  const normalized = {
    userId: intent.userId,
    strategyId: intent.strategyId,
    symbol: intent.symbol,
    side: intent.side,
    source: intent.source,
    clientTs: tsSec,
  };

  const keyString = JSON.stringify(normalized);
  let hash = 0;
  for (let i = 0; i < keyString.length; i++) {
    const char = keyString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `idem_${Math.abs(hash).toString(16)}`;
}

// STEP 1: Single response helper (enforces one shape always)
const respond = (
  action: DecisionAction,
  reason: Reason,
  request_id: string,
  retry_in_ms = 0,
  extra: Record<string, any> = {},
): Response => {
  const decision = { action, reason, request_id, retry_in_ms, ...extra };
  return new Response(
    JSON.stringify({
      ok: true,
      decision,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
};

// Cache management
function getCachedDecision(key: string): { decision: TradeDecision; timestamp: number } | null {
  const cached = recentDecisionCache.get(key);
  if (cached && Date.now() - cached.timestamp < 30000) {
    // 30s cache
    return cached;
  }
  if (cached) {
    recentDecisionCache.delete(key); // Expired
  }
  return null;
}

function cacheDecision(key: string, decision: TradeDecision): void {
  recentDecisionCache.set(key, {
    decision: { ...decision },
    timestamp: Date.now(),
  });

  // Cleanup old entries
  if (recentDecisionCache.size > 1000) {
    const entries = Array.from(recentDecisionCache.entries());
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
    recentDecisionCache.clear();
    entries.slice(0, 500).forEach(([k, v]) => recentDecisionCache.set(k, v));
  }
}

// =============================================================================
// SELL CONTRACT (INVARIANT - applies to ALL paths, UD=ON or UD=OFF):
// A SELL must always close BUY lots (FIFO), generate per-lot SELL rows,
// and must NEVER insert an aggregated SELL without original_trade_id.
// Each SELL row must have:
//   - original_trade_id: UUID of the BUY lot being closed
//   - original_purchase_amount: amount from the BUY lot
//   - original_purchase_price: price from the BUY lot
//   - original_purchase_value: entry value (amount * price)
//   - exit_value: sell amount * exit price
//   - realized_pnl: exit_value - original_purchase_value
//   - realized_pnl_pct: (realized_pnl / original_purchase_value) * 100
// =============================================================================

// Helper: Reconstruct open lots from DB for a symbol (inlined for Deno compatibility)
interface OpenLotFromDb {
  lotId: string;
  symbol: string;
  entryPrice: number;
  entryDate: string;
  originalAmount: number;
  remainingAmount: number;
  entryValue: number;
}

async function reconstructOpenLotsFromDb(
  supabaseClient: any,
  userId: string,
  strategyId: string,
  baseSymbol: string,
): Promise<OpenLotFromDb[]> {
  // Fetch all BUY trades for this symbol
  const { data: buyTrades, error: buyError } = await supabaseClient
    .from("mock_trades")
    .select("id, cryptocurrency, amount, price, total_value, executed_at")
    .eq("user_id", userId)
    .eq("strategy_id", strategyId)
    .in("cryptocurrency", [baseSymbol, `${baseSymbol}-EUR`])
    .eq("trade_type", "buy")
    .order("executed_at", { ascending: true }); // FIFO order

  if (buyError) {
    console.error("[reconstructOpenLotsFromDb] Error fetching BUY trades:", buyError);
    return [];
  }

  if (!buyTrades || buyTrades.length === 0) {
    return [];
  }

  // Fetch all SELL trades that reference these BUYs
  const buyIds = buyTrades.map((b: any) => b.id);
  const { data: linkedSells, error: sellError } = await supabaseClient
    .from("mock_trades")
    .select("original_trade_id, amount")
    .eq("user_id", userId)
    .eq("strategy_id", strategyId)
    .eq("trade_type", "sell")
    .in("original_trade_id", buyIds);

  // Calculate sold amount per lot
  const soldPerLot = new Map<string, number>();
  if (linkedSells) {
    for (const sell of linkedSells) {
      if (sell.original_trade_id) {
        const current = soldPerLot.get(sell.original_trade_id) || 0;
        soldPerLot.set(sell.original_trade_id, current + parseFloat(sell.amount));
      }
    }
  }

  // Fetch unlinked SELLs (legacy, no original_trade_id) for FIFO deduction
  const { data: unlinkedSells } = await supabaseClient
    .from("mock_trades")
    .select("amount, executed_at")
    .eq("user_id", userId)
    .eq("strategy_id", strategyId)
    .in("cryptocurrency", [baseSymbol, `${baseSymbol}-EUR`])
    .eq("trade_type", "sell")
    .is("original_trade_id", null)
    .order("executed_at", { ascending: true });

  // Apply FIFO for unlinked SELLs
  const unlinkedSoldPerLot = new Map<string, number>();
  if (unlinkedSells && unlinkedSells.length > 0) {
    for (const sell of unlinkedSells) {
      let remainingToDeduct = parseFloat(sell.amount);
      for (const buy of buyTrades) {
        if (remainingToDeduct <= 0.00000001) break;
        const alreadySoldLinked = soldPerLot.get(buy.id) || 0;
        const alreadySoldUnlinked = unlinkedSoldPerLot.get(buy.id) || 0;
        const totalSold = alreadySoldLinked + alreadySoldUnlinked;
        const available = parseFloat(buy.amount) - totalSold;
        if (available > 0.00000001) {
          const deduct = Math.min(remainingToDeduct, available);
          unlinkedSoldPerLot.set(buy.id, alreadySoldUnlinked + deduct);
          remainingToDeduct -= deduct;
        }
      }
    }
  }

  // Build open lots
  const openLots: OpenLotFromDb[] = [];
  for (const buy of buyTrades) {
    const soldLinked = soldPerLot.get(buy.id) || 0;
    const soldUnlinked = unlinkedSoldPerLot.get(buy.id) || 0;
    const totalSold = soldLinked + soldUnlinked;
    const remaining = parseFloat(buy.amount) - totalSold;

    if (remaining > 0.00000001) {
      openLots.push({
        lotId: buy.id,
        symbol: toBaseSymbol(buy.cryptocurrency),
        originalAmount: parseFloat(buy.amount),
        remainingAmount: remaining,
        entryPrice: parseFloat(buy.price),
        entryValue: parseFloat(buy.total_value),
        entryDate: buy.executed_at,
      });
    }
  }

  console.log(`[reconstructOpenLotsFromDb] Found ${openLots.length} open lots for ${baseSymbol}`);
  openLots.forEach((lot, i) => {
    console.log(
      `  [${i}] lotId=${lot.lotId.substring(0, 8)}... remaining=${lot.remainingAmount.toFixed(8)} entry=€${lot.entryPrice.toFixed(2)}`,
    );
  });

  return openLots;
}

// Helper: Build per-lot sell orders from open lots (FIFO)
interface PerLotSellOrder {
  lotId: string;
  amount: number;
  entryPrice: number;
  entryValue: number;
}

function buildPerLotSellOrdersForAmount(openLots: OpenLotFromDb[], amountToSell: number): PerLotSellOrder[] {
  const orders: PerLotSellOrder[] = [];
  let remaining = amountToSell;

  for (const lot of openLots) {
    if (remaining <= 0.00000001) break;
    const takeAmount = Math.min(remaining, lot.remainingAmount);
    if (takeAmount > 0.00000001) {
      orders.push({
        lotId: lot.lotId,
        amount: takeAmount,
        entryPrice: lot.entryPrice,
        entryValue: takeAmount * lot.entryPrice,
      });
      remaining -= takeAmount;
    }
  }

  return orders;
}

// Direct execution path (UD=OFF)
// NOTE: This path now uses per-lot SELL mechanism identical to UD=ON path
async function executeTradeDirectly(
  supabaseClient: any,
  intent: TradeIntent,
  strategyConfig: any,
  requestId: string,
): Promise<{ success: boolean; error?: string; qty?: number }> {
  console.log("[DEBUG][executeTradeDirectly] ENTERED");
  console.log("[DEBUG][executeTradeDirectly] intent.side:", intent.side);
  console.log("[DEBUG][executeTradeDirectly] intent.symbol:", intent.symbol);
  console.log("[DEBUG][executeTradeDirectly] intent.metadata?.is_test_mode:", intent.metadata?.is_test_mode);

  try {
    // Get real market price using symbol utilities with freshness check
    const baseSymbol = toBaseSymbol(intent.symbol);
    const sc = strategyConfig || {};

    // READ canonical execution mode from passed config (set at request entry)
    // DO NOT redeclare isMockExecution - use the value passed via strategyConfig
    const localIsMockExecution = sc?.canonicalIsTestMode === true;
    const localCanonicalExecutionMode = sc?.canonicalExecutionMode || "MOCK";

    console.log("[DEBUG][executeTradeDirectly] localIsMockExecution:", localIsMockExecution);

    // FAIL-CLOSED: Required config must exist - NO || fallbacks
    const priceStaleMaxMs = sc.priceStaleMaxMs;
    const spreadThresholdBps = sc.spreadThresholdBps;

    if (priceStaleMaxMs === undefined || priceStaleMaxMs === null) {
      console.log(`🚫 DIRECT: Trade blocked - missing required config: priceStaleMaxMs`);
      return { success: false, error: "blocked_missing_config:priceStaleMaxMs" };
    }
    if (spreadThresholdBps === undefined || spreadThresholdBps === null) {
      console.log(`🚫 DIRECT: Trade blocked - missing required config: spreadThresholdBps`);
      return { success: false, error: "blocked_missing_config:spreadThresholdBps" };
    }

    console.log("[DEBUG][executeTradeDirectly] baseSymbol:", baseSymbol);
    console.log("[DEBUG][executeTradeDirectly] Fetching market price...");

    const priceData = await getMarketPrice(baseSymbol, priceStaleMaxMs);
    const realMarketPrice = priceData.price;

    console.log("[DEBUG][executeTradeDirectly] realMarketPrice:", realMarketPrice);

    // Store price for decision logging
    intent.metadata = intent.metadata || {};
    intent.metadata._coordinator_price = realMarketPrice;

    // Phase 2: Hold period enforcement for ALL SELLs
    if (intent.side === "SELL") {
      // Fetch the most recent BUY for the same user/strategy/symbol
      const { data: recentBuys } = await supabaseClient
        .from("mock_trades")
        .select("executed_at")
        .eq("user_id", intent.userId)
        .eq("strategy_id", intent.strategyId)
        .eq("cryptocurrency", baseSymbol)
        .eq("trade_type", "buy")
        .order("executed_at", { ascending: false })
        .limit(1);

      if (recentBuys && recentBuys.length > 0) {
        const lastBuyTime = new Date(recentBuys[0].executed_at).getTime();
        const timeSinceBuy = Date.now() - lastBuyTime;

        // FAIL-CLOSED: Required config must exist - NO || fallbacks
        const minHoldPeriodMs = sc.minHoldPeriodMs;
        if (minHoldPeriodMs === undefined || minHoldPeriodMs === null) {
          console.log(`🚫 DIRECT: SELL blocked - missing required config: minHoldPeriodMs`);
          return { success: false, error: "blocked_missing_config:minHoldPeriodMs" };
        }

        if (timeSinceBuy < minHoldPeriodMs) {
          console.log(`🚫 DIRECT: SELL blocked - hold period not met (${timeSinceBuy}ms < ${minHoldPeriodMs}ms)`);

          // Log decision for consistency
          const cooldownMs = sc.cooldownBetweenOppositeActionsMs;
          if (cooldownMs === undefined || cooldownMs === null) {
            return { success: false, error: "blocked_missing_config:cooldownBetweenOppositeActionsMs" };
          }

          const pseudoUnifiedConfig = {
            enableUnifiedDecisions: false,
            minHoldPeriodMs: minHoldPeriodMs,
            cooldownBetweenOppositeActionsMs: cooldownMs,
            confidenceOverrideThreshold: sc.confidenceOverrideThreshold,
          };

          await logDecisionAsync(
            supabaseClient,
            intent,
            "DEFER",
            "hold_min_period_not_met",
            pseudoUnifiedConfig,
            requestId,
            undefined,
            undefined,
            realMarketPrice,
            strategyConfig,
          );

          return { success: false, error: "hold_min_period_not_met" };
        }
      }
    }

    // Phase 3: Price freshness and spread gates (for SELL operations)
    if (intent.side === "SELL") {
      if (priceData.tickAgeMs > priceStaleMaxMs) {
        console.log(`🚫 DIRECT: SELL blocked - price too stale (${priceData.tickAgeMs}ms > ${priceStaleMaxMs}ms)`);
        return {
          success: false,
          error: `insufficient_price_freshness: ${priceData.tickAgeMs}ms > ${priceStaleMaxMs}ms`,
        };
      }

      if (priceData.spreadBps > spreadThresholdBps) {
        console.log(
          `🚫 DIRECT: SELL blocked - spread too wide (${priceData.spreadBps.toFixed(1)}bps > ${spreadThresholdBps}bps)`,
        );
        return {
          success: false,
          error: `spread_too_wide: ${priceData.spreadBps.toFixed(1)}bps > ${spreadThresholdBps}bps`,
        };
      }
    }

    // CRITICAL FIX: Check available EUR balance BEFORE executing BUY trades
    const tradeAllocation = sc?.perTradeAllocation || 50; // match app defaults
    let qty: number;

    if (intent.side === "BUY") {
      console.log("[DEBUG][executeTradeDirectly] ENTERED BUY branch");

      // localIsMockExecution already declared at function scope (line ~3453)

      // Calculate current EUR balance from all trades (filter by canonical test mode)
      const { data: allTrades } = await supabaseClient
        .from("mock_trades")
        .select("trade_type, total_value")
        .eq("user_id", intent.userId)
        .eq("is_test_mode", localIsMockExecution);

      console.log("[DEBUG][executeTradeDirectly] allTrades count:", allTrades?.length || 0);

      let availableEur = 30000; // Starting balance

      if (allTrades) {
        allTrades.forEach((trade: any) => {
          const value = parseFloat(trade.total_value);
          if (trade.trade_type === "buy") {
            availableEur -= value;
          } else if (trade.trade_type === "sell") {
            availableEur += value;
          }
        });
      }

      console.log(`💰 DIRECT: Available EUR balance: €${availableEur.toFixed(2)}`);
      console.log("[DEBUG][executeTradeDirectly] availableEur:", availableEur);
      console.log("[DEBUG][executeTradeDirectly] tradeAllocation:", tradeAllocation);

      // Check if we have sufficient balance (applies to ALL modes including MOCK)
      if (availableEur < tradeAllocation) {
        const adjustedAllocation = Math.max(0, availableEur);
        if (adjustedAllocation < 10) {
          // Minimum €10 trade
          console.log(
            `🚫 DIRECT: Insufficient balance - €${availableEur.toFixed(2)} available, €${tradeAllocation} requested (localIsMockExecution=${localIsMockExecution})`,
          );
          return {
            success: false,
            error: "blocked_by_insufficient_cash",
            reason: "blocked_by_insufficient_cash",
            details: `Insufficient EUR balance: €${availableEur.toFixed(2)} available, €${tradeAllocation} requested`,
          };
        }
        console.log(
          `⚠️ DIRECT: Adjusting trade from €${tradeAllocation} to €${adjustedAllocation.toFixed(2)} (available balance)`,
        );
        qty = adjustedAllocation / realMarketPrice;
      } else {
        qty = tradeAllocation / realMarketPrice;
      }
    } else {
      // =============================================================================
      // STEP 3: PER-LOT SELL EXECUTION (UD=OFF path now uses same logic as UD=ON)
      // =============================================================================
      console.log("============ STEP 3: PER-LOT SELL EXECUTION ============");

      // Reconstruct open lots for this symbol
      const openLots = await reconstructOpenLotsFromDb(supabaseClient, intent.userId, intent.strategyId, baseSymbol);

      // Calculate net position from open lots
      const netPosition = openLots.reduce((sum, lot) => sum + lot.remainingAmount, 0);
      console.log("Open lots count:", openLots.length);
      console.log("Net position from lots:", netPosition);

      if (netPosition <= 0.00000001) {
        console.log(`🚫 DIRECT: SELL blocked - no open lots (net=${netPosition})`);
        return { success: false, error: "no_position_to_sell" };
      }

      // Determine quantity to sell
      const requestedQty = intent.qtySuggested || netPosition;
      const sellQty = Math.min(requestedQty, netPosition);

      // Build per-lot SELL orders (FIFO)
      const perLotOrders = buildPerLotSellOrdersForAmount(openLots, sellQty);

      if (perLotOrders.length === 0) {
        console.log(`🚫 DIRECT: SELL blocked - no lots to close`);
        return { success: false, error: "no_lots_to_close" };
      }

      // ANTI-REGRESSION GUARD: Verify all orders have original_trade_id
      if (perLotOrders.some((o) => !o.lotId)) {
        throw new Error("INVALID SELL: original_trade_id (lotId) is mandatory - SELL contract violated");
      }

      console.log(
        `[DIRECT] Generated ${perLotOrders.length} per-lot SELL orders for ${sellQty.toFixed(8)} ${baseSymbol}`,
      );
      perLotOrders.forEach((order, i) => {
        console.log(
          `  [${i}] lotId=${order.lotId.substring(0, 8)}... amount=${order.amount.toFixed(8)} entry=€${order.entryPrice.toFixed(2)}`,
        );
      });

      // Build SELL rows with full FIFO fields
      const executedAt = new Date().toISOString();
      const sellRows = perLotOrders.map((order, index) => {
        const exitValue = order.amount * realMarketPrice;
        const realizedPnl = exitValue - order.entryValue;
        const realizedPnlPct = order.entryValue > 0 ? (realizedPnl / order.entryValue) * 100 : 0;

        return {
          user_id: intent.userId,
          strategy_id: intent.strategyId,
          trade_type: "sell",
          cryptocurrency: baseSymbol,
          amount: order.amount,
          price: realMarketPrice,
          total_value: order.amount * realMarketPrice,
          executed_at: executedAt,
          is_test_mode: localIsMockExecution,
          notes: `Direct path: UD=OFF - Per-lot SELL [${index + 1}/${perLotOrders.length}]`,
          strategy_trigger: `direct_${intent.source}|req:${requestId}|lot:${order.lotId.substring(0, 8)}`,
          // MANDATORY FIFO FIELDS (SELL CONTRACT)
          original_trade_id: order.lotId,
          original_purchase_amount: order.amount,
          original_purchase_price: order.entryPrice,
          original_purchase_value: order.entryValue,
          exit_value: Math.round(exitValue * 100) / 100,
          realized_pnl: Math.round(realizedPnl * 100) / 100,
          realized_pnl_pct: Math.round(realizedPnlPct * 100) / 100,
          // UNIFIED LEDGER: Explicit mock execution fields
          execution_source: "mock_engine",
          execution_confirmed: true,
          execution_ts: executedAt,
        };
      });

      // PHASE B: Dual-engine detection with origin tracking (log only, no blocking)
      const currentOrigin = detectIntentOrigin(intent.metadata);
      const dualCheck = await checkDualEngineConflict(supabaseClient, intent.userId, intent.strategyId, intent.symbol);
      if (dualCheck.hasRecentTrade) {
        logDualEngineWarning(dualCheck, currentOrigin, intent.userId, intent.strategyId, baseSymbol);
      }

      // Insert all SELL rows
      console.log("[DEBUG][executeTradeDirectly] Inserting", sellRows.length, "per-lot SELL rows...");
      const { data: insertResults, error: insertError } = await supabaseClient
        .from("mock_trades")
        .insert(sellRows)
        .select("id");

      if (insertError) {
        console.error("❌ DIRECT: Per-lot SELL insert failed:", insertError);
        throw new Error(`Per-lot SELL insert failed: ${insertError.message}`);
      }

      // Log success
      console.log("============ STEP 4: PER-LOT WRITE SUCCESSFUL ============");
      console.log(`Inserted ${insertResults?.length || 0} SELL rows for ${perLotOrders.length} lots`);
      sellRows.forEach((row, i) => {
        console.log(
          `  [${i}] lotId=${row.original_trade_id?.substring(0, 8)}... amount=${row.amount.toFixed(8)} pnl=€${row.realized_pnl?.toFixed(2)}`,
        );
      });

      const totalQty = sellRows.reduce((sum, r) => sum + r.amount, 0);
      const totalPnl = sellRows.reduce((sum, r) => sum + (r.realized_pnl || 0), 0);
      console.log(`📊 Total: qty=${totalQty.toFixed(8)}, pnl=€${totalPnl.toFixed(2)}`);

      // CASH LEDGER UPDATE: Credit SELL proceeds
      // Use canonical isMockMode derived at function entry
      const totalExitValue = sellRows.reduce((sum, r) => sum + (r.exit_value || r.total_value), 0);

      const settleRes = await settleCashLedger(
        supabaseClient,
        intent.userId,
        "SELL",
        {
          total_value: sellRows.reduce((sum, r) => sum + r.total_value, 0),
          exit_value: totalExitValue,
          fees: 0,
          sell_fees: 0,
        },
        {
          tradeId: insertResults?.[0]?.id,
          path: "direct_ud_off",
          isMockMode: localIsMockExecution, // Use canonical execution mode
          strategyId: intent.strategyId,
          symbol: baseSymbol,
        },
      );

      if (!settleRes?.success) {
        console.error("❌ DIRECT: Cash ledger settlement failed:", settleRes);

        if (localIsMockExecution) {
          return { success: false, error: "cash_ledger_settlement_failed" };
        }

        // Log decision_event for audit
        await supabaseClient.from("decision_events").insert({
          user_id: intent.userId,
          strategy_id: intent.strategyId,
          symbol: baseSymbol,
          side: "SELL",
          source: "coordinator_direct",
          reason: "cash_ledger_settle_failed",
          decision_ts: new Date().toISOString(),
          metadata: {
            path: "direct_ud_off",
            trade_id: insertResults?.[0]?.id,
            cash_before: settleRes?.cash_before,
            delta: settleRes?.delta,
            cash_after: settleRes?.cash_after,
            error: settleRes?.error,
            trade_inserted: true,
            lots_sold: sellRows.length,
          },
        });
      }

      qty = totalQty;

      console.log("✅ DIRECT: Per-lot SELL executed successfully");
      console.log("============ STEP 5: FINAL DECISION ============");
      console.log("decision.action: SELL");
      console.log("decision.reason: unified_decisions_disabled_direct_path (per-lot)");

      return { success: true, qty: totalQty };
    }

    // === BUY PATH CONTINUES HERE ===
    const totalValue = qty * realMarketPrice;

    console.log(`💱 DIRECT: BUY ${qty} ${baseSymbol} at €${realMarketPrice} = €${totalValue}`);

    // DEBUG INSTRUMENTATION: Track mock_trades insert attempt
    console.log("[DEBUG][executeTradeDirectly] ========== MOCK_TRADES BUY INSERT ==========");

    // Insert BUY trade record with entry_context for pyramiding model
    const entryContext = intent.metadata?.entry_context || null;

    const mockTrade = {
      user_id: intent.userId,
      strategy_id: intent.strategyId,
      trade_type: "buy",
      cryptocurrency: baseSymbol,
      amount: qty,
      price: realMarketPrice,
      total_value: totalValue,
      executed_at: new Date().toISOString(),
      is_test_mode: localIsMockExecution,
      notes: `Direct path: UD=OFF`,
      strategy_trigger: `direct_${intent.source}|req:${requestId}`,
      // PYRAMIDING MODEL: Store entry_context in market_conditions
      market_conditions: {
        entry_context: entryContext,
        backend_request_id: intent.metadata?.backend_request_id,
        origin: intent.metadata?.origin || "BACKEND_LIVE",
        executed_at: new Date().toISOString(),
        latency_ms: Date.now() - new Date(intent.ts || Date.now()).getTime(),
      },
      // UNIFIED LEDGER: Explicit mock execution fields
      execution_source: "mock_engine",
      execution_confirmed: true,
      execution_ts: new Date().toISOString(),
    };

    // PHASE B: Dual-engine detection with origin tracking (log only, no blocking)
    const currentOrigin = detectIntentOrigin(intent.metadata);
    const dualCheck = await checkDualEngineConflict(supabaseClient, intent.userId, intent.strategyId, intent.symbol);
    if (dualCheck.hasRecentTrade) {
      logDualEngineWarning(dualCheck, currentOrigin, intent.userId, intent.strategyId, baseSymbol);
    }

    const { data: insertResult, error } = await supabaseClient.from("mock_trades").insert(mockTrade).select("id");

    if (error) {
      console.log("============ STEP 4: WRITE FAILED ============");
      console.log("DB insert error:", error);
      throw new Error(`DB insert failed: ${error.message}`);
    }

    const insertedTradeId = insertResult?.[0]?.id ?? null;

    // STEP 4: PROVE THE WRITE
    console.log("============ STEP 4: BUY WRITE SUCCESSFUL ============");
    console.log("Inserted trade ID:", insertedTradeId ?? "ID_NOT_RETURNED");

    // Query back the inserted row for settlement
    const { data: insertedRow, error: insertedReadError } = await supabaseClient
      .from("mock_trades")
      .select("id, cryptocurrency, trade_type, amount, total_value, fees, buy_fees")
      .eq("id", insertedTradeId)
      .single();

    if (insertedReadError || !insertedRow?.id) {
      console.error("[DEBUG][executeTradeDirectly] Failed to read back inserted row");
      if (localIsMockExecution) {
        return { success: false, error: "cash_ledger_settlement_failed" };
      }
    } else {
      // CASH LEDGER UPDATE (BUY) - use canonical isMockMode
      const settleRes = await settleCashLedger(
        supabaseClient,
        intent.userId,
        "BUY",
        {
          total_value: Number(insertedRow.total_value) || 0,
          fees: insertedRow.fees ?? 0,
          buy_fees: insertedRow.buy_fees ?? 0,
        },
        {
          tradeId: insertedRow.id,
          path: "direct_ud_off",
          isMockMode: localIsMockExecution, // Use canonical execution mode
          strategyId: intent.strategyId,
          symbol: baseSymbol,
        },
      );

      if (!settleRes?.success) {
        console.error("❌ DIRECT: Cash ledger settlement failed:", settleRes);
        if (localIsMockExecution) {
          return { success: false, error: "cash_ledger_settlement_failed" };
        }
      }
    }

    console.log("✅ DIRECT: BUY executed successfully");
    console.log("============ STEP 5: FINAL DECISION ============");
    console.log("decision.action: BUY");
    console.log("decision.reason: unified_decisions_disabled_direct_path");

    return { success: true, qty };
  } catch (error) {
    console.log("============ STEP 4: EXECUTION FAILED ============");
    console.log("Error message:", error.message);
    console.log("============ STEP 5: FINAL DECISION ============");
    console.log("decision.action: DEFER");
    console.log("decision.reason:", error.message);

    console.error("❌ DIRECT: Execution failed:", error.message);
    return { success: false, error: error.message };
  }
}

// Get real-time prices from Coinbase API with freshness tracking (Phase 3)
async function getMarketPrice(
  symbol: string,
  maxStaleMs: number = 15000,
): Promise<{ price: number; tickAgeMs: number; spreadBps: number }> {
  try {
    const baseSymbol = toBaseSymbol(symbol);
    const pairSymbol = toPairSymbol(baseSymbol);
    const fetchStartTime = Date.now();
    console.log(
      "💱 EXECUTION PRICE LOOKUP: base=",
      baseSymbol,
      "pair=",
      pairSymbol,
      "url=/products/",
      pairSymbol,
      "/ticker",
    );

    const response = await fetch(`https://api.exchange.coinbase.com/products/${pairSymbol}/ticker`);
    const data = await response.json();
    const fetchEndTime = Date.now();
    const tickAgeMs = fetchEndTime - fetchStartTime;

    if (response.ok && data.price) {
      const price = parseFloat(data.price);
      const bid = parseFloat(data.bid) || price;
      const ask = parseFloat(data.ask) || price;
      const spread = ask - bid;
      const spreadBps = price > 0 ? (spread / price) * 10000 : 0; // Convert to basis points

      console.log(
        `💱 COORDINATOR: Got real price for ${pairSymbol}: €${price} (spread: ${spreadBps.toFixed(1)}bps, age: ${tickAgeMs}ms)`,
      );

      // Phase 3: Check price freshness
      if (tickAgeMs > maxStaleMs) {
        console.log(`⚠️ PRICE FRESHNESS WARNING: ${pairSymbol} tick age ${tickAgeMs}ms > ${maxStaleMs}ms threshold`);
      }

      return { price, tickAgeMs, spreadBps };
    }

    throw new Error(`Invalid price response: ${data.message || "Unknown error"}`);
  } catch (error) {
    console.error("❌  Price fetch error for", symbol, ":", error.message);
    throw error;
  }
}

// Async decision logging - Enhanced for Phase 1 Learning Loop
// Returns { logged: boolean, error?: string } to indicate success/failure
async function logDecisionAsync(
  supabaseClient: any,
  intent: TradeIntent,
  action: DecisionAction,
  reason: Reason,
  unifiedConfig: UnifiedConfig,
  requestId: string,
  profitMetadata?: any,
  tradeId?: string,
  executionPrice?: number,
  strategyConfig?: any,
  confidenceConfig?: {
    source: "default" | "strategy_parameters";
    optimizer: string | null;
    optimizerMetadata: any | null;
  },
): Promise<{ logged: boolean; error?: string }> {
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);

    // Normalize confidence to [0,1] fraction for logging
    const normalizedConfidence = normalizeConfidence(intent.confidence);

    // Map executed decisions to semantic actions
    const actionToLog = action === "BUY" ? "ENTER" : action === "SELL" ? "EXIT" : action;

    // Log to existing trade_decisions_log for compatibility
    await supabaseClient.from("trade_decisions_log").insert({
      user_id: intent.userId,
      strategy_id: intent.strategyId,
      symbol: baseSymbol, // Store base symbol only
      intent_side: intent.side,
      intent_source: intent.source,
      confidence: normalizedConfidence, // Store as fraction
      decision_action: actionToLog,
      decision_reason: reason,
      metadata: {
        ...intent.metadata,
        qtySuggested: intent.qtySuggested,
        unifiedConfig,
        request_id: requestId,
        idempotencyKey: intent.idempotencyKey,
        ...(profitMetadata && { profitAnalysis: profitMetadata }),
      },
    });

    // PHASE 2: Use canonical execution mode (passed via strategyConfig or intent)
    // NOTE: executionMode is now derived canonically at request entry, NOT from ENV
    const executionMode = strategyConfig?.canonicalExecutionMode || "MOCK";

    // PHASE 1 ENHANCEMENT: Log to decision_events for learning loop
    // Log ALL decisions unconditionally (BUY/SELL/BLOCK/DEFER/HOLD) for complete audit trail
    if (action === "BUY" || action === "SELL" || action === "BLOCK" || action === "DEFER" || action === "HOLD") {
      // Extract EFFECTIVE TP/SL/min_confidence from strategy config (after overrides)
      // FAIL-CLOSED: Required config must exist - NO || fallbacks
      const effectiveTpPct =
        strategyConfig?.takeProfitPercentage ?? strategyConfig?.configuration?.takeProfitPercentage;
      const effectiveSlPct = strategyConfig?.stopLossPercentage ?? strategyConfig?.configuration?.stopLossPercentage;
      const effectiveMinConf =
        strategyConfig?.minConfidence ??
        (strategyConfig?.configuration?.aiConfidenceThreshold
          ? strategyConfig.configuration.aiConfidenceThreshold / 100
          : undefined);
      const finalEntryPrice =
        executionPrice ||
        profitMetadata?.entry_price ||
        intent.metadata?.entry_price ||
        profitMetadata?.currentPrice ||
        null;

      // Log warning if config missing (but don't block decision logging - it's an audit trail)
      if (effectiveTpPct === undefined || effectiveSlPct === undefined || effectiveMinConf === undefined) {
        console.warn(
          `[coordinator] WARNING: Missing config for decision logging - tp_pct=${effectiveTpPct}, sl_pct=${effectiveSlPct}, min_conf=${effectiveMinConf}`,
        );
      }

      // PHASE 1B: Use canonical isTestMode from strategyConfig (set at request entry)
      // This is derived ONLY from execution mode, not from config/metadata inference
      const isTestMode = strategyConfig?.canonicalIsTestMode === true;

      console.log(`[coordinator] logging decision with effective params`, {
        symbol: baseSymbol,
        tp_pct: effectiveTpPct,
        sl_pct: effectiveSlPct,
        min_confidence: effectiveMinConf,
        confidence: normalizedConfidence,
        is_test_mode: isTestMode,
      });

      console.log(
        `📌 LEARNING: logDecisionAsync - symbol=${baseSymbol}, side=${intent.side}, action=${action}, execution_mode=${executionMode}, is_test_mode=${isTestMode}, entry_price=${finalEntryPrice}, tp_pct=${effectiveTpPct}, sl_pct=${effectiveSlPct}, min_confidence=${effectiveMinConf}, confidence=${normalizedConfidence}, expected_pnl_pct=${intent.metadata?.expectedPnL || null}`,
      );

      // Validate and normalize source for decision_events constraint
      // INTELLIGENT ENGINE ONLY: Only 'intelligent' and 'manual' should reach here
      // The entry gate blocks 'automated', 'pool', 'news', 'whale' sources
      // Allowed DB values: 'manual', 'system', 'intelligent' (NOT 'automated')
      const normalizedSource =
        intent.source === "intelligent" ? "intelligent" : intent.source === "manual" ? "manual" : "system"; // Fallback for any edge case (should never happen)

      // PHASE 1B: Compute fused signal score (READ-ONLY, no behavior change)
      let fusedSignalData = null;
      if (isSignalFusionEnabled(strategyConfig)) {
        try {
          const fusionResult = await computeFusedSignalScore({
            supabaseClient,
            userId: intent.userId,
            strategyId: intent.strategyId,
            symbol: baseSymbol,
            side: intent.side,
            horizon: (intent.metadata?.horizon || "1h") as "15m" | "1h" | "4h" | "24h",
            now: new Date(),
          });

          fusedSignalData = {
            score: fusionResult.fusedScore,
            totalSignals: fusionResult.totalSignals,
            enabledSignals: fusionResult.enabledSignals,
            topSignals: fusionResult.details
              .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
              .slice(0, 5)
              .map((d) => ({
                type: d.signalType,
                contribution: Number(d.contribution.toFixed(2)),
              })),
          };

          console.log(
            `[SignalFusion] Computed score for ${baseSymbol}: ${fusionResult.fusedScore.toFixed(2)} from ${fusionResult.enabledSignals}/${fusionResult.totalSignals} signals`,
          );
        } catch (err) {
          console.error("[SignalFusion] Failed to compute signal fusion, continuing without it:", err);
          // Fail soft: fusion errors must NEVER block decisions
        }
      }

      const eventPayload = {
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        symbol: baseSymbol, // Always use extracted base symbol (e.g., "SOL" from "SOL-EUR")
        side: intent.side, // Use intent.side (BUY/SELL), not action
        source: normalizedSource, // Validated source - one of: automated, manual, system, intelligent
        confidence: normalizedConfidence, // Store as fraction [0,1]
        reason: `${reason}: ${intent.reason || "No additional details"}`,
        expected_pnl_pct: intent.metadata?.expectedPnL || null,
        tp_pct: effectiveTpPct, // Use effective TP after overrides
        sl_pct: effectiveSlPct, // Use effective SL after overrides
        entry_price: finalEntryPrice,
        qty_suggested: intent.qtySuggested,
        decision_ts: new Date().toISOString(),
        trade_id: tradeId,
        metadata: {
          action: action, // Store action (BUY/SELL/BLOCK/DEFER/HOLD) in metadata
          is_test_mode: isTestMode, // CRITICAL: Record test vs real mode for learning loop
          request_id: requestId,
          unifiedConfig,
          profitAnalysis: profitMetadata,
          rawIntent: {
            symbol: intent.symbol,
            idempotencyKey: intent.idempotencyKey,
            ts: intent.ts,
          },
          effective_min_confidence: effectiveMinConf, // Store effective min_confidence for reference
          confidence_source: confidenceConfig?.source || "default", // Dynamic or default
          confidence_optimizer: confidenceConfig?.optimizer || null, // Which optimizer (if any)
          confidence_optimizer_metadata: confidenceConfig?.optimizerMetadata
            ? { run_id: confidenceConfig.optimizerMetadata.run_id, run_at: confidenceConfig.optimizerMetadata.run_at }
            : null, // Trimmed metadata for audit trail
          // PHASE 1B: Attach fused signal data (READ-ONLY)
          signalFusion: fusedSignalData,
          // Intelligent Engine metadata (merged from intent.metadata)
          debugTag: intent.metadata?.debugTag ?? null, // CRITICAL: Forward debugTag for forced debug trades
          engine: intent.metadata?.engine ?? null,
          engineFeatures: intent.metadata?.engineFeatures ?? null,
          price: intent.metadata?.price ?? null,
          symbol_normalized: intent.metadata?.symbol_normalized ?? baseSymbol,
          trigger: intent.metadata?.trigger ?? null,
          idempotencyKey: intent.idempotencyKey ?? null, // Forward idempotencyKey
          // ============= PHASE E: Backend traceability metadata =============
          // These fields are set when the intent comes from backend-shadow-engine in LIVE mode
          origin:
            intent.metadata?.context === "BACKEND_LIVE"
              ? "BACKEND_LIVE"
              : intent.metadata?.context === "BACKEND_SHADOW"
                ? "BACKEND_SHADOW"
                : null,
          engineMode: intent.metadata?.context?.startsWith("BACKEND_") ? "LIVE" : null,
          backend_request_id: intent.metadata?.backend_request_id ?? null,
          backend_ts: intent.metadata?.backend_ts ?? null,
          idempotency_key: intent.idempotencyKey ?? null,
        },
        raw_intent: intent as any,
      };

      // CRITICAL: Log exactly what will be inserted for debugging
      console.info("COORDINATOR: inserting decision_event", {
        userId: eventPayload.user_id,
        symbol: eventPayload.symbol,
        side: eventPayload.side,
        source: eventPayload.source,
        decisionAction: action,
        decisionReason: reason,
        debugTag: eventPayload.metadata?.debugTag,
        engine: eventPayload.metadata?.engine,
        entry_price: eventPayload.entry_price,
      });

      // 🧪 INTELLIGENT INSERT – PAYLOAD (requested debug log)
      console.log("🧪 INTELLIGENT INSERT – PAYLOAD", {
        table: "decision_events",
        source: eventPayload.source,
        userId: eventPayload.user_id,
        strategyId: eventPayload.strategy_id,
        symbol: eventPayload.symbol,
        side: eventPayload.side,
        debugTag: eventPayload.metadata?.debugTag,
        engine: eventPayload.metadata?.engine,
        entry_price: eventPayload.entry_price,
        confidence: eventPayload.confidence,
      });

      console.log("📌 LEARNING: decision_events full payload", JSON.stringify(eventPayload, null, 2));

      const { data: decisionInsertResult, error: decisionInsertError } = await supabaseClient
        .from("decision_events")
        .insert([eventPayload])
        .select("id");

      // 🧪 INTELLIGENT INSERT – RESULT (requested debug log)
      console.log("🧪 INTELLIGENT INSERT – RESULT", {
        source: eventPayload.source,
        debugTag: eventPayload.metadata?.debugTag,
        engine: eventPayload.metadata?.engine,
        insertedId: decisionInsertResult?.[0]?.id || null,
        error: decisionInsertError ? decisionInsertError.message : null,
        errorDetails: decisionInsertError ? decisionInsertError.details : null,
        errorHint: decisionInsertError ? decisionInsertError.hint : null,
      });

      if (decisionInsertError) {
        console.error("❌ LEARNING: decision_events insert failed", {
          message: decisionInsertError.message,
          details: decisionInsertError.details,
          hint: decisionInsertError.hint,
          code: decisionInsertError.code,
          source: eventPayload.source,
          debugTag: eventPayload.metadata?.debugTag,
          strategyId: eventPayload.strategy_id,
        });
        // Return failure so caller knows the insert did not succeed
        return { logged: false, error: decisionInsertError.message, decisionId: null };
      } else {
        const insertedDecisionId = decisionInsertResult?.[0]?.id || null;
        console.log("✅ LEARNING: Successfully logged decision event row", {
          id: insertedDecisionId,
          symbol: baseSymbol,
          side: intent.side,
          source: eventPayload.source,
          debugTag: eventPayload.metadata?.debugTag,
          reason,
          trade_id: tradeId || null, // Log the causal link for visibility
        });

        // OPTION D: Causal link - decision_events.trade_id already set above via eventPayload.trade_id
        // Log the causal relationship for debugging
        if (tradeId) {
          console.log("🔗 CAUSAL_LINK: decision_events.id=" + insertedDecisionId + " → mock_trades.id=" + tradeId);
        }

        return { logged: true, decisionId: insertedDecisionId };
      }
    }
    // If we didn't insert (action not in logged set), return success
    return { logged: true, decisionId: null };
  } catch (error) {
    console.error("❌ COORDINATOR: Failed to log decision:", error.message);
    return { logged: false, error: error.message, decisionId: null };
  }
}

// ============= DYNAMIC TP/SL CALCULATION =============
// Compute dynamic thresholds based on recent price volatility
// This fixes the "TP never hit / SL always hit" problem in crypto

interface DynamicThresholds {
  dynamicTpPct: number;
  dynamicSlPct: number;
  microVolatility: number;
  source: "dynamic" | "static";
}

async function computeDynamicTpSlThresholds(
  supabaseClient: any,
  symbol: string,
  baseTpPct: number,
  baseSlPct: number,
): Promise<DynamicThresholds> {
  try {
    const baseSymbol = symbol.includes("-") ? symbol.split("-")[0] : symbol;

    // Fetch recent price snapshots (last 5 minutes) for micro-volatility calculation
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentPrices } = await supabaseClient
      .from("price_snapshots")
      .select("price, ts")
      .eq("symbol", `${baseSymbol}-EUR`)
      .gte("ts", fiveMinutesAgo)
      .order("ts", { ascending: false })
      .limit(30);

    // If not enough price data, try market_features_v0 for volatility
    if (!recentPrices || recentPrices.length < 3) {
      const { data: features } = await supabaseClient
        .from("market_features_v0")
        .select("vol_1h, vol_4h, vol_24h")
        .eq("symbol", `${baseSymbol}-EUR`)
        .eq("granularity", "1h")
        .order("ts_utc", { ascending: false })
        .limit(1);

      if (features && features.length > 0) {
        // Use pre-computed volatility from market features
        const vol = features[0].vol_1h || features[0].vol_4h || features[0].vol_24h || 0;
        const volPct = vol * 100; // Convert to percentage

        // Dynamic adjustment: TP = max(baseTp, vol * 1.0), SL = max(baseSl, vol * 1.2)
        const dynamicTpPct = Math.max(baseTpPct, volPct * 1.0);
        const dynamicSlPct = Math.max(baseSlPct, volPct * 1.2);

        console.log(
          `[DynamicTPSL] Using market_features volatility for ${baseSymbol}: vol=${volPct.toFixed(2)}%, TP=${dynamicTpPct.toFixed(2)}%, SL=${dynamicSlPct.toFixed(2)}%`,
        );

        return {
          dynamicTpPct: Math.min(dynamicTpPct, 5.0), // Cap at 5%
          dynamicSlPct: Math.min(dynamicSlPct, 5.0), // Cap at 5%
          microVolatility: volPct,
          source: "dynamic",
        };
      }

      // Fallback to static thresholds
      console.log(`[DynamicTPSL] No volatility data for ${baseSymbol}, using static thresholds`);
      return { dynamicTpPct: baseTpPct, dynamicSlPct: baseSlPct, microVolatility: 0, source: "static" };
    }

    // Compute micro-volatility from price snapshots
    const prices = recentPrices.map((p: any) => parseFloat(p.price));
    const latestPrice = prices[0];
    const oldestPrice = prices[prices.length - 1];

    // Micro-volatility = |price change| / oldest price
    const microVolatility = (Math.abs(latestPrice - oldestPrice) / oldestPrice) * 100;

    // Also compute max swing for more robust volatility estimate
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const maxSwing = ((maxPrice - minPrice) / minPrice) * 100;

    // Use the larger of micro-volatility and half the max swing
    const effectiveVol = Math.max(microVolatility, maxSwing * 0.5);

    // Dynamic adjustment: wider thresholds in volatile markets
    const dynamicTpPct = Math.max(baseTpPct, effectiveVol * 1.0);
    const dynamicSlPct = Math.max(baseSlPct, effectiveVol * 1.2);

    console.log(
      `[DynamicTPSL] ${baseSymbol}: microVol=${microVolatility.toFixed(3)}%, maxSwing=${maxSwing.toFixed(3)}%, TP=${dynamicTpPct.toFixed(2)}% (base ${baseTpPct}%), SL=${dynamicSlPct.toFixed(2)}% (base ${baseSlPct}%)`,
    );

    return {
      dynamicTpPct: Math.min(dynamicTpPct, 5.0), // Cap at 5%
      dynamicSlPct: Math.min(dynamicSlPct, 5.0), // Cap at 5%
      microVolatility: effectiveVol,
      source: "dynamic",
    };
  } catch (error) {
    console.error(`[DynamicTPSL] Error computing thresholds for ${symbol}:`, error);
    // Fallback to static on error
    return { dynamicTpPct: baseTpPct, dynamicSlPct: baseSlPct, microVolatility: 0, source: "static" };
  }
}

// ============= PHASE 1: TP DETECTION FUNCTIONS =============

// Evaluate if current position has reached take-profit threshold
async function evaluatePositionStatus(
  supabaseClient: any,
  intent: TradeIntent,
  strategyConfig: any,
  currentPrice: number,
  requestId: string,
): Promise<{ shouldSell: boolean; pnlPct: number; tpPct: number; slPct?: number; metadata: any } | null> {
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);

    // Extract base TP/SL config
    const baseTpPct = strategyConfig?.takeProfitPercentage || 0.7;
    const baseSlPct = strategyConfig?.stopLossPercentage || 0.7;

    // Compute dynamic thresholds based on recent volatility
    const dynamicThresholds = await computeDynamicTpSlThresholds(supabaseClient, baseSymbol, baseTpPct, baseSlPct);

    const effectiveTpPct = dynamicThresholds.dynamicTpPct;
    const effectiveSlPct = dynamicThresholds.dynamicSlPct;

    // Get BUY trades to check if we have a position
    const { data: buyTrades } = await supabaseClient
      .from("mock_trades")
      .select("amount, price, executed_at")
      .eq("user_id", intent.userId)
      .eq("strategy_id", intent.strategyId)
      .eq("cryptocurrency", baseSymbol)
      .eq("trade_type", "buy")
      .order("executed_at", { ascending: true }); // FIFO order

    if (!buyTrades || buyTrades.length === 0) {
      return null; // No position to evaluate
    }

    // Get existing SELL trades to calculate what's already been sold
    const { data: sellTrades } = await supabaseClient
      .from("mock_trades")
      .select("original_purchase_amount")
      .eq("user_id", intent.userId)
      .eq("strategy_id", intent.strategyId)
      .eq("cryptocurrency", baseSymbol)
      .eq("trade_type", "sell")
      .not("original_purchase_amount", "is", null);

    // Calculate remaining position using FIFO
    let totalSold = 0;
    if (sellTrades) {
      totalSold = sellTrades.reduce((sum: number, sell: any) => sum + parseFloat(sell.original_purchase_amount), 0);
    }

    let totalPurchaseValue = 0;
    let totalPurchaseAmount = 0;
    let tempSold = totalSold;

    // Calculate average purchase price for remaining position
    for (const buy of buyTrades) {
      const buyAmount = parseFloat(buy.amount);
      const buyPrice = parseFloat(buy.price);

      // Calculate how much of this buy is still available
      const availableFromThisBuy = Math.max(0, buyAmount - tempSold);
      if (availableFromThisBuy <= 0) {
        tempSold -= buyAmount;
        continue;
      }

      // Add available amount to remaining position
      totalPurchaseAmount += availableFromThisBuy;
      totalPurchaseValue += availableFromThisBuy * buyPrice;
      tempSold = Math.max(0, tempSold - buyAmount);
    }

    if (totalPurchaseAmount === 0) {
      return null; // No remaining position
    }

    const avgPurchasePrice = totalPurchaseValue / totalPurchaseAmount;
    const pnlPct = ((currentPrice - avgPurchasePrice) / avgPurchasePrice) * 100;

    const metadata = {
      avgPurchasePrice: avgPurchasePrice.toFixed(2),
      currentPrice: currentPrice.toFixed(2),
      pnlPct: pnlPct.toFixed(2),
      tpPct: effectiveTpPct.toFixed(2),
      slPct: effectiveSlPct.toFixed(2),
      baseTpPct: baseTpPct.toFixed(2),
      baseSlPct: baseSlPct.toFixed(2),
      microVolatility: dynamicThresholds.microVolatility.toFixed(3),
      thresholdSource: dynamicThresholds.source,
      positionSize: totalPurchaseAmount.toFixed(8),
      evaluation: "tp_sl_detection",
    };

    // Check if TP threshold is reached (using DYNAMIC threshold)
    if (pnlPct >= effectiveTpPct) {
      // DERIVED ANTI-CHURN GUARD: Require minimum realized PnL relative to TP
      // Uses EXIT_FLOOR_RATIO constant defined at top of file
      const minExitPnlPct = baseTpPct * EXIT_FLOOR_RATIO;

      if (pnlPct < minExitPnlPct) {
        console.log(
          `[DynamicTPSL] TP BLOCKED by anti-churn floor: pnl=${pnlPct.toFixed(2)}% < floor=${minExitPnlPct.toFixed(2)}% (${EXIT_FLOOR_RATIO * 100}% of TP=${baseTpPct}%)`,
        );
        return null; // Block micro-TP, wait for meaningful gain
      }

      console.log(
        `[DynamicTPSL] TP HIT for ${baseSymbol}: pnl=${pnlPct.toFixed(2)}% >= tp=${effectiveTpPct.toFixed(2)}% (floor=${minExitPnlPct.toFixed(2)}% passed)`,
      );
      return {
        shouldSell: true,
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        tpPct: effectiveTpPct,
        slPct: effectiveSlPct,
        metadata,
      };
    }

    // Check if SL threshold is reached (using DYNAMIC threshold)
    if (pnlPct <= -effectiveSlPct) {
      console.log(
        `[DynamicTPSL] SL HIT for ${baseSymbol}: pnl=${pnlPct.toFixed(2)}% <= -sl=${-effectiveSlPct.toFixed(2)}%`,
      );
      return {
        shouldSell: true,
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        tpPct: effectiveTpPct,
        slPct: effectiveSlPct,
        metadata: { ...metadata, evaluation: "sl_detection", trigger: "STOP_LOSS" },
      };
    }

    return null; // Neither TP nor SL reached
  } catch (error) {
    console.error(`❌ COORDINATOR: TP/SL evaluation error for ${intent.symbol}:`, error);
    return null;
  }
}

// ============= MAIN EXECUTION LOGIC =============

// Micro-queue management
function getQueueLength(symbolKey: string): number {
  const queue = symbolQueues.get(symbolKey);
  return queue ? queue.length : 0;
}

function addToQueue(symbolKey: string, intent: TradeIntent): void {
  if (!symbolQueues.has(symbolKey)) {
    symbolQueues.set(symbolKey, []);
  }
  const queue = symbolQueues.get(symbolKey)!;
  queue.push(intent);
}

function removeFromQueue(symbolKey: string, intent: TradeIntent): void {
  const queue = symbolQueues.get(symbolKey);
  if (queue) {
    const index = queue.findIndex((i) => i.idempotencyKey === intent.idempotencyKey);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    if (queue.length === 0) {
      symbolQueues.delete(symbolKey);
    }
  }
}

// Timestamp-based conflict detection (NO DB LOCKS)
// PHASE 5: Also includes exposure-based risk limits
async function detectConflicts(
  supabaseClient: any,
  intent: TradeIntent,
  config: UnifiedConfig,
  strategyConfig?: any,
): Promise<{ hasConflict: boolean; reason: string; guardReport?: any }> {
  // Initialize guard report (EXTENDED FOR OMNISCIENT AI AGENT STABILIZATION)
  const guardReport = {
    minNotionalFail: false,
    cooldownActive: false,
    riskLimitExceeded: false,
    positionNotFound: false,
    qtyMismatch: false,
    marketClosed: false,
    holdPeriodNotMet: false,
    exposureLimitExceeded: false, // PHASE 5: Exposure guard
    // NEW STABILIZATION GATES (Omniscient AI Agent)
    stopLossCooldownActive: false,
    signalAlignmentFailed: false,
    highVolatilityBlocked: false,
    entrySpacingBlocked: false,
    // PYRAMIDING CONTEXT GATE
    duplicateContextBlocked: false,
    other: null as string | null,
    missingConfig: null as string | null, // Track which config key is missing
  };

  // Get recent trades for this symbol
  const baseSymbol = toBaseSymbol(intent.symbol);

  // =====================================================================
  // PHASE 5: EXPOSURE CHECK FOR BUY INTENTS
  // Derive maxExposurePerCoin from existing config params - NO NEW KNOBS
  // =====================================================================
  if (intent.side === "BUY") {
    const cfg = strategyConfig?.configuration || strategyConfig || {};
    const walletValueEUR = cfg.walletValueEUR || 30000; // Test mode default
    const maxWalletExposurePct = Math.min(cfg.maxWalletExposure || 80, cfg.riskManagement?.maxWalletExposure || 80);
    const selectedCoinsCount = (cfg.selectedCoins || []).length || 5;
    const maxActiveCoins = cfg.maxActiveCoins || selectedCoinsCount;
    const perTradeAllocation = cfg.perTradeAllocation || 50;

    // Calculate derived limits
    const maxWalletExposureEUR = walletValueEUR * (maxWalletExposurePct / 100);
    const maxExposurePerCoinEUR = maxWalletExposureEUR / maxActiveCoins;

    // Get ALL trades for this user/strategy (both buys AND sells) to calculate NET exposure
    const { data: allTrades } = await supabaseClient
      .from("mock_trades")
      .select("cryptocurrency, amount, price, trade_type")
      .eq("user_id", intent.userId)
      .eq("strategy_id", intent.strategyId)
      .in("trade_type", ["buy", "sell"])
      .order("executed_at", { ascending: false });

    // Calculate NET exposure (buys - sells) per symbol
    // Track net QUANTITY per symbol, then multiply by current price for exposure
    const qtyBySymbol: Record<string, { netQty: number; avgPrice: number; buyQty: number }> = {};

    for (const trade of allTrades || []) {
      const sym = trade.cryptocurrency.replace("-EUR", "");
      const qty = parseFloat(trade.amount);
      const price = parseFloat(trade.price);

      if (!qtyBySymbol[sym]) {
        qtyBySymbol[sym] = { netQty: 0, avgPrice: 0, buyQty: 0 };
      }

      if (trade.trade_type === "buy") {
        // Weighted average price for buys
        const prevTotal = qtyBySymbol[sym].buyQty * qtyBySymbol[sym].avgPrice;
        qtyBySymbol[sym].buyQty += qty;
        qtyBySymbol[sym].avgPrice =
          qtyBySymbol[sym].buyQty > 0 ? (prevTotal + qty * price) / qtyBySymbol[sym].buyQty : price;
        qtyBySymbol[sym].netQty += qty;
      } else {
        // Subtract sells from net quantity
        qtyBySymbol[sym].netQty -= qty;
      }
    }

    // Calculate exposure in EUR based on NET quantities
    const positionsBySymbol: Record<string, number> = {};
    let totalExposureEUR = 0;

    for (const [sym, data] of Object.entries(qtyBySymbol)) {
      // Only count positive net positions
      if (data.netQty > 0) {
        const exposureEUR = data.netQty * data.avgPrice;
        positionsBySymbol[sym] = exposureEUR;
        totalExposureEUR += exposureEUR;
      }
    }

    console.log(
      `[EXPOSURE] NET positions:`,
      Object.entries(positionsBySymbol)
        .map(([k, v]) => `${k}=€${v.toFixed(0)}`)
        .join(", ") || "none",
    );

    const currentSymbolExposure = positionsBySymbol[baseSymbol] || 0;
    const uniqueCoinsWithExposure = Object.keys(positionsBySymbol).length;
    const tradeValueEUR = perTradeAllocation;

    // Check 1: Global wallet exposure
    if (totalExposureEUR + tradeValueEUR > maxWalletExposureEUR) {
      console.log(
        `🚫 COORDINATOR: BUY blocked - max wallet exposure reached (${totalExposureEUR.toFixed(0)} + ${tradeValueEUR} > ${maxWalletExposureEUR.toFixed(0)})`,
      );
      guardReport.exposureLimitExceeded = true;
      return { hasConflict: true, reason: "max_wallet_exposure_reached", guardReport };
    }

    // Check 2: Max active coins (unique coins)
    const isNewCoin = currentSymbolExposure < 1;
    if (isNewCoin && uniqueCoinsWithExposure >= maxActiveCoins) {
      console.log(
        `🚫 COORDINATOR: BUY blocked - max active coins reached (${uniqueCoinsWithExposure} >= ${maxActiveCoins})`,
      );
      guardReport.exposureLimitExceeded = true;
      return { hasConflict: true, reason: "max_active_coins_reached", guardReport };
    }

    // Check 3: Per-symbol exposure limit
    if (currentSymbolExposure + tradeValueEUR > maxExposurePerCoinEUR) {
      console.log(
        `🚫 COORDINATOR: BUY blocked - max per-coin exposure reached (${currentSymbolExposure.toFixed(0)} + ${tradeValueEUR} > ${maxExposurePerCoinEUR.toFixed(0)})`,
      );
      guardReport.exposureLimitExceeded = true;
      return { hasConflict: true, reason: "max_exposure_per_coin_reached", guardReport };
    }

    console.log(
      `✅ COORDINATOR: Exposure check passed for ${baseSymbol} BUY (symbol: €${currentSymbolExposure.toFixed(0)}, total: €${totalExposureEUR.toFixed(0)})`,
    );
  }
  // =====================================================================
  // END PHASE 5 EXPOSURE CHECK
  // =====================================================================

  // =====================================================================
  // OMNISCIENT AI AGENT STABILIZATION GATES (BUY-SIDE)
  // These gates prevent the "death spiral" and ensure multi-signal validation
  // =====================================================================
  if (intent.side === "BUY") {
    const cfg = strategyConfig?.configuration || strategyConfig || {};
    const signalScores = intent.metadata?.signalScores || {};

    // ========= GATE 1: STOP-LOSS COOLDOWN =========
    // After a STOP_LOSS exit, block BUY on same symbol for cooldown period
    // This prevents the deadly SL → immediate re-entry loop
    // FAIL-CLOSED: Required config must exist - NO || fallbacks
    const stopLossCooldownMs = cfg.stopLossCooldownMs;
    if (stopLossCooldownMs === undefined || stopLossCooldownMs === null) {
      console.log(`🚫 COORDINATOR: BUY blocked - missing required config: stopLossCooldownMs`);
      guardReport.missingConfig = "stopLossCooldownMs";
      return { hasConflict: true, reason: "blocked_missing_config:stopLossCooldownMs", guardReport };
    }

    // Check recent decision_events for STOP_LOSS exits on this symbol
    const slCooldownCutoff = new Date(Date.now() - stopLossCooldownMs).toISOString();
    const { data: recentSlExits } = await supabaseClient
      .from("decision_events")
      .select("id, decision_ts, metadata")
      .eq("user_id", intent.userId)
      .eq("strategy_id", intent.strategyId)
      .eq("symbol", baseSymbol)
      .eq("side", "SELL")
      .gte("decision_ts", slCooldownCutoff)
      .order("decision_ts", { ascending: false })
      .limit(5);

    // Check if any recent SELL was a STOP_LOSS
    const recentStopLoss = (recentSlExits || []).find((ev: any) => {
      const trigger = ev.metadata?.trigger || ev.metadata?.exitTrigger || "";
      return trigger === "STOP_LOSS" || trigger === "SL" || trigger === "stop_loss";
    });

    if (recentStopLoss) {
      const slExitTime = new Date(recentStopLoss.decision_ts).getTime();
      const timeSinceSL = Date.now() - slExitTime;
      if (timeSinceSL < stopLossCooldownMs) {
        console.log(
          `🚫 COORDINATOR: BUY blocked - stop-loss cooldown active (${Math.round(timeSinceSL / 1000)}s < ${stopLossCooldownMs / 1000}s)`,
        );
        console.log(
          `   Recent SL exit at ${recentStopLoss.decision_ts}, waiting ${Math.round((stopLossCooldownMs - timeSinceSL) / 1000)}s more`,
        );
        guardReport.stopLossCooldownActive = true;
        return { hasConflict: true, reason: "blocked_by_stop_loss_cooldown", guardReport };
      }
    }

    // ========= GATE 2: MULTI-SIGNAL ALIGNMENT =========
    // An omniscient AI agent requires MULTIPLE confirming signals, not just one
    // Block BUYs when core signals are weak or misaligned
    // NO HARDCODED FALLBACKS - values MUST come from strategy config
    const trendScore = signalScores.trend ?? 0;
    const momentumScore = signalScores.momentum ?? 0;
    const volatilityScore = signalScores.volatility ?? 0;

    // FAIL-CLOSED: Required thresholds must exist in config - NO ?? fallbacks
    const minTrendScore = cfg.minTrendScoreForBuy;
    const minMomentumScore = cfg.minMomentumScoreForBuy;
    const maxVolatilityForBuy = cfg.maxVolatilityScoreForBuy;

    // Block if required config is missing
    if (minTrendScore === undefined || minTrendScore === null) {
      console.log(`🚫 COORDINATOR: BUY blocked - missing required config: minTrendScoreForBuy`);
      guardReport.missingConfig = "minTrendScoreForBuy";
      return { hasConflict: true, reason: "blocked_missing_config:minTrendScoreForBuy", guardReport };
    }
    if (minMomentumScore === undefined || minMomentumScore === null) {
      console.log(`🚫 COORDINATOR: BUY blocked - missing required config: minMomentumScoreForBuy`);
      guardReport.missingConfig = "minMomentumScoreForBuy";
      return { hasConflict: true, reason: "blocked_missing_config:minMomentumScoreForBuy", guardReport };
    }
    if (maxVolatilityForBuy === undefined || maxVolatilityForBuy === null) {
      console.log(`🚫 COORDINATOR: BUY blocked - missing required config: maxVolatilityScoreForBuy`);
      guardReport.missingConfig = "maxVolatilityScoreForBuy";
      return { hasConflict: true, reason: "blocked_missing_config:maxVolatilityScoreForBuy", guardReport };
    }

    console.log(
      `[Config] Signal alignment thresholds: minTrend=${minTrendScore}, minMomentum=${minMomentumScore}, maxVolatility=${maxVolatilityForBuy}`,
    );

    // Only apply signal alignment gate if we have signal scores in metadata
    const hasSignalScores = Object.keys(signalScores).length > 0;
    if (hasSignalScores) {
      const alignmentPassed = trendScore >= minTrendScore && momentumScore >= minMomentumScore;

      if (!alignmentPassed) {
        console.log(`🚫 COORDINATOR: BUY blocked - signal alignment failed`);
        console.log(
          `   trend=${trendScore.toFixed(2)} (need >=${minTrendScore}), momentum=${momentumScore.toFixed(2)} (need >=${minMomentumScore})`,
        );
        console.log(`   Full signal scores:`, JSON.stringify(signalScores));
        guardReport.signalAlignmentFailed = true;
        return { hasConflict: true, reason: "blocked_by_signal_alignment", guardReport };
      }
      console.log(
        `✅ COORDINATOR: Signal alignment passed (trend=${trendScore.toFixed(2)}, momentum=${momentumScore.toFixed(2)})`,
      );
    }

    // ========= GATE 3: HIGH VOLATILITY BLOCK =========
    // Block BUYs when volatility is dangerously high (risk management)
    if (hasSignalScores && volatilityScore > maxVolatilityForBuy) {
      console.log(
        `🚫 COORDINATOR: BUY blocked - high volatility (${volatilityScore.toFixed(2)} > ${maxVolatilityForBuy})`,
      );
      guardReport.highVolatilityBlocked = true;
      return { hasConflict: true, reason: "blocked_by_high_volatility", guardReport };
    }

    // ========= GATE 4: MINIMUM ENTRY SPACING =========
    // Prevent rapid-fire entries on the same symbol (anti-churn)
    // FAIL-CLOSED: Required config must exist
    const minEntrySpacingMs = cfg.minEntrySpacingMs;
    if (minEntrySpacingMs === undefined || minEntrySpacingMs === null) {
      console.log(`🚫 COORDINATOR: BUY blocked - missing required config: minEntrySpacingMs`);
      guardReport.missingConfig = "minEntrySpacingMs";
      return { hasConflict: true, reason: "blocked_missing_config:minEntrySpacingMs", guardReport };
    }

    const entrySpacingCutoff = new Date(Date.now() - minEntrySpacingMs).toISOString();

    // Query both formats: "BTC" and "BTC-EUR" since mock_trades stores full pair
    const symbolVariants = [baseSymbol, `${baseSymbol}-EUR`];

    const { data: recentBuysForSpacing } = await supabaseClient
      .from("mock_trades")
      .select("id, executed_at, cryptocurrency")
      .eq("user_id", intent.userId)
      .eq("strategy_id", intent.strategyId)
      .in("cryptocurrency", symbolVariants)
      .eq("trade_type", "buy")
      .gte("executed_at", entrySpacingCutoff)
      .order("executed_at", { ascending: false })
      .limit(1);

    if (recentBuysForSpacing && recentBuysForSpacing.length > 0) {
      const lastBuyTime = new Date(recentBuysForSpacing[0].executed_at).getTime();
      const timeSinceLastBuy = Date.now() - lastBuyTime;
      console.log(
        `🚫 COORDINATOR: BUY blocked - entry spacing not met (${Math.round(timeSinceLastBuy / 1000)}s < ${minEntrySpacingMs / 1000}s)`,
      );
      console.log(
        `   Last BUY at ${recentBuysForSpacing[0].executed_at} for ${recentBuysForSpacing[0].cryptocurrency}, waiting ${Math.round((minEntrySpacingMs - timeSinceLastBuy) / 1000)}s more`,
      );
      guardReport.entrySpacingBlocked = true;
      return { hasConflict: true, reason: "blocked_by_entry_spacing", guardReport };
    }

    // ========= GATE 5: CONTEXT DUPLICATE DETECTION (PYRAMIDING MODEL) =========
    // Block BUYs with duplicate entry_context on OPEN lots for same symbol
    // Allows pyramiding: same symbol, different context → ALLOWED
    // Blocks duplication: same trigger_type + timeframe + anchor_price within ε → BLOCKED
    //
    // CONFIG KEY: contextDuplicateEpsilonPct (per-strategy configurable)
    // DEFAULT: 0.005 (0.5%) - safe fallback, not fail-closed as this is an additive feature
    // The epsilon defines how close two anchor_prices must be to be considered "same"
    const entryContext = intent.metadata?.entry_context;

    if (entryContext && entryContext.context_version === 1) {
      // Get epsilon from strategy config. Default 0.5% if not configured.
      // This is NOT fail-closed (unlike policy thresholds) because:
      // 1. It's an additive safety feature, not a gating policy
      // 2. Fail-open (allow trades) is safer than fail-closed (block all trades)
      // 3. The default 0.5% is conservative and battle-tested
      const DEFAULT_CONTEXT_EPSILON = 0.005; // 0.5%
      const contextDuplicateEpsilonPct = cfg.contextDuplicateEpsilonPct ?? DEFAULT_CONTEXT_EPSILON;

      // Define isTestMode BEFORE it's used in queries below
      const isTestModeForContext = intent.metadata?.is_test_mode ?? false;

      console.log(`[CONTEXT_GUARD] Checking for duplicate context on ${baseSymbol}`);
      console.log(
        `[CONTEXT_GUARD] New context: trigger_type=${entryContext.trigger_type}, timeframe=${entryContext.timeframe}, anchor_price=${entryContext.anchor_price?.toFixed(4)}`,
      );
      console.log(
        `[CONTEXT_GUARD] Epsilon: ${(contextDuplicateEpsilonPct * 100).toFixed(2)}% (from config: ${cfg.contextDuplicateEpsilonPct !== undefined})`,
      );

      // Query OPEN BUY lots for this symbol (with entry_context in market_conditions)
      const { data: openBuysWithContext } = await supabaseClient
        .from("mock_trades")
        .select("id, market_conditions, amount, original_trade_id")
        .eq("user_id", intent.userId)
        .eq("strategy_id", intent.strategyId)
        .in("cryptocurrency", symbolVariants)
        .eq("trade_type", "buy")
        .eq("is_test_mode", isTestModeForContext);

      // For each BUY, check if it's still open and has matching context
      for (const buyTrade of openBuysWithContext || []) {
        // Skip if no entry_context or legacy trade
        const ctx = buyTrade.market_conditions?.entry_context;
        if (!ctx || ctx.context_version !== 1) continue;

        // Check if this BUY is still open (remaining_amount > 0)
        // Query sells that closed this specific BUY
        const { data: sellsForBuy } = await supabaseClient
          .from("mock_trades")
          .select("original_purchase_amount")
          .eq("original_trade_id", buyTrade.id)
          .eq("trade_type", "sell");

        const soldAmount = (sellsForBuy || []).reduce(
          (sum: number, s: any) => sum + (parseFloat(s.original_purchase_amount) || 0),
          0,
        );
        const remainingAmount = parseFloat(buyTrade.amount) - soldAmount;

        // Skip closed lots
        if (remainingAmount <= 1e-8) continue;

        // Check context match
        const sameType = ctx.trigger_type === entryContext.trigger_type;
        const sameTimeframe = ctx.timeframe === entryContext.timeframe;
        const priceDelta = Math.abs(ctx.anchor_price - entryContext.anchor_price) / ctx.anchor_price;
        const priceMatch = priceDelta < contextDuplicateEpsilonPct;

        if (sameType && sameTimeframe && priceMatch) {
          console.log(`🚫 COORDINATOR: BUY blocked - duplicate entry context on open lot`);
          console.log(
            `   Existing lot ${buyTrade.id}: trigger_type=${ctx.trigger_type}, timeframe=${ctx.timeframe}, anchor_price=${ctx.anchor_price}`,
          );
          console.log(
            `   Price delta: ${(priceDelta * 100).toFixed(3)}% < epsilon ${(contextDuplicateEpsilonPct * 100).toFixed(2)}%`,
          );
          guardReport.duplicateContextBlocked = true;
          return { hasConflict: true, reason: "blocked_by_duplicate_context", guardReport };
        }
      }

      console.log(`✅ COORDINATOR: Context duplicate check passed - no matching open lots`);
    } else if (!entryContext) {
      // Legacy intent without entry_context - log warning but allow
      console.log(`[CONTEXT_GUARD] Warning: BUY intent missing entry_context, skipping duplicate check`);
    }

    console.log(`✅ COORDINATOR: All stabilization gates passed for ${baseSymbol} BUY`);
  }
  // =====================================================================
  // END OMNISCIENT AI AGENT STABILIZATION GATES
  // =====================================================================

  // =====================================================================
  // ALL-TIME TRADES QUERY: For position existence check (SELL validation)
  // This query has NO time filter - positions are BUYs minus SELLs ALL TIME
  // IMPORTANT: Query BOTH symbol formats since mock_trades may store either
  // =====================================================================
  const isTestMode = intent.metadata?.is_test_mode ?? false;

  // Query both symbol formats: "XRP" and "XRP-EUR" since data may be stored either way
  const symbolVariantsForPosition = [baseSymbol, `${baseSymbol}-EUR`];

  const { data: allTradesForSymbol, error: allTradesError } = await supabaseClient
    .from("mock_trades")
    .select("trade_type, cryptocurrency, amount, executed_at")
    .eq("user_id", intent.userId)
    .eq("strategy_id", intent.strategyId)
    .in("cryptocurrency", symbolVariantsForPosition)
    .eq("is_test_mode", isTestMode);
  // IMPORTANT: No .gte('executed_at', ...) here - all-time for position existence

  if (allTradesError) {
    console.error("[COORD][POSITIONS] Error fetching all trades:", allTradesError);
  }

  const allTrades = allTradesForSymbol || [];

  // Calculate net position using the shared helper
  const netPosition = calculateNetPositionForSymbol(allTrades, baseSymbol);

  // Enhanced debug logging for position lookup
  console.log("[COORD][POSITIONS] netPosition", {
    userId: intent.userId.substring(0, 8) + "...",
    strategyId: intent.strategyId.substring(0, 8) + "...",
    baseSymbol,
    symbolVariantsQueried: symbolVariantsForPosition,
    isTestMode,
    netPosition: netPosition.toFixed(8),
    tradeCount: allTrades.length,
    buys: allTrades.filter((t) => t.trade_type === "buy").length,
    sells: allTrades.filter((t) => t.trade_type === "sell").length,
    // Debug: Show what symbols were actually found
    foundSymbols: [...new Set(allTrades.map((t) => t.cryptocurrency))],
    // Debug: position_snapshot from intent if present (sent by backend)
    position_snapshot_from_backend: intent.metadata?.position_snapshot || null,
  });

  // =====================================================================
  // RECENT TRADES QUERY: For time-based guards (cooldown, hold period timing)
  // This query has a time window - used ONLY for time-based logic
  // =====================================================================
  const cooldownWindowMs = Math.max(config.cooldownBetweenOppositeActionsMs, config.minHoldPeriodMs, 600000);

  const { data: recentTradesForCooldown } = await supabaseClient
    .from("mock_trades")
    .select("trade_type, executed_at, amount, price")
    .eq("user_id", intent.userId)
    .eq("strategy_id", intent.strategyId)
    .eq("cryptocurrency", baseSymbol)
    .eq("is_test_mode", isTestMode)
    .gte("executed_at", new Date(Date.now() - cooldownWindowMs).toISOString())
    .order("executed_at", { ascending: false })
    .limit(20);

  const recentTrades = recentTradesForCooldown || [];

  // Apply precedence-based conflict rules
  if (intent.source === "manual") {
    return { hasConflict: false, reason: "manual_override_precedence", guardReport };
  }

  if (intent.source === "pool" && intent.side === "SELL") {
    // Pool exits get high precedence but check cooldown
    const recentBuy = recentTrades.find(
      (t) =>
        t.trade_type === "buy" &&
        Date.now() - new Date(t.executed_at).getTime() < config.cooldownBetweenOppositeActionsMs,
    );

    if (recentBuy) {
      guardReport.cooldownActive = true;
      return { hasConflict: true, reason: "blocked_by_precedence:POOL_EXIT", guardReport };
    }

    return { hasConflict: false, reason: "no_conflicts_detected", guardReport };
  }

  // =====================================================================
  // SELL VALIDATION: Position existence (all-time) + Hold period (time-based)
  // CRITICAL FIX: minHoldPeriod applies to ALL SELLs including automatic exits
  // =====================================================================
  if (intent.side === "SELL") {
    const isPositionManagement = intent.metadata?.position_management === true && intent.metadata?.entry_price != null;

    // STEP 1: Check if position EXISTS (all-time net position > 0)
    // Skip ONLY position existence check for position management SELLs (they validate via original_trade_id)
    if (!isPositionManagement) {
      if (netPosition <= 0) {
        // Enhanced debug logging for positionNotFound
        console.log("[COORD][GUARD] positionNotFound - DETAILED DEBUG", {
          userId: intent.userId.substring(0, 8) + "...",
          strategyId: intent.strategyId.substring(0, 8) + "...",
          baseSymbol,
          symbolVariantsQueried: [baseSymbol, `${baseSymbol}-EUR`],
          isTestMode,
          netPosition: netPosition.toFixed(8),
          tradesFoundCount: allTrades.length,
          buysFoundCount: allTrades.filter((t) => t.trade_type === "buy").length,
          sellsFoundCount: allTrades.filter((t) => t.trade_type === "sell").length,
          foundSymbolsInDB: [...new Set(allTrades.map((t) => t.cryptocurrency))],
          // Backend snapshot for correlation
          position_snapshot_from_backend: intent.metadata?.position_snapshot || "NOT_PROVIDED",
          symbol_raw_from_backend: intent.metadata?.symbol_raw || "NOT_PROVIDED",
          symbol_normalized_from_backend: intent.metadata?.symbol_normalized || "NOT_PROVIDED",
          exit_trigger: intent.metadata?.exit_trigger || intent.reason,
        });
        guardReport.positionNotFound = true;
        return { hasConflict: true, reason: "no_position_found", guardReport };
      }
    }

    // STEP 2: Check hold period - APPLIES TO ALL SELLs (manual, TP, SL, trailing)
    // This is the primary anti-churn gate preventing "stupid trades"
    const allBuysSorted = allTrades
      .filter((t) => t.trade_type === "buy")
      .sort((a, b) => new Date(b.executed_at ?? 0).getTime() - new Date(a.executed_at ?? 0).getTime());

    const lastBuy = allBuysSorted[0];

    if (lastBuy) {
      const timeSinceBuy = Date.now() - new Date(lastBuy.executed_at as string).getTime();

      // FAIL-CLOSED: Required config must exist - NO || fallbacks
      const minHoldPeriodMs = config.minHoldPeriodMs;
      if (minHoldPeriodMs === undefined || minHoldPeriodMs === null) {
        console.log(`🚫 COORDINATOR: SELL blocked - missing required config: minHoldPeriodMs`);
        guardReport.missingConfig = "minHoldPeriodMs";
        return { hasConflict: true, reason: "blocked_missing_config:minHoldPeriodMs", guardReport };
      }

      if (timeSinceBuy < minHoldPeriodMs) {
        console.log("[COORD][GUARD] holdPeriodNotMet - BLOCKING SELL (all paths)", {
          userId: intent.userId.substring(0, 8) + "...",
          baseSymbol,
          timeSinceBuyMs: timeSinceBuy,
          minHoldPeriodMs,
          lastBuyAt: lastBuy.executed_at,
          exitTrigger: intent.metadata?.exit_trigger || intent.reason,
          isPositionManagement,
        });
        guardReport.holdPeriodNotMet = true;
        return { hasConflict: true, reason: "hold_min_period_not_met", guardReport };
      }
    }

    console.log(
      `✅ COORDINATOR: SELL validated for ${baseSymbol} - position exists (net=${netPosition.toFixed(6)}) and hold period met`,
    );
  }

  // Check cooldown for opposite actions (no double penalty for automated BUYs)
  // Uses recentTrades (time-windowed) as cooldown is inherently a time-based guard
  const oppositeAction = intent.side === "BUY" ? "sell" : "buy";
  const recentOpposite = recentTrades.find((t) => t.trade_type === oppositeAction);

  if (recentOpposite) {
    const timeSinceOpposite = Date.now() - new Date(recentOpposite.executed_at).getTime();
    const cooldownRequired = config.cooldownBetweenOppositeActionsMs;

    if (timeSinceOpposite < cooldownRequired) {
      // Check confidence override for high-confidence sources
      if (
        ["intelligent", "news", "whale"].includes(intent.source) &&
        intent.confidence >= config.confidenceOverrideThreshold
      ) {
        return { hasConflict: false, reason: "confidence_override_applied", guardReport };
      }

      guardReport.cooldownActive = true;
      return { hasConflict: true, reason: "blocked_by_cooldown", guardReport };
    }
  }

  return { hasConflict: false, reason: "no_conflicts_detected", guardReport };
}

// Execute with minimal advisory lock (atomic section only)
async function executeWithMinimalLock(
  supabaseClient: any,
  intent: TradeIntent,
  config: UnifiedConfig,
  strategyConfig: any,
  requestId: string,
): Promise<TradeDecision> {
  // Short-lived advisory lock ONLY for the atomic execution section
  const lockKey = generateLockKey(intent.userId, intent.strategyId, intent.symbol);
  let lockAcquired = false;

  try {
    // =========================================================================
    // CANONICAL CONFIG RESOLUTION (SINGLE SOURCE OF TRUTH)
    // Use resolveCanonicalConfig for BOTH executeWithMinimalLock AND executeTradeOrder
    // =========================================================================
    const baseSymbol = toBaseSymbol(intent.symbol);

    const canonicalResult = resolveCanonicalConfig(strategyConfig);

    // Allow force override to bypass config validation for manual trades
    const isForceOverride = intent.metadata?.force === true && intent.source === "manual";
    if (!canonicalResult.success && !isForceOverride) {
      const missingKey = canonicalResult.missingKeys?.[0] || "unknown";
      console.log(
        `🚫 COORDINATOR: executeTradeOrder blocked - missing config: ${canonicalResult.missingKeys?.join(", ")}`,
      );
      return { success: false, error: `blocked_missing_config:${missingKey}` };
    }

    // Use defaults when force override with no config
    const canonical = canonicalResult.config || {
      takeProfitPercentage: 2.0,
      stopLossPercentage: 2.0,
      aiConfidenceThreshold: 50,
      priceStaleMaxMs: 60000,
      spreadThresholdBps: 100,
      minHoldPeriodMs: 60000,
      cooldownBetweenOppositeActionsMs: 60000,
      confidenceOverrideThreshold: 50,
    };

    if (isForceOverride) {
      console.log("🔥 MANUAL FORCE: Using default config for manual trade override");
    }

    const { priceStaleMaxMs, spreadThresholdBps } = canonical;

    // NOTE: Execution mode is canonical at request entry; use passed-through canonical flag only.
    const localIsMockExecution = strategyConfig?.canonicalIsTestMode === true;

    const priceData = await getMarketPrice(baseSymbol, priceStaleMaxMs);

    // Price freshness gate
    if (priceData.tickAgeMs > priceStaleMaxMs) {
      console.log(
        `🚫 COORDINATOR: Trade blocked - insufficient price freshness (${priceData.tickAgeMs}ms > ${priceStaleMaxMs}ms)`,
      );
      logDecisionAsync(
        supabaseClient,
        intent,
        "DEFER",
        "insufficient_price_freshness",
        config,
        requestId,
        undefined,
        undefined,
        priceData.price,
        strategyConfig,
      );
      return { action: "DEFER", reason: "insufficient_price_freshness", request_id: requestId, retry_in_ms: 0 };
    }

    // Spread gate - BYPASS IN MOCK MODE (paper trading)
    if (!localIsMockExecution && priceData.spreadBps > spreadThresholdBps) {
      console.log(
        `🚫 COORDINATOR: Trade blocked - spread too wide (${priceData.spreadBps.toFixed(1)}bps > ${spreadThresholdBps}bps)`,
      );
      logDecisionAsync(
        supabaseClient,
        intent,
        "DEFER",
        "spread_too_wide",
        config,
        requestId,
        undefined,
        undefined,
        priceData.price,
        strategyConfig,
      );
      return { action: "DEFER", reason: "spread_too_wide", request_id: requestId, retry_in_ms: 0 };
    }

    if (localIsMockExecution && priceData.spreadBps > spreadThresholdBps) {
      console.log(
        `🧪 MOCK MODE: Bypassing spread gate (${priceData.spreadBps.toFixed(1)}bps > ${spreadThresholdBps}bps)`,
      );
    }

    // PHASE 3.1: PRE-EXECUTION CIRCUIT BREAKER GATE
    const breakerCheck = await checkCircuitBreakers(supabaseClient, intent);
    if (breakerCheck.blocked) {
      console.log(`🚫 COORDINATOR: Blocked by circuit breaker - ${breakerCheck.reason}`);
      logDecisionAsync(
        supabaseClient,
        intent,
        "DEFER",
        "blocked_by_circuit_breaker",
        config,
        requestId,
        { breaker_types: breakerCheck.breaker_types },
        undefined,
        priceData.price,
        strategyConfig,
      );
      return { action: "DEFER", reason: "blocked_by_circuit_breaker", request_id: requestId, retry_in_ms: 0 };
    }

    // PHASE 1: TP DETECTION - Check if position reached take-profit threshold
    let tpEvaluation = null;
    try {
      tpEvaluation = await evaluatePositionStatus(supabaseClient, intent, strategyConfig, priceData.price, requestId);
    } catch (error) {
      console.error(`❌ COORDINATOR: TP evaluation failed:`, error);
      tpEvaluation = null;
    }

    if (tpEvaluation && tpEvaluation.shouldSell) {
      console.log(
        `✅ COORDINATOR: TP hit → SELL now (pnl_pct=${tpEvaluation.pnlPct} ≥ tp=${tpEvaluation.tpPct}) req=${requestId}`,
      );

      // Check if TP override respects existing gates (hold period and cooldown)
      const baseSymbol = toBaseSymbol(intent.symbol);
      const recentTrades = await getRecentTrades(supabaseClient, intent.userId, intent.strategyId, baseSymbol);

      // Check minimum hold period
      const minHoldMs = config?.minHoldPeriodMs || 0;
      if (minHoldMs > 0) {
        const lastBuy = recentTrades.find((t) => t.trade_type === "buy");
        if (lastBuy) {
          const holdTime = Date.now() - new Date(lastBuy.executed_at).getTime();
          if (holdTime < minHoldMs) {
            console.log(`🚫 COORDINATOR: TP blocked by minimum hold period (${holdTime}ms < ${minHoldMs}ms)`);
            // Continue with original intent instead of TP override
          } else {
            // Check cooldown before executing TP SELL
            const cooldownMs = config?.cooldownBetweenOppositeActionsMs || 0;
            if (cooldownMs > 0) {
              const recentBuy = recentTrades.find((t) => t.trade_type === "buy");
              if (recentBuy) {
                const timeSinceBuy = Date.now() - new Date(recentBuy.executed_at).getTime();
                if (timeSinceBuy < cooldownMs) {
                  // TP SELL: Skip cooldown check - TP exits should be fast
                  console.log(`🎯 COORDINATOR: TP SELL bypassing cooldown - taking profit at ${tpEvaluation.pnlPct}%`);
                  return await executeTPSellWithLock(
                    supabaseClient,
                    intent,
                    tpEvaluation,
                    config,
                    requestId,
                    lockKey,
                    strategyConfig,
                  );
                }
              }
            }

            // TP override is allowed, proceed with locked TP SELL
            return await executeTPSellWithLock(
              supabaseClient,
              intent,
              tpEvaluation,
              config,
              requestId,
              lockKey,
              strategyConfig,
            );
          }
        }
      } else {
        // No hold period restriction, check cooldown
        const cooldownMs = config?.cooldownBetweenOppositeActionsMs || 0;
        if (cooldownMs > 0) {
          const recentBuy = recentTrades.find((t) => t.trade_type === "buy");
          if (recentBuy) {
            const timeSinceBuy = Date.now() - new Date(recentBuy.executed_at).getTime();
            if (timeSinceBuy < cooldownMs) {
              // TP SELL: Skip cooldown check - TP exits should be fast
              console.log(`🎯 COORDINATOR: TP SELL bypassing cooldown - taking profit at ${tpEvaluation.pnlPct}%`);
              return await executeTPSellWithLock(
                supabaseClient,
                intent,
                tpEvaluation,
                config,
                requestId,
                lockKey,
                strategyConfig,
              );
            }
          }
        }

        // No restrictions, proceed with locked TP SELL
        return await executeTPSellWithLock(
          supabaseClient,
          intent,
          tpEvaluation,
          config,
          requestId,
          lockKey,
          strategyConfig,
        );
      }
    }

    // Check if this is a position_management intent with entry_price (no lock needed)
    const isPositionManagement = intent.metadata?.position_management === true;
    const hasEntryPrice = typeof intent.metadata?.entry_price === "number";
    const needsLock = !(isPositionManagement && hasEntryPrice);

    if (needsLock) {
      // Try to acquire row-based lock (survives connection pooling)
      console.log(`🔒 COORDINATOR: Acquiring row-based lock for atomic section: ${lockKey}`);

      const { data: lockResult, error: lockError } = await supabaseClient.rpc("acquire_execution_lock", {
        p_lock_key: lockKey,
        p_user_id: intent.userId,
        p_strategy_id: intent.strategyId,
        p_symbol: intent.symbol,
        p_request_id: requestId,
        p_ttl_seconds: 30,
      });

      if (lockError || !lockResult) {
        // Lock contention - defer briefly
        metrics.blockedByLockCount++;
        const retryMs = Math.round(200 + Math.random() * 300);
        console.log(
          `🎯 UD_MODE=ON → DEFER: reason=atomic_section_busy_defer symbol=${intent.symbol} retry=${retryMs}ms error=${lockError?.message || "lock_held"}`,
        );

        return { action: "DEFER", reason: "atomic_section_busy_defer", request_id: requestId, retry_in_ms: retryMs };
      }

      lockAcquired = true;
      console.log(`🔒 COORDINATOR: Row-based lock acquired - executing atomic section`);
    } else {
      console.log(
        `✅ POSITION MANAGEMENT: Skipping lock for ${intent.symbol} SELL with entry_price=${intent.metadata.entry_price}`,
      );
    }

    // PHASE 3.1: Capture decision timestamp for latency tracking
    const decision_at = new Date().toISOString();

    // ATOMIC SECTION: Execute trade with real price data
    const executionResult = await executeTradeOrder(
      supabaseClient,
      intent,
      strategyConfig,
      requestId,
      priceData,
      decision_at,
    );

    if (executionResult.success) {
      console.log(`🎯 UD_MODE=ON → EXECUTE: action=${intent.side} symbol=${intent.symbol} lock=OK`);

      // PHASE 3.1: Post-execution quality logging and breaker evaluation
      await logExecutionQuality(supabaseClient, intent, executionResult, decision_at, priceData);
      await evaluateCircuitBreakers(supabaseClient, intent);

      // Log ENTER/EXIT on successful execution with trade_id, execution price, and EFFECTIVE config (with overrides)
      // OPTION D: The tradeId (mock_trades.id) is passed to logDecisionAsync to create the causal link
      const logResult = await logDecisionAsync(
        supabaseClient,
        intent,
        intent.side,
        "no_conflicts_detected",
        config,
        requestId,
        undefined,
        executionResult.tradeId,
        executionResult.executed_price,
        executionResult.effectiveConfig || strategyConfig,
      );

      // OPTION D: Log the causal relationship for debugging
      console.log("🔗 CAUSAL_LINK_SUMMARY", {
        mock_trade_id: executionResult.tradeId,
        decision_event_id: logResult.decisionId,
        symbol: intent.symbol,
        side: intent.side,
        source: intent.source,
        link_direction: "decision_events.trade_id → mock_trades.id",
      });

      return {
        action: intent.side as DecisionAction,
        reason: "no_conflicts_detected",
        request_id: requestId,
        retry_in_ms: 0,
        qty: executionResult.qty,
      };
    } else {
      console.error(`❌ UD_MODE=ON → EXECUTE FAILED: ${executionResult.error}`);
      return { action: "DEFER", reason: "direct_execution_failed", request_id: requestId, retry_in_ms: 0 };
    }
  } finally {
    // Always release row-based lock
    if (lockAcquired) {
      try {
        await supabaseClient.rpc("release_execution_lock", { p_lock_key: lockKey });
        console.log(`🔓 COORDINATOR: Released row-based lock: ${lockKey}`);
      } catch (unlockError) {
        console.error(`❌ COORDINATOR: Failed to release row-based lock:`, unlockError);
      }
    }
  }
}

// Generate lock key for row-based locking (returns string for execution_locks table)
function generateLockKey(userId: string, strategyId: string, symbol: string): string {
  return `${userId}_${strategyId}_${symbol}`;
}

// Get recent trades (timestamp-based, no locks)
async function getRecentTrades(supabaseClient: any, userId: string, strategyId: string, symbol: string) {
  const baseSymbol = toBaseSymbol(symbol);
  const { data: trades } = await supabaseClient
    .from("mock_trades")
    .select("trade_type, executed_at, amount, price")
    .eq("user_id", userId)
    .eq("strategy_id", strategyId)
    .eq("cryptocurrency", baseSymbol) // Use base symbol for DB lookup
    .gte("executed_at", new Date(Date.now() - 300000).toISOString()) // Last 5 minutes
    .order("executed_at", { ascending: false })
    .limit(10);

  return trades || [];
}

// PHASE 4: Load strategy parameters from DB
async function loadStrategyParameters(
  supabaseClient: any,
  userId: string,
  strategyId: string,
  symbol: string,
): Promise<any | null> {
  const { data, error } = await supabaseClient
    .from("strategy_parameters")
    .select("*")
    .eq("user_id", userId)
    .eq("strategy_id", strategyId)
    .eq("symbol", symbol)
    .maybeSingle();

  if (error) {
    console.warn(`[coordinator] Failed to load strategy_parameters: ${error.message}`);
    return null;
  }

  return data;
}

// Helper to get effective min_confidence with dynamic overrides
async function getEffectiveMinConfidenceForDecision(args: {
  supabaseClient: any;
  userId: string;
  strategyId: string;
  symbol: string;
  baseMinConfidence: number;
}): Promise<{
  effectiveMinConfidence: number;
  source: "default" | "strategy_parameters";
  optimizer: string | null;
  optimizerMetadata: any | null;
}> {
  const CONF_MIN = 0.3;
  const CONF_MAX = 0.9;

  try {
    // Query strategy_parameters for this (userId, strategyId, symbol)
    const { data: paramRow, error } = await args.supabaseClient
      .from("strategy_parameters")
      .select("min_confidence, last_updated_by, optimization_iteration, metadata")
      .eq("user_id", args.userId)
      .eq("strategy_id", args.strategyId)
      .eq("symbol", args.symbol)
      .maybeSingle();

    if (error) {
      console.warn(`[coordinator] Failed to query strategy_parameters for confidence: ${error.message}`);
      return {
        effectiveMinConfidence: args.baseMinConfidence,
        source: "default",
        optimizer: null,
        optimizerMetadata: null,
      };
    }

    if (!paramRow || paramRow.min_confidence === null || paramRow.min_confidence === undefined) {
      console.log(
        `[coordinator] No strategy_parameters row or null min_confidence for ${args.symbol}, using base: ${args.baseMinConfidence}`,
      );
      return {
        effectiveMinConfidence: args.baseMinConfidence,
        source: "default",
        optimizer: null,
        optimizerMetadata: null,
      };
    }

    // Parse and clamp min_confidence
    const parsedConf =
      typeof paramRow.min_confidence === "string" ? parseFloat(paramRow.min_confidence) : paramRow.min_confidence;

    if (isNaN(parsedConf)) {
      console.warn(
        `[coordinator] Invalid min_confidence value for ${args.symbol}: ${paramRow.min_confidence}, using base`,
      );
      return {
        effectiveMinConfidence: args.baseMinConfidence,
        source: "default",
        optimizer: null,
        optimizerMetadata: null,
      };
    }

    const clampedConf = Math.max(CONF_MIN, Math.min(CONF_MAX, parsedConf));

    // Extract optimizer info from metadata
    let optimizerMetadata = null;
    if (paramRow.metadata) {
      // Prefer AI optimizer metadata, else rule optimizer
      if (paramRow.metadata.last_ai_optimizer_v1) {
        optimizerMetadata = paramRow.metadata.last_ai_optimizer_v1;
      } else if (paramRow.metadata.last_rule_optimizer_v1) {
        optimizerMetadata = paramRow.metadata.last_rule_optimizer_v1;
      }
    }

    console.log(
      `[coordinator] Using dynamic min_confidence for ${args.symbol}: ${clampedConf} (source: strategy_parameters, optimizer: ${paramRow.last_updated_by || "unknown"})`,
    );

    return {
      effectiveMinConfidence: clampedConf,
      source: "strategy_parameters",
      optimizer: paramRow.last_updated_by || null,
      optimizerMetadata: optimizerMetadata,
    };
  } catch (err) {
    console.error(`[coordinator] Error in getEffectiveMinConfidenceForDecision: ${err?.message || String(err)}`);
    return {
      effectiveMinConfidence: args.baseMinConfidence,
      source: "default",
      optimizer: null,
      optimizerMetadata: null,
    };
  }
}

// Execute trade (reused by both paths)
// ============= POSITION-AWARE HELPERS =============

// Get remaining quantity for a specific position ID
async function getPositionRemainingForId(
  supabaseClient: any,
  userId: string,
  strategyId: string,
  positionId: string,
  baseSymbol: string,
): Promise<{
  remainingQty: number;
  isOpen: boolean;
  originalAmount: number;
  originalValue: number;
  originalPrice: number;
}> {
  try {
    // Fetch the original BUY trade
    const { data: buyTrade, error: buyError } = await supabaseClient
      .from("mock_trades")
      .select("*")
      .eq("id", positionId)
      .eq("user_id", userId)
      .eq("strategy_id", strategyId)
      .eq("cryptocurrency", baseSymbol)
      .eq("trade_type", "buy")
      .maybeSingle();

    if (buyError) {
      console.error("[Coordinator][Position] Error fetching position:", buyError);
      return { remainingQty: 0, isOpen: false, originalAmount: 0, originalValue: 0, originalPrice: 0 };
    }

    if (!buyTrade) {
      console.log("[Coordinator][Position] Position not found:", positionId);
      return { remainingQty: 0, isOpen: false, originalAmount: 0, originalValue: 0, originalPrice: 0 };
    }

    const originalAmount = parseFloat(buyTrade.amount);
    const originalPrice = parseFloat(buyTrade.price);
    const originalValue = originalAmount * originalPrice;

    // Calculate how much has been sold from this specific position
    // by looking for SELLs that reference this position_id
    const { data: sellTrades, error: sellError } = await supabaseClient
      .from("mock_trades")
      .select("amount, original_trade_id")
      .eq("user_id", userId)
      .eq("strategy_id", strategyId)
      .eq("cryptocurrency", baseSymbol)
      .eq("trade_type", "sell")
      .eq("original_trade_id", positionId);

    if (sellError) {
      console.error("[Coordinator][Position] Error fetching sell history:", sellError);
      // Conservative: if we can't determine sells, assume position is fully available
      return {
        remainingQty: originalAmount,
        isOpen: true,
        originalAmount,
        originalValue,
        originalPrice,
      };
    }

    // Sum up all sells that targeted this position
    let totalSold = 0;
    if (sellTrades && sellTrades.length > 0) {
      totalSold = sellTrades.reduce((sum, sell) => sum + parseFloat(sell.amount), 0);
    }

    const remainingQty = Math.max(0, originalAmount - totalSold);
    const isOpen = remainingQty > 0.0001; // Use small epsilon for float comparison

    console.log("[Coordinator][Position] Position info", {
      positionId,
      originalAmount,
      totalSold,
      remainingQty,
      isOpen,
    });

    return {
      remainingQty,
      isOpen,
      originalAmount,
      originalValue,
      originalPrice,
    };
  } catch (error) {
    console.error("[Coordinator][Position] Unexpected error:", error);
    return { remainingQty: 0, isOpen: false, originalAmount: 0, originalValue: 0, originalPrice: 0 };
  }
}

// ============= TRADE EXECUTION =============

async function executeTradeOrder(
  supabaseClient: any,
  intent: TradeIntent,
  strategyConfig: any,
  requestId: string,
  priceData?: { price: number; tickAgeMs: number; spreadBps: number },
  decision_at?: string,
): Promise<{
  success: boolean;
  error?: string;
  qty?: number;
  tradeId?: string;
  executed_at?: string;
  decision_price?: number;
  executed_price?: number;
  partial_fill?: boolean;
  effectiveConfig?: any; // Return the effective config with overrides applied
}> {
  try {
    // =========================================================================
    // CANONICAL CONFIG RESOLUTION - use same resolver as executeWithMinimalLock
    // =========================================================================
    const baseSymbol = toBaseSymbol(intent.symbol);
    const canonicalResult = resolveCanonicalConfig(strategyConfig);

    // Note: Config should already be validated in executeWithMinimalLock,
    // but we check again for safety in case this function is called directly
    if (!canonicalResult.success) {
      const missingKey = canonicalResult.missingKeys?.[0] || "unknown";
      console.log(
        `🚫 COORDINATOR: executeTradeOrder blocked - missing config: ${canonicalResult.missingKeys?.join(", ")}`,
      );
      return { success: false, error: `blocked_missing_config:${missingKey}` };
    }

    const canonical = canonicalResult.config!;

    // PHASE 4: Load optimized parameters (override canonical config)
    const params = await loadStrategyParameters(supabaseClient, intent.userId, intent.strategyId, baseSymbol);

    // Create effective config by merging overrides
    let effectiveConfig = {
      ...strategyConfig,
      // Ensure canonical values are present
      takeProfitPercentage: canonical.takeProfitPercentage,
      stopLossPercentage: canonical.stopLossPercentage,
      aiConfidenceThreshold: canonical.aiConfidenceThreshold,
      minConfidence: canonical.aiConfidenceThreshold / 100,
    };

    // Apply strategy_parameters overrides if available
    if (params) {
      effectiveConfig = {
        ...effectiveConfig,
        takeProfitPercentage: params.tp_pct ?? canonical.takeProfitPercentage,
        stopLossPercentage: params.sl_pct ?? canonical.stopLossPercentage,
        minConfidence: params.min_confidence ?? canonical.aiConfidenceThreshold / 100,
      };
    }

    // Log parameter override status using in-scope canonical values
    console.log("STRATEGY_PARAMS_OVERRIDE", {
      symbol: baseSymbol,
      canonicalConfig: {
        tp_pct: canonical.takeProfitPercentage,
        sl_pct: canonical.stopLossPercentage,
        confidence: canonical.aiConfidenceThreshold,
      },
      params: params
        ? {
            min_confidence: params.min_confidence,
            tp_pct: params.tp_pct,
            sl_pct: params.sl_pct,
          }
        : null,
      effective: {
        min_confidence: effectiveConfig.minConfidence,
        tp_pct: effectiveConfig.takeProfitPercentage,
        sl_pct: effectiveConfig.stopLossPercentage,
      },
    });

    // PHASE 5: READ canonical execution mode from strategyConfig (NOT from ENV)
    // DO NOT redeclare isMockExecution - use local variable name to avoid conflict
    const localExecutionMode = strategyConfig?.canonicalExecutionMode || "MOCK";
    const localIsMockExecution = localExecutionMode === "MOCK";
    console.log(`[coordinator] CANONICAL_EXECUTION_MODE=${localExecutionMode} (localIsMockExecution=${localIsMockExecution}) for ${intent.side} ${baseSymbol}`);
    console.log(`💱 COORDINATOR: Executing ${intent.side} order for ${intent.symbol}`);

    // Use provided price data or fetch new price
    let realMarketPrice: number;
    if (priceData) {
      realMarketPrice = priceData.price;
    } else {
      const marketPrice = await getMarketPrice(baseSymbol);
      realMarketPrice = marketPrice.price;
    }

    console.log(`💱 COORDINATOR: Got real price for ${toPairSymbol(baseSymbol)}: €${realMarketPrice}`);

    // CRITICAL FIX: Check available EUR balance BEFORE executing BUY trades
    let qty: number;
    const tradeAllocation = effectiveConfig?.perTradeAllocation || 50; // match app defaults

    if (intent.side === "BUY") {
      // Derive isTestMode from canonical execution mode for balance queries
      const canonicalIsTestMode = strategyConfig?.canonicalIsTestMode === true;
      
      // Calculate current EUR balance from all trades (filter by canonical test mode)
      const { data: allTrades } = await supabaseClient
        .from("mock_trades")
        .select("trade_type, total_value")
        .eq("user_id", intent.userId)
        .eq("is_test_mode", canonicalIsTestMode);

      let availableEur = 30000; // Starting balance

      if (allTrades) {
        allTrades.forEach((trade: any) => {
          const value = parseFloat(trade.total_value);
          if (trade.trade_type === "buy") {
            availableEur -= value;
          } else if (trade.trade_type === "sell") {
            availableEur += value;
          }
        });
      }

      console.log(`💰 COORDINATOR: Available EUR balance: €${availableEur.toFixed(2)}`);

      // =============================================================================
      // BUY QUANTITY COMPUTATION (CRITICAL)
      // =============================================================================
      // For BUY orders: intent.metadata.eurAmount is the CANONICAL EUR amount
      // We ALWAYS derive qty from EUR amount / price
      // NEVER use qtySuggested for BUY - that would cause 5 EUR → 5 ETH bug
      // =============================================================================
      const eurAmount = Number(intent.metadata?.eurAmount);
      if (!Number.isFinite(eurAmount) || eurAmount <= 0) {
        return {
          success: false,
          error: "Missing EUR amount for BUY",
        };
      }

      console.log(`[coordinator] BUY sizing: eurAmount=${eurAmount}`);

      // MOCK MODE: Bypass balance check for MOCK execution (paper trading)
      // localIsMockExecution is derived from canonical execution mode at top of function
      if (localIsMockExecution) {
        console.log(`🧪 MOCK MODE: Bypassing balance check - using virtual paper trading`);
        console.log(`🧪 MOCK MODE source: canonicalExecutionMode=${localExecutionMode}`);
        // Compute quantity from EUR amount - NEVER use qtySuggested for BUY
        qty = eurAmount / realMarketPrice;
      } else {
        // REAL MODE: Check if we have sufficient balance
        if (availableEur < eurAmount) {
          const adjustedAllocation = Math.max(0, availableEur);
          if (adjustedAllocation < 10) {
            // Minimum €10 trade
            console.log(
              `🚫 COORDINATOR: Insufficient balance - €${availableEur.toFixed(2)} available, €${eurAmount} requested`,
            );
            return {
              success: false,
              error: `Insufficient EUR balance: €${availableEur.toFixed(2)} available, €${eurAmount} requested`,
            };
          }
          console.log(
            `⚠️ COORDINATOR: Adjusting trade from €${eurAmount} to €${adjustedAllocation.toFixed(2)} (available balance)`,
          );
          qty = adjustedAllocation / realMarketPrice;
        } else {
          // Compute quantity from EUR amount - NEVER use qtySuggested for BUY
          qty = eurAmount / realMarketPrice;
        }
      }
    } else {
      // For SELL orders, use the suggested quantity
      qty = intent.qtySuggested || 0.001;
    }

    let totalValue = qty * realMarketPrice;

    console.log(
      `💱 COORDINATOR: Trade calculation - ${intent.side} ${qty} ${baseSymbol} at €${realMarketPrice} = €${totalValue}`,
    );

    // For SELL orders, compute FIFO accounting fields and cap quantity
    let fifoFields = {};
    if (intent.side === "SELL") {
      // ========= SELL BRANCHING LOGIC =========
      // Detect intent type for routing
      const isPoolExit = intent.source === "pool";
      const isPositionManaged = !!intent.metadata?.position_management && !!intent.metadata?.position_id;
      const isManualSell = intent.metadata?.context === "MANUAL" && intent.metadata?.originalTradeId;

      console.log("[Coordinator][SELL] Incoming intent", {
        userId: intent.userId,
        strategyId: intent.strategyId,
        symbol: intent.symbol,
        side: intent.side,
        source: intent.source,
        position_management: intent.metadata?.position_management ?? false,
        position_id: intent.metadata?.position_id ?? null,
        originalTradeId: intent.metadata?.originalTradeId ?? null,
        context: intent.metadata?.context ?? null,
      });

      console.log("[Coordinator][SELL] Branch selection", {
        isPositionManaged,
        isPoolExit,
        isManualSell,
        branch: isPositionManaged ? "position" : isPoolExit ? "pool" : isManualSell ? "manual" : "symbol",
      });

      // ========= BRANCH A: POSITION-MANAGED SELL (per position_id) =========
      if (isPositionManaged) {
        console.log("[Coordinator][SELL][Position] Processing position-managed SELL");
        const positionId = intent.metadata.position_id;

        // Get position-specific remaining quantity
        const positionInfo = await getPositionRemainingForId(
          supabaseClient,
          intent.userId,
          intent.strategyId,
          positionId,
          baseSymbol,
        );

        console.log("[Coordinator][SELL][Position] Position check", {
          position_id: positionId,
          requestedQty: qty,
          remainingQty: positionInfo.remainingQty,
          isOpen: positionInfo.isOpen,
        });

        // Check if position is open
        if (!positionInfo.isOpen || positionInfo.remainingQty <= 0) {
          console.log(`🚫 COORDINATOR: Position ${positionId} is not open or fully closed`);
          // Log BLOCK decision
          await logDecisionAsync(
            supabaseClient,
            intent,
            "BLOCK",
            "no_position_found",
            { enableUnifiedDecisions: true } as UnifiedConfig,
            requestId,
            {
              positionExit: {
                isPositionManaged: true,
                position_id: positionId,
                requested_qty: qty,
                remaining_position_qty: positionInfo.remainingQty,
                is_open: positionInfo.isOpen,
              },
            },
            undefined,
            realMarketPrice,
            effectiveConfig,
          );
          return { success: false, error: "blocked_no_open_position_for_position_id", effectiveConfig };
        }

        // Check if requested quantity exceeds position size
        const epsilon = 0.0001; // Small tolerance for float comparison
        if (qty > positionInfo.remainingQty + epsilon) {
          console.log(`🚫 COORDINATOR: Requested qty ${qty} exceeds position size ${positionInfo.remainingQty}`);
          // Log BLOCK decision
          await logDecisionAsync(
            supabaseClient,
            intent,
            "BLOCK",
            "insufficient_position_size",
            { enableUnifiedDecisions: true } as UnifiedConfig,
            requestId,
            {
              positionExit: {
                isPositionManaged: true,
                position_id: positionId,
                requested_qty: qty,
                remaining_position_qty: positionInfo.remainingQty,
                is_open: positionInfo.isOpen,
              },
            },
            undefined,
            realMarketPrice,
            effectiveConfig,
          );
          return { success: false, error: "blocked_quantity_exceeds_position_size", effectiveConfig };
        }

        // Position is valid, use position-specific FIFO fields
        fifoFields = {
          original_purchase_amount: positionInfo.originalAmount,
          original_purchase_value: positionInfo.originalValue,
          original_purchase_price: positionInfo.originalPrice,
          original_trade_id: positionId, // Link back to original trade
        };

        console.log("[Coordinator][SELL][Position] Using position FIFO fields", fifoFields);

        // ========= BRANCH B: POOL EXIT (source === "pool") =========
      } else if (isPoolExit) {
        console.log("[Coordinator][SELL][Pool] Processing pool exit SELL");
        // Pool logic uses symbol-level aggregation as designed
        // Pool manager handles its own quantity logic, but we still compute FIFO fields for P&L tracking

        const { data: buyTrades } = await supabaseClient
          .from("mock_trades")
          .select("amount, price, executed_at")
          .eq("user_id", intent.userId)
          .eq("strategy_id", intent.strategyId)
          .eq("cryptocurrency", baseSymbol)
          .eq("trade_type", "buy")
          .order("executed_at", { ascending: true });

        const { data: sellTrades } = await supabaseClient
          .from("mock_trades")
          .select("original_purchase_amount")
          .eq("user_id", intent.userId)
          .eq("strategy_id", intent.strategyId)
          .eq("cryptocurrency", baseSymbol)
          .eq("trade_type", "sell")
          .not("original_purchase_amount", "is", null);

        if (buyTrades && buyTrades.length > 0) {
          let totalSold = sellTrades
            ? sellTrades.reduce((sum, sell) => sum + parseFloat(sell.original_purchase_amount), 0)
            : 0;
          let remainingQty = qty;
          let fifoValue = 0;
          let fifoAmount = 0;

          for (const buy of buyTrades) {
            if (remainingQty <= 0) break;
            const buyAmount = parseFloat(buy.amount);
            const buyPrice = parseFloat(buy.price);
            const availableFromBuy = Math.max(0, buyAmount - totalSold);

            if (availableFromBuy > 0) {
              const takeAmount = Math.min(remainingQty, availableFromBuy);
              fifoAmount += takeAmount;
              fifoValue += takeAmount * buyPrice;
              remainingQty -= takeAmount;
            }
            totalSold -= Math.min(totalSold, buyAmount);
          }

          // Pool EXIT: Use computed FIFO fields (pool manager already validated quantity)
          fifoFields =
            fifoAmount > 0
              ? {
                  original_purchase_amount: fifoAmount,
                  original_purchase_value: fifoValue,
                  original_purchase_price: fifoValue / fifoAmount,
                }
              : {};

          console.log(
            `   Pool SELL FIFO: amount=${fifoAmount}, value=${fifoValue}, avgPrice=${fifoAmount > 0 ? fifoValue / fifoAmount : 0}`,
          );
        }

        // Pool exits bypass coverage enforcement - pool manager handles quantity validation

        // ========= BRANCH C: MANUAL SELL BYPASS =========
      } else if (isManualSell) {
        console.log(`🔓 COORDINATOR: Manual SELL with originalTradeId detected - BYPASSING coverage gate`);
        console.log(`   Context: ${intent.metadata.context}, OriginalTradeId: ${intent.metadata.originalTradeId}`);

        // For manual SELLs, still compute FIFO fields for P&L tracking but don't enforce coverage
        const { data: buyTrades } = await supabaseClient
          .from("mock_trades")
          .select("amount, price, executed_at")
          .eq("user_id", intent.userId)
          .eq("strategy_id", intent.strategyId)
          .eq("cryptocurrency", baseSymbol)
          .eq("trade_type", "buy")
          .order("executed_at", { ascending: true });

        const { data: sellTrades } = await supabaseClient
          .from("mock_trades")
          .select("original_purchase_amount")
          .eq("user_id", intent.userId)
          .eq("strategy_id", intent.strategyId)
          .eq("cryptocurrency", baseSymbol)
          .eq("trade_type", "sell")
          .not("original_purchase_amount", "is", null);

        if (buyTrades && buyTrades.length > 0) {
          let totalSold = sellTrades
            ? sellTrades.reduce((sum, sell) => sum + parseFloat(sell.original_purchase_amount), 0)
            : 0;
          let remainingQty = qty;
          let fifoValue = 0;
          let fifoAmount = 0;

          for (const buy of buyTrades) {
            if (remainingQty <= 0) break;
            const buyAmount = parseFloat(buy.amount);
            const buyPrice = parseFloat(buy.price);
            const availableFromBuy = Math.max(0, buyAmount - totalSold);

            if (availableFromBuy > 0) {
              const takeAmount = Math.min(remainingQty, availableFromBuy);
              fifoAmount += takeAmount;
              fifoValue += takeAmount * buyPrice;
              remainingQty -= takeAmount;
            }
            totalSold -= Math.min(totalSold, buyAmount);
          }

          // Manual SELL: Use computed FIFO fields even if partial/zero coverage (for P&L tracking)
          fifoFields =
            fifoAmount > 0
              ? {
                  original_purchase_amount: fifoAmount,
                  original_purchase_value: fifoValue,
                  original_purchase_price: fifoValue / fifoAmount,
                }
              : {};

          console.log(
            `   Manual SELL FIFO: amount=${fifoAmount}, value=${fifoValue}, avgPrice=${fifoAmount > 0 ? fifoValue / fifoAmount : 0}`,
          );
        }

        // Skip coverage enforcement - allow manual SELL to proceed

        // ========= BRANCH D: PER-LOT SELL LOGIC (HYBRID TP/SL MODEL) =========
        // Architecture: Pooled triggers, per-lot execution
        // CloseMode from intent metadata determines which lots to close:
        //   - TP_SELECTIVE: Only close lots where lot P&L >= TP threshold AND age >= minHold
        //   - SL_FULL_FLUSH: Close ALL lots (stop loss hit)
        //   - AUTO_CLOSE_ALL: Close ALL lots (time-based)
        //   - MANUAL_SYMBOL: Close by FIFO up to qtySuggested
      } else {
        // Extract closeMode from intent metadata
        const closeMode = intent.metadata?.closeMode || "MANUAL_SYMBOL";
        const tpThresholdPct = intent.metadata?.tpThresholdPct ?? 3; // Default 3% TP for selective
        const minHoldMs = intent.metadata?.minHoldMs ?? 60000; // Default 1 min hold

        console.log(`🎯 COORDINATOR: Per-Lot SELL [${closeMode}] - reconstructing open lots for ${baseSymbol}`);
        console.log(`  Config: tpThreshold=${tpThresholdPct}%, minHold=${minHoldMs}ms`);

        // Fetch ALL buy trades with IDs for per-lot tracking
        const { data: buyTrades } = await supabaseClient
          .from("mock_trades")
          .select("id, amount, price, executed_at, total_value")
          .eq("user_id", intent.userId)
          .eq("strategy_id", intent.strategyId)
          .eq("cryptocurrency", baseSymbol)
          .eq("trade_type", "buy")
          .eq("is_test_mode", true)
          .order("executed_at", { ascending: true }); // FIFO order

        // Fetch ALL sell trades with original_trade_id to track what's been sold per lot
        const { data: sellTrades } = await supabaseClient
          .from("mock_trades")
          .select("amount, original_trade_id")
          .eq("user_id", intent.userId)
          .eq("strategy_id", intent.strategyId)
          .eq("cryptocurrency", baseSymbol)
          .eq("trade_type", "sell")
          .eq("is_test_mode", true);

        if (!buyTrades || buyTrades.length === 0) {
          console.log(`🚫 COORDINATOR: SELL blocked - no buy history found`);
          await logDecisionAsync(
            supabaseClient,
            intent,
            "BLOCK",
            "insufficient_position_size",
            { enableUnifiedDecisions: true } as UnifiedConfig,
            requestId,
            { realMarketPrice },
            undefined,
            realMarketPrice,
            effectiveConfig,
          );
          return { success: false, error: "insufficient_position_size", effectiveConfig };
        }

        // Build per-lot sold amounts map
        const soldByLotId = new Map<string, number>();
        if (sellTrades) {
          for (const sell of sellTrades) {
            if (sell.original_trade_id) {
              const current = soldByLotId.get(sell.original_trade_id) || 0;
              soldByLotId.set(sell.original_trade_id, current + parseFloat(sell.amount));
            }
          }
        }

        // Also handle legacy sells without original_trade_id (FIFO deduction)
        const legacySells = (sellTrades || []).filter((s) => !s.original_trade_id);
        let legacySellRemaining = legacySells.reduce((sum, s) => sum + parseFloat(s.amount), 0);

        // Reconstruct open lots with remaining amounts AND unrealized P&L
        interface EnrichedOpenLot {
          lotId: string;
          originalAmount: number;
          remainingAmount: number;
          entryPrice: number;
          entryValue: number;
          entryDate: string;
          ageMs: number;
          unrealizedPnl: number;
          unrealizedPnlPct: number;
        }

        const nowMs = Date.now();
        const openLots: EnrichedOpenLot[] = [];

        for (const buy of buyTrades) {
          const buyAmount = parseFloat(buy.amount);
          const buyPrice = parseFloat(buy.price);
          const entryDate = buy.executed_at;

          // Subtract targeted sells (with original_trade_id)
          let soldFromLot = soldByLotId.get(buy.id) || 0;

          // Subtract legacy sells (FIFO order)
          if (legacySellRemaining > 0) {
            const deductFromLegacy = Math.min(legacySellRemaining, buyAmount - soldFromLot);
            if (deductFromLegacy > 0) {
              soldFromLot += deductFromLegacy;
              legacySellRemaining -= deductFromLegacy;
            }
          }

          const remaining = buyAmount - soldFromLot;

          if (remaining > 0.00000001) {
            // Calculate per-lot unrealized P&L
            const entryValue = remaining * buyPrice;
            const currentValue = remaining * realMarketPrice;
            const unrealizedPnl = currentValue - entryValue;
            const unrealizedPnlPct = entryValue > 0 ? (unrealizedPnl / entryValue) * 100 : 0;
            const ageMs = nowMs - new Date(entryDate).getTime();

            openLots.push({
              lotId: buy.id,
              originalAmount: buyAmount,
              remainingAmount: remaining,
              entryPrice: buyPrice,
              entryValue,
              entryDate,
              ageMs,
              unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
              unrealizedPnlPct: Math.round(unrealizedPnlPct * 100) / 100,
            });
          }
        }

        console.log(`[COORD][PER_LOT] Open lots for ${baseSymbol}:`, openLots.length);
        openLots.forEach((lot, i) => {
          console.log(
            `  [${i}] lotId=${lot.lotId.substring(0, 8)}... remaining=${lot.remainingAmount.toFixed(8)} entry=€${lot.entryPrice.toFixed(2)} pnl=${lot.unrealizedPnlPct.toFixed(2)}% age=${Math.round(lot.ageMs / 60000)}min`,
          );
        });

        if (openLots.length === 0) {
          console.log(`🚫 COORDINATOR: SELL blocked - no open lots found`);
          await logDecisionAsync(
            supabaseClient,
            intent,
            "BLOCK",
            "insufficient_position_size",
            { enableUnifiedDecisions: true } as UnifiedConfig,
            requestId,
            { realMarketPrice },
            undefined,
            realMarketPrice,
            effectiveConfig,
          );
          return { success: false, error: "insufficient_position_size", effectiveConfig };
        }

        // Build per-lot sell orders based on closeMode
        interface PerLotSellOrder {
          lotId: string;
          amount: number;
          entryPrice: number;
          entryValue: number;
          unrealizedPnlPct: number;
        }

        let perLotSellOrders: PerLotSellOrder[] = [];

        if (closeMode === "TP_SELECTIVE") {
          // ========= TP_SELECTIVE: Only close profitable lots meeting criteria =========
          console.log(
            `[COORD][TP_SELECTIVE] Filtering for profitable lots (threshold=${tpThresholdPct}%, minHold=${minHoldMs}ms)`,
          );

          // Filter to only profitable lots meeting criteria
          const qualifyingLots = openLots.filter((lot) => {
            const meetsProfit = lot.unrealizedPnlPct >= tpThresholdPct;
            const meetsAge = lot.ageMs >= minHoldMs;
            console.log(
              `    Lot ${lot.lotId.substring(0, 8)}: pnl=${lot.unrealizedPnlPct.toFixed(2)}% (need ${tpThresholdPct}%), age=${Math.round(lot.ageMs / 60000)}min (need ${Math.round(minHoldMs / 60000)}min) → ${meetsProfit && meetsAge ? "✓" : "✗"}`,
            );
            return meetsProfit && meetsAge;
          });

          // Sort by entry date (FIFO - oldest profitable first)
          qualifyingLots.sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());

          console.log(`[COORD][TP_SELECTIVE] ${qualifyingLots.length}/${openLots.length} lots qualify for TP close`);

          // Close all qualifying lots (or up to qty if provided)
          let remainingToSell = qty > 0 ? qty : Infinity;

          for (const lot of qualifyingLots) {
            if (remainingToSell <= 0.00000001) break;

            const takeAmount = Math.min(remainingToSell, lot.remainingAmount);

            if (takeAmount > 0.00000001) {
              perLotSellOrders.push({
                lotId: lot.lotId,
                amount: takeAmount,
                entryPrice: lot.entryPrice,
                entryValue: takeAmount * lot.entryPrice,
                unrealizedPnlPct: lot.unrealizedPnlPct,
              });
              remainingToSell -= takeAmount;
            }
          }

          // If NO lots qualify for TP, BLOCK the sell
          if (perLotSellOrders.length === 0) {
            console.log(`🚫 COORDINATOR: TP_SELECTIVE blocked - no lots meet TP criteria`);
            await logDecisionAsync(
              supabaseClient,
              intent,
              "BLOCK",
              "no_lots_meet_tp_criteria",
              { enableUnifiedDecisions: true } as UnifiedConfig,
              requestId,
              { realMarketPrice, closeMode, tpThresholdPct, minHoldMs, openLotCount: openLots.length },
              undefined,
              realMarketPrice,
              effectiveConfig,
            );
            return { success: false, error: "no_lots_meet_tp_criteria", effectiveConfig };
          }
        } else if (closeMode === "SL_FULL_FLUSH" || closeMode === "AUTO_CLOSE_ALL") {
          // ========= SL_FULL_FLUSH / AUTO_CLOSE_ALL: Close ALL lots =========
          console.log(`[COORD][${closeMode}] Flushing all ${openLots.length} lots`);

          // Sort by entry date (FIFO)
          openLots.sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());

          perLotSellOrders = openLots.map((lot) => ({
            lotId: lot.lotId,
            amount: lot.remainingAmount,
            entryPrice: lot.entryPrice,
            entryValue: lot.remainingAmount * lot.entryPrice,
            unrealizedPnlPct: lot.unrealizedPnlPct,
          }));
        } else {
          // ========= MANUAL_SYMBOL / default: FIFO up to qtySuggested =========
          console.log(`[COORD][${closeMode}] FIFO close up to qty=${qty}`);

          let remainingToSell = qty;

          for (const lot of openLots) {
            if (remainingToSell <= 0.00000001) break;

            const takeAmount = Math.min(remainingToSell, lot.remainingAmount);

            if (takeAmount > 0.00000001) {
              perLotSellOrders.push({
                lotId: lot.lotId,
                amount: takeAmount,
                entryPrice: lot.entryPrice,
                entryValue: takeAmount * lot.entryPrice,
                unrealizedPnlPct: lot.unrealizedPnlPct,
              });
              remainingToSell -= takeAmount;
            }
          }
        }

        console.log(`[COORD][PER_LOT] Generated ${perLotSellOrders.length} per-lot sell orders [${closeMode}]`);
        perLotSellOrders.forEach((order, i) => {
          console.log(
            `  [${i}] lotId=${order.lotId.substring(0, 8)}... sell=${order.amount.toFixed(8)} entry=€${order.entryPrice.toFixed(2)} pnl=${order.unrealizedPnlPct.toFixed(2)}%`,
          );
        });

        if (perLotSellOrders.length === 0) {
          console.log(`🚫 COORDINATOR: SELL blocked - could not build per-lot orders`);
          await logDecisionAsync(
            supabaseClient,
            intent,
            "BLOCK",
            "insufficient_position_size",
            { enableUnifiedDecisions: true } as UnifiedConfig,
            requestId,
            { realMarketPrice },
            undefined,
            realMarketPrice,
            effectiveConfig,
          );
          return { success: false, error: "insufficient_position_size", effectiveConfig };
        }

        // Store perLotSellOrders for multi-insert later
        // @ts-ignore - Adding custom field for per-lot processing
        intent.__perLotSellOrders = perLotSellOrders;

        // Update qty to total being sold (may be capped by available lots)
        const totalSelling = perLotSellOrders.reduce((sum, o) => sum + o.amount, 0);
        if (totalSelling < qty) {
          console.log(`⚠️ COORDINATOR: Capping SELL qty from ${qty} to ${totalSelling} (available in lots)`);
          qty = totalSelling;
        }
        totalValue = qty * realMarketPrice;

        // Use first lot's FIFO fields for backward compatibility (will be overridden per-row in insert)
        const firstOrder = perLotSellOrders[0];
        fifoFields = {
          original_purchase_amount: firstOrder.amount,
          original_purchase_value: firstOrder.entryValue,
          original_purchase_price: firstOrder.entryPrice,
          original_trade_id: firstOrder.lotId,
        };
      }
    }

    // PHASE 3.1: Capture execution timestamp and compute metrics
    const executed_at = new Date().toISOString();
    const execution_latency_ms = decision_at ? new Date(executed_at).getTime() - new Date(decision_at).getTime() : null;
    const decision_price = priceData?.price || realMarketPrice;
    const executed_price = realMarketPrice;
    const slippage_bps = ((executed_price - decision_price) / decision_price) * 10000;
    const partial_fill = false; // Mock trades are always full fills

    // ============= SHADOW MODE CHECK =============
    // In shadow mode, skip actual trade inserts but return what WOULD happen
    const isShadowMode = intent?.metadata?.execMode === "SHADOW" || intent?.metadata?.context === "BACKEND_SHADOW";

    if (isShadowMode) {
      console.log("🌑 SHADOW MODE: Skipping trade insert - returning decision only");
      return {
        success: true,
        qty,
        tradeId: undefined, // No trade inserted
        executed_at,
        decision_price,
        executed_price,
        partial_fill: false,
        effectiveConfig,
        // @ts-ignore - Shadow-specific fields
        shadow: true,
        wouldExecute: true,
        shadowDecision: {
          side: intent.side,
          symbol: baseSymbol,
          qty,
          price: realMarketPrice,
          totalValue,
          reason: "shadow_mode_no_insert",
        },
      };
    }

    // PHASE 5: Branch execution based on canonical mode
    // localIsMockExecution is derived from strategyConfig.canonicalExecutionMode at function entry
    if (localIsMockExecution) {
      // MOCK mode → mock_trades with is_test_mode=true
      console.log(`[coordinator] MOCK MODE: Writing to mock_trades (is_test_mode=true)`);

      // ============= PER-LOT SELL INSERTION =============
      // @ts-ignore - Check for per-lot orders generated in Branch D
      const perLotSellOrders = intent.__perLotSellOrders as
        | { lotId: string; amount: number; entryPrice: number; entryValue: number }[]
        | undefined;

      if (perLotSellOrders && perLotSellOrders.length > 0 && intent.side === "SELL") {
        // INSERT MULTIPLE ROWS - one per lot being closed
        console.log(`[coordinator] PER-LOT SELL: Inserting ${perLotSellOrders.length} SELL rows`);

        const sellRows = perLotSellOrders.map((order, index) => {
          const exitValue = order.amount * realMarketPrice;
          const realizedPnl = exitValue - order.entryValue;
          const realizedPnlPct = order.entryValue > 0 ? (realizedPnl / order.entryValue) * 100 : 0;

          return {
            user_id: intent.userId,
            strategy_id: intent.strategyId,
            trade_type: "sell",
            cryptocurrency: baseSymbol,
            amount: order.amount,
            price: realMarketPrice,
            total_value: order.amount * realMarketPrice,
            executed_at,
            is_test_mode: localIsMockExecution, // Use canonical execution mode
            notes: `Coordinator: UD=ON (TEST) - Per-lot SELL [${index + 1}/${perLotSellOrders.length}]`,
            strategy_trigger:
              intent.source === "coordinator_tp"
                ? `coord_tp|req:${requestId}|lot:${order.lotId.substring(0, 8)}`
                : `coord_${intent.source}|req:${requestId}|lot:${order.lotId.substring(0, 8)}`,
            market_conditions: {
              execution_mode: localExecutionMode,
              decision_at,
              executed_at,
              latency_ms: execution_latency_ms,
              request_id: requestId,
              lot_index: index,
              total_lots: perLotSellOrders.length,
            },
            // Per-lot FIFO fields
            original_trade_id: order.lotId,
            original_purchase_amount: order.amount,
            original_purchase_value: order.entryValue,
            original_purchase_price: order.entryPrice,
            exit_value: exitValue,
            realized_pnl: Math.round(realizedPnl * 100) / 100,
            realized_pnl_pct: Math.round(realizedPnlPct * 100) / 100,
            // UNIFIED LEDGER: Explicit mock execution fields
            execution_source: "mock_engine",
            execution_confirmed: true,
            execution_ts: executed_at,
          };
        });

        // PHASE B: Dual-engine detection with origin tracking (log only, no blocking)
        const currentOrigin = detectIntentOrigin(intent.metadata);
        const dualCheck = await checkDualEngineConflict(
          supabaseClient,
          intent.userId,
          intent.strategyId,
          intent.symbol,
        );
        if (dualCheck.hasRecentTrade) {
          logDualEngineWarning(dualCheck, currentOrigin, intent.userId, intent.strategyId, baseSymbol);
        }

        const { data: insertResults, error: insertError } = await supabaseClient
          .from("mock_trades")
          .insert(sellRows)
          .select("id");

        if (insertError) {
          console.error("❌ COORDINATOR: Per-lot SELL insert failed:", insertError);
          return { success: false, error: insertError.message };
        }

        // Log success
        console.log("============ PER-LOT SELL SUCCESSFUL ============");
        console.log(`Inserted ${insertResults?.length || 0} SELL rows for ${perLotSellOrders.length} lots`);
        sellRows.forEach((row, i) => {
          console.log(
            `  [${i}] lotId=${row.original_trade_id?.substring(0, 8)}... amount=${row.amount.toFixed(8)} pnl=€${row.realized_pnl?.toFixed(2)}`,
          );
        });

        const totalQty = sellRows.reduce((sum, r) => sum + r.amount, 0);
        const totalPnl = sellRows.reduce((sum, r) => sum + (r.realized_pnl || 0), 0);
        console.log(`📊 Total: qty=${totalQty.toFixed(8)}, pnl=€${totalPnl.toFixed(2)}`);

        // ============= CASH LEDGER UPDATE: Per-lot SELL proceeds (via helper) =============
        // Use exit_value (net, trigger-computed) not total_value (gross)
        const totalExitValue = sellRows.reduce((sum, r) => sum + (r.exit_value || r.total_value), 0);

        const cashResult = await settleCashLedger(
          supabaseClient,
          intent.userId,
          "SELL",
          {
            total_value: sellRows.reduce((sum, r) => sum + r.total_value, 0),
            exit_value: totalExitValue, // Use exit_value which is net of fees
            fees: 0,
            sell_fees: 0,
          },
          {
            tradeId: insertResults?.[0]?.id,
            path: "per_lot",
            isMockMode: isMockExecution, // Use canonical execution mode
            strategyId: intent.strategyId,
            symbol: baseSymbol,
          },
        );

        if (!cashResult.success) {
          // Trades inserted but cash not updated - log decision_event for audit
          console.error(`⚠️ COORDINATOR: Per-lot SELL cash settlement failed: ${cashResult.error}`);
          await supabaseClient.from("decision_events").insert({
            user_id: intent.userId,
            strategy_id: intent.strategyId,
            symbol: baseSymbol,
            side: "SELL",
            source: intent.source || "coordinator_per_lot",
            reason: "cash_ledger_settle_failed",
            decision_ts: new Date().toISOString(),
            metadata: {
              cash_before: cashResult.cash_before,
              delta: cashResult.delta,
              error: cashResult.error,
              trade_inserted: true,
              lots_sold: sellRows.length,
            },
          });
        }
        // ============= END CASH LEDGER UPDATE =============

        return {
          success: true,
          qty: totalQty,
          tradeId: insertResults?.[0]?.id, // Return first row ID for backward compatibility
          executed_at,
          decision_price,
          executed_price,
          partial_fill: false,
          effectiveConfig,
          perLotResults: insertResults?.map((r) => r.id), // Return all IDs
        };
      }
      // ============= END PER-LOT SELL INSERTION =============

      // ============= PHASE E: Enhanced mock_trades insert with backend metadata =============
      // Include idempotency_key and backend_request_id in notes for traceability
      const isBackendLiveInsert = intent.metadata?.context === "BACKEND_LIVE";
      const backendRequestId = intent.metadata?.backend_request_id || null;
      const idempotencyKeyForInsert = intent.idempotencyKey || null;

      // Build notes with traceability info
      let tradeNotes = "Coordinator: UD=ON (TEST)";
      if (isBackendLiveInsert) {
        tradeNotes = `Coordinator: UD=ON (TEST) | origin=BACKEND_LIVE`;
        if (backendRequestId) {
          tradeNotes += ` | backend_request_id=${backendRequestId}`;
        }
      }

      // Standard single-row insert (BUY or single SELL)
      // GOAL 2.B: Include pnl_at_decision_pct from backend intent metadata
      const pnlAtDecisionPct = intent.metadata?.pnl_at_decision_pct ?? null;

      const mockTrade = {
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        trade_type: intent.side.toLowerCase(),
        cryptocurrency: baseSymbol,
        amount: qty,
        price: realMarketPrice,
        total_value: totalValue,
        executed_at,
        is_test_mode: localIsMockExecution, // Use canonical execution mode
        notes: tradeNotes,
        // PHASE E: Include idempotencyKey in strategy_trigger for dedup checking
        strategy_trigger:
          intent.source === "coordinator_tp"
            ? `coord_tp|req:${requestId}${idempotencyKeyForInsert ? "|idem:" + idempotencyKeyForInsert : ""}`
            : `coord_${intent.source}|req:${requestId}${idempotencyKeyForInsert ? "|idem:" + idempotencyKeyForInsert : ""}`,
        market_conditions: {
          execution_mode: localExecutionMode,
          decision_at,
          executed_at,
          latency_ms: execution_latency_ms,
          request_id: requestId,
          // PHASE E: Backend metadata in market_conditions
          origin: isBackendLiveInsert ? "BACKEND_LIVE" : null,
          backend_request_id: backendRequestId,
          idempotency_key: idempotencyKeyForInsert,
          // PYRAMIDING MODEL: Store entry_context for context duplicate detection
          entry_context: intent.metadata?.entry_context || null,
        },
        // GOAL 2.B: P&L at decision time for UI display
        pnl_at_decision_pct: pnlAtDecisionPct,
        // UNIFIED LEDGER: Explicit mock execution fields
        execution_source: "mock_engine",
        execution_confirmed: true,
        execution_ts: executed_at,
        ...fifoFields,
      };

      // PHASE B: Dual-engine detection with origin tracking (log only, no blocking)
      const currentOrigin = detectIntentOrigin(intent.metadata);
      const dualCheck = await checkDualEngineConflict(supabaseClient, intent.userId, intent.strategyId, intent.symbol);
      if (dualCheck.hasRecentTrade) {
        logDualEngineWarning(dualCheck, currentOrigin, intent.userId, intent.strategyId, baseSymbol);
      }

      const { data: insertResult, error } = await supabaseClient.from("mock_trades").insert(mockTrade).select("id");

      if (error) {
        console.error("❌ COORDINATOR: Mock trade insert failed:", error);
        return { success: false, error: error.message };
      }

      // STEP 4: PROVE THE WRITE - log successful insert
      console.log("============ STEP 4: WRITE SUCCESSFUL (TEST MODE) ============");
      console.log("Inserted row ID:", insertResult?.[0]?.id || "ID_NOT_RETURNED");
      console.log(
        "Inserted trade data:",
        JSON.stringify(
          {
            symbol: mockTrade.cryptocurrency,
            side: mockTrade.trade_type,
            amount: mockTrade.amount,
            price: mockTrade.price,
            total_value: mockTrade.total_value,
            is_test_mode: mockTrade.is_test_mode,
            fifo_fields: fifoFields,
          },
          null,
          2,
        ),
      );
      console.log(
        `📊 Execution metrics: latency=${execution_latency_ms}ms, slippage=${slippage_bps}bps, partial_fill=${partial_fill}`,
      );

      // ============= CASH LEDGER UPDATE: BUY deduction or SELL credit (via helper) =============
      // For SELL, use exit_value from fifoFields if available (net of fees)
      const cashResult = await settleCashLedger(
        supabaseClient,
        intent.userId,
        intent.side as "BUY" | "SELL",
        {
          total_value: totalValue,
          exit_value: fifoFields?.exit_value, // Will be undefined for BUY, which is fine
          fees: 0,
          buy_fees: 0,
          sell_fees: 0,
        },
        {
          tradeId: insertResult?.[0]?.id,
          path: "standard",
          isMockMode: isMockExecution, // Use canonical execution mode
          strategyId: intent.strategyId,
          symbol: baseSymbol,
        },
      );

      if (!cashResult.success) {
        // Trade inserted but cash not updated - log decision_event for audit
        console.error(`⚠️ COORDINATOR: ${intent.side} cash settlement failed: ${cashResult.error}`);
        await supabaseClient.from("decision_events").insert({
          user_id: intent.userId,
          strategy_id: intent.strategyId,
          symbol: baseSymbol,
          side: intent.side,
          source: intent.source || "coordinator_standard",
          reason: "cash_ledger_settle_failed",
          decision_ts: new Date().toISOString(),
          metadata: {
            cash_before: cashResult.cash_before,
            delta: cashResult.delta,
            error: cashResult.error,
            trade_inserted: true,
          },
        });
      }
      // ============= END CASH LEDGER UPDATE =============

      console.log("✅ COORDINATOR TEST: Trade executed successfully");
      return {
        success: true,
        qty,
        tradeId: insertResult?.[0]?.id,
        executed_at,
        decision_price,
        executed_price,
        partial_fill,
        effectiveConfig, // Return the effective config with overrides
      };
    } else {
      // REAL mode → for now, insert into mock_trades with is_test_mode=false
      // This allows real trades to be tracked in the same ledger but distinguished
      console.log(`[coordinator] REAL MODE: Would execute real trade (inserting to ledger with is_test_mode=false)`);

      // NOTE: Full REAL mode with exchange API integration is not yet implemented
      // For now, we insert into mock_trades with is_test_mode=false for manual trades
      return {
        success: false,
        error: "REAL mode execution not yet implemented - manual control required",
        effectiveConfig, // Return effective config even on error
      };
    }
  } catch (error) {
    console.error("❌ COORDINATOR: Trade execution error:", error.message);
    return { success: false, error: error.message, effectiveConfig: strategyConfig }; // Return original config on error
  }
}

// ============= PHASE 3.1: EXECUTION QUALITY & CIRCUIT BREAKERS =============

// Check circuit breakers before execution
async function checkCircuitBreakers(
  supabaseClient: any,
  intent: TradeIntent,
): Promise<{ blocked: boolean; reason?: string; breaker_types?: string[] }> {
  try {
    const { data: breakers } = await supabaseClient
      .from("execution_circuit_breakers")
      .select("breaker_type, threshold_value")
      .eq("user_id", intent.userId)
      .eq("strategy_id", intent.strategyId)
      .eq("symbol", toBaseSymbol(intent.symbol))
      .eq("is_active", true);

    if (breakers && breakers.length > 0) {
      const breaker_types = breakers.map((b: any) => b.breaker_type);
      return {
        blocked: true,
        reason: `Active breakers: ${breaker_types.join(", ")}`,
        breaker_types,
      };
    }

    return { blocked: false };
  } catch (error) {
    console.error("❌ BREAKER CHECK: Error checking circuit breakers:", error);
    return { blocked: false }; // Fail open to avoid blocking all trades
  }
}

// Log execution quality metrics
async function logExecutionQuality(
  supabaseClient: any,
  intent: TradeIntent,
  executionResult: any,
  decision_at: string,
  priceData: any,
): Promise<void> {
  try {
    const executed_at = executionResult.executed_at || new Date().toISOString();
    const execution_latency_ms = new Date(executed_at).getTime() - new Date(decision_at).getTime();
    const decision_price = priceData?.price || executionResult.decision_price;
    const executed_price = executionResult.executed_price;
    const slippage_bps = ((executed_price - decision_price) / decision_price) * 10000;
    const decision_qty = intent.qtySuggested || 0;
    const executed_qty = executionResult.qty || 0;
    const partial_fill = executed_qty < decision_qty;

    // Optional context fields - best effort
    const spread_bps = priceData?.spread || null;
    const market_depth = null; // Could be enhanced later
    const volatility_regime = null; // Could be enhanced later

    const qualityLog = {
      user_id: intent.userId,
      strategy_id: intent.strategyId,
      symbol: toBaseSymbol(intent.symbol),
      side: intent.side.toLowerCase(),
      decision_at,
      executed_at,
      execution_latency_ms,
      decision_price,
      executed_price,
      decision_qty,
      executed_qty,
      partial_fill,
      slippage_bps,
      spread_bps,
      market_depth,
      volatility_regime,
      trade_id: executionResult.tradeId,
    };

    await supabaseClient.from("execution_quality_log").insert([qualityLog]);
    console.log("📊 EXECUTION QUALITY: Logged execution metrics", {
      symbol: qualityLog.symbol,
      side: qualityLog.side,
      slippage_bps: qualityLog.slippage_bps,
      execution_latency_ms: qualityLog.execution_latency_ms,
      partial_fill: qualityLog.partial_fill,
    });
  } catch (error) {
    console.error("❌ EXECUTION QUALITY: Failed to log metrics:", error);
  }
}

// Evaluate circuit breaker conditions and trip if needed
async function evaluateCircuitBreakers(supabaseClient: any, intent: TradeIntent): Promise<void> {
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);
    const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago

    // Get recent execution quality logs for this {user, strategy, symbol}
    const { data: recentLogs } = await supabaseClient
      .from("execution_quality_log")
      .select("slippage_bps, partial_fill, executed_at")
      .eq("user_id", intent.userId)
      .eq("strategy_id", intent.strategyId)
      .eq("symbol", baseSymbol)
      .gte("executed_at", windowStart)
      .order("executed_at", { ascending: false });

    if (!recentLogs || recentLogs.length === 0) return;

    // SLIPPAGE BREAKER: avg(abs(slippage_bps)) > 50 across ≥3 fills
    if (recentLogs.length >= 3) {
      const avgAbsSlippage =
        recentLogs.reduce((sum: number, log: any) => sum + Math.abs(log.slippage_bps), 0) / recentLogs.length;
      if (avgAbsSlippage > 50) {
        console.log(`🚨 BREAKER TRIP: Slippage threshold exceeded (${avgAbsSlippage.toFixed(1)}bps avg)`);
        await tripBreaker(
          supabaseClient,
          intent,
          "slippage",
          50,
          `Avg slippage ${avgAbsSlippage.toFixed(1)}bps > 50bps`,
        );
      }
    }

    // PARTIAL FILL BREAKER: partial_fill ratio > 0.30
    const partialFills = recentLogs.filter((log: any) => log.partial_fill).length;
    const partialFillRate = partialFills / recentLogs.length;
    if (partialFillRate > 0.3) {
      console.log(`🚨 BREAKER TRIP: Partial fill rate exceeded (${(partialFillRate * 100).toFixed(1)}%)`);
      await tripBreaker(
        supabaseClient,
        intent,
        "partial_fill_rate",
        0.3,
        `Partial fill rate ${(partialFillRate * 100).toFixed(1)}% > 30%`,
      );
    }
  } catch (error) {
    console.error("❌ BREAKER EVALUATION: Error evaluating circuit breakers:", error);
  }
}

// Trip a circuit breaker
async function tripBreaker(
  supabaseClient: any,
  intent: TradeIntent,
  breaker_type: string,
  threshold_value: number,
  reason: string,
): Promise<void> {
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);

    await supabaseClient.from("execution_circuit_breakers").upsert(
      {
        user_id: intent.userId,
        strategy_id: intent.strategyId,
        symbol: baseSymbol,
        breaker_type,
        threshold_value,
        is_active: true,
        last_trip_at: new Date().toISOString(),
        trip_count: supabaseClient.raw("COALESCE(trip_count, 0) + 1"),
        trip_reason: reason,
      },
      {
        onConflict: "user_id,strategy_id,symbol,breaker_type",
      },
    );

    console.log(`🚨 BREAKER TRIPPED: ${breaker_type} for ${baseSymbol} - ${reason}`);
  } catch (error) {
    console.error("❌ BREAKER TRIP: Failed to trip breaker:", error);
  }
}

// ============= PROFIT-AWARE COORDINATOR (Milestone 1) =============
// REMOVED: evaluateProfitGate function - profit filtering removed from SELL path per user request

// Execute TP-triggered SELL
async function executeTPSell(
  supabaseClient: any,
  intent: TradeIntent,
  tpEvaluation: any,
  config: UnifiedConfig,
  requestId: string,
  strategyConfig: any,
): Promise<TradeDecision> {
  try {
    const baseSymbol = toBaseSymbol(intent.symbol);

    // Create TP SELL intent - sell the position size detected
    const tpSellIntent: TradeIntent = {
      ...intent,
      side: "SELL",
      qtySuggested: parseFloat(tpEvaluation.metadata.positionSize),
      reason: `TP hit: ${tpEvaluation.pnlPct}% ≥ ${tpEvaluation.tpPct}%`,
      source: "coordinator_tp", // Tag as TP-triggered
    };

    // Get current price for execution
    const priceData = await getMarketPrice(baseSymbol);

    // Execute the TP SELL
    const executionResult = await executeTradeOrder(supabaseClient, tpSellIntent, strategyConfig, requestId, priceData);

    if (executionResult.success) {
      console.log(`✅ COORDINATOR: TP SELL executed successfully`);

      // Log TP decision with detailed metadata and execution price and EFFECTIVE config (with overrides)
      await logDecisionAsync(
        supabaseClient,
        intent,
        "SELL",
        "tp_hit_fastpath",
        config,
        requestId,
        tpEvaluation.metadata,
        executionResult.tradeId,
        executionResult.executed_price,
        executionResult.effectiveConfig || strategyConfig,
      );

      return {
        action: "SELL",
        reason: "tp_hit",
        request_id: requestId,
        retry_in_ms: 0,
        qty: executionResult.qty,
      };
    } else {
      console.error(`❌ COORDINATOR: TP SELL execution failed: ${executionResult.error}`);
      return { action: "DEFER", reason: "tp_execution_failed", request_id: requestId, retry_in_ms: 0 };
    }
  } catch (error) {
    console.error("❌ COORDINATOR: TP SELL error:", error);
    return { action: "DEFER", reason: "tp_execution_error", request_id: requestId, retry_in_ms: 0 };
  }
}

// Execute TP-triggered SELL with advisory lock protection
async function executeTPSellWithLock(
  supabaseClient: any,
  intent: TradeIntent,
  tpEvaluation: any,
  config: UnifiedConfig,
  requestId: string,
  lockKey: number,
  strategyConfig: any,
): Promise<TradeDecision> {
  let lockAcquired = false;

  try {
    // Acquire row-based lock (survives connection pooling)
    console.log(`🔒 COORDINATOR: Acquiring row-based TP lock: ${lockKey}`);

    const { data: lockResult, error: lockError } = await supabaseClient.rpc("acquire_execution_lock", {
      p_lock_key: lockKey,
      p_user_id: intent.userId,
      p_strategy_id: intent.strategyId,
      p_symbol: intent.symbol,
      p_request_id: requestId,
      p_ttl_seconds: 30,
    });

    if (lockError || !lockResult) {
      console.log(
        `🚫 COORDINATOR: TP SELL blocked by lock contention, deferring (${lockError?.message || "lock_held"})`,
      );
      return { action: "DEFER", reason: "tp_lock_contention", request_id: requestId, retry_in_ms: 200 };
    }

    lockAcquired = true;
    console.log(`🔒 COORDINATOR: Row-based TP lock acquired - executing TP SELL`);

    const baseSymbol = toBaseSymbol(intent.symbol);

    // Create TP SELL intent - sell the position size detected
    const tpSellIntent: TradeIntent = {
      ...intent,
      side: "SELL",
      qtySuggested: parseFloat(tpEvaluation.metadata.positionSize),
      reason: `TP hit: ${tpEvaluation.pnlPct}% ≥ ${tpEvaluation.tpPct}%`,
      source: "coordinator_tp", // Tag as TP-triggered
    };

    // Get current price for execution
    const priceData = await getMarketPrice(baseSymbol);

    // Execute the TP SELL
    const executionResult = await executeTradeOrder(supabaseClient, tpSellIntent, strategyConfig, requestId, priceData);

    if (executionResult.success) {
      console.log(`✅ COORDINATOR: TP SELL executed successfully under lock`);

      // Log TP decision with detailed metadata and execution price and EFFECTIVE config (with overrides)
      await logDecisionAsync(
        supabaseClient,
        intent,
        "SELL",
        "tp_hit_fastpath",
        config,
        requestId,
        tpEvaluation.metadata,
        executionResult.tradeId,
        executionResult.executed_price,
        executionResult.effectiveConfig || strategyConfig,
      );

      return {
        action: "SELL",
        reason: "tp_hit",
        request_id: requestId,
        retry_in_ms: 0,
        qty: executionResult.qty,
      };
    } else {
      console.error(`❌ COORDINATOR: TP SELL execution failed: ${executionResult.error}`);
      return { action: "DEFER", reason: "tp_execution_failed", request_id: requestId, retry_in_ms: 0 };
    }
  } catch (error) {
    console.error(`❌ COORDINATOR: TP SELL error:`, error);
    return { action: "DEFER", reason: "tp_execution_error", request_id: requestId, retry_in_ms: 0 };
  } finally {
    // Always release row-based lock
    if (lockAcquired) {
      try {
        await supabaseClient.rpc("release_execution_lock", { p_lock_key: lockKey });
        console.log(`🔓 COORDINATOR: Released row-based TP lock: ${lockKey}`);
      } catch (unlockError) {
        console.error(`❌ COORDINATOR: Failed to release row-based TP lock:`, unlockError);
      }
    }
  }
}

// ============= END PHASE 1: TP DETECTION =============

// ============= END PROFIT-AWARE COORDINATOR =============

// Cleanup old cached data periodically
setInterval(() => {
  const now = Date.now();

  // Clean decision cache
  for (const [key, value] of recentDecisionCache.entries()) {
    if (now - value.timestamp > 60000) {
      // 1 minute
      recentDecisionCache.delete(key);
    }
  }

  // Clean empty queues
  for (const [key, queue] of symbolQueues.entries()) {
    if (queue.length === 0) {
      symbolQueues.delete(key);
    }
  }

  // Reset metrics every 30 minutes
  if (now - metrics.lastReset > 1800000) {
    console.log(`📊 COORDINATOR METRICS (30min):`, {
      totalRequests: metrics.totalRequests,
      atomicSectionBusyPct: ((metrics.blockedByLockCount / metrics.totalRequests) * 100).toFixed(2),
      deferRate: ((metrics.deferCount / metrics.totalRequests) * 100).toFixed(2),
      avgLatency:
        metrics.executionTimes.length > 0
          ? (metrics.executionTimes.reduce((a, b) => a + b, 0) / metrics.executionTimes.length).toFixed(0)
          : 0,
      p95Latency:
        metrics.executionTimes.length > 0
          ? metrics.executionTimes.sort((a, b) => a - b)[Math.floor(metrics.executionTimes.length * 0.95)]
          : 0,
    });

    // Reset metrics
    metrics.totalRequests = 0;
    metrics.blockedByLockCount = 0;
    metrics.deferCount = 0;
    metrics.executionTimes = [];
    metrics.lastReset = now;
  }
}, 60000); // Run every minute
