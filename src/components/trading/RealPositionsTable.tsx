/**
 * RealPositionsTable - REAL on-chain positions with full P&L (parity with TEST mode).
 *
 * Source of truth:
 *  - Quantity per asset: SUM(filled_quantity) over CONFIRMED BUYs in real_trade_history_view.
 *    NB: rows where decode_method = 'manual_backfill' already store filled_quantity in
 *    asset units (ETH); other rows are decoded from on-chain transfer logs and also
 *    expose a true asset-quantity in filled_quantity. No notional→qty conversion needed
 *    at this layer.
 *  - Purchase Value (EUR): SUM(mock_trades.total_value) joined on real_trades.trade_id.
 *    We deliberately use mock_trades.total_value (Option B FX-consistent EUR) and NOT
 *    real_trades.total_value (legacy/inconsistent unit).
 *  - Live price: useHoldingsPrices → price-proxy (same as TEST mode).
 */
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useHoldingsPrices } from '@/hooks/useHoldingsPrices';
import type { OpenTrade } from '@/hooks/useOpenTrades';
import type { RealPositionRow } from '@/types/trading';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';

interface RealPositionsTableProps {
  positions: RealPositionRow[];
  isLoading: boolean;
  onRefresh?: () => void;
}

interface EnrichedPosition {
  symbol: string;
  chain_id: number;
  qty: number;            // sum of filled_quantity (asset units)
  costBasisEur: number;   // sum of mock_trades.total_value (EUR)
  avgPriceEur: number;    // costBasis / qty
  last_trade_at: string;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

export function RealPositionsTable({ positions, isLoading, onRefresh }: RealPositionsTableProps) {
  const [enriched, setEnriched] = useState<EnrichedPosition[]>([]);
  const [enriching, setEnriching] = useState(false);

  // Qty comes from real_positions_view (single source of truth, already converted).
  // Cost basis (EUR) comes from mock_trades.total_value joined via real_trades.trade_id
  // for CONFIRMED BUYs only.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (positions.length === 0) { setEnriched([]); return; }
      setEnriching(true);
      try {
        // Pull CONFIRMED BUYs to know which mock_trade_ids contribute to cost basis
        const { data: rows, error } = await (supabase
          .from('real_trade_history_view' as any)
          .select('symbol, chain_id, mock_trade_id')
          .eq('side', 'BUY')
          .eq('execution_status', 'CONFIRMED') as any);
        if (error) throw error;

        const tradeIds: string[] = (rows || [])
          .map((r: any) => r.mock_trade_id)
          .filter((x: any) => !!x);

        let mockMap = new Map<string, number>();
        if (tradeIds.length > 0) {
          const { data: mocks, error: mErr } = await supabase
            .from('mock_trades')
            .select('id,total_value')
            .in('id', tradeIds);
          if (mErr) throw mErr;
          mockMap = new Map((mocks || []).map((m: any) => [m.id, Number(m.total_value || 0)]));
        }

        // Cost basis per (symbol, chain_id)
        const costByKey = new Map<string, number>();
        for (const r of rows || []) {
          const key = `${r.symbol}-${r.chain_id}`;
          const add = mockMap.get(r.mock_trade_id) ?? 0;
          costByKey.set(key, (costByKey.get(key) || 0) + add);
        }

        // Build enriched list directly from positions (qty = position_size from view)
        const out: EnrichedPosition[] = positions.map((p) => {
          const key = `${p.symbol}-${p.chain_id}`;
          const qty = Number(p.position_size || 0);
          const costBasisEur = costByKey.get(key) || 0;
          return {
            symbol: p.symbol,
            chain_id: p.chain_id,
            qty,
            costBasisEur,
            avgPriceEur: qty > 0 ? costBasisEur / qty : 0,
            last_trade_at: p.last_trade_at,
          };
        }).filter(e => e.qty > 0);

        if (!cancelled) setEnriched(out);
      } catch (e) {
        console.error('[RealPositionsTable] enrichment error:', e);
        if (!cancelled) setEnriched([]);
      } finally {
        if (!cancelled) setEnriching(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [positions]);

  // Synthetic OpenTrade[] to drive useHoldingsPrices (price-proxy, same as TEST)
  const syntheticOpenTrades: OpenTrade[] = useMemo(
    () => enriched.map(e => ({
      id: `${e.symbol}-${e.chain_id}`,
      cryptocurrency: e.symbol,
      amount: e.qty,
      price: e.avgPriceEur,
      total_value: e.costBasisEur,
      executed_at: e.last_trade_at,
      strategy_id: '',
      fees: 0,
    })),
    [enriched]
  );
  const { holdingsPrices, isLoadingPrices } = useHoldingsPrices(syntheticOpenTrades);

  const resolvePrice = (symbol: string): number | null => {
    const base = toBaseSymbol(symbol);
    const pair = toPairSymbol(base);
    const p = holdingsPrices[pair]?.price ?? holdingsPrices[base]?.price;
    return typeof p === 'number' && p > 0 ? p : null;
  };

  if (isLoading || enriching) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading positions...</span>
        </div>
      </Card>
    );
  }

  if (enriched.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <p>No open positions.</p>
          <p className="text-sm mt-1">Execute a real BUY trade to see positions here.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Positions</h3>
          <Badge variant="outline" className="text-xs">REAL</Badge>
        </div>
        {onRefresh && (
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="divide-y">
        {enriched.map((p) => {
          const livePrice = resolvePrice(p.symbol);
          const currentValue = livePrice !== null ? p.qty * livePrice : null;
          const unrealized = currentValue !== null ? currentValue - p.costBasisEur : null;
          const unrealizedPct = unrealized !== null && p.costBasisEur > 0
            ? (unrealized / p.costBasisEur) * 100
            : null;
          const isProfit = unrealized !== null && unrealized > 0;
          const isLoss = unrealized !== null && unrealized < 0;

          return (
            <div key={`${p.symbol}-${p.chain_id}`} className="p-4 hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
                    {p.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <span className="font-semibold">{p.symbol}</span>
                    <p className="text-xs text-muted-foreground">Chain: {p.chain_id}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">
                    {p.qty.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last trade: {formatTimestamp(p.last_trade_at)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Purchase Price</p>
                  <p className="font-medium">{formatEuro(p.avgPriceEur)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Purchase Value</p>
                  <p className="font-medium">{formatEuro(p.costBasisEur)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Current Price</p>
                  <p className="font-medium">
                    {isLoadingPrices && livePrice === null
                      ? '…'
                      : livePrice !== null ? formatEuro(livePrice) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Current Value</p>
                  <p className="font-medium">
                    {currentValue !== null ? formatEuro(currentValue) : '—'}
                  </p>
                </div>
              </div>

              {unrealized !== null && (
                <div className={`mt-2 text-sm flex justify-between items-center ${
                  isProfit ? 'text-emerald-500' : isLoss ? 'text-red-500' : 'text-muted-foreground'
                }`}>
                  <span className="text-xs">Unrealized P&L</span>
                  <span className="font-semibold">
                    {unrealized >= 0 ? '+' : ''}{formatEuro(unrealized)}
                    {unrealizedPct !== null &&
                      ` (${unrealizedPct >= 0 ? '+' : ''}${formatPercentage(unrealizedPct)})`}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
