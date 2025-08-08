import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTestMode } from "@/hooks/useTestMode";
import { TrendingUp, TrendingDown, DollarSign, Activity, Target, TestTube } from "lucide-react";
import { NoActiveStrategyState } from "./NoActiveStrategyState";
import { formatEuro } from '@/utils/currencyFormatter';
import { useRealTimeMarketData } from '@/hooks/useRealTimeMarketData';

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
  const [userFeeRate, setUserFeeRate] = useState<number>(0);

  const { marketData } = useRealTimeMarketData();

  useEffect(() => {
    if (user) {
      fetchUserFeeRate();
      fetchPerformanceMetrics();
    }
  }, [user, testMode, marketData]);

  const fetchUserFeeRate = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('fee_rate')
        .eq('id', user.id)
        .maybeSingle();
      if (!error && data) setUserFeeRate(Number(data.fee_rate || 0));
    } catch (e) {
      console.warn('Failed to fetch user fee rate', e);
    }
  };

  const fetchPerformanceMetrics = async () => {
    try {
      setLoading(true);
      
      const tableName = testMode ? 'mock_trades' : 'trading_history';
      const { data: trades, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('user_id', user?.id)
        .order('executed_at', { ascending: true });

      if (error) throw error;

      if (trades && trades.length > 0) {
        // FIFO lots per symbol
        type Lot = { remaining: number; unitPrice: number; feePerUnit: number };
        const lotsBySymbol = new Map<string, Lot[]>();
        const feeRateBySymbol = new Map<string, number>();

        let realizedPL = 0;
        let unrealizedPL = 0;
        let totalFees = 0;
        let winningTrades = 0;
        let losingTrades = 0;
        let sellEvents = 0;

        // Pre-calc fee rates from buys
        trades.forEach(t => {
          totalFees += Number(t.fees || 0);
          if (t.trade_type === 'buy' && t.total_value && t.fees) {
            const rate = Number(t.fees) / Number(t.total_value);
            if (!feeRateBySymbol.has(t.cryptocurrency)) feeRateBySymbol.set(t.cryptocurrency, rate);
          }
        });

        for (const t of trades) {
          const sym = t.cryptocurrency;
          if (!lotsBySymbol.has(sym)) lotsBySymbol.set(sym, []);
          const lots = lotsBySymbol.get(sym)!;

          if (t.trade_type === 'buy') {
            const unitPrice = Number(t.total_value) / Number(t.amount || 1);
            const feePerUnit = Number(t.fees || 0) / Number(t.amount || 1);
            lots.push({ remaining: Number(t.amount), unitPrice, feePerUnit });
          } else if (t.trade_type === 'sell') {
            let sellRemaining = Number(t.amount);
            const sellPrice = Number(t.price);
            const explicitSellFeePerUnit = Number(t.fees || 0) / (Number(t.amount) || 1);
            const fallbackRate = feeRateBySymbol.get(sym) ?? 0.005;
            const sellFeePerUnit = explicitSellFeePerUnit || (fallbackRate * sellPrice);

            let sellRealized = 0;
            while (sellRemaining > 1e-12 && lots.length > 0) {
              const lot = lots[0];
              const used = Math.min(lot.remaining, sellRemaining);
              const buyCost = used * (lot.unitPrice + lot.feePerUnit);
              const proceeds = used * (sellPrice - sellFeePerUnit);
              sellRealized += (proceeds - buyCost);
              lot.remaining -= used;
              sellRemaining -= used;
              if (lot.remaining <= 1e-12) lots.shift();
            }
            realizedPL += sellRealized;
            sellEvents += 1;
            if (sellRealized > 0) winningTrades += 1; else if (sellRealized < 0) losingTrades += 1;
          }
        }

        // Unrealized from remaining lots at current prices
        lotsBySymbol.forEach((lots, sym) => {
          const current = marketData[sym]?.price;
          if (!current) return;
          lots.forEach(lot => {
            unrealizedPL += lot.remaining * (current - lot.unitPrice) - (lot.remaining * lot.feePerUnit);
          });
        });

        const totalTrades = trades.length;
        const winRate = sellEvents > 0 ? (winningTrades / sellEvents) * 100 : 0;

        setMetrics({
          totalTrades,
          winningTrades,
          losingTrades,
          totalProfitLoss: realizedPL + unrealizedPL,
          winRate,
          totalFees
        });
      } else {
        setMetrics({ totalTrades: 0, winningTrades: 0, losingTrades: 0, totalProfitLoss: 0, winRate: 0, totalFees: 0 });
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
            {loading ? (
              <div className="w-12 h-8 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <div className="text-2xl font-bold text-white">{metrics.totalTrades}</div>
            )}
            <div className="text-xs text-slate-500">Executed trades</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <TrendingUp className="h-4 w-4" />
              Win Rate
            </div>
            {loading ? (
              <div className="w-16 h-8 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <div className="text-2xl font-bold text-green-400">
                {metrics.winRate.toFixed(1)}%
              </div>
            )}
            <div className="text-xs text-slate-500">Success ratio</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <DollarSign className="h-4 w-4" />
              Total P&L
            </div>
            {loading ? (
              <div className="w-20 h-8 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <div className={`text-2xl font-bold ${
                metrics.totalProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {formatEuro(metrics.totalProfitLoss)}
              </div>
            )}
            <div className="text-xs text-slate-500">Profit & Loss</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-green-400">
              <TrendingUp className="h-4 w-4" />
              Winning Trades
            </div>
            {loading ? (
              <div className="w-8 h-6 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <div className="text-xl font-semibold text-green-400">
                {metrics.winningTrades}
              </div>
            )}
            <div className="text-xs text-slate-500">Profitable trades</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <TrendingDown className="h-4 w-4" />
              Losing Trades
            </div>
            {loading ? (
              <div className="w-8 h-6 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <div className="text-xl font-semibold text-red-400">
                {metrics.losingTrades}
              </div>
            )}
            <div className="text-xs text-slate-500">Unprofitable trades</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <DollarSign className="h-4 w-4" />
              Total Fees
            </div>
            {loading ? (
              <div className="w-16 h-6 bg-slate-700 animate-pulse rounded"></div>
            ) : (
              <div className="text-xl font-semibold text-slate-300">
                {formatEuro(metrics.totalFees)}
              </div>
            )}
            <div className="text-xs text-slate-500">Trading costs</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};