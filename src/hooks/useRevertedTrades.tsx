/**
 * useRevertedTrades — Lists REAL BUY trades that REVERTED on-chain.
 *
 * Source: real_trades WHERE execution_status='REVERTED' AND side='BUY'
 *   AND trade_role='ENGINE_TRADE'
 * Sorted by created_at DESC, default limit 50.
 *
 * Returns gas lost per trade (ETH + EUR) using raw_receipt.effectiveGasPrice.
 */
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useMarketData } from '@/contexts/MarketDataContext';

export interface RevertedTradeRow {
  id: string;
  cryptocurrency: string;
  side: 'BUY' | 'SELL';
  amount: number;
  price: number;
  tx_hash: string;
  chain_id: number;
  error_reason: string | null;
  created_at: string;
  gasEth: number;
  gasEur: number;
}

export function useRevertedTrades(limit = 50) {
  const { user } = useAuth();
  const { marketData } = useMarketData();
  const [rows, setRows] = useState<RevertedTradeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ethPrice = marketData['ETH-EUR']?.price ?? marketData['ETH']?.price ?? null;

  const refresh = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await (supabase
        .from('real_trades' as any)
        .select('id, cryptocurrency, side, amount, price, tx_hash, chain_id, error_reason, created_at, gas_used, raw_receipt, trade_role') as any)
        .eq('execution_status', 'REVERTED')
        .eq('side', 'BUY')
        .eq('trade_role', 'ENGINE_TRADE')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (qErr) throw qErr;

      const mapped: RevertedTradeRow[] = ((data || []) as any[]).map((r) => {
        let wei = 0n;
        const egpHex = r.raw_receipt?.effectiveGasPrice;
        if (r.gas_used != null && egpHex != null) {
          try {
            const gu = BigInt(Math.trunc(Number(r.gas_used)));
            const egp = typeof egpHex === 'string' ? BigInt(egpHex) : BigInt(Number(egpHex));
            wei = gu * egp;
          } catch (e) {
            console.warn('[useRevertedTrades] gas parse failed', r.id, e);
          }
        } else {
          console.warn('[useRevertedTrades] missing gas data', r.id);
        }
        const gasEth = Number(wei) / 1e18;
        return {
          id: r.id,
          cryptocurrency: r.cryptocurrency,
          side: r.side,
          amount: Number(r.amount || 0),
          price: Number(r.price || 0),
          tx_hash: r.tx_hash,
          chain_id: r.chain_id,
          error_reason: r.error_reason,
          created_at: r.created_at,
          gasEth,
          gasEur: ethPrice ? gasEth * ethPrice : 0,
        };
      });
      setRows(mapped);
    } catch (err: any) {
      console.error('[useRevertedTrades] error', err);
      setError(err?.message || 'Failed to load reverted trades');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, limit, ethPrice]);

  useEffect(() => { refresh(); }, [refresh]);

  const totalGasEur = rows.reduce((s, r) => s + r.gasEur, 0);
  const totalGasEth = rows.reduce((s, r) => s + r.gasEth, 0);

  return { rows, isLoading, error, refresh, totalGasEur, totalGasEth };
}
