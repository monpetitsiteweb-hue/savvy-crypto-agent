/**
 * useTradesGas — Per-trade on-chain gas (ETH + EUR) keyed by mock_trade_id.
 *
 * Source: real_trades (CONFIRMED) joined to mock_trades via real_trades.trade_id.
 * Wei = gas_used × raw_receipt.effectiveGasPrice. EUR via live ETH price.
 *
 * Fail-soft: missing gas_used / effectiveGasPrice → gasEth=0 + console.warn.
 * Never throws.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMarketData } from '@/contexts/MarketDataContext';

export interface TradeGas {
  gasEth: number;
  gasEur: number;
}

export function useTradesGas(mockTradeIds: string[]): {
  gasByTradeId: Record<string, TradeGas>;
  isLoading: boolean;
} {
  const { marketData } = useMarketData();
  const [gasMap, setGasMap] = useState<Record<string, { wei: bigint }>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Stable key to avoid loops
  const idsKey = mockTradeIds.slice().sort().join(',');

  useEffect(() => {
    if (mockTradeIds.length === 0) {
      setGasMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const { data, error } = await (supabase
          .from('real_trades' as any)
          .select('trade_id, gas_used, raw_receipt') as any)
          .in('trade_id', mockTradeIds)
          .eq('execution_status', 'CONFIRMED');
        if (error) throw error;
        const next: Record<string, { wei: bigint }> = {};
        for (const row of (data || []) as any[]) {
          const mockId = row.trade_id as string;
          const gasUsedRaw = row.gas_used;
          const egpHex = row.raw_receipt?.effectiveGasPrice;
          if (gasUsedRaw == null || egpHex == null) {
            console.warn('[useTradesGas] missing gas data for trade', mockId, {
              gas_used: gasUsedRaw,
              effectiveGasPrice: egpHex,
            });
            next[mockId] = { wei: 0n };
            continue;
          }
          try {
            const gasUsed = BigInt(Math.trunc(Number(gasUsedRaw)));
            const egp = typeof egpHex === 'string'
              ? BigInt(egpHex)
              : BigInt(Number(egpHex));
            next[mockId] = { wei: gasUsed * egp };
          } catch (e) {
            console.warn('[useTradesGas] failed to parse gas for trade', mockId, e);
            next[mockId] = { wei: 0n };
          }
        }
        if (!cancelled) setGasMap(next);
      } catch (err) {
        console.error('[useTradesGas] query error', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const ethPrice = marketData['ETH-EUR']?.price ?? marketData['ETH']?.price ?? null;
  const out: Record<string, TradeGas> = {};
  for (const [id, v] of Object.entries(gasMap)) {
    const gasEth = Number(v.wei) / 1e18;
    out[id] = { gasEth, gasEur: ethPrice ? gasEth * ethPrice : 0 };
  }
  return { gasByTradeId: out, isLoading };
}
