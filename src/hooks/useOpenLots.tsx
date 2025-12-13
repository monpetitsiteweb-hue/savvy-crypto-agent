import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface OpenLot {
  buy_trade_id: string;
  cryptocurrency: string;
  remaining_amount: number;
  buy_price: number;
  buy_total_value: number;
  executed_at: string;
  strategy_id: string;
  buy_fee: number;
}

interface UseOpenLotsResult {
  openLots: OpenLot[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOpenLots(): UseOpenLotsResult {
  const [openLots, setOpenLots] = useState<OpenLot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setOpenLots([]);
        setError('Not authenticated');
        return;
      }

      // Use raw SQL via rpc since get_open_lots is newly created and not in generated types
      const { data, error: rpcError } = await supabase
        .rpc('get_open_lots' as any, { p_user_id: user.id });

      if (rpcError) {
        throw rpcError;
      }

      setOpenLots((data as OpenLot[]) || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch open lots';
      setError(message);
      setOpenLots([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { openLots, isLoading, error, refresh };
}
