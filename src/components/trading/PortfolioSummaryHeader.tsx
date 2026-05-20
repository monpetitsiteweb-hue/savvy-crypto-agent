/**
 * PortfolioSummaryHeader — 3-card portfolio header shared by TEST and REAL modes.
 *
 * Displays Trade Counts / Portfolio Value / Performance using identical structure
 * so the two modes look visually consistent.
 */
import { Card } from '@/components/ui/card';
import { TrendingUp, DollarSign, Fuel, AlertTriangle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { formatPnlWithSign } from '@/utils/portfolioMath';

export interface PortfolioSummaryData {
  // Trade counts
  openPositions: number;
  /** null while the accounted-SELL gate is loading; renders as "—". */
  closedSells: number | null;
  totalBuyTrades: number;
  // Portfolio value
  cashEur: number;
  openPositionsValueEur: number;
  gasSpentEur: number;
  totalPortfolioValueEur: number;
  // Performance
  unrealizedPnlEur: number;
  realizedPnlEur: number;
  totalPnlEur: number;
  totalPnlPct: number;
  // Quality flags
  hasMissingPrices?: boolean;
  missingSymbols?: string[];
  gasLabel?: string; // e.g. "Gas (est.)" or "Gas (on-chain)"
}

export function PortfolioSummaryHeader({ data }: { data: PortfolioSummaryData }) {
  const unrealPnl = formatPnlWithSign(data.unrealizedPnlEur);
  const realPnl = formatPnlWithSign(data.realizedPnlEur);
  const totalPnl = formatPnlWithSign(data.totalPnlEur);
  const gasLabel = data.gasLabel ?? 'Gas (est.)';

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Trade Counts */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-medium text-muted-foreground">Trade Counts</span>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Open Positions</span>
            <span className="text-lg font-bold">{data.openPositions}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Closed (SELL)</span>
            <span className="text-sm">{data.closedSells ?? '—'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Total BUY Trades</span>
            <span className="text-sm">{data.totalBuyTrades}</span>
          </div>
        </div>
      </Card>

      {/* Portfolio Value */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="w-4 h-4 text-yellow-500" />
          <span className="text-sm font-medium text-muted-foreground">Portfolio Value</span>
          {data.hasMissingPrices && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger><AlertTriangle className="h-3 w-3 text-amber-400" /></TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Partial: missing price for {(data.missingSymbols || []).join(', ')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Cash</span>
            <span className="text-sm">{formatEuro(data.cashEur)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Open Positions</span>
            <span className="text-sm">{formatEuro(data.openPositionsValueEur)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Fuel className="h-3 w-3" /> {gasLabel}
            </span>
            <span className="text-sm text-amber-400">−{formatEuro(data.gasSpentEur)}</span>
          </div>
          <div className="flex justify-between items-center border-t pt-2">
            <span className="text-xs text-muted-foreground font-medium">Total Value</span>
            <span className="text-lg font-bold">{formatEuro(data.totalPortfolioValueEur)}</span>
          </div>
        </div>
      </Card>

      {/* Performance */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-green-500" />
          <span className="text-sm font-medium text-muted-foreground">Performance</span>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Unrealized P&L</span>
            <span className={`text-lg font-bold ${unrealPnl.colorClass}`}>
              {unrealPnl.sign}{unrealPnl.value}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Realized P&L</span>
            <span className={`text-sm ${realPnl.colorClass}`}>
              {realPnl.sign}{realPnl.value}
            </span>
          </div>
          <div className="flex justify-between items-center border-t pt-2">
            <span className="text-xs text-muted-foreground font-medium">Total P&L</span>
            <span className={`text-sm font-semibold ${totalPnl.colorClass}`}>
              {totalPnl.sign}{totalPnl.value} ({formatPercentage(data.totalPnlPct)}) — {totalPnl.label}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
