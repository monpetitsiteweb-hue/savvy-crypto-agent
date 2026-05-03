/**
 * useRealGasSpent — Sums gas spent (in EUR) across REAL trades.
 *
 * Source: real_trades.raw_receipt (effectiveGasPrice in wei hex) × gas_used.
 * Converts wei → ETH → EUR using current ETH-EUR price from MarketDataContext.
 *
 * Includes BOTH CONFIRMED and REVERTED trades (reverts still consume gas).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useMarketData } from '@/contexts/MarketDataContext';

interface UseRealGasSpentResult {
  gasSpentEur: number;
  gasSpentEth: number;
  txCount: number;
  isLoading: boolean;
}

export function useRealGasSpent(): UseRealGasSpentResult {
  const { user } = useAuth();
  const { marketData } = useMarketData();
  const [weiTotal, setWeiTotal] = useState<bigint>(0n);
  const [txCount, setTxCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const { data, error } = await (supabase
          .from('real_trades' as any)
          .select('gas_used, raw_receipt, execution_status') as any)
          .in('execution_status', ['CONFIRMED', 'REVERTED']);
        if (error) throw error;
        let total = 0n;
        let count = 0;
        for (const row of (data || []) as any[]) {
          const gasUsed = row.gas_used ? BigInt(Math.trunc(Number(row.gas_used))) : 0n;
          const egpHex = row.raw_receipt?.effectiveGasPrice;
          if (!gasUsed || !egpHex) continue;
          try {
            const egp = typeof egpHex === 'string' && egpHex.startsWith('0x')
              ? BigInt(egpHex)
              : BigInt(egpHex);
            total += gasUsed * egp;
            count += 1;
          } catch {
            // skip malformed
          }
        }
        if (!cancelled) {
          setWeiTotal(total);
          setTxCount(count);
        }
      } catch (err) {
        console.error('[useRealGasSpent] error', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const ethPrice = marketData['ETH-EUR']?.price ?? marketData['ETH']?.price ?? null;
  const gasSpentEth = Number(weiTotal) / 1e18;
  const gasSpentEur = ethPrice ? gasSpentEth * ethPrice : 0;

  return { gasSpentEur, gasSpentEth, txCount, isLoading };
}
