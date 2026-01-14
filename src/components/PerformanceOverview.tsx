// TRADE-BASED: PerformanceOverview uses portfolioMath for consistent calculations
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTradeViewFilter } from "@/hooks/useTradeViewFilter";
import { usePortfolioMetrics } from "@/hooks/usePortfolioMetrics";
import { useOpenTrades } from "@/hooks/useOpenTrades";
import { useMarketData } from "@/contexts/MarketDataContext";
import { useHoldingsPrices } from "@/hooks/useHoldingsPrices";
import { TrendingUp, TrendingDown, DollarSign, Activity, Target, TestTube, Percent, Fuel, AlertTriangle, BarChart3 } from "lucide-react";
import { NoActiveStrategyState } from "./NoActiveStrategyState";
import { PortfolioNotInitialized } from "./PortfolioNotInitialized";
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { useMockWallet } from "@/hooks/useMockWallet";
import { afterReset } from "@/utils/resetHelpers";
import { 
  computeFullPortfolioValuation, 
  formatPnlWithSign,
  MOCK_GAS_PER_TX_EUR,
  type MarketPrices,
  type PortfolioValuation 
} from '@/utils/portfolioMath';

interface LocalMetrics {
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalTrades: number;
  avgWinningTrade: number;
  avgLosingTrade: number;
}

interface PerformanceOverviewProps {
  hasActiveStrategy: boolean;
  onCreateStrategy?: () => void;
}

export const PerformanceOverview = ({ hasActiveStrategy, onCreateStrategy }: PerformanceOverviewProps) => {
  const { user } = useAuth();
  const { testMode } = useTradeViewFilter();
  const { resetPortfolio, isLoading: walletLoading } = useMockWallet();
  const { 
    metrics, 
    loading: metricsLoading, 
    isInitialized,
    refresh: refreshMetrics,
    totalPnlPct,
    realizedPnlPct,
    unrealizedPnlPct
  } = usePortfolioMetrics();
  
  // TRADE-BASED: Use open trades for portfolio valuation
  const { openTrades, refresh: refreshOpenTrades } = useOpenTrades();
  const { marketData } = useMarketData();
  const { holdingsPrices, isLoadingPrices, failedSymbols, debugInfo } = useHoldingsPrices(openTrades);
  const [localMetrics, setLocalMetrics] = useState<LocalMetrics>({
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalTrades: 0,
    avgWinningTrade: 0,
    avgLosingTrade: 0
  });
  const [localLoading, setLocalLoading] = useState(true);
  const [txCount, setTxCount] = useState(0);

  // Fetch win/loss metrics and total traded volume locally
  const fetchLocalMetrics = async () => {
    if (!user) return;
    
    try {
      setLocalLoading(true);
      
      // Fetch sell trades for win/loss
      const { data: sellTrades, error } = await supabase
        .from('mock_trades')
        .select('realized_pnl')
        .eq('user_id', user.id)
        .eq('trade_type', 'sell')
        .eq('is_test_mode', testMode);

      if (error) throw error;

      const winningTrades = sellTrades?.filter(t => (t.realized_pnl || 0) > 0) || [];
      const losingTrades = sellTrades?.filter(t => (t.realized_pnl || 0) < 0) || [];
      
      const wins = winningTrades.length;
      const losses = losingTrades.length;
      const total = sellTrades?.length || 0;
      const winRate = total > 0 ? (wins / total) * 100 : 0;
      
      // Calculate average winning and losing trade
      const totalWinPnl = winningTrades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
      const totalLossPnl = losingTrades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
      
      const avgWinningTrade = wins > 0 ? totalWinPnl / wins : 0;
      const avgLosingTrade = losses > 0 ? totalLossPnl / losses : 0;

      setLocalMetrics({
        winningTrades: wins,
        losingTrades: losses,
        winRate,
        totalTrades: total,
        avgWinningTrade,
        avgLosingTrade
      });
      
      // Fetch transaction count for gas calculation (each trade = 1 tx)
      const { count } = await supabase
        .from('mock_trades')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_test_mode', testMode)
        .eq('is_corrupted', false);
      
      setTxCount(count || 0);
    } catch (error) {
      console.error('Error fetching local metrics:', error);
    } finally {
      setLocalLoading(false);
    }
  };
  
  // Compute portfolio valuation using shared utility
  // Prefer holdingsPrices (specific to user holdings), fallback to marketData
  const effectivePrices = useMemo(() => {
    const merged: MarketPrices = { ...marketData as MarketPrices };
    for (const [key, val] of Object.entries(holdingsPrices)) {
      if (val && val.price > 0) {
        merged[key] = val;
      }
    }
    return merged;
  }, [holdingsPrices, marketData]);

  const portfolioValuation: PortfolioValuation = useMemo(() => {
    return computeFullPortfolioValuation(
      metrics,
      openTrades,
      effectivePrices,
      txCount,
      testMode
    );
  }, [metrics, openTrades, effectivePrices, txCount, testMode]);

  useEffect(() => {
    if (user && testMode) {
      fetchLocalMetrics();
    }
  }, [user, testMode]);

  // Re-fetch when metrics change (trade happened)
  useEffect(() => {
    if (isInitialized) {
      fetchLocalMetrics();
    }
  }, [metrics.realized_pnl_eur, isInitialized]);

  // Deterministic reset using afterReset helper (no setTimeout)
  const handleReset = async () => {
    try {
      await resetPortfolio();
      // Use centralized afterReset for deterministic refresh
      await afterReset({
        refreshPortfolioMetrics: refreshMetrics,
        refreshOpenTrades: refreshOpenTrades,
      });
      // Fetch local metrics (win/loss counts) after reset
      await fetchLocalMetrics();
    } catch (error) {
      console.error('Failed to reset portfolio:', error);
    }
  };

  if (!hasActiveStrategy) {
    return (
      <NoActiveStrategyState 
        onCreateStrategy={onCreateStrategy}
        className="min-h-[400px]"
      />
    );
  }

  // Show not initialized state
  if (testMode && !metricsLoading && !isInitialized) {
    return <PortfolioNotInitialized onReset={handleReset} isLoading={walletLoading} />;
  }

  const loading = metricsLoading || localLoading;
  const lossRate = localMetrics.totalTrades > 0 
    ? ((localMetrics.losingTrades / localMetrics.totalTrades) * 100) 
    : 0;

  return (
    <Card className={`bg-slate-800/50 border-slate-600 ${testMode ? "border-orange-500/20" : ""}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white">
          <Activity className="h-5 w-5" />
          Performance Overview
          {testMode && (
            <Badge variant="secondary" className="bg-orange-500/20 text-orange-400 border-orange-500/30">
              <TestTube className="h-3 w-3 mr-1" />
              Test Mode
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Partial Valuation Warning Badge - improved messaging */}
        {isLoadingPrices && openTrades.length > 0 && (
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400 animate-spin flex-shrink-0" />
            <span className="text-sm text-blue-400">Loading prices...</span>
          </div>
        )}
        {!isLoadingPrices && (portfolioValuation.hasMissingPrices || failedSymbols.length > 0) && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />
              <span className="text-sm text-amber-400">Partial valuation — some positions excluded</span>
            </div>
            <div className="text-xs text-amber-400/70 ml-6">
              {failedSymbols.length > 0 
                ? failedSymbols.map(f => `${f.symbol}: ${f.reason.replace('_', ' ')}`).join(', ')
                : `Price unavailable: ${portfolioValuation.missingSymbols.join(', ')}`}
            </div>
            {/* DEBUG: Development only - remove after validation */}
            {import.meta.env.DEV && (failedSymbols.some(f => ['BTC', 'ETH', 'SOL'].includes(f.symbol))) && (
              <div className="text-xs text-red-400 mt-1 font-mono">
                DEBUG: pairs={JSON.stringify(debugInfo.holdingsPairs)}, fetched={debugInfo.fetchedCount}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            SECTION 1: OVERALL PERFORMANCE
            "How is my strategy doing overall?"
        ═══════════════════════════════════════════════════════════════════════ */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300 border-b border-slate-700/50 pb-2">
            <BarChart3 className="h-4 w-4" />
            Overall Performance
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {/* Total Closed Trades */}
            <div className="p-3 bg-slate-700/30 rounded-lg">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <Target className="h-3.5 w-3.5" />
                Closed Trades
              </div>
              {loading ? (
                <div className="w-12 h-7 bg-slate-700 animate-pulse rounded"></div>
              ) : (
                <div className="text-xl font-bold text-white">{localMetrics.totalTrades}</div>
              )}
            </div>

            {/* Total P&L */}
            <div className="p-3 bg-slate-700/30 rounded-lg">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <DollarSign className="h-3.5 w-3.5" />
                Total P&L
              </div>
              {metricsLoading ? (
                <div className="w-16 h-7 bg-slate-700 animate-pulse rounded"></div>
              ) : (
                (() => {
                  const pnl = formatPnlWithSign(portfolioValuation.totalPnlEur);
                  return (
                    <>
                      <div className={`text-xl font-bold ${pnl.colorClass}`}>
                        {pnl.sign}{pnl.value}
                      </div>
                      <div className={`text-xs ${pnl.colorClass}`}>
                        {formatPercentage(portfolioValuation.totalPnlPct)}
                      </div>
                    </>
                  );
                })()
              )}
            </div>

            {/* Realized P&L */}
            <div className="p-3 bg-slate-700/30 rounded-lg">
              <div className="text-xs text-slate-400 mb-1">Realized P&L</div>
              {metricsLoading ? (
                <div className="w-16 h-7 bg-slate-700 animate-pulse rounded"></div>
              ) : (
                (() => {
                  const realPnl = formatPnlWithSign(portfolioValuation.realizedPnlEur);
                  return (
                    <>
                      <div className={`text-xl font-bold ${realPnl.colorClass}`}>
                        {realPnl.sign}{realPnl.value}
                      </div>
                      <div className={`text-xs ${realPnl.colorClass}`}>
                        {formatPercentage(realizedPnlPct)}
                      </div>
                    </>
                  );
                })()
              )}
            </div>

            {/* Unrealized P&L */}
            <div className="p-3 bg-slate-700/30 rounded-lg">
              <div className="text-xs text-slate-400 mb-1">Unrealized P&L</div>
              {metricsLoading ? (
                <div className="w-16 h-7 bg-slate-700 animate-pulse rounded"></div>
              ) : (
                (() => {
                  const unrealPnl = formatPnlWithSign(portfolioValuation.unrealizedPnlEur);
                  return (
                    <>
                      <div className={`text-xl font-bold ${unrealPnl.colorClass}`}>
                        {unrealPnl.sign}{unrealPnl.value}
                      </div>
                      <div className={`text-xs ${unrealPnl.colorClass}`}>
                        {formatPercentage(unrealizedPnlPct)}
                      </div>
                    </>
                  );
                })()
              )}
            </div>

            {/* Gas (mock) */}
            <div className="p-3 bg-slate-700/30 rounded-lg">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <Fuel className="h-3.5 w-3.5" />
                Gas (mock)
              </div>
              {metricsLoading ? (
                <div className="w-16 h-7 bg-slate-700 animate-pulse rounded"></div>
              ) : (
                <>
                  <div className="text-xl font-bold text-amber-400">−{formatEuro(portfolioValuation.gasSpentEur)}</div>
                  <div className="text-xs text-slate-500">
                    €{MOCK_GAS_PER_TX_EUR.toFixed(2)} × {txCount} tx
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            SECTION 2 & 3: WINNING vs LOSING TRADES (side by side)
            "How good are my wins?" vs "How costly are my losses?"
        ═══════════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* WINNING TRADES SECTION - Green accent */}
          <div className="p-4 bg-green-500/5 border border-green-500/20 rounded-lg space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-green-400 border-b border-green-500/20 pb-2">
              <TrendingUp className="h-4 w-4" />
              Winning Trades
            </div>
            
            <div className="grid grid-cols-3 gap-3">
              {/* Win Rate */}
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-xs text-green-400/70 mb-1">
                  <Percent className="h-3 w-3" />
                  Win Rate
                </div>
                {loading ? (
                  <div className="w-12 h-7 bg-green-900/30 animate-pulse rounded mx-auto"></div>
                ) : (
                  <div className="text-xl font-bold text-green-400">
                    {localMetrics.winRate.toFixed(1)}%
                  </div>
                )}
              </div>
              
              {/* Number of Wins */}
              <div className="text-center">
                <div className="text-xs text-green-400/70 mb-1">Count</div>
                {loading ? (
                  <div className="w-8 h-7 bg-green-900/30 animate-pulse rounded mx-auto"></div>
                ) : (
                  <div className="text-xl font-bold text-green-400">
                    {localMetrics.winningTrades}
                  </div>
                )}
              </div>
              
              {/* Average Winning Trade */}
              <div className="text-center">
                <div className="text-xs text-green-400/70 mb-1">Avg Win</div>
                {loading ? (
                  <div className="w-14 h-7 bg-green-900/30 animate-pulse rounded mx-auto"></div>
                ) : (
                  <div className="text-xl font-bold text-green-400">
                    +{formatEuro(localMetrics.avgWinningTrade)}
                  </div>
                )}
              </div>
            </div>
            
            <div className="text-xs text-green-400/50 text-center pt-1 border-t border-green-500/10">
              How good are my wins?
            </div>
          </div>

          {/* LOSING TRADES SECTION - Red accent */}
          <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-red-400 border-b border-red-500/20 pb-2">
              <TrendingDown className="h-4 w-4" />
              Losing Trades
            </div>
            
            <div className="grid grid-cols-3 gap-3">
              {/* Loss Rate */}
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-xs text-red-400/70 mb-1">
                  <Percent className="h-3 w-3" />
                  Loss Rate
                </div>
                {loading ? (
                  <div className="w-12 h-7 bg-red-900/30 animate-pulse rounded mx-auto"></div>
                ) : (
                  <div className="text-xl font-bold text-red-400">
                    {lossRate.toFixed(1)}%
                  </div>
                )}
              </div>
              
              {/* Number of Losses */}
              <div className="text-center">
                <div className="text-xs text-red-400/70 mb-1">Count</div>
                {loading ? (
                  <div className="w-8 h-7 bg-red-900/30 animate-pulse rounded mx-auto"></div>
                ) : (
                  <div className="text-xl font-bold text-red-400">
                    {localMetrics.losingTrades}
                  </div>
                )}
              </div>
              
              {/* Average Losing Trade */}
              <div className="text-center">
                <div className="text-xs text-red-400/70 mb-1">Avg Loss</div>
                {loading ? (
                  <div className="w-14 h-7 bg-red-900/30 animate-pulse rounded mx-auto"></div>
                ) : (
                  <div className="text-xl font-bold text-red-400">
                    {formatEuro(localMetrics.avgLosingTrade)}
                  </div>
                )}
              </div>
            </div>
            
            <div className="text-xs text-red-400/50 text-center pt-1 border-t border-red-500/10">
              How costly are my losses?
            </div>
          </div>
        </div>

        {/* Total Fees - compact footer */}
        <div className="p-3 bg-slate-700/20 rounded-lg border border-slate-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <DollarSign className="h-4 w-4" />
              Total Fees
            </div>
            <div className="text-right">
              {metricsLoading ? (
                <div className="w-16 h-5 bg-slate-700 animate-pulse rounded"></div>
              ) : (
                <>
                  <div className="text-sm font-medium text-slate-300">
                    {formatEuro(metrics.total_fees_eur)}
                  </div>
                  <div className="text-xs text-slate-500">
                    Buy: {formatEuro(metrics.total_buy_fees_eur)} / Sell: {formatEuro(metrics.total_sell_fees_eur)}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            SECTION 4: CAPITAL & PERFORMANCE CONTEXT
            Didactic section explaining how performance relates to capital
        ═══════════════════════════════════════════════════════════════════════ */}
        <div className="mt-6 p-4 bg-slate-900/30 border border-slate-700/30 rounded-lg space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300 border-b border-slate-700/50 pb-2">
            <DollarSign className="h-4 w-4 text-slate-400" />
            Capital & Performance Context
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            {/* Starting Capital */}
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-1">Starting Capital</div>
              {metricsLoading ? (
                <div className="w-16 h-6 bg-slate-700 animate-pulse rounded mx-auto"></div>
              ) : (
                <div className="text-lg font-semibold text-white">
                  {formatEuro(portfolioValuation.startingCapitalEur)}
                </div>
              )}
            </div>
            
            {/* Total Capital */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-center cursor-help">
                  <div className="text-xs text-slate-500 mb-1">Total Capital</div>
                  {metricsLoading ? (
                    <div className="w-16 h-6 bg-slate-700 animate-pulse rounded mx-auto"></div>
                  ) : (
                    <div className="text-lg font-semibold text-white">
                      {formatEuro(portfolioValuation.startingCapitalEur)}
                    </div>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-xs">Reference used to compute Total P&L.</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Current Total P&L */}
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-1">Current Total P&L</div>
              {metricsLoading ? (
                <div className="w-16 h-6 bg-slate-700 animate-pulse rounded mx-auto"></div>
              ) : (
                (() => {
                  const pnl = formatPnlWithSign(portfolioValuation.totalPnlEur);
                  return (
                    <div className={`text-lg font-semibold ${pnl.colorClass}`}>
                      {pnl.sign}{pnl.value}
                    </div>
                  );
                })()
              )}
            </div>
          </div>
          
          {/* Explanatory copy */}
          <div className="text-xs text-slate-500 leading-relaxed border-t border-slate-700/30 pt-3">
            Performance is always calculated relative to the total capital deposited.
            If additional funds are added later, total capital increases, but past performance remains unchanged.
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
