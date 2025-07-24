import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, BarChart3 } from 'lucide-react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface BacktestResult {
  period_days: number;
  total_trades: number;
  winning_trades: number;
  win_rate: number;
  total_return: number;
  final_portfolio_value: number;
  initial_value: number;
  trades: Array<{
    timestamp: string;
    action: string;
    symbol: string;
    amount: number;
    price: number;
    value: number;
    reasoning: string;
  }>;
  signals_analyzed: number;
  strategy_effectiveness: number;
}

interface Strategy {
  id: string;
  strategy_name: string;
  configuration: any;
  is_active: boolean;
}

export const StrategyBacktest: React.FC = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStrategies, setLoadingStrategies] = useState(true);
  const { toast } = useToast();

  React.useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: strategiesData, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setStrategies(strategiesData || []);
    } catch (error) {
      console.error('Error loading strategies:', error);
      toast({
        title: "Error",
        description: "Failed to load trading strategies",
        variant: "destructive",
      });
    } finally {
      setLoadingStrategies(false);
    }
  };

  const runBacktest = async () => {
    if (!selectedStrategy) {
      toast({
        title: "Error",
        description: "Please select a strategy to backtest",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase.functions.invoke('automated-trading-engine', {
        body: {
          action: 'backtest_strategy',
          userId: user.id,
          strategyId: selectedStrategy
        }
      });

      if (error) throw error;

      setBacktestResult(data.backtest_results);
      toast({
        title: "Backtest Complete",
        description: `Analyzed ${data.backtest_results.total_trades} trades over ${data.period_days} days`,
      });
    } catch (error) {
      console.error('Error running backtest:', error);
      toast({
        title: "Error",
        description: "Failed to run backtest. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR'
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  if (loadingStrategies) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Strategy Backtesting
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Backtest Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Strategy Backtesting
          </CardTitle>
          <CardDescription>
            Test how your strategies would have performed using historical data and signals
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Strategy</label>
              <Select value={selectedStrategy} onValueChange={setSelectedStrategy}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a strategy to backtest" />
                </SelectTrigger>
                <SelectContent>
                  {strategies.map((strategy) => (
                    <SelectItem key={strategy.id} value={strategy.id}>
                      <div className="flex items-center gap-2">
                        <span>{strategy.strategy_name}</span>
                        {strategy.is_active && (
                          <Badge variant="secondary" className="text-xs">Active</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Backtest Period</label>
              <Select defaultValue="30">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button 
            onClick={runBacktest} 
            disabled={!selectedStrategy || isLoading}
            className="w-full"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Running Backtest...
              </>
            ) : (
              <>
                <Activity className="h-4 w-4 mr-2" />
                Run Backtest
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Backtest Results */}
      {backtestResult && (
        <div className="space-y-6">
          {/* Performance Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Backtest Results
              </CardTitle>
              <CardDescription>
                Performance analysis for {backtestResult.period_days} days
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Total Return</span>
                  </div>
                  <div className={`text-2xl font-bold ${backtestResult.total_return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatPercentage(backtestResult.total_return)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatCurrency(backtestResult.final_portfolio_value)} final value
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Total Trades</span>
                  </div>
                  <div className="text-2xl font-bold">{backtestResult.total_trades}</div>
                  <div className="text-sm text-muted-foreground">
                    {backtestResult.signals_analyzed} signals analyzed
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Win Rate</span>
                  </div>
                  <div className="text-2xl font-bold">{formatPercentage(backtestResult.win_rate)}</div>
                  <div className="text-sm text-muted-foreground">
                    {backtestResult.winning_trades} winning trades
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Effectiveness</span>
                  </div>
                  <div className="text-2xl font-bold">{formatPercentage(backtestResult.strategy_effectiveness)}</div>
                  <div className="text-sm text-muted-foreground">
                    Signal to trade conversion
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Win Rate Progress</span>
                  <span>{formatPercentage(backtestResult.win_rate)}</span>
                </div>
                <Progress value={backtestResult.win_rate} className="h-2" />
              </div>
            </CardContent>
          </Card>

          {/* Trade History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Trade History (Sample)
              </CardTitle>
              <CardDescription>
                Recent trades from the backtest simulation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {backtestResult.trades.map((trade, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Badge 
                        variant={trade.action === 'buy' ? 'default' : 'secondary'}
                        className={trade.action === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                      >
                        {trade.action.toUpperCase()}
                      </Badge>
                      <div>
                        <div className="font-medium">{trade.symbol}</div>
                        <div className="text-sm text-muted-foreground">
                          {trade.amount.toFixed(6)} @ {formatCurrency(trade.price)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{formatCurrency(trade.value)}</div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(trade.timestamp).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {backtestResult.trades.length === 0 && (
                <div className="text-center py-6 text-muted-foreground">
                  No trades were executed during this backtest period
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {strategies.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-6">
              <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No Trading Strategies</h3>
              <p className="text-muted-foreground mb-4">
                Create a trading strategy first to run backtests
              </p>
              <Button variant="outline">
                Create Strategy
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};