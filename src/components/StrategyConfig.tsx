import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Settings, Activity, TrendingUp, Play, Pause, Edit } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ComprehensiveStrategyConfig } from './strategy/ComprehensiveStrategyConfig';
import { StrategyBuilder } from './strategy/StrategyBuilder';

interface StrategyConfigProps {}

interface Strategy {
  id: string;
  strategy_name: string;
  description: string;
  configuration: any;
  is_active_test: boolean;
  is_active_live: boolean;
  test_mode: boolean;
  created_at: string;
  updated_at: string;
}

export const StrategyConfig: React.FC<StrategyConfigProps> = () => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { toast } = useToast();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [currentView, setCurrentView] = useState<'list' | 'create' | 'edit' | 'comprehensive'>('list');
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchStrategies();
    }
  }, [user, testMode]);

  const fetchStrategies = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setStrategies(data || []);
    } catch (error) {
      console.error('Error fetching strategies:', error);
      toast({
        title: "Error",
        description: "Failed to fetch strategies",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleStrategy = async (strategy: Strategy, isTest: boolean) => {
    if (!user) return;

    try {
      const field = isTest ? 'is_active_test' : 'is_active_live';
      const currentValue = isTest ? strategy.is_active_test : strategy.is_active_live;
      
      const { error } = await supabase
        .from('trading_strategies')
        .update({ [field]: !currentValue })
        .eq('id', strategy.id)
        .eq('user_id', user.id);

      if (error) throw error;

      await fetchStrategies();
      
      toast({
        title: currentValue ? "Strategy Deactivated" : "Strategy Activated",
        description: `${strategy.strategy_name} ${currentValue ? 'stopped' : 'started'} in ${isTest ? 'test' : 'live'} mode`,
      });
    } catch (error) {
      console.error('Error toggling strategy:', error);
      toast({
        title: "Error",
        description: "Failed to toggle strategy",
        variant: "destructive",
      });
    }
  };

  const deleteStrategy = async (strategyId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('trading_strategies')
        .delete()
        .eq('id', strategyId)
        .eq('user_id', user.id);

      if (error) throw error;

      await fetchStrategies();
      toast({
        title: "Strategy Deleted",
        description: "Strategy has been removed successfully",
      });
    } catch (error) {
      console.error('Error deleting strategy:', error);
      toast({
        title: "Error",
        description: "Failed to delete strategy",
        variant: "destructive",
      });
    }
  };

  const handleStrategyEdit = (strategy: Strategy) => {
    setSelectedStrategy(strategy);
    setCurrentView('comprehensive');
  };

  if (currentView === 'create') {
    return (
      <StrategyBuilder
        onCancel={() => {
          setCurrentView('list');
          fetchStrategies();
        }}
      />
    );
  }

  if (currentView === 'comprehensive') {
    return (
      <ComprehensiveStrategyConfig
        onBack={() => {
          setCurrentView('list');
          setSelectedStrategy(null);
          fetchStrategies();
        }}
        existingStrategy={selectedStrategy}
        isEditing={!!selectedStrategy}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Trading Strategies</h2>
          <p className="text-muted-foreground">
            Manage your automated trading strategies {testMode ? '(Test Mode)' : '(Live Mode)'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => setCurrentView('create')}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Strategy
          </Button>
          <Button 
            onClick={() => setCurrentView('comprehensive')}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Settings className="h-4 w-4" />
            Advanced Config
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">Loading strategies...</div>
      ) : strategies.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Activity className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Strategies Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first trading strategy to get started with automated trading.
            </p>
            <Button onClick={() => setCurrentView('create')}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Strategy
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {strategies.map((strategy) => (
            <Card key={strategy.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {strategy.strategy_name}
                      {testMode ? (
                        strategy.is_active_test ? (
                          <Badge variant="default" className="bg-green-500">Test Active</Badge>
                        ) : (
                          <Badge variant="outline">Test Inactive</Badge>
                        )
                      ) : (
                        strategy.is_active_live ? (
                          <Badge variant="default" className="bg-green-500">Live Active</Badge>
                        ) : (
                          <Badge variant="outline">Live Inactive</Badge>
                        )
                      )}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {strategy.description || 'No description provided'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStrategyEdit(strategy)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={testMode ? (strategy.is_active_test ? "destructive" : "default") : (strategy.is_active_live ? "destructive" : "default")}
                      size="sm"
                      onClick={() => toggleStrategy(strategy, testMode)}
                    >
                      {testMode ? (
                        strategy.is_active_test ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )
                      ) : (
                        strategy.is_active_live ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Risk Level:</span>
                    <p className="font-medium">{strategy.configuration?.riskProfile || 'Medium'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Max Exposure:</span>
                    <p className="font-medium">{strategy.configuration?.maxWalletExposure || 50}%</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Stop Loss:</span>
                    <p className="font-medium">{strategy.configuration?.stopLossPercentage || 3}%</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Take Profit:</span>
                    <p className="font-medium">{strategy.configuration?.takeProfitPercentage || 2.5}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};