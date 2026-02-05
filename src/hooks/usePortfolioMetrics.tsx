import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { useTradingMode } from './useTradingMode';
import { supabase } from '@/integrations/supabase/client';

export interface PortfolioMetrics {
  success: boolean;
  reason?: string;
  queried_mode?: boolean; // Mode that was actually queried (for assertion)
  starting_capital_eur: number;
  cash_balance_eur: number;
  reserved_eur: number;
  available_eur: number;
  invested_cost_basis_eur: number;
  current_position_value_eur: number;
  unrealized_pnl_eur: number;
  realized_pnl_eur: number;
  total_pnl_eur: number;
  total_portfolio_value_eur: number;
  total_fees_eur: number;
  total_buy_fees_eur: number;
  total_sell_fees_eur: number;
}

/**
 * GUARDRAIL #2: Never fabricate money values
 * 
 * On RPC error, we do NOT fall back to zeros.
 * Instead, we set error state and let UI handle it explicitly.
 */
const EMPTY_METRICS: PortfolioMetrics = {
  success: false,
  reason: 'not_loaded',
  starting_capital_eur: 0,
  cash_balance_eur: 0,
  reserved_eur: 0,
  available_eur: 0,
  invested_cost_basis_eur: 0,
  current_position_value_eur: 0,
  unrealized_pnl_eur: 0,
  realized_pnl_eur: 0,
  total_pnl_eur: 0,
  total_portfolio_value_eur: 0,
  total_fees_eur: 0,
  total_buy_fees_eur: 0,
  total_sell_fees_eur: 0,
};

export function usePortfolioMetrics() {
  const { user } = useAuth();
  // GUARDRAIL #3: Single source of truth - use useTradingMode only
  const { isTestMode } = useTradingMode();
  const [metrics, setMetrics] = useState<PortfolioMetrics>(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // GUARDRAIL #2: Explicit RPC failure state (not just null error)
  const [rpcFailed, setRpcFailed] = useState(false);

  // Diagnostics + stale-response protection
  const callSeq = useRef(0);
  const lastGoodMetrics = useRef<PortfolioMetrics | null>(null);

  const fetchMetrics = useCallback(async () => {
    // =========================================================================
    // UNIFIED LEDGER: Dashboard works the same in Test and Live mode
    // The ONLY difference is the is_test_mode filter passed to the RPC
    // =========================================================================
    if (!user) {
      setMetrics(EMPTY_METRICS);
      setLoading(false);
      setRpcFailed(false);
      return;
    }

    const seq = ++callSeq.current;

    setLoading(true);
    setError(null);
    setRpcFailed(false);

    // FACT LOG (always): show exactly what we are sending
    console.info('[usePortfolioMetrics] calling get_portfolio_metrics', {
      seq,
      userId: user.id,
      p_is_test_mode: isTestMode,
    });

    try {
      // p_is_test_mode is REQUIRED (single deterministic contract)
      const { data, error: rpcError } = await supabase.rpc('get_portfolio_metrics' as any, {
        p_user_id: user.id,
        p_is_test_mode: isTestMode,
      });

      // FACT LOG (always): show raw response
      console.info('[usePortfolioMetrics] RPC result', {
        seq,
        data,
        rpcError,
      });

      if (rpcError) {
        throw rpcError;
      }

      // Ignore stale responses (if a newer call was started after this one)
      if (seq !== callSeq.current) {
        return;
      }

      if (data && typeof data === 'object') {
        const m = data as PortfolioMetrics;
        const next: PortfolioMetrics = {
          success: m.success ?? false,
          reason: m.reason,
          queried_mode: m.queried_mode,
          starting_capital_eur: m.starting_capital_eur ?? 0,
          cash_balance_eur: m.cash_balance_eur ?? 0,
          reserved_eur: m.reserved_eur ?? 0,
          available_eur: m.available_eur ?? 0,
          invested_cost_basis_eur: m.invested_cost_basis_eur ?? 0,
          current_position_value_eur: m.current_position_value_eur ?? 0,
          unrealized_pnl_eur: m.unrealized_pnl_eur ?? 0,
          realized_pnl_eur: m.realized_pnl_eur ?? 0,
          total_pnl_eur: m.total_pnl_eur ?? 0,
          total_portfolio_value_eur: m.total_portfolio_value_eur ?? 0,
          total_fees_eur: m.total_fees_eur ?? 0,
          total_buy_fees_eur: m.total_buy_fees_eur ?? 0,
          total_sell_fees_eur: m.total_sell_fees_eur ?? 0,
        };

        setMetrics(next);
        setRpcFailed(false);
        if (next.success === true) {
          lastGoodMetrics.current = next;
        }
      } else {
        // Invalid response structure - GUARDRAIL #2: Mark as failed, don't fabricate zeros
        console.error('[usePortfolioMetrics] Invalid response structure', { data });
        setRpcFailed(true);
        setError('Invalid response from server');
        // Keep last known good metrics for display but mark as stale
        if (lastGoodMetrics.current) {
          setMetrics({ ...lastGoodMetrics.current, reason: 'stale_data' });
        }
      }
    } catch (err: any) {
      console.error('[usePortfolioMetrics] Error', { seq, err });

      // Ignore stale failures (if a newer call was started after this one)
      if (seq !== callSeq.current) {
        return;
      }

      // GUARDRAIL #2: Set explicit error state, do NOT render zeros
      setRpcFailed(true);
      setError(err.message || 'Failed to fetch metrics');

      // Keep last known good metrics but mark as stale
      if (lastGoodMetrics.current) {
        setMetrics({ ...lastGoodMetrics.current, reason: 'stale_data' });
      }
      // If no prior good data, leave as EMPTY_METRICS with reason 'not_loaded'
    } finally {
      // Only clear loading for the latest call
      if (seq === callSeq.current) {
        setLoading(false);
      }
    }
  }, [user, isTestMode]);

  // Initial fetch and subscribe to mock_trades changes
  useEffect(() => {
    fetchMetrics();

    if (!user) return;

    const channel = supabase
      .channel('portfolio_metrics_trades')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mock_trades',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          // Debounce refresh
          setTimeout(() => fetchMetrics(), 500);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isTestMode, fetchMetrics]);

  // Computed values
  const isInitialized = metrics.success === true;

  // Since start gain (€ and %)
  const sinceStartGainEur = metrics.total_portfolio_value_eur - metrics.starting_capital_eur;
  const sinceStartGainPct = metrics.starting_capital_eur > 0
    ? (sinceStartGainEur / metrics.starting_capital_eur) * 100
    : 0;

  // P&L percentages (guard divide-by-zero)
  const unrealizedPnlPct = metrics.invested_cost_basis_eur > 0
    ? (metrics.unrealized_pnl_eur / metrics.invested_cost_basis_eur) * 100
    : 0;

  const realizedPnlPct = metrics.starting_capital_eur > 0
    ? (metrics.realized_pnl_eur / metrics.starting_capital_eur) * 100
    : 0;

  const totalPnlPct = metrics.starting_capital_eur > 0
    ? (metrics.total_pnl_eur / metrics.starting_capital_eur) * 100
    : 0;

  return {
    metrics,
    loading,
    error,
    // GUARDRAIL #2: Expose explicit RPC failure state
    rpcFailed,
    isInitialized,
    refresh: fetchMetrics,
    // Current mode for display context
    currentMode: isTestMode ? 'TEST' : 'REAL',
    // Computed values for easy consumption
    sinceStartGainEur,
    sinceStartGainPct,
    unrealizedPnlPct,
    realizedPnlPct,
    totalPnlPct,
  };
}
