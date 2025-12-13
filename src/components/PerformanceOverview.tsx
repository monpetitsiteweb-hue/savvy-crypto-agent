// P2 FIX: PerformanceOverview uses afterReset for deterministic refresh
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTestMode } from "@/hooks/useTestMode";
import { usePortfolioMetrics } from "@/hooks/usePortfolioMetrics";
import { useOpenLots } from "@/hooks/useOpenLots";
import { TrendingUp, TrendingDown, DollarSign, Activity, Target, TestTube, Percent } from "lucide-react";
import { NoActiveStrategyState } from "./NoActiveStrategyState";
import { PortfolioNotInitialized } from "./PortfolioNotInitialized";
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { useMockWallet } from "@/hooks/useMockWallet";
import { afterReset } from "@/utils/resetHelpers";

interface LocalMetrics {
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalTrades: number;
}

interface PerformanceOverviewProps {
  hasActiveStrategy: boolean;
  onCreateStrategy?: () => void;
}

export const PerformanceOverview = ({ hasActiveStrategy, onCreateStrategy }: PerformanceOverviewProps) => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
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
  
  // P2 FIX: Use server-side open lots for consistency
  const { refresh: refreshOpenLots } = useOpenLots();
  const [localMetrics, setLocalMetrics] = useState<LocalMetrics>({
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalTrades: 0
  });
  const [localLoading, setLocalLoading] = useState(true);

  // Fetch win/loss metrics locally (these are count-based, not stored in RPC)
  const fetchLocalMetrics = async () => {
    if (!user) return;
    
    try {
      setLocalLoading(true);
      
      const { data: sellTrades, error } = await supabase
        .from('mock_trades')
        .select('realized_pnl')
        .eq('user_id', user.id)
        .eq('trade_type', 'sell')
        .eq('is_test_mode', true);

      if (error) throw error;

      const wins = sellTrades?.filter(t => (t.realized_pnl || 0) > 0).length || 0;
      const losses = sellTrades?.filter(t => (t.realized_pnl || 0) < 0).length || 0;
      const total = sellTrades?.length || 0;
      const winRate = total > 0 ? (wins / total) * 100 : 0;

      setLocalMetrics({
        winningTrades: wins,
        losingTrades: losses,
        winRate,
        totalTrades: total
      });
    } catch (error) {
      console.error('Error fetching local metrics:', error);
    } finally {
      setLocalLoading(false);
    }
  };

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

  // P2 FIX: Deterministic reset using afterReset helper (no setTimeout)
  const handleReset = async () => {
    try {
      await resetPortfolio();
      // P2 FIX: Use centralized afterReset for deterministic refresh
      await afterReset({
        refreshPortfolioMetrics: refreshMetrics,
        refreshOpenLots: refreshOpenLots,
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
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {/* Total Trades - from local count */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Target className="h-4 w-4" />
              Closed Trades
            </div>
            {loading ? (
              <div className="w-12 h-8 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <div className="text-2xl font-bold text-white">{localMetrics.totalTrades}</div>
            )}
            <div className="text-xs text-slate-500">Completed trades (local)</div>
          </div>

          {/* Win Rate - from local calculation */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Percent className="h-4 w-4" />
              Win Rate
            </div>
            {loading ? (
              <div className="w-16 h-8 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <div className={`text-2xl font-bold ${localMetrics.winRate >= 50 ? 'text-green-400' : 'text-amber-400'}`}>
                {localMetrics.winRate.toFixed(1)}%
              </div>
            )}
            <div className="text-xs text-slate-500">Success ratio (local)</div>
          </div>

          {/* Total P&L - FROM RPC */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <DollarSign className="h-4 w-4" />
              Total P&L
            </div>
            {metricsLoading ? (
              <div className="w-20 h-8 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <>
                <div className={`text-2xl font-bold ${
                  metrics.total_pnl_eur >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {formatEuro(metrics.total_pnl_eur)}
                </div>
                <div className={`text-xs ${metrics.total_pnl_eur >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                  {formatPercentage(totalPnlPct)} from RPC
                </div>
              </>
            )}
          </div>

          {/* Winning Trades - from local */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-green-400">
              <TrendingUp className="h-4 w-4" />
              Winning Trades
            </div>
            {loading ? (
              <div className="w-8 h-6 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <div className="text-xl font-semibold text-green-400">
                {localMetrics.winningTrades}
              </div>
            )}
            <div className="text-xs text-slate-500">Profitable trades (local)</div>
          </div>

          {/* Losing Trades - from local */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <TrendingDown className="h-4 w-4" />
              Losing Trades
            </div>
            {loading ? (
              <div className="w-8 h-6 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <div className="text-xl font-semibold text-red-400">
                {localMetrics.losingTrades}
              </div>
            )}
            <div className="text-xs text-slate-500">Unprofitable trades (local)</div>
          </div>

          {/* Total Fees - FROM RPC */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <DollarSign className="h-4 w-4" />
              Total Fees
            </div>
            {metricsLoading ? (
              <div className="w-16 h-6 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <>
                <div className="text-xl font-semibold text-slate-300">
                  {formatEuro(metrics.total_fees_eur)}
                </div>
                <div className="text-xs text-slate-500">
                  Buy: {formatEuro(metrics.total_buy_fees_eur)} / Sell: {formatEuro(metrics.total_sell_fees_eur)}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Gas Tracking Placeholder - P5 */}
        <div className="mt-4 p-3 bg-slate-700/20 rounded-lg border border-slate-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Activity className="h-4 w-4" />
              Gas Spent (est.)
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-slate-500">€0.00</div>
              <div className="text-xs text-slate-600" title="Available when on-chain execution is enabled; mock trades will later estimate">
                Mock trades (no gas)
              </div>
            </div>
          </div>
        </div>

        {/* P&L Breakdown */}
        {isInitialized && (
          <div className="mt-4 pt-4 border-t border-slate-700">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="text-xs text-slate-400">Unrealized P&L</div>
                <div className={`text-lg font-semibold ${metrics.unrealized_pnl_eur >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatEuro(metrics.unrealized_pnl_eur)}
                </div>
                <div className={`text-xs ${metrics.unrealized_pnl_eur >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                  {formatPercentage(unrealizedPnlPct)}
                </div>
              </div>
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="text-xs text-slate-400">Realized P&L</div>
                <div className={`text-lg font-semibold ${metrics.realized_pnl_eur >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatEuro(metrics.realized_pnl_eur)}
                </div>
                <div className={`text-xs ${metrics.realized_pnl_eur >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                  {formatPercentage(realizedPnlPct)}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
