/**
 * useRealTradeHistory Hook
 * 
 * Fetches REAL on-chain trade history from real_trade_history_view.
 * This is the REAL equivalent of mock_trades history.
 * 
 * NO client-side aggregation.
 * NO joins in frontend.
 * NO fallback logic.
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
      // Query real_trade_history_view directly
      // Ordered by execution_recorded_at DESC (most recent first)
      const { data, error: queryError } = await (supabase
        .from('real_trade_history_view' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('execution_recorded_at', { ascending: false })
        .limit(500) as any);

      if (queryError) {
        throw queryError;
      }

      // Map the response to typed rows
      const typedTrades: RealTradeHistoryRow[] = (data || []).map((row: any) => ({
        real_trade_id: row.real_trade_id,
        mock_trade_id: row.mock_trade_id,
        trade_id: row.real_trade_id, // alias
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
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to real_trades changes for live updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('real_trades_history_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'real_trades',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Debounce refresh
          setTimeout(() => refresh(), 500);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, refresh]);

  return { trades, isLoading, error, refresh };
}
