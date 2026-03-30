/**
 * useRealPositions Hook
 * 
 * Fetches REAL on-chain positions from real_positions_view.
 * Uses shared RealTradesRealtimeContext instead of per-component channel.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRealTradesRealtime } from '@/contexts/RealTradesRealtimeContext';
import type { RealPositionRow } from '@/types/trading';

interface UseRealPositionsResult {
  positions: RealPositionRow[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRealPositions(): UseRealPositionsResult {
  const { user } = useAuth();
  const [positions, setPositions] = useState<RealPositionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setPositions([]);
      setError('Not authenticated');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await (supabase
        .from('real_positions_view' as any)
        .select('*')
        .order('last_trade_at', { ascending: false }) as any);

      if (queryError) {
        throw queryError;
      }

      const typedPositions: RealPositionRow[] = (data || []).map((row: any) => ({
        user_id: row.user_id,
        strategy_id: row.strategy_id,
        symbol: row.symbol,
        chain_id: row.chain_id,
        position_size: row.position_size,
        last_trade_at: row.last_trade_at,
      }));

      setPositions(typedPositions);
    } catch (err: any) {
      console.error('[useRealPositions] Error:', err);
      setError(err.message || 'Failed to fetch real positions');
      setPositions([]);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Use shared realtime subscription instead of per-component channel
  useRealTradesRealtime('useRealPositions', () => {
    refresh();
  });

  return { positions, isLoading, error, refresh };
}
