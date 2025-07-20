import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Settings, Activity, TrendingUp, Play, Pause, Edit, Copy, AlertTriangle } from 'lucide-react';
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
      
      // If activating, first deactivate all other strategies in the same environment
      if (!currentValue) {
        const deactivateField = isTest ? 'is_active_test' : 'is_active_live';
        await supabase
          .from('trading_strategies')
          .update({ [deactivateField]: false })
          .eq('user_id', user.id)
          .neq('id', strategy.id);
      }
      
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

  const handlePushToProduction = async (strategy: Strategy) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('trading_strategies')
        .update({ 
          is_active_live: true,
          is_active_test: false
        })
        .eq('id', strategy.id)
        .eq('user_id', user.id);

      if (error) throw error;

      await fetchStrategies();
      toast({
        title: "Strategy Pushed to Production",
        description: `${strategy.strategy_name} is now live and will execute real trades`,
      });
    } catch (error) {
      console.error('Error pushing strategy to production:', error);
      toast({
        title: "Error",
        description: "Failed to push strategy to production",
        variant: "destructive",
      });
    }
  };

  const handleCloneStrategy = async (strategy: Strategy) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('trading_strategies')
        .insert({
          user_id: user.id,
          strategy_name: `${strategy.strategy_name} (Clone)`,
          description: `Clone of ${strategy.strategy_name}`,
          configuration: strategy.configuration,
          test_mode: true,
          is_active: false,
          is_active_test: false,
          is_active_live: false
        });

      if (error) throw error;

      await fetchStrategies();
      toast({
        title: "Strategy Cloned",
        description: `${strategy.strategy_name} has been cloned successfully`,
      });
    } catch (error) {
      console.error('Error cloning strategy:', error);
      toast({
        title: "Error",
        description: "Failed to clone strategy",
        variant: "destructive",
      });
    }
  };

  if (currentView === 'create') {
    return (
      <div className="w-full">
        <StrategyBuilder
          onCancel={() => {
            setCurrentView('list');
            fetchStrategies();
          }}
          isCollapsed={true}
        />
      </div>
    );
  }

  if (currentView === 'comprehensive') {
    return (
      <div className="w-full">
        <ComprehensiveStrategyConfig
          onBack={() => {
            setCurrentView('list');
            setSelectedStrategy(null);
            fetchStrategies();
          }}
          existingStrategy={selectedStrategy}
          isEditing={!!selectedStrategy}
          isCollapsed={true}
        />
      </div>
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
                      onClick={() => handleCloneStrategy(strategy)}
                      title="Clone Strategy"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStrategyEdit(strategy)}
                      title="Edit Strategy"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    {strategy.is_active_test && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="default"
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            title="Push to Production"
                          >
                            <TrendingUp className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle className="flex items-center gap-2">
                              <AlertTriangle className="h-5 w-5 text-yellow-500" />
                              Push Strategy to Production
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              ⚠️ This strategy will now execute real trades using your Coinbase funds. 
                              Are you sure you want to enable live trading for "{strategy.strategy_name}"?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handlePushToProduction(strategy)}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              Yes, Push to Live
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
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
              <CardContent className="space-y-4">
                {/* Strategy Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Risk Level</p>
                          <p className="text-xl font-bold text-blue-900 dark:text-blue-100">
                            {strategy.configuration?.riskProfile || 'Medium'}
                          </p>
                        </div>
                        <Settings className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-green-600 dark:text-green-400">Max Exposure</p>
                          <p className="text-xl font-bold text-green-900 dark:text-green-100">
                            {strategy.configuration?.maxWalletExposure || 50}%
                          </p>
                        </div>
                        <TrendingUp className="h-6 w-6 text-green-600 dark:text-green-400" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-red-600 dark:text-red-400">Stop Loss</p>
                          <p className="text-xl font-bold text-red-900 dark:text-red-100">
                            {strategy.configuration?.stopLossPercentage || 3}%
                          </p>
                        </div>
                        <Activity className="h-6 w-6 text-red-600 dark:text-red-400" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">Take Profit</p>
                          <p className="text-xl font-bold text-yellow-900 dark:text-yellow-100">
                            {strategy.configuration?.takeProfitPercentage || 2.5}%
                          </p>
                        </div>
                        <TrendingUp className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Tags and Categories */}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="bg-primary/10">
                    {strategy.configuration?.selectedCoins?.length || 0} Coins
                  </Badge>
                  <Badge variant="outline" className="bg-secondary/10">
                    {strategy.configuration?.buyOrderType || 'Market'} Orders
                  </Badge>
                  {strategy.configuration?.enableDCA && (
                    <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                      DCA Enabled
                    </Badge>
                  )}
                  {strategy.configuration?.enableShorting && (
                    <Badge variant="outline" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100">
                      Shorting
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};