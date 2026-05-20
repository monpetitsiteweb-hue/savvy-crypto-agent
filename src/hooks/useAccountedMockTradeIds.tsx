/**
 * useAccountedMockTradeIds
 *
 * Returns the set of mock_trade ids that pass the accounting gates used by
 * PerformanceOverview.fetchLocalMetrics. This is the canonical "accounted"
 * population for REAL-mode trade counts and aggregates.
 *
 * Filter (mirrors PerformanceOverview):
 *   is_corrupted = false
 *   AND is_archived = false
 *   AND settlement_status = 'SETTLED'
 *   AND execution_confirmed = true
 *
 * Used to align RealTradingHistory counts with Performance.
 */
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface Result {
  ids: Set<string> | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useAccountedMockTradeIds(isTestMode: boolean): Result {
  const { user } = useAuth();
  const [ids, setIds] = useState<Set<string> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setIds(new Set());
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('mock_trades')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_test_mode', isTestMode)
        .eq('is_corrupted', false)
        .eq('is_archived', false)
        .eq('execution_confirmed', true)
        .eq('settlement_status', 'SETTLED');
      if (error) throw error;
      setIds(new Set((data || []).map((r: any) => r.id)));
    } catch (err) {
      console.error('[useAccountedMockTradeIds] error', err);
      setIds(new Set());
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, isTestMode]);

  useEffect(() => { refresh(); }, [refresh]);

  return { ids, isLoading, refresh };
}
