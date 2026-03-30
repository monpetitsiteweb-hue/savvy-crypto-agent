/**
 * useRealTradeHistory Hook
 * 
 * Fetches REAL on-chain trade history from real_trade_history_view.
 * 
 * NOTE: real_trades is NOT in the supabase_realtime publication and has 0 rows.
 * No Realtime subscription is needed. Uses polling every 60s as fallback.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { RealTradeHistoryRow } from '@/types/trading';

interface UseRealTradeHistoryResult {
  trades: RealTradeHistoryRow[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRealTradeHistory(): UseRealTradeHistoryResult {
  const { user } = useAuth();
  const [trades, setTrades] = useState<RealTradeHistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setTrades([]);
      setError('Not authenticated');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await (supabase
        .from('real_trade_history_view' as any)
        .select('*')
        .order('execution_recorded_at', { ascending: false })
        .limit(500) as any);

      if (queryError) {
        throw queryError;
      }

      const typedTrades: RealTradeHistoryRow[] = (data || []).map((row: any) => ({
        real_trade_id: row.real_trade_id,
        mock_trade_id: row.mock_trade_id,
        trade_id: row.real_trade_id,
        user_id: row.user_id,
        strategy_id: row.strategy_id,
        symbol: row.symbol,
        side: row.side,
        filled_quantity: row.filled_quantity,
        effective_price: row.effective_price,
        total_value: row.total_value,
        fees: row.fees,
        tx_hash: row.tx_hash,
        chain_id: row.chain_id,
        provider: row.provider,
        execution_status: row.execution_status,
        execution_target: row.execution_target,
        execution_authority: row.execution_authority,
        is_system_operator: row.is_system_operator,
        gas_used: row.gas_used,
        block_number: row.block_number,
        block_timestamp: row.block_timestamp,
        decode_method: row.decode_method,
        error_reason: row.error_reason,
        intent_ts: row.intent_ts,
        execution_recorded_at: row.execution_recorded_at,
      }));

      setTrades(typedTrades);
    } catch (err: any) {
      console.error('[useRealTradeHistory] Error:', err);
      setError(err.message || 'Failed to fetch real trade history');
      setTrades([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll every 60s (real_trades is not in Realtime publication)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => refresh(), 60_000);
    return () => clearInterval(interval);
  }, [user?.id, refresh]);

  return { trades, isLoading, error, refresh };
}
