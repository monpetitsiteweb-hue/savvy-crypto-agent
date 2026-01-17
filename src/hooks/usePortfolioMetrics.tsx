import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useTestMode } from './useTradeViewFilter';
import { supabase } from '@/integrations/supabase/client';

export interface PortfolioMetrics {
  success: boolean;
  reason?: string;
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
  const { testMode } = useTestMode();
  const [metrics, setMetrics] = useState<PortfolioMetrics>(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    // =========================================================================
    // UNIFIED LEDGER: Dashboard works the same in Test and Live mode
    // The ONLY difference is the is_test_mode filter passed to the RPC
    // =========================================================================
    if (!user) {
      setMetrics(EMPTY_METRICS);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Pass is_test_mode to RPC so it filters correctly for Test vs Live
      const { data, error: rpcError } = await supabase.rpc('get_portfolio_metrics' as any, {
        p_user_id: user.id,
        p_is_test_mode: testMode,
      });

      console.log('[usePortfolioMetrics] RPC result:', { data, error: rpcError });

      if (rpcError) {
        throw rpcError;
      }

      if (data && typeof data === 'object') {
        const m = data as PortfolioMetrics;
        setMetrics({
          success: m.success ?? false,
          reason: m.reason,
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
        });
      } else {
        setMetrics({ ...EMPTY_METRICS, reason: 'invalid_response' });
      }
    } catch (err: any) {
      console.error('[usePortfolioMetrics] Error:', err);
      setError(err.message || 'Failed to fetch metrics');
      setMetrics({ ...EMPTY_METRICS, reason: 'error' });
    } finally {
      setLoading(false);
    }
  }, [user, testMode]);

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
  }, [user, testMode, fetchMetrics]);

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
    isInitialized,
    refresh: fetchMetrics,
    // Computed values for easy consumption
    sinceStartGainEur,
    sinceStartGainPct,
    unrealizedPnlPct,
    realizedPnlPct,
    totalPnlPct,
  };
}
