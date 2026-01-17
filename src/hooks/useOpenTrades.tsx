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

      // Use RPC or raw query to avoid TypeScript deep instantiation issues
      // For live mode, filter by execution_confirmed = true
      const baseFilter = {
        user_id: user.id,
        trade_type: 'buy',
        is_test_mode: testMode,
        is_corrupted: false,
      };

      const { data: buyTrades, error: buyError } = await (supabase
        .from('mock_trades')
        .select('id, cryptocurrency, amount, price, total_value, executed_at, strategy_id, fees, notes')
        .match(baseFilter)
        .order('executed_at', { ascending: false }) as unknown as Promise<{ data: any[] | null; error: any }>);

      if (buyError) throw buyError;

      // Filter for execution_confirmed in live mode (post-query since TS is unhappy)
      let filteredBuys = buyTrades || [];
      if (!testMode) {
        // Re-fetch with execution_confirmed filter for live mode
        const { data: liveBuys, error: liveErr } = await (supabase
          .from('mock_trades')
          .select('id, cryptocurrency, amount, price, total_value, executed_at, strategy_id, fees, notes')
          .eq('user_id', user.id)
          .eq('trade_type', 'buy')
          .eq('is_test_mode', false)
          .eq('is_corrupted', false)
          .eq('execution_confirmed', true)
          .order('executed_at', { ascending: false }) as unknown as Promise<{ data: any[] | null; error: any }>);
        if (liveErr) throw liveErr;
        filteredBuys = liveBuys || [];
      }

      // Get SELL trades for linkage
      const { data: sellTrades, error: sellError } = await (supabase
        .from('mock_trades')
        .select('original_trade_id')
        .eq('user_id', user.id)
        .eq('trade_type', 'sell')
        .eq('is_test_mode', testMode)
        .eq('is_corrupted', false)
        .not('original_trade_id', 'is', null) as unknown as Promise<{ data: { original_trade_id: string }[] | null; error: any }>);

      if (sellError) throw sellError;

      const closedTradeIds = new Set((sellTrades || []).map(s => s.original_trade_id));

      const open = filteredBuys
        .filter((trade: any) => !closedTradeIds.has(trade.id))
        .map((trade: any) => ({
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
