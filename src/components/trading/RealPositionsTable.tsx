/**
 * RealPositionsTable - REAL on-chain open positions, ONE ROW PER TRADE.
 *
 * Behavioral parity with TEST mode (TradingHistory → OpenTradeCard):
 *  - Source: useOpenTrades() (mock_trades BUY where execution_confirmed=true,
 *    minus BUYs whose id is referenced by a confirmed SELL via original_trade_id).
 *  - Rendering: one <OpenTradeCard> per individual BUY trade. NO aggregation.
 *  - Live price: useHoldingsPrices (price-proxy), same as TEST mode.
 *
 * The `positions` prop is accepted for backward compatibility with parents but
 * is intentionally ignored — the trade-level model is the single source of truth.
 */
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useOpenTrades } from '@/hooks/useOpenTrades';
import { useHoldingsPrices } from '@/hooks/useHoldingsPrices';
import { useTradesGas } from '@/hooks/useTradesGas';
import { OpenTradeCard } from '@/components/trading/OpenTradeCard';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import type { RealPositionRow } from '@/types/trading';

interface RealPositionsTableProps {
  positions?: RealPositionRow[]; // unused (kept for compat)
  isLoading?: boolean;           // unused (kept for compat)
  onRefresh?: () => void;
}

export function RealPositionsTable({ onRefresh }: RealPositionsTableProps) {
  const { openTrades, isLoading, refresh } = useOpenTrades();
  const { holdingsPrices, isLoadingPrices } = useHoldingsPrices(openTrades);
  const { gasByTradeId } = useTradesGas(openTrades.map(t => t.id));

  const resolvePrice = (symbol: string): number | null => {
    const base = toBaseSymbol(symbol);
    const pair = toPairSymbol(base);
    const p = holdingsPrices[pair]?.price ?? holdingsPrices[base]?.price;
    return typeof p === 'number' && p > 0 ? p : null;
  };

  const handleRefresh = () => {
    refresh();
    onRefresh?.();
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading positions...</span>
        </div>
      </Card>
    );
  }

  if (openTrades.length === 0) {
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
          <h3 className="font-semibold">Open Positions</h3>
          <Badge variant="outline" className="text-xs">REAL</Badge>
          <span className="text-xs text-muted-foreground">
            {openTrades.length} trade{openTrades.length > 1 ? 's' : ''}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {openTrades.map((trade) => (
          <OpenTradeCard
            key={trade.id}
            trade={trade}
            livePrice={resolvePrice(trade.cryptocurrency)}
            gasOverride={gasByTradeId[trade.id] ?? { gasEth: 0, gasEur: 0 }}
          />
        ))}
      </div>

      {isLoadingPrices && (
        <div className="px-4 pb-3 text-xs text-muted-foreground">
          Loading live prices…
        </div>
      )}
    </Card>
  );
}
