import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, Brain, AlertCircle } from 'lucide-react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface PerformanceData {
  recent_trades: Array<{
    id: string;
    cryptocurrency: string;
    trade_type: string;
    amount: number;
    price: number;
    total_value: number;
    profit_loss: number;
    executed_at: string;
    strategy_trigger: string;
    notes: string;
    trading_strategies?: {
      strategy_name: string;
      configuration: any;
    };
  }>;
  ai_decisions: Array<{
    id: string;
    content: string;
    created_at: string;
    metadata: any;
  }>;
  summary: {
    total_trades: number;
    successful_trades: number;
    total_pnl: number;
    avg_trade_size: number;
  };
}

interface SignalEffectiveness {
  signal_type: string;
  total_signals: number;
  successful_predictions: number;
  effectiveness_rate: number;
  avg_confidence: number;
}

export const PerformanceDashboard: React.FC = () => {
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [signalEffectiveness, setSignalEffectiveness] = useState<SignalEffectiveness[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadPerformanceData();
    loadSignalEffectiveness();
  }, []);

  const loadPerformanceData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase.functions.invoke('automated-trading-engine', {
        body: {
          action: 'get_execution_log',
          userId: user.id
        }
      });

      if (error) throw error;
      setPerformanceData(data.execution_log);
    } catch (error) {
      console.error('Error loading performance data:', error);
      toast({
        title: "Error",
        description: "Failed to load performance data",
        variant: "destructive",
      });
    }
  };

  const loadSignalEffectiveness = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get AI knowledge about signal effectiveness
      const { data: knowledge, error } = await supabase
        .from('ai_knowledge_base')
        .select('*')
        .eq('user_id', user.id)
        .eq('knowledge_type', 'signal_correlation')
        .order('updated_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      // Process knowledge data to extract signal effectiveness
      const effectiveness = processSignalEffectiveness(knowledge || []);
      setSignalEffectiveness(effectiveness);
    } catch (error) {
      console.error('Error loading signal effectiveness:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const processSignalEffectiveness = (knowledge: any[]): SignalEffectiveness[] => {
    const signalMap = new Map<string, any>();

    knowledge.forEach(k => {
      if (k.metadata?.signal) {
        const signalType = k.metadata.signal.signal_type;
        const effectiveness = k.metadata.effectiveness === 'positive' ? 1 : 0;
        
        if (!signalMap.has(signalType)) {
          signalMap.set(signalType, {
            total: 0,
            successful: 0,
            confidenceSum: 0
          });
        }
        
        const current = signalMap.get(signalType);
        current.total += 1;
        current.successful += effectiveness;
        current.confidenceSum += k.confidence_score;
      }
    });

    return Array.from(signalMap.entries()).map(([signalType, data]) => ({
      signal_type: signalType,
      total_signals: data.total,
      successful_predictions: data.successful,
      effectiveness_rate: data.total > 0 ? (data.successful / data.total) * 100 : 0,
      avg_confidence: data.total > 0 ? data.confidenceSum / data.total : 0
    }));
  };

  const refreshData = async () => {
    setRefreshing(true);
    await Promise.all([loadPerformanceData(), loadSignalEffectiveness()]);
    setRefreshing(false);
    toast({
      title: "Data Refreshed",
      description: "Performance data has been updated",
    });
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

  const generatePnLChartData = () => {
    if (!performanceData) return [];
    
    let runningPnL = 0;
    return performanceData.recent_trades
      .slice().reverse()
      .map((trade, index) => {
        runningPnL += trade.profit_loss || 0;
        return {
          date: new Date(trade.executed_at).toLocaleDateString(),
          pnl: runningPnL,
          trade: `${trade.trade_type} ${trade.cryptocurrency}`,
          value: trade.total_value
        };
      });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance Dashboard</CardTitle>
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Performance Dashboard</h2>
          <p className="text-muted-foreground">Track your trading performance and AI effectiveness</p>
        </div>
        <Button onClick={refreshData} disabled={refreshing}>
          {refreshing ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
          ) : (
            <Activity className="h-4 w-4 mr-2" />
          )}
          Refresh Data
        </Button>
      </div>

      {/* Performance Overview */}
      {performanceData && (
        <div className="grid gap-6 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{performanceData.summary.total_trades}</div>
                  <div className="text-sm text-muted-foreground">Total Trades</div>
                </div>
                <Activity className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-2xl font-bold ${performanceData.summary.total_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(performanceData.summary.total_pnl)}
                  </div>
                  <div className="text-sm text-muted-foreground">Total P&L</div>
                </div>
                <DollarSign className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">
                    {performanceData.summary.total_trades > 0 ? 
                      formatPercentage((performanceData.summary.successful_trades / performanceData.summary.total_trades) * 100) :
                      '0%'
                    }
                  </div>
                  <div className="text-sm text-muted-foreground">Win Rate</div>
                </div>
                <Target className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">
                    {formatCurrency(performanceData.summary.avg_trade_size)}
                  </div>
                  <div className="text-sm text-muted-foreground">Avg Trade Size</div>
                </div>
                <TrendingUp className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="pnl" className="space-y-6">
        <TabsList>
          <TabsTrigger value="pnl">P&L Chart</TabsTrigger>
          <TabsTrigger value="trades">Recent Trades</TabsTrigger>
          <TabsTrigger value="signals">Signal Effectiveness</TabsTrigger>
          <TabsTrigger value="ai">AI Decisions</TabsTrigger>
        </TabsList>

        {/* P&L Chart */}
        <TabsContent value="pnl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Profit & Loss Over Time
              </CardTitle>
              <CardDescription>Cumulative performance across all trades</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={generatePnLChartData()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip 
                      formatter={(value: number) => [formatCurrency(value), 'P&L']}
                      labelFormatter={(label) => `Date: ${label}`}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="pnl" 
                      stroke="#8884d8" 
                      fill="#8884d8" 
                      fillOpacity={0.3}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recent Trades */}
        <TabsContent value="trades">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Recent Trades
              </CardTitle>
              <CardDescription>Latest trading activity and performance</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {performanceData?.recent_trades.slice(0, 10).map((trade) => (
                  <div key={trade.id} className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="flex items-center gap-4">
                      <Badge 
                        variant={trade.trade_type === 'buy' ? 'default' : 'secondary'}
                        className={trade.trade_type === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                      >
                        {trade.trade_type.toUpperCase()}
                      </Badge>
                      <div>
                        <div className="font-medium">{trade.cryptocurrency}</div>
                        <div className="text-sm text-muted-foreground">
                          {trade.trading_strategies?.strategy_name || 'Manual Trade'}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium">{formatCurrency(trade.total_value)}</div>
                        <div className="text-sm text-muted-foreground">
                          {trade.amount.toFixed(6)} @ {formatCurrency(trade.price)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-medium ${(trade.profit_loss || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(trade.profit_loss || 0)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(trade.executed_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
                
                {(!performanceData?.recent_trades || performanceData.recent_trades.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    No trades executed yet
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Signal Effectiveness */}
        <TabsContent value="signals">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Signal Effectiveness
              </CardTitle>
              <CardDescription>AI learning performance by signal type</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {signalEffectiveness.map((signal, index) => (
                  <div key={index} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{signal.signal_type}</div>
                        <div className="text-sm text-muted-foreground">
                          {signal.total_signals} signals • {signal.successful_predictions} successful
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{formatPercentage(signal.effectiveness_rate)}</div>
                        <div className="text-sm text-muted-foreground">
                          {(signal.avg_confidence * 100).toFixed(1)}% avg confidence
                        </div>
                      </div>
                    </div>
                    <Progress value={signal.effectiveness_rate} className="h-2" />
                  </div>
                ))}
                
                {signalEffectiveness.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-12 w-12 mx-auto mb-4" />
                    <p>No signal effectiveness data available yet</p>
                    <p className="text-sm">AI is still learning from incoming signals</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Decisions */}
        <TabsContent value="ai">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                AI Trading Decisions
              </CardTitle>
              <CardDescription>Recent AI recommendations and reasoning</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {performanceData?.ai_decisions.slice(0, 5).map((decision) => (
                  <div key={decision.id} className="p-4 rounded-lg border space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">AI Recommendation</Badge>
                      <div className="text-sm text-muted-foreground">
                        {new Date(decision.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-sm">{decision.content}</div>
                    {decision.metadata?.opportunities && (
                      <div className="text-xs text-muted-foreground mt-2">
                        Found {decision.metadata.opportunities.length} opportunities
                      </div>
                    )}
                  </div>
                ))}
                
                {(!performanceData?.ai_decisions || performanceData.ai_decisions.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    No AI decisions recorded yet
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};