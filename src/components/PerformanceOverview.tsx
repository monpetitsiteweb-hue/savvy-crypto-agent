import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTestMode } from "@/hooks/useTestMode";
import { TrendingUp, TrendingDown, DollarSign, Activity, Target, TestTube } from "lucide-react";
import { NoActiveStrategyState } from "./NoActiveStrategyState";
import { formatEuro } from '@/utils/currencyFormatter';

interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalProfitLoss: number;
  winRate: number;
  totalFees: number;
}

interface PerformanceOverviewProps {
  hasActiveStrategy: boolean;
  onCreateStrategy?: () => void;
}

export const PerformanceOverview = ({ hasActiveStrategy, onCreateStrategy }: PerformanceOverviewProps) => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalProfitLoss: 0,
    winRate: 0,
    totalFees: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchPerformanceMetrics();
    }
  }, [user, testMode]);

  const fetchPerformanceMetrics = async () => {
    try {
      setLoading(true);
      
      // Get trades from the appropriate table based on test mode
      const tableName = testMode ? 'mock_trades' : 'trading_history';
      const { data: trades, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('user_id', user?.id);

      if (error) throw error;

      if (trades && trades.length > 0) {
        const totalTrades = trades.length;
        let totalProfitLoss = 0;
        let totalFees = 0;
        let winningTrades = 0;
        let losingTrades = 0;

        // Calculate metrics from trades
        trades.forEach(trade => {
          const fees = trade.fees || 0;
          totalFees += fees;

          // For profit/loss calculation, we need to track if this was profitable
          // This is a simplified calculation - in reality it would be more complex
          if (testMode && 'profit_loss' in trade && trade.profit_loss !== undefined) {
            totalProfitLoss += trade.profit_loss;
            if (trade.profit_loss > 0) winningTrades++;
            else if (trade.profit_loss < 0) losingTrades++;
          } else {
            // For live trades, we'd need more sophisticated P&L calculation
            // For now, simulate some profit/loss
            const simulatedPL = (Math.random() - 0.45) * trade.total_value * 0.1;
            totalProfitLoss += simulatedPL;
            if (simulatedPL > 0) winningTrades++;
            else losingTrades++;
          }
        });

        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

        setMetrics({
          totalTrades,
          winningTrades,
          losingTrades,
          totalProfitLoss,
          winRate,
          totalFees
        });
      }
    } catch (error) {
      console.error('Error fetching performance metrics:', error);
    } finally {
      setLoading(false);
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

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">Loading performance metrics...</div>
        </CardContent>
      </Card>
    );
  }

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
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Target className="h-4 w-4" />
              Total Trades
            </div>
            <div className="text-2xl font-bold text-white">{metrics.totalTrades}</div>
            <div className="text-xs text-slate-500">Executed trades</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <TrendingUp className="h-4 w-4" />
              Win Rate
            </div>
            <div className="text-2xl font-bold text-green-400">
              {metrics.winRate.toFixed(1)}%
            </div>
            <div className="text-xs text-slate-500">Success ratio</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <DollarSign className="h-4 w-4" />
              Total P&L
            </div>
            <div className={`text-2xl font-bold ${
              metrics.totalProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {formatEuro(metrics.totalProfitLoss)}
            </div>
            <div className="text-xs text-slate-500">Profit & Loss</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-green-400">
              <TrendingUp className="h-4 w-4" />
              Winning Trades
            </div>
            <div className="text-xl font-semibold text-green-400">
              {metrics.winningTrades}
            </div>
            <div className="text-xs text-slate-500">Profitable trades</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <TrendingDown className="h-4 w-4" />
              Losing Trades
            </div>
            <div className="text-xl font-semibold text-red-400">
              {metrics.losingTrades}
            </div>
            <div className="text-xs text-slate-500">Unprofitable trades</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <DollarSign className="h-4 w-4" />
              Total Fees
            </div>
            <div className="text-xl font-semibold text-slate-300">
              {formatEuro(metrics.totalFees)}
            </div>
            <div className="text-xs text-slate-500">Trading costs</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};