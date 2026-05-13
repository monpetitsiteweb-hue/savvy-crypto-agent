// Trade-based model: Each BUY trade is one open position
// =========================================================================
// UNIFIED LEDGER: Dashboard works the same in Test and Live mode
// - Test mode: is_test_mode = true
// - Live mode: is_test_mode = false AND execution_confirmed = true
// =========================================================================
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTestMode } from '@/hooks/useTradeViewFilter';

export interface OpenTrade {
  id: string;
  cryptocurrency: string;
  amount: number;
  price: number;
  total_value: number;
  executed_at: string;
  strategy_id: string;
  fees: number;
  notes?: string;
}

interface UseOpenTradesResult {
  openTrades: OpenTrade[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOpenTrades(): UseOpenTradesResult {
  const [openTrades, setOpenTrades] = useState<OpenTrade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { testMode } = useTestMode();

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setOpenTrades([]);
        setError('Not authenticated');
        return;
      }

      // =====================================================================
      // Authoritative source: mock_trades.is_open_position (maintained by
      // settle_sell_trade_v2, partial-fill aware). Do NOT derive openness from
      // set-membership of original_trade_id — that drops BUYs with partial sells.
      // =====================================================================
      const buyQuery = (supabase
        .from('mock_trades')
        .select('id, cryptocurrency, amount, price, total_value, executed_at, strategy_id, fees, notes') as any)
        .eq('user_id', user.id)
        .eq('trade_type', 'buy')
        .eq('is_test_mode', testMode)
        .eq('is_corrupted', false)
        .eq('is_archived', false)
        .eq('is_open_position', true);

      // Live mode: only show confirmed on-chain trades
      const finalBuyQuery = testMode
        ? buyQuery
        : buyQuery.eq('execution_confirmed', true);

      const { data: buyTrades, error: buyError } = await finalBuyQuery.order('executed_at', { ascending: false });

      if (buyError) throw buyError;

      const open = ((buyTrades || []) as any[])
        .map(trade => ({
          id: trade.id,
          cryptocurrency: trade.cryptocurrency,
          amount: trade.amount,
          price: trade.price,
          total_value: trade.total_value,
          executed_at: trade.executed_at,
          strategy_id: trade.strategy_id,
          fees: trade.fees || 0,
          notes: trade.notes ?? undefined
        }));

      setOpenTrades(open);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch open trades';
      setError(message);
      setOpenTrades([]);
    } finally {
      setIsLoading(false);
    }
  }, [testMode]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { openTrades, isLoading, error, refresh };
}
