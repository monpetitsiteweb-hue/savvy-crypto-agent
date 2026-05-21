/**
 * useLiveSellTrades
 *
 * Fetches LIVE (REAL mode) SELL trades from mock_trades, applying the same
 * canonical accounting gates used by PerformanceOverview.fetchLocalMetrics,
 * then intersects with useAccountedMockTradeIds as a defensive double-gate.
 *
 * NEVER joins the parent BUY — see LiveSellTradeCard.tsx for rationale.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useMockTradesRealtime } from '@/contexts/MockTradesRealtimeContext';
import { useAccountedMockTradeIds } from '@/hooks/useAccountedMockTradeIds';

export interface LiveSellTrade {
  id: string;
  user_id: string;
  cryptocurrency: string;
  trade_type: string;
  amount: number;
  price: number;
  total_value: number;
  executed_at: string;
  notes: string | null;
  original_trade_id: string | null;
  original_purchase_amount: number | null;
  original_purchase_value: number | null;
  exit_value: number | null;
  realized_pnl: number | null;
  realized_pnl_pct: number | null;
  is_test_mode: boolean;
  is_corrupted: boolean;
  is_archived: boolean;
  execution_confirmed: boolean;
  settlement_status: string;
}

interface Result {
  trades: LiveSellTrade[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useLiveSellTrades(): Result {
  const { user } = useAuth();
  const [raw, setRaw] = useState<LiveSellTrade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Defensive double-gate: intersect with canonical accounted set.
  const { ids: accountedIds } = useAccountedMockTradeIds(false);

  const refetch = useCallback(async () => {
    if (!user) {
      setRaw([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await (supabase as any)
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_test_mode', false)
        .eq('trade_type', 'sell')
        .eq('is_corrupted', false)
        .eq('is_archived', false)
        .eq('execution_confirmed', true)
        .eq('settlement_status', 'SETTLED')
        .order('executed_at', { ascending: false });
      if (qErr) throw qErr;
      setRaw((data || []) as LiveSellTrade[]);
    } catch (err: any) {
      console.error('[useLiveSellTrades] error', err);
      setError(err?.message || 'Failed to load LIVE SELL trades');
      setRaw([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { refetch(); }, [refetch]);

  // Realtime: shared mock_trades channel — debounced refresh.
  useMockTradesRealtime('useLiveSellTrades', refetch, 500);

  const trades = useMemo(() => {
    if (accountedIds === null) return raw; // gate loading/error → show raw, parent gates UI
    return raw.filter(t => accountedIds.has(t.id));
  }, [raw, accountedIds]);

  return { trades, isLoading, error, refetch };
}
