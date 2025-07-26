import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Clock,
  Target,
  Activity,
  Percent
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { formatEuro, formatPercentage, formatDuration } from '@/utils/currencyFormatter';

interface PerformancePanelProps {
  strategyId?: string;
}

interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalProfitLoss: number;
  avgTradeValue: number;
  avgTradeDuration: number;
  totalFees: number;
}

const MetricCard = ({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  trend, 
  color = 'default' 
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'default' | 'success' | 'danger' | 'warning';
}) => {
  const colorClasses = {
    default: 'bg-slate-800 border-slate-700',
    success: 'bg-green-900/20 border-green-700',
    danger: 'bg-red-900/20 border-red-700',
    warning: 'bg-yellow-900/20 border-yellow-700'
  };

  const iconColorClasses = {
    default: 'text-slate-400',
    success: 'text-green-400',
    danger: 'text-red-400',
    warning: 'text-yellow-400'
  };

  return (
    <Card className={`${colorClasses[color]} transition-all hover:shadow-md`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-400">{title}</p>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold text-white">{value}</p>
              {trend && (
                <div className={`flex items-center ${
                  trend === 'up' ? 'text-green-400' : 
                  trend === 'down' ? 'text-red-400' : 'text-slate-400'
                }`}>
                  {trend === 'up' ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : trend === 'down' ? (
                    <TrendingDown className="h-4 w-4" />
                  ) : null}
                </div>
              )}
            </div>
            {subtitle && (
              <p className="text-xs text-slate-400">{subtitle}</p>
            )}
          </div>
          <Icon className={`h-8 w-8 ${iconColorClasses[color]}`} />
        </div>
      </CardContent>
    </Card>
  );
};

export const PerformancePanel = ({ strategyId }: PerformancePanelProps) => {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalProfitLoss: 0,
    avgTradeValue: 0,
    avgTradeDuration: 0,
    totalFees: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && strategyId) {
      fetchPerformanceData();
    }
  }, [user, strategyId]);

  const fetchPerformanceData = async () => {
    if (!user || !strategyId) return;

    try {
      // Fetch mock trades for the strategy
      const { data: trades, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('strategy_id', strategyId);

      if (error) throw error;

      if (trades && trades.length > 0) {
        const totalTrades = trades.length;
        const winningTrades = trades.filter(t => t.profit_loss > 0).length;
        const losingTrades = trades.filter(t => t.profit_loss < 0).length;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
        const totalProfitLoss = trades.reduce((sum, t) => sum + (t.profit_loss || 0), 0);
        const totalFees = trades.reduce((sum, t) => sum + (t.fees || 0), 0);
        const avgTradeValue = totalTrades > 0 ? trades.reduce((sum, t) => sum + t.total_value, 0) / totalTrades : 0;

        setMetrics({
          totalTrades,
          winningTrades,
          losingTrades,
          winRate,
          totalProfitLoss,
          avgTradeValue,
          avgTradeDuration: 2.5, // Placeholder - would need executed_at analysis
          totalFees
        });
      }
    } catch (error) {
      console.error('Error fetching performance data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="text-center">Loading performance data...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Performance Overview
          </h2>
          <p className="text-slate-400 mt-1">
            Real-time performance metrics for your strategy
          </p>
        </div>
      </div>

      {/* Key Performance Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Win Rate"
          value={formatPercentage(metrics.winRate)}
          subtitle={`${metrics.winningTrades} of ${metrics.totalTrades} trades`}
          icon={Percent}
          color={metrics.winRate >= 60 ? 'success' : metrics.winRate >= 40 ? 'warning' : 'danger'}
          trend={metrics.winRate >= 50 ? 'up' : 'down'}
        />
        
        <MetricCard
          title="Total P&L"
          value={formatEuro(metrics.totalProfitLoss)}
          subtitle="Net profit/loss"
          icon={DollarSign}
          color={metrics.totalProfitLoss >= 0 ? 'success' : 'danger'}
          trend={metrics.totalProfitLoss >= 0 ? 'up' : 'down'}
        />
        
        <MetricCard
          title="Avg Trade Duration"
          value={formatDuration(metrics.avgTradeDuration)}
          subtitle="Average holding time"
          icon={Clock}
          color="default"
        />
        
        <MetricCard
          title="Total Trades"
          value={metrics.totalTrades || 0}
          subtitle="Executed positions"
          icon={Activity}
          color="default"
        />
      </div>

      {/* Detailed Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          title="Avg Profit Per Trade"
          value={metrics.totalTrades > 0 ? formatEuro(metrics.totalProfitLoss / metrics.totalTrades) : formatEuro(0)}
          subtitle="Per position average"
          icon={Target}
          color={metrics.totalProfitLoss > 0 ? 'success' : 'danger'}
        />
        
        <MetricCard
          title="Avg Trade Value"
          value={formatEuro(metrics.avgTradeValue)}
          subtitle="Average position size"
          icon={DollarSign}
          color="default"
        />
        
        <MetricCard
          title="Total Fees Paid"
          value={formatEuro(metrics.totalFees)}
          subtitle="Trading commissions"
          icon={TrendingDown}
          color="warning"
        />
      </div>

      {/* Performance Summary */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Strategy Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
            <div>
              <p className="font-medium text-white">Current Performance</p>
              <p className="text-sm text-slate-400">
                {metrics.totalTrades === 0 
                  ? 'No trades executed yet' 
                  : `${metrics.winningTrades} winning • ${metrics.losingTrades} losing trades`
                }
              </p>
            </div>
            <Badge 
              variant={metrics.winRate >= 60 ? 'default' : 'secondary'}
              className={metrics.winRate >= 60 ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}
            >
              {metrics.totalTrades === 0 ? 'Pending' : metrics.winRate >= 60 ? 'Performing Well' : 'Needs Attention'}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};