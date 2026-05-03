/**
 * RealTradingHistory - REAL mode version of TradingHistory
 *
 * Now uses the shared <PortfolioSummaryHeader> for visual parity with TEST mode.
 *
 * Sources (REAL mode):
 *  - Cash → portfolio_capital via get_portfolio_metrics(p_is_test_mode=false)
 *  - Open Positions value → useOpenTrades + useHoldingsPrices (live prices)
 *  - Gas → useRealGasSpent (sum of gas_used × effectiveGasPrice on CONFIRMED+REVERTED)
 *  - Realized P&L → metrics.realized_pnl_eur (= 0 until first real SELL CONFIRMED)
 */
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { useRealTradeHistory } from '@/hooks/useRealTradeHistory';
import { useRealPositions } from '@/hooks/useRealPositions';
import { useOpenTrades } from '@/hooks/useOpenTrades';
import { useHoldingsPrices } from '@/hooks/useHoldingsPrices';
import { useMarketData } from '@/contexts/MarketDataContext';
import { usePortfolioMetrics } from '@/hooks/usePortfolioMetrics';
import { useRealGasSpent } from '@/hooks/useRealGasSpent';
import { RealTradeHistoryTable } from '@/components/trading/RealTradeHistoryTable';
import { RealPositionsTable } from '@/components/trading/RealPositionsTable';
import { PortfolioSummaryHeader, type PortfolioSummaryData } from '@/components/trading/PortfolioSummaryHeader';
import { NoActiveStrategyState } from '@/components/NoActiveStrategyState';
import { computeOpenTradesValueEur, type MarketPrices } from '@/utils/portfolioMath';

interface RealTradingHistoryProps {
  hasActiveStrategy: boolean;
  onCreateStrategy?: () => void;
}

export function RealTradingHistory({ hasActiveStrategy, onCreateStrategy }: RealTradingHistoryProps) {
  const { trades, isLoading: tradesLoading, refresh: refreshTrades } = useRealTradeHistory();
  const { positions, isLoading: positionsLoading, refresh: refreshPositions } = useRealPositions();
  const { openTrades } = useOpenTrades();
  const { holdingsPrices } = useHoldingsPrices(openTrades);
  const { marketData } = useMarketData();
  const { metrics } = usePortfolioMetrics();
  const { gasSpentEur } = useRealGasSpent();

  const [confirmedOnly, setConfirmedOnly] = useState(true);

  if (!hasActiveStrategy) {
    return <NoActiveStrategyState onCreateStrategy={onCreateStrategy} />;
  }

  const buyTrades = trades.filter(t => t.side === 'BUY' && (!confirmedOnly || t.execution_status === 'CONFIRMED'));
  const sellTrades = trades.filter(t => t.side === 'SELL' && (!confirmedOnly || t.execution_status === 'CONFIRMED'));
  const visibleTrades = confirmedOnly ? trades.filter(t => t.execution_status === 'CONFIRMED') : trades;

  // Derive Open Positions value (live) using same logic as TEST mode
  const effectivePrices: MarketPrices = useMemo(() => {
    const merged: MarketPrices = { ...(marketData as MarketPrices) };
    for (const [k, v] of Object.entries(holdingsPrices)) {
      if (v && v.price > 0) merged[k] = v;
    }
    return merged;
  }, [marketData, holdingsPrices]);

  const openCalc = useMemo(
    () => computeOpenTradesValueEur(openTrades, effectivePrices),
    [openTrades, effectivePrices]
  );

  const summary: PortfolioSummaryData = useMemo(() => {
    const cashEur = metrics?.cash_balance_eur || 0;
    const openPositionsValueEur = openCalc.totalValue;
    const totalPortfolioValueEur = cashEur + openPositionsValueEur - gasSpentEur;
    const unrealizedPnlEur = openCalc.totalValue - openCalc.pricedCostBasis;
    const realizedPnlEur = metrics?.realized_pnl_eur || 0;
    const totalPnlEur = unrealizedPnlEur + realizedPnlEur - gasSpentEur;
    const startingCapital = metrics?.starting_capital_eur || 0;
    const totalPnlPct = startingCapital > 0 ? (totalPnlEur / startingCapital) * 100 : 0;

    return {
      openPositions: positions.length,
      closedSells: sellTrades.length,
      totalBuyTrades: buyTrades.length,
      cashEur,
      openPositionsValueEur,
      gasSpentEur,
      totalPortfolioValueEur,
      unrealizedPnlEur,
      realizedPnlEur,
      totalPnlEur,
      totalPnlPct,
      hasMissingPrices: openCalc.hasMissingPrices,
      missingSymbols: openCalc.missingSymbols,
      gasLabel: 'Gas (on-chain)',
    };
  }, [metrics, openCalc, gasSpentEur, positions.length, sellTrades.length, buyTrades.length]);

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">Trading History</h2>
            <Badge variant="outline" className="text-xs">REAL</Badge>
          </div>
        </div>

        <PortfolioSummaryHeader data={summary} />

        <Tabs defaultValue="positions">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="positions" className="flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4" />
              Positions ({positions.length})
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <ArrowDownLeft className="w-4 h-4" />
              Trade History ({visibleTrades.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="positions" className="mt-4">
            <RealPositionsTable
              positions={positions}
              isLoading={positionsLoading}
              onRefresh={refreshPositions}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <div className="flex items-center justify-end gap-2 mb-3">
              <span className="text-xs text-muted-foreground">
                {confirmedOnly ? 'Confirmed only' : 'Show all'}
              </span>
              <Switch
                checked={confirmedOnly}
                onCheckedChange={setConfirmedOnly}
                aria-label="Toggle confirmed-only filter"
              />
            </div>
            <RealTradeHistoryTable
              trades={visibleTrades}
              isLoading={tradesLoading}
              onRefresh={refreshTrades}
            />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
