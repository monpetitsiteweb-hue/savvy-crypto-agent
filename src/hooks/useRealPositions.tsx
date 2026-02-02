/**
 * useRealPositions Hook
 * 
 * Fetches REAL on-chain positions from real_positions_view.
 * This is the REAL equivalent of open trades/positions.
 * 
 * IMPORTANT: REAL positions show QUANTITY ONLY.
 * - NO P&L
 * - NO average price
 * - NO performance metrics
 * 
 * These remain TEST-only until proper FIFO matching logic is implemented.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
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
      // Query real_positions_view directly
      const { data, error: queryError } = await (supabase
        .from('real_positions_view' as any)
        .select('*')
        .order('last_trade_at', { ascending: false }) as any);

      if (queryError) {
        throw queryError;
      }

      // Map the response to typed rows
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

  // Subscribe to real_trades changes for live updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('real_positions_changes')
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

  return { positions, isLoading, error, refresh };
}
