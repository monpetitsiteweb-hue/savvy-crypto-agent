/**
 * RealTradingHistory - REAL mode version of TradingHistory
 *
 * 3 tabs: Open Positions / SELL Trades / Reverted
 * No "Confirmed only" toggle (each tab is already filtered by status).
 */
import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowUpRight, ArrowDownLeft, AlertTriangle } from 'lucide-react';
import { useRealTradeHistory } from '@/hooks/useRealTradeHistory';
import { useRealPositions } from '@/hooks/useRealPositions';
import { useOpenTrades } from '@/hooks/useOpenTrades';
import { useHoldingsPrices } from '@/hooks/useHoldingsPrices';
import { useMarketData } from '@/contexts/MarketDataContext';
import { usePortfolioMetrics } from '@/hooks/usePortfolioMetrics';
import { useRevertedTrades } from '@/hooks/useRevertedTrades';
import { useAccountedMockTradeIds } from '@/hooks/useAccountedMockTradeIds';
import { useTradingMode } from '@/hooks/useTradingMode';
import { RealPositionsTable } from '@/components/trading/RealPositionsTable';
import { RevertedTradesTable } from '@/components/trading/RevertedTradesTable';
import { LiveSellTradeCard } from '@/components/trading/LiveSellTradeCard';
import { useLiveSellTrades } from '@/hooks/useLiveSellTrades';
import { PortfolioSummaryHeader, type PortfolioSummaryData } from '@/components/trading/PortfolioSummaryHeader';
import { NoActiveStrategyState } from '@/components/NoActiveStrategyState';
import { computeOpenTradesValueEur, type MarketPrices } from '@/utils/portfolioMath';

interface RealTradingHistoryProps {
  hasActiveStrategy: boolean;
  onCreateStrategy?: () => void;
}

export function RealTradingHistory({ hasActiveStrategy, onCreateStrategy }: RealTradingHistoryProps) {
  const { trades } = useRealTradeHistory();
  const { positions, isLoading: positionsLoading, refresh: refreshPositions } = useRealPositions();
  const { openTrades } = useOpenTrades();
  const { holdingsPrices } = useHoldingsPrices(openTrades);
  const { marketData } = useMarketData();
  const { metrics } = usePortfolioMetrics();
  const { isTestMode } = useTradingMode();
  // Fix 4 (H2/H3/H11): align REAL SELL counts with PerformanceOverview.
  // Gate is SELL-scoped — never applied to BUYs (no BUY spec in fetchLocalMetrics).
  const {
    ids: accountedSellIds,
    hasError: accountedError,
  } = useAccountedMockTradeIds(isTestMode);

  const { rows: revertedRows } = useRevertedTrades(50);

  // LIVE SELL cards: mock_trades-backed, gated, visually aligned with TEST.
  const { trades: liveSellTrades, isLoading: liveSellLoading } = useLiveSellTrades();

  // tx_hash lookup: from existing useRealTradeHistory result; no new query.
  const txHashLookup = useMemo(() => {
    const m = new Map<string, string>();
    trades.forEach(rt => {
      if (rt.mock_trade_id && rt.tx_hash) m.set(rt.mock_trade_id, rt.tx_hash);
    });
    return m;
  }, [trades]);

  // Fix 2 (H6): gas displayed here must match Dashboard + Performance (RPC truth).
  const gasSpentEur = metrics?.total_gas_eur ?? 0;

  if (!hasActiveStrategy) {
    return <NoActiveStrategyState onCreateStrategy={onCreateStrategy} />;
  }

  // BUY counts: always unfiltered (no spec for BUY in fetchLocalMetrics).
  const confirmedBuys = trades.filter(t => t.side === 'BUY' && t.execution_status === 'CONFIRMED');
  const allConfirmedSells = trades.filter(t => t.side === 'SELL' && t.execution_status === 'CONFIRMED');

  // SELL gate behaviour:
  //  - loading (ids === null && !hasError): expose null → UI shows "—" skeleton
  //  - hasError: fall back to UNFILTERED allConfirmedSells + stale badge
  //  - normal: filter by accounted SELL ids; rows without mock_trade_id pass
  const confirmedSellsFiltered: typeof allConfirmedSells | null =
    accountedSellIds === null
      ? (accountedError ? allConfirmedSells : null)
      : allConfirmedSells.filter(t => !t.mock_trade_id || accountedSellIds.has(t.mock_trade_id));

  const sellCount: number | null = confirmedSellsFiltered === null ? null : confirmedSellsFiltered.length;
  const sellCountLabel = sellCount === null ? '—' : String(sellCount);

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
    // Totals bound directly to get_portfolio_metrics RPC (single source of truth).
    const cashEur = metrics?.cash_balance_eur || 0;
    const openPositionsValueEur = metrics?.current_position_value_eur || 0;
    const totalPortfolioValueEur = metrics?.total_portfolio_value_eur || 0;
    const unrealizedPnlEur = metrics?.unrealized_pnl_eur || 0;
    const realizedPnlEur = metrics?.realized_pnl_eur || 0;
    const totalPnlEur = metrics?.total_pnl_eur || 0;
    const startingCapital = metrics?.starting_capital_eur || 0;
    const totalPnlPct = startingCapital > 0 ? (totalPnlEur / startingCapital) * 100 : 0;

    return {
      openPositions: openTrades.length,
      closedSells: sellCount,
      totalBuyTrades: confirmedBuys.length,
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
  }, [metrics, openCalc, gasSpentEur, openTrades.length, sellCount, confirmedBuys.length]);


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
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="positions" className="flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4" />
              Open Positions ({openTrades.length})
            </TabsTrigger>
            <TabsTrigger value="sells" className="flex items-center gap-2">
              <ArrowDownLeft className="w-4 h-4" />
              SELL Trades ({liveSellLoading && liveSellTrades.length === 0 ? '—' : liveSellTrades.length})
              {accountedError && (
                <Badge variant="outline" className="text-[10px] ml-1 border-amber-500/40 text-amber-500">
                  stale
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="reverted" className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Reverted ({revertedRows.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="positions" className="mt-4">
            <RealPositionsTable
              positions={positions}
              isLoading={positionsLoading}
              onRefresh={refreshPositions}
            />
          </TabsContent>

          <TabsContent value="sells" className="mt-4">
            {liveSellLoading && liveSellTrades.length === 0 ? (
              <Card className="p-6">
                <div className="text-center text-muted-foreground animate-pulse">
                  <p className="text-sm">Loading accounted SELL trades…</p>
                </div>
              </Card>
            ) : liveSellTrades.length === 0 ? (
              <Card className="p-6">
                <div className="text-center text-muted-foreground">
                  <p>No SELL trades yet.</p>
                  <p className="text-sm mt-1">Confirmed SELL trades will appear here with realized P&L.</p>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                {liveSellTrades.map(t => (
                  <LiveSellTradeCard key={t.id} trade={t} txHashLookup={txHashLookup} />
                ))}
              </div>
            )}
          </TabsContent>


          <TabsContent value="reverted" className="mt-4">
            <RevertedTradesTable />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
