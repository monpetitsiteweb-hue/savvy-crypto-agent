import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Bot, Play, Pause, Settings, Activity, AlertTriangle, CheckCircle } from 'lucide-react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Strategy {
  id: string;
  strategy_name: string;
  configuration: any;
  is_active: boolean;
  is_active_test: boolean;
  is_active_live: boolean;
}

interface AutomationStatus {
  executions: number;
  last_execution: string | null;
  mode: 'mock' | 'live';
  strategies_active: number;
}

export const StrategyAutomation: React.FC = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus>({
    executions: 0,
    last_execution: null,
    mode: 'mock',
    strategies_active: 0
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [automationMode, setAutomationMode] = useState<'mock' | 'live'>('mock');
  const [autoExecute, setAutoExecute] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadStrategies();
    loadAutomationStatus();
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
      
      const activeCount = strategiesData?.filter(s => s.is_active).length || 0;
      setAutomationStatus(prev => ({ ...prev, strategies_active: activeCount }));
    } catch (error) {
      console.error('Error loading strategies:', error);
      toast({
        title: "Error",
        description: "Failed to load strategies",
        variant: "destructive",
      });
    }
  };

  const loadAutomationStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get recent executions from conversation history
      const { data: recentExecutions, error } = await supabase
        .from('conversation_history')
        .select('*')
        .eq('user_id', user.id)
        .eq('message_type', 'ai_recommendation')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false });

      if (!error && recentExecutions) {
        setAutomationStatus(prev => ({
          ...prev,
          executions: recentExecutions.length,
          last_execution: recentExecutions[0]?.created_at || null
        }));
      }
    } catch (error) {
      console.error('Error loading automation status:', error);
    }
  };

  const processSignals = async () => {
    setIsProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase.functions.invoke('automated-trading-engine', {
        body: {
          action: 'process_signals',
          userId: user.id,
          mode: automationMode
        }
      });

      if (error) throw error;

      toast({
        title: "Signals Processed",
        description: `${data.executions?.length || 0} strategy executions completed in ${automationMode} mode`,
      });

      // Refresh data
      await loadAutomationStatus();
      
    } catch (error) {
      console.error('Error processing signals:', error);
      toast({
        title: "Error",
        description: "Failed to process signals. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleStrategyActive = async (strategyId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('trading_strategies')
        .update({ 
          is_active: isActive,
          is_active_test: isActive && automationMode === 'mock',
          is_active_live: isActive && automationMode === 'live'
        })
        .eq('id', strategyId);

      if (error) throw error;

      await loadStrategies();
      
      toast({
        title: `Strategy ${isActive ? 'Activated' : 'Deactivated'}`,
        description: `Strategy is now ${isActive ? 'active' : 'inactive'} for automated execution`,
      });
    } catch (error) {
      console.error('Error updating strategy:', error);
      toast({
        title: "Error",
        description: "Failed to update strategy status",
        variant: "destructive",
      });
    }
  };

  const executeStrategy = async (strategyId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase.functions.invoke('automated-trading-engine', {
        body: {
          action: 'execute_strategy',
          userId: user.id,
          strategyId: strategyId,
          mode: automationMode
        }
      });

      if (error) throw error;

      toast({
        title: "Strategy Executed",
        description: `${data.strategy_name} executed successfully in ${automationMode} mode`,
      });

      await loadAutomationStatus();
      
    } catch (error) {
      console.error('Error executing strategy:', error);
      toast({
        title: "Error",
        description: "Failed to execute strategy. Please try again.",
        variant: "destructive",
      });
    }
  };

  const updateStrategyConfig = async (strategyId: string, newConfig: any) => {
    try {
      const strategy = strategies.find(s => s.id === strategyId);
      if (!strategy) return;

      const updatedConfig = { ...strategy.configuration, ...newConfig };

      const { error } = await supabase
        .from('trading_strategies')
        .update({ configuration: updatedConfig })
        .eq('id', strategyId);

      if (error) throw error;
      await loadStrategies();
      
      toast({
        title: "Configuration Updated",
        description: "Strategy automation settings have been saved",
      });
    } catch (error) {
      console.error('Error updating strategy config:', error);
      toast({
        title: "Error",
        description: "Failed to update strategy configuration",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Automation Control Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Strategy Automation Control
          </CardTitle>
          <CardDescription>
            Manage automated strategy execution based on AI signals
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Status Overview */}
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Active Strategies</span>
              </div>
              <div className="text-2xl font-bold">{automationStatus.strategies_active}</div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Executions (24h)</span>
              </div>
              <div className="text-2xl font-bold">{automationStatus.executions}</div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Mode</span>
              </div>
              <Badge variant={automationMode === 'live' ? 'destructive' : 'secondary'}>
                {automationMode.toUpperCase()}
              </Badge>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Last Execution</span>
              </div>
              <div className="text-sm text-muted-foreground">
                {automationStatus.last_execution ? 
                  new Date(automationStatus.last_execution).toLocaleString() : 
                  'Never'
                }
              </div>
            </div>
          </div>

          <Separator />

          {/* Controls */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Execution Mode</Label>
              <Select value={automationMode} onValueChange={(value: 'mock' | 'live') => setAutomationMode(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mock">Mock Trading</SelectItem>
                  <SelectItem value="live">Live Trading</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Auto Process Signals</Label>
              <div className="flex items-center space-x-2">
                <Switch 
                  checked={autoExecute} 
                  onCheckedChange={setAutoExecute}
                />
                <span className="text-sm text-muted-foreground">
                  {autoExecute ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Manual Processing</Label>
              <Button 
                onClick={processSignals} 
                disabled={isProcessing}
                className="w-full"
              >
                {isProcessing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Process Signals
                  </>
                )}
              </Button>
            </div>
          </div>

          {automationMode === 'live' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-50 border border-orange-200">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              <span className="text-sm text-orange-800">
                Live trading mode will execute real trades with your Coinbase account. Use with caution.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Strategy List */}
      <Card>
        <CardHeader>
          <CardTitle>Strategy Configuration</CardTitle>
          <CardDescription>Configure individual strategy automation settings</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {strategies.map((strategy) => (
              <div key={strategy.id} className="border rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">{strategy.strategy_name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {strategy.configuration?.symbols?.join(', ') || 'All symbols'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={strategy.is_active}
                      onCheckedChange={(checked) => toggleStrategyActive(strategy.id, checked)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => executeStrategy(strategy.id)}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      Execute
                    </Button>
                  </div>
                </div>

                {strategy.is_active && (
                  <div className="grid gap-4 md:grid-cols-3 pt-3 border-t">
                    <div className="space-y-2">
                      <Label className="text-xs">Confidence Threshold</Label>
                      <Input
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={strategy.configuration?.confidence_threshold || 0.7}
                        onChange={(e) => updateStrategyConfig(strategy.id, {
                          confidence_threshold: parseFloat(e.target.value)
                        })}
                        className="h-8"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Min Signal Strength</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={strategy.configuration?.minimum_signal_strength || 60}
                        onChange={(e) => updateStrategyConfig(strategy.id, {
                          minimum_signal_strength: parseInt(e.target.value)
                        })}
                        className="h-8"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Trade Amount (EUR)</Label>
                      <Input
                        type="number"
                        min="1"
                        value={strategy.configuration?.trade_amount || 100}
                        onChange={(e) => updateStrategyConfig(strategy.id, {
                          trade_amount: parseInt(e.target.value)
                        })}
                        className="h-8"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {strategies.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Bot className="h-12 w-12 mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No Strategies Found</h3>
                <p>Create a trading strategy to enable automation</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};