/**
 * RealTradeHistoryTable - Table component for displaying REAL on-chain trade history
 * 
 * This is a REUSABLE component that displays real_trade_history_view data.
 * Shows: status (CONFIRMED/REVERTED), tx_hash (clickable), intent_ts vs execution_recorded_at
 * 
 * NO P&L calculations.
 * NO performance stats.
 */
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink, RefreshCw, Loader2 } from 'lucide-react';
import type { RealTradeHistoryRow } from '@/types/trading';
import { formatEuro } from '@/utils/currencyFormatter';

interface RealTradeHistoryTableProps {
  trades: RealTradeHistoryRow[];
  isLoading: boolean;
  onRefresh?: () => void;
  isSystemOperator?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REVERTED: 'bg-red-500/20 text-red-400 border-red-500/30',
  SUBMITTED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  MINED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  DROPPED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

const SIDE_COLORS: Record<string, string> = {
  BUY: 'bg-emerald-500/20 text-emerald-400',
  SELL: 'bg-red-500/20 text-red-400',
};

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function getBaseScanUrl(txHash: string, chainId: number): string {
  // Base mainnet = 8453
  if (chainId === 8453) {
    return `https://basescan.org/tx/${txHash}`;
  }
  // Base Sepolia testnet = 84532
  if (chainId === 84532) {
    return `https://sepolia.basescan.org/tx/${txHash}`;
  }
  // Default to Base mainnet
  return `https://basescan.org/tx/${txHash}`;
}

export function RealTradeHistoryTable({
  trades,
  isLoading,
  onRefresh,
  isSystemOperator = false,
}: RealTradeHistoryTableProps) {
  if (isLoading) {
    return (
      <Card className="p-6 bg-slate-800/80 border-slate-700">
        <div className="flex items-center justify-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading trade history...</span>
        </div>
      </Card>
    );
  }

  if (trades.length === 0) {
    return (
      <Card className="p-6 bg-slate-800/80 border-slate-700">
        <div className="text-center text-slate-400">
          <p>No real trades found.</p>
          <p className="text-sm mt-1">Execute a real trade to see it here.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-800/80 border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-white">
            {isSystemOperator ? 'System Trading Wallet' : 'REAL (on-chain)'}
          </h3>
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

      {/* Trade list */}
      <div className="divide-y divide-slate-700 max-h-[500px] overflow-y-auto">
        {trades.map((trade) => (
          <div key={trade.real_trade_id} className="p-4 hover:bg-slate-700/30">
            <div className="flex items-start justify-between gap-4">
              {/* Left: Symbol, Side, Quantity */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-white">{trade.symbol}</span>
                  <Badge className={SIDE_COLORS[trade.side] || 'bg-slate-500/20'}>
                    {trade.side}
                  </Badge>
                  <Badge variant="outline" className={STATUS_COLORS[trade.execution_status] || STATUS_COLORS.SUBMITTED}>
                    {trade.execution_status}
                  </Badge>
                </div>
                <div className="text-sm text-slate-400 space-y-0.5">
                  <p>Qty: {trade.filled_quantity.toFixed(8)}</p>
                  <p>Price: {formatEuro(trade.effective_price)}</p>
                  {trade.total_value && <p>Value: {formatEuro(trade.total_value)}</p>}
                </div>
              </div>

              {/* Right: Timestamps and TX Hash */}
              <div className="text-right text-xs text-slate-500 space-y-1">
                <p>Intent: {formatTimestamp(trade.intent_ts)}</p>
                <p>Executed: {formatTimestamp(trade.execution_recorded_at)}</p>
                <a
                  href={getBaseScanUrl(trade.tx_hash, trade.chain_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 hover:underline"
                >
                  <span className="font-mono">{trade.tx_hash.slice(0, 10)}...{trade.tx_hash.slice(-6)}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
