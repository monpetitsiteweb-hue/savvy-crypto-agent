/**
 * LiveSellTradeCard — REAL-mode SELL card, visually aligned with TEST's
 * PastPositionCard (src/components/TradingHistory.tsx).
 *
 * INTENTIONAL DIVERGENCE FROM TEST: All purchase fields are read DIRECTLY
 * from the SELL row (original_purchase_amount / original_purchase_value),
 * NEVER from a parent BUY join. This is required to stay correct on the
 * 4 TASK_RECON_B16 Cat A parents whose `amount`/`price` were patched to a
 * dust convention. The B16-RECON badge surfaces the convention to the user.
 * DO NOT replace these reads with parent joins "for consistency with TEST".
 */
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ExternalLink } from 'lucide-react';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import type { LiveSellTrade } from '@/hooks/useLiveSellTrades';

// TASK_RECON_B16 Cat A parent BUY ids (user 3a05bf2d…, REAL mode).
const CAT_A_PARENT_IDS = new Set<string>([
  'd8b19f93-fd1d-4026-9437-b8657930b47c',
  '7e316154-fcef-4f2b-a085-bd4612a87268',
  'a15bff62-0d52-4e01-ad76-474da7844b30',
  '6bc1be80-0d49-410d-9ce8-01d081e3cf2a',
]);

const BASE_CHAIN_ID = 8453;
function baseScanUrl(txHash: string) {
  return `https://basescan.org/tx/${txHash}`;
}

interface Props {
  trade: LiveSellTrade;
  txHashLookup: Map<string, string>;
}

export function LiveSellTradeCard({ trade, txHashLookup }: Props) {
  const isLinked = !!trade.original_trade_id;
  const isCatA = !!trade.original_trade_id && CAT_A_PARENT_IDS.has(trade.original_trade_id);

  const amount = trade.original_purchase_amount ?? trade.amount ?? 0;
  const purchaseValue = trade.original_purchase_value ?? 0;
  const purchasePrice =
    trade.original_purchase_value && trade.original_purchase_amount
      ? trade.original_purchase_value / trade.original_purchase_amount
      : 0;
  const exitPrice = trade.price ?? 0;
  const exitValue = trade.exit_value ?? trade.total_value ?? 0;
  const pnlEur = trade.realized_pnl ?? 0;
  const pnlPct = trade.realized_pnl_pct ?? 0;

  const txHash = txHashLookup.get(trade.id);

  const noteText = trade.notes && trade.notes.length > 120
    ? `${trade.notes.slice(0, 120)}…`
    : trade.notes;

  return (
    <Card className="p-4 hover:shadow-md transition-shadow" data-testid="live-sell-card">
      {/* Badges row */}
      <div className="flex gap-2 mb-2 items-center">
        <Badge
          variant="outline"
          className={`text-xs ${
            isLinked
              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
              : 'bg-slate-500/10 text-slate-400 border-slate-500/30'
          }`}
        >
          {isLinked ? 'Linked SELL' : 'SELL'}
        </Badge>

        {isCatA && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="bg-amber-500/10 text-amber-700 border-amber-500/30 text-xs cursor-help"
                >
                  B16-RECON
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-sm">
                  Lot reconstructed via TASK_RECON_B16 (2026-05-15). Displayed
                  amount and purchase value reflect the DB SELL row, which carries
                  the dust-amount convention. Actual on-chain value of this lot
                  was ~€8.55. See PROJECT_LOG.md B19 Cat A.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {txHash && (
          <a
            href={baseScanUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline"
            title={`View on Basescan (chain ${BASE_CHAIN_ID})`}
          >
            <span className="font-mono">{txHash.slice(0, 8)}…{txHash.slice(-4)}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span className="font-semibold text-lg">{trade.cryptocurrency}</span>
        </div>
        <Badge variant="secondary">SELL</Badge>
      </div>

      {/* Body grid */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Amount</p>
          <p className="font-medium">{amount.toFixed(8)}</p>
        </div>

        <div>
          <p className="text-muted-foreground">Purchase Price</p>
          <p className="font-medium" data-testid="purchase-price">{formatEuro(purchasePrice)}</p>
        </div>

        <div>
          <p className="text-muted-foreground">Purchase Value</p>
          <p className="font-medium">{formatEuro(purchaseValue)}</p>
        </div>

        <div>
          <p className="text-muted-foreground">Exit Price</p>
          <p className="font-medium" data-testid="exit-price">{formatEuro(exitPrice)}</p>
        </div>

        <div>
          <p className="text-muted-foreground">Exit Value</p>
          <p className="font-medium">{formatEuro(exitValue)}</p>
        </div>

        <div>
          <p className="text-muted-foreground">Realized P&L</p>
          <p
            className={`font-medium ${
              pnlEur > 0 ? 'text-emerald-600' : pnlEur < -0.01 ? 'text-red-600' : ''
            }`}
            data-testid="realized-pnl"
          >
            {formatEuro(pnlEur)}{' '}
            <span className="text-xs">({formatPercentage(pnlPct)})</span>
          </p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
        <p>Executed: {new Date(trade.executed_at).toLocaleString()}</p>
        {noteText && <p className="mt-1">Note: {noteText}</p>}
      </div>
    </Card>
  );
}
