import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Settings, Activity, TrendingUp, Play, Pause, Edit, Copy, AlertTriangle, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ComprehensiveStrategyConfig } from './strategy/ComprehensiveStrategyConfig';

interface StrategyConfigProps {
  onLayoutChange?: (isFullWidth: boolean) => void;
}

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

export const StrategyConfig: React.FC<StrategyConfigProps> = ({ onLayoutChange }) => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { toast } = useToast();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [currentView, setCurrentView] = useState<'list' | 'create' | 'edit' | 'comprehensive'>('list');
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProductionActivationModal, setShowProductionActivationModal] = useState(false);
  const [strategyToActivate, setStrategyToActivate] = useState<Strategy | null>(null);

  useEffect(() => {
    if (user) {
      fetchStrategies();
    }
  }, [user, testMode]);

  // Notify parent component when view changes to full-width
  useEffect(() => {
    const isFullWidth = currentView === 'create' || currentView === 'comprehensive';
    if (onLayoutChange) {
      onLayoutChange(isFullWidth);
    }
  }, [currentView, onLayoutChange]);

  const fetchStrategies = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Filter strategies based on current view mode
      const filteredStrategies = (data || []).filter(strategy => {
        if (testMode) {
          // Test View: Only show test strategies (test_mode = true)
          return strategy.test_mode === true;
        } else {
          // Live View: Only show production strategies (test_mode = false)
          return strategy.test_mode === false;
        }
      });
      
      setStrategies(filteredStrategies);
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

  const handleStrategyToggle = (strategy: Strategy, isTest: boolean) => {
    if (!isTest && !strategy.is_active_live) {
      // For Live mode activation, show production confirmation
      setStrategyToActivate(strategy);
      setShowProductionActivationModal(true);
    } else {
      // For Test mode or deactivation, toggle directly
      toggleStrategy(strategy, isTest);
    }
  };

  const handleProductionActivation = () => {
    if (strategyToActivate) {
      toggleStrategy(strategyToActivate, false);
      setShowProductionActivationModal(false);
      setStrategyToActivate(null);
    }
  };

  const handleCancelProductionActivation = () => {
    setShowProductionActivationModal(false);
    setStrategyToActivate(null);
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
      // Create a copy in production (not move)
      const productionStrategy = {
        user_id: user.id,
        strategy_name: strategy.strategy_name,
        description: strategy.description,
        configuration: strategy.configuration,
        test_mode: false, // This marks it as production
        is_active: false,
        is_active_test: false,
        is_active_live: false, // Not automatically activated
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('trading_strategies')
        .insert(productionStrategy);

      if (error) throw error;

      await fetchStrategies();
      toast({
        title: "Strategy Pushed to Production",
        description: `${strategy.strategy_name} has been copied to Production. Switch to Live View to activate it.`,
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

  if (currentView === 'create' || currentView === 'comprehensive') {
    return (
      <ComprehensiveStrategyConfig
        onBack={() => {
          setCurrentView('list');
          setSelectedStrategy(null);
          fetchStrategies();
        }}
        existingStrategy={currentView === 'comprehensive' ? selectedStrategy : null}
        isEditing={currentView === 'comprehensive'}
        isCollapsed={false}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Trading Strategies</h2>
          <p className="text-white/80 font-medium">
            {testMode ? 'Test View - Simulation Environment' : 'Live View - Production Environment'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => setCurrentView('create')}
            className="px-6 py-2 max-w-xs"
          >
            <Plus className="h-4 w-4 mr-2" />
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
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          title="Delete Strategy"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Strategy</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{strategy.strategy_name}"? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteStrategy(strategy.id)}
                            className="bg-red-600 hover:bg-red-700"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    {/* Push to Production button - only show for test strategies that are active */}
                    {testMode && strategy.is_active_test && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="default"
                            size="sm"
                            className="bg-orange-600 hover:bg-orange-700 font-bold"
                            title="Push to Production"
                          >
                            Push to Production
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle className="flex items-center gap-2">
                              <AlertTriangle className="h-5 w-5 text-red-500" />
                              Push Strategy to Production
                            </AlertDialogTitle>
                            <AlertDialogDescription className="space-y-3">
                              <p className="font-bold text-red-600">
                                ⚠️ This strategy will now be moved to Production.
                              </p>
                              <p className="text-sm text-muted-foreground">
                                It will be visible in Live mode but not active until you manually activate it.
                              </p>
                              <p className="text-sm font-semibold text-red-600">
                                You will be trading with real funds once activated.
                              </p>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel – Keep Testing</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handlePushToProduction(strategy)}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              Yes, Go Live with Real Money
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    <Button
                      variant={testMode ? (strategy.is_active_test ? "destructive" : "default") : (strategy.is_active_live ? "destructive" : "default")}
                      size="sm"
                      onClick={() => handleStrategyToggle(strategy, testMode)}
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
                {/* Strategy Performance Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-4">
                  <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 dark:from-blue-950 dark:to-blue-900 dark:border-blue-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Risk Level</p>
                          <p className="text-lg font-bold text-blue-900 dark:text-blue-100">
                            {strategy.configuration?.riskProfile || 'Medium'}
                          </p>
                        </div>
                        <Settings className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200 dark:from-green-950 dark:to-green-900 dark:border-green-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-green-700 dark:text-green-300 uppercase tracking-wide">Win Rate</p>
                          <p className="text-lg font-bold text-green-900 dark:text-green-100">87.5%</p>
                        </div>
                        <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200 dark:from-purple-950 dark:to-purple-900 dark:border-purple-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wide">Total Trades</p>
                          <p className="text-lg font-bold text-purple-900 dark:text-purple-100">142</p>
                        </div>
                        <Activity className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200 dark:from-orange-950 dark:to-orange-900 dark:border-orange-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-orange-700 dark:text-orange-300 uppercase tracking-wide">Avg Duration</p>
                          <p className="text-lg font-bold text-orange-900 dark:text-orange-100">2.4h</p>
                        </div>
                        <Activity className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200 dark:from-red-950 dark:to-red-900 dark:border-red-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">Stop Loss</p>
                          <p className="text-lg font-bold text-red-900 dark:text-red-100">
                            {strategy.configuration?.stopLossPercentage || 3}%
                          </p>
                        </div>
                        <Activity className="h-5 w-5 text-red-600 dark:text-red-400" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200 dark:from-yellow-950 dark:to-yellow-900 dark:border-yellow-800">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-300 uppercase tracking-wide">Avg Profit</p>
                          <p className="text-lg font-bold text-yellow-900 dark:text-yellow-100">€12.45</p>
                        </div>
                        <TrendingUp className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Strategy Configuration Summary */}
                <div className="bg-muted/50 p-4 rounded-lg space-y-3">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="font-semibold text-foreground">Exposure:</span> 
                      <span className="ml-2 text-muted-foreground">{strategy.configuration?.maxWalletExposure || 50}%</span>
                    </div>
                    <div>
                      <span className="font-semibold text-foreground">Take Profit:</span> 
                      <span className="ml-2 text-muted-foreground">{strategy.configuration?.takeProfitPercentage || 2.5}%</span>
                    </div>
                    <div>
                      <span className="font-semibold text-foreground">Order Type:</span> 
                      <span className="ml-2 text-muted-foreground">{strategy.configuration?.buyOrderType || 'Market'}</span>
                    </div>
                  </div>
                </div>

                {/* Tags and Categories */}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30 font-medium">
                    {strategy.configuration?.selectedCoins?.length || 0} Coins
                  </Badge>
                  <Badge variant="outline" className="bg-secondary/20 text-secondary-foreground border-secondary/30 font-medium">
                    {strategy.configuration?.category || 'Trend'} Strategy
                  </Badge>
                  {strategy.configuration?.enableDCA && (
                    <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 border-green-300 dark:border-green-700 font-medium">
                      DCA Enabled
                    </Badge>
                  )}
                  {strategy.configuration?.enableShorting && (
                    <Badge variant="outline" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100 border-orange-300 dark:border-orange-700 font-medium">
                      Shorting
                    </Badge>
                  )}
                  <Badge variant="outline" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 border-blue-300 dark:border-blue-700 font-medium">
                    {strategy.configuration?.tags?.join(', ') || 'Scalping, Automated'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Production Activation Confirmation Modal */}
      <AlertDialog open={showProductionActivationModal} onOpenChange={setShowProductionActivationModal}>
        <AlertDialogContent className="bg-gradient-to-br from-card via-card/95 to-red-50/10 border-2 border-red-500/30 shadow-2xl">
          <AlertDialogHeader className="relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-red-500/10 via-transparent to-red-500/10" />
            <AlertDialogTitle className="flex items-center gap-3 text-xl relative z-10">
              <div className="h-10 w-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
              <span className="bg-gradient-to-r from-red-600 to-red-500 bg-clip-text text-transparent">
                Activate Strategy in Live Trading
              </span>
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4 text-base relative z-10">
              <div className="bg-red-50/80 dark:bg-red-950/50 p-4 rounded-lg border border-red-200/50 dark:border-red-800/50">
                <p className="font-bold text-red-700 dark:text-red-300 text-lg mb-2">
                  ⚠️ REAL MONEY TRADING WARNING
                </p>
                <p className="text-red-600 dark:text-red-400 font-medium">
                  You are about to activate "{strategyToActivate?.strategy_name}" with real funds from your connected Coinbase account.
                </p>
              </div>
              
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 bg-red-500 rounded-full"></div>
                  <span>This will execute real trades with actual money</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 bg-red-500 rounded-full"></div>
                  <span>You can incur real financial losses</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 bg-red-500 rounded-full"></div>
                  <span>Make sure you've thoroughly tested this strategy first</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 bg-red-500 rounded-full"></div>
                  <span>Monitor your positions actively</span>
                </div>
              </div>

              <div className="bg-amber-50/80 dark:bg-amber-950/50 p-3 rounded-lg border border-amber-200/50 dark:border-amber-800/50">
                <p className="text-amber-700 dark:text-amber-300 text-sm font-medium">
                  💡 Recommendation: Only activate strategies that have performed well in Test Mode.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3 pt-4">
            <AlertDialogCancel 
              onClick={handleCancelProductionActivation}
              className="hover:bg-muted/50"
            >
              Cancel - Keep Safe
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleProductionActivation}
              className="bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 text-white font-bold shadow-lg"
            >
              I Understand - Activate with Real Money
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};