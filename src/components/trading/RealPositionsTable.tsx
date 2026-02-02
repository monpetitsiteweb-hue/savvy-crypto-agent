/**
 * RealPositionsTable - Table component for displaying REAL on-chain positions
 * 
 * This is a REUSABLE component that displays real_positions_view data.
 * Shows: symbol, quantity ONLY
 * 
 * NO P&L.
 * NO average price.
 * NO performance stats.
 * 
 * These metrics remain TEST-only until proper FIFO matching logic is implemented.
 */
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2 } from 'lucide-react';
import type { RealPositionRow } from '@/types/trading';

interface RealPositionsTableProps {
  positions: RealPositionRow[];
  isLoading: boolean;
  onRefresh?: () => void;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function RealPositionsTable({
  positions,
  isLoading,
  onRefresh,
}: RealPositionsTableProps) {
  if (isLoading) {
    return (
      <Card className="p-6 bg-slate-800/80 border-slate-700">
        <div className="flex items-center justify-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading positions...</span>
        </div>
      </Card>
    );
  }

  if (positions.length === 0) {
    return (
      <Card className="p-6 bg-slate-800/80 border-slate-700">
        <div className="text-center text-slate-400">
          <p>No open positions.</p>
          <p className="text-sm mt-1">Execute a real BUY trade to see positions here.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-800/80 border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-white">REAL Positions</h3>
          <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            On-Chain
          </Badge>
        </div>
        {onRefresh && (
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Info banner: Quantity only */}
      <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20">
        <p className="text-xs text-amber-400">
          <strong>Note:</strong> REAL mode shows quantity only. P&L and performance stats are TEST-only.
        </p>
      </div>

      {/* Positions list */}
      <div className="divide-y divide-slate-700">
        {positions.map((position) => (
          <div key={`${position.symbol}-${position.chain_id}`} className="p-4 hover:bg-slate-700/30">
            <div className="flex items-center justify-between">
              {/* Left: Symbol */}
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-sm font-bold text-white">
                  {position.symbol.slice(0, 2)}
                </div>
                <div>
                  <span className="font-semibold text-white">{position.symbol}</span>
                  <p className="text-xs text-slate-500">Chain: {position.chain_id}</p>
                </div>
              </div>

              {/* Right: Quantity */}
              <div className="text-right">
                <p className="text-lg font-bold text-white">
                  {position.position_size.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                </p>
                <p className="text-xs text-slate-500">
                  Last trade: {formatTimestamp(position.last_trade_at)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
