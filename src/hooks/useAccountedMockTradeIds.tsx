/**
 * useAccountedMockTradeIds
 *
 * Returns the set of SELL mock_trade ids that pass the accounting gates used
 * by PerformanceOverview.fetchLocalMetrics. This is the canonical "accounted"
 * SELL population used for REAL-mode trade counts and aggregates.
 *
 * Mirror of PerformanceOverview.fetchLocalMetrics (strict):
 *   trade_type = 'sell'
 *   AND is_test_mode = isTestMode
 *   AND is_corrupted = false
 *   AND is_archived = false
 *   AND execution_confirmed = true
 *   AND settlement_status = 'SETTLED'
 *   AND (REAL mode only) id IN (
 *         SELECT trade_id FROM real_trades
 *         WHERE execution_status='CONFIRMED' AND trade_role='ENGINE_TRADE'
 *       )
 *
 * In TEST mode the real_trades intersect is bypassed (same as Performance).
 *
 * NOTE: This gate is SELL-scoped. Do NOT apply it to BUY counts — BUY semantics
 * are not specified in fetchLocalMetrics. Callers must only filter SELL rows.
 */
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface Result {
  /** Set of accounted SELL mock_trade ids, or null while loading / on error. */
  ids: Set<string> | null;
  isLoading: boolean;
  /** True when the last fetch failed; consumers should fall back gracefully. */
  hasError: boolean;
  refresh: () => Promise<void>;
}

export function useAccountedMockTradeIds(isTestMode: boolean): Result {
  const { user } = useAuth();
  const [ids, setIds] = useState<Set<string> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setIds(new Set());
      setIsLoading(false);
      setHasError(false);
      return;
    }
    setIsLoading(true);
    setHasError(false);
    try {
      // REAL mode: build the set of mock_trade ids backed by a CONFIRMED
      // on-chain ENGINE_TRADE. In TEST mode this gate is bypassed.
      let realConfirmedIds: Set<string> | null = null;
      if (!isTestMode) {
        const { data: confirmedReal, error: rErr } = await (supabase as any)
          .from('real_trades')
          .select('trade_id')
          .eq('user_id', user.id)
          .eq('execution_status', 'CONFIRMED')
          .eq('trade_role', 'ENGINE_TRADE');
        if (rErr) throw rErr;
        realConfirmedIds = new Set((confirmedReal || []).map((r: any) => r.trade_id));
      }

      const { data, error } = await (supabase as any)
        .from('mock_trades')
        .select('id')
        .eq('user_id', user.id)
        .eq('trade_type', 'sell')
        .eq('is_test_mode', isTestMode)
        .eq('is_corrupted', false)
        .eq('is_archived', false)
        .eq('execution_confirmed', true)
        .eq('settlement_status', 'SETTLED');
      if (error) throw error;

      const filtered = (data || []).filter((r: any) =>
        realConfirmedIds === null ? true : realConfirmedIds.has(r.id)
      );
      setIds(new Set(filtered.map((r: any) => r.id)));
    } catch (err) {
      console.error('[useAccountedMockTradeIds] error', err);
      // GUARDRAIL: never fabricate. Leave ids=null so callers can fall back to
      // the unfiltered population with a stale/error indicator.
      setIds(null);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, isTestMode]);

  useEffect(() => { refresh(); }, [refresh]);

  return { ids, isLoading, hasError, refresh };
}
