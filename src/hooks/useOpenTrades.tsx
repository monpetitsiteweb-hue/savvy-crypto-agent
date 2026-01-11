// Trade-based model: Each BUY trade is one open position
// No lot/remaining_amount semantics - pure trade-based view
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

// Get all BUY trades that have NOT been closed by a SELL (via original_trade_id linkage)
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

      // Get all BUY trades
      const { data: buyTrades, error: buyError } = await supabase
        .from('mock_trades')
        .select('id, cryptocurrency, amount, price, total_value, executed_at, strategy_id, fees, notes')
        .eq('user_id', user.id)
        .eq('trade_type', 'buy')
        .eq('is_test_mode', testMode)
        .eq('is_corrupted', false)
        .order('executed_at', { ascending: false });

      if (buyError) throw buyError;

      // Get all SELL trades with original_trade_id (to find closed positions)
      const { data: sellTrades, error: sellError } = await supabase
        .from('mock_trades')
        .select('original_trade_id')
        .eq('user_id', user.id)
        .eq('trade_type', 'sell')
        .eq('is_test_mode', testMode)
        .eq('is_corrupted', false)
        .not('original_trade_id', 'is', null) as { data: { original_trade_id: string | null }[] | null; error: any };

      if (sellError) throw sellError;

      // Create a set of closed trade IDs
      const closedTradeIds = new Set(sellTrades?.map(s => s.original_trade_id) || []);

      // Filter to only open trades (BUYs without a matching SELL)
      const open = (buyTrades || [])
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
          notes: trade.notes
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
