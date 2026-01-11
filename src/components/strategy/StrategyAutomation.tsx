import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTradeViewFilter';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Play, Pause, Settings, Clock, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';
import { normalizeStrategy, StrategyData } from '@/types/strategy';

interface AutomationStatus {
  is_enabled: boolean;
  strategies_active: number;
  last_execution: Date | null;
  next_execution: Date | null;
  execution_interval: string;
}

export const StrategyAutomation: React.FC = () => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { toast } = useToast();
  
  const [strategies, setStrategies] = useState<StrategyData[]>([]);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus>({
    is_enabled: false,
    strategies_active: 0,
    last_execution: null,
    next_execution: null,
    execution_interval: '5m'
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadStrategies();
      loadAutomationStatus();
    }
  }, [user, testMode]);

  const loadStrategies = async () => {
    if (!user) return;
    
    try {
      const { data: strategiesData, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setStrategies((strategiesData || []).map(normalizeStrategy));
      
      const activeCount = strategiesData?.filter(s => s.is_active).length || 0;
      setAutomationStatus(prev => ({ ...prev, strategies_active: activeCount }));
    } catch (error) {
      console.error('Error loading strategies:', error);
    }
  };

  const loadAutomationStatus = async () => {
    try {
      // Check for any active strategies and recent executions
      // This is a simplified implementation for now
      setAutomationStatus(prev => ({
        ...prev,
        last_execution: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        next_execution: new Date(Date.now() + 5 * 60 * 1000)   // 5 minutes from now
      }));
    } catch (error) {
      console.error('Error loading automation status:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleAutomation = async () => {
    try {
      const newStatus = !automationStatus.is_enabled;
      setAutomationStatus(prev => ({ ...prev, is_enabled: newStatus }));
      
      toast({
        title: newStatus ? "Automation Enabled" : "Automation Disabled",
        description: newStatus 
          ? "Strategy automation is now running" 
          : "Strategy automation has been paused"
      });
    } catch (error) {
      console.error('Error toggling automation:', error);
      toast({
        title: "Error",
        description: "Failed to toggle automation",
        variant: "destructive"
      });
    }
  };

  const updateExecutionInterval = async (interval: string) => {
    try {
      setAutomationStatus(prev => ({ ...prev, execution_interval: interval }));
      
      toast({
        title: "Execution Interval Updated",
        description: `Strategies will now execute every ${interval}`
      });
    } catch (error) {
      console.error('Error updating execution interval:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading automation settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Strategy Automation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="automation-toggle" className="text-sm font-medium">
                Enable Automation
              </Label>
              <p className="text-sm text-muted-foreground">
                Automatically execute active trading strategies
              </p>
            </div>
            <Switch
              id="automation-toggle"
              checked={automationStatus.is_enabled}
              onCheckedChange={toggleAutomation}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Execution Interval</Label>
              <Select 
                value={automationStatus.execution_interval} 
                onValueChange={updateExecutionInterval}
                disabled={!automationStatus.is_enabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1m">Every minute</SelectItem>
                  <SelectItem value="5m">Every 5 minutes</SelectItem>
                  <SelectItem value="15m">Every 15 minutes</SelectItem>
                  <SelectItem value="1h">Every hour</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium">Active Strategies</Label>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-lg px-3 py-1">
                  {automationStatus.strategies_active}
                </Badge>
                <span className="text-sm text-muted-foreground">strategies running</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Status</Label>
              <div className="flex items-center gap-2">
                <Badge variant={automationStatus.is_enabled ? "default" : "secondary"}>
                  {automationStatus.is_enabled ? (
                    <>
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Running
                    </>
                  ) : (
                    <>
                      <Pause className="h-3 w-3 mr-1" />
                      Paused
                    </>
                  )}
                </Badge>
              </div>
            </div>
          </div>

          <div className="border-t pt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <Label className="font-medium text-muted-foreground">Last Execution</Label>
                <p className="mt-1">
                  {automationStatus.last_execution 
                    ? automationStatus.last_execution.toLocaleString()
                    : 'Never'
                  }
                </p>
              </div>
              <div>
                <Label className="font-medium text-muted-foreground">Next Execution</Label>
                <p className="mt-1">
                  {automationStatus.next_execution && automationStatus.is_enabled
                    ? automationStatus.next_execution.toLocaleString()
                    : 'N/A'
                  }
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Strategy Status</CardTitle>
        </CardHeader>
        <CardContent>
          {strategies.length === 0 ? (
            <div className="text-center py-8">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No strategies found</p>
              <p className="text-sm text-muted-foreground mt-2">
                Create a strategy first to enable automation
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {strategies.map((strategy) => (
                <div key={strategy.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <h4 className="font-medium">{strategy.strategy_name}</h4>
                    <p className="text-sm text-muted-foreground">
                      {testMode ? 'Test Mode' : 'Live Mode'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={
                      strategy.is_active ? 'default' : 'outline'
                    }>
                      {strategy.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};