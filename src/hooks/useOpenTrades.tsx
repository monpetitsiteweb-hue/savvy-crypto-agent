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
      // Fetch BUY trades - unified query for both Test and Live mode
      // Live mode adds execution_confirmed = true filter
      // Cast to any to avoid TS2589 deep instantiation error
      // =====================================================================
      const buyQuery = (supabase
        .from('mock_trades')
        .select('id, cryptocurrency, amount, price, total_value, executed_at, strategy_id, fees, notes') as any)
        .eq('user_id', user.id)
        .eq('trade_type', 'buy')
        .eq('is_test_mode', testMode)
        .eq('is_corrupted', false);

      // Live mode: only show confirmed real trades
      const finalBuyQuery = testMode
        ? buyQuery
        : buyQuery.eq('execution_confirmed', true);

      const { data: buyTrades, error: buyError } = await finalBuyQuery.order('executed_at', { ascending: false });

      if (buyError) throw buyError;

      // =====================================================================
      // Fetch SELL trades to find closed positions
      // =====================================================================
      const sellQuery = (supabase
        .from('mock_trades')
        .select('original_trade_id') as any)
        .eq('user_id', user.id)
        .eq('trade_type', 'sell')
        .eq('is_test_mode', testMode)
        .eq('is_corrupted', false)
        .not('original_trade_id', 'is', null);

      // Live mode: only count confirmed sells
      const finalSellQuery = testMode
        ? sellQuery
        : sellQuery.eq('execution_confirmed', true);

      const { data: sellTrades, error: sellError } = await finalSellQuery;

      if (sellError) throw sellError;

      // Create a set of closed trade IDs
      const closedTradeIds = new Set(
        ((sellTrades || []) as { original_trade_id: string }[]).map(s => s.original_trade_id)
      );

      // Filter to only open trades (BUYs without a matching SELL)
      const open = ((buyTrades || []) as any[])
        .filter(trade => !closedTradeIds.has(trade.id))
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
