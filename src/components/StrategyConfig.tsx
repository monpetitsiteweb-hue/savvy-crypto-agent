import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Play, 
  Pause, 
  Edit, 
  Trash2, 
  Plus, 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  Shield,
  TestTube,
  Target,
  DollarSign,
  Activity
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger 
} from '@/components/ui/alert-dialog';
import { ComprehensiveStrategyConfig } from '@/components/strategy/ComprehensiveStrategyConfig';

interface StrategyConfigProps {}

interface Strategy {
  id: string;
  strategy_name: string;
  configuration: any;
  is_active_test: boolean;
  is_active_live: boolean;
  test_mode: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
}

interface StrategyPerformance {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_profit_loss: number;
  total_fees: number;
  win_rate: number;
}

export const StrategyConfig: React.FC<StrategyConfigProps> = () => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const [activeStrategy, setActiveStrategy] = useState<Strategy | null>(null);
  const [hasActiveStrategy, setHasActiveStrategy] = useState(false);
  const [allStrategies, setAllStrategies] = useState<Strategy[]>([]);
  const [strategyPerformance, setStrategyPerformance] = useState<StrategyPerformance | null>(null);
  const [viewMode, setViewMode] = useState<'overview' | 'configure'>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [activeMenuItem, setActiveMenuItem] = useState('basic-settings');
  const [strategyConfig, setStrategyConfig] = useState({
    name: '',
    riskLevel: 'medium' as 'low' | 'medium' | 'high',
    maxPosition: 5000,
    takeProfit: 1.3,
    stopLoss: 1.0,
    targetCoins: [] as string[],
    exchanges: [] as string[],
  });

  // Load all strategies - CRITICAL: Only depend on user, not testMode
  useEffect(() => {
    const loadStrategies = async () => {
      if (!user) {
        setAllStrategies([]);
        setHasActiveStrategy(false);
        setActiveStrategy(null);
        return;
      }
      
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (data && !error) {
        setAllStrategies(data);
        
        const activeStrategyData = data.find(s => 
          testMode ? s.is_active_test : s.is_active_live
        );
        
        if (activeStrategyData) {
          setHasActiveStrategy(true);
          setActiveStrategy(activeStrategyData);
          
          // Load performance data for active strategy
          const { data: performanceData } = await supabase
            .from('strategy_performance')
            .select('*')
            .eq('strategy_id', activeStrategyData.id)
            .eq('is_test_mode', testMode)
            .order('execution_date', { ascending: false })
            .limit(1);

          if (performanceData && performanceData.length > 0) {
            setStrategyPerformance(performanceData[0]);
          }
        } else {
          setHasActiveStrategy(false);
          setActiveStrategy(null);
        }
      } else {
        setHasActiveStrategy(false);
        setActiveStrategy(null);
        setAllStrategies([]);
      }
    };

    loadStrategies();
  }, [user]); // ONLY user dependency

  // Update active strategy when testMode changes - SEPARATE effect to avoid re-renders
  useEffect(() => {
    if (allStrategies.length > 0) {
      const activeStrategyData = allStrategies.find(s => 
        testMode ? s.is_active_test : s.is_active_live
      );
      
      if (activeStrategyData) {
        setActiveStrategy(activeStrategyData);
        setHasActiveStrategy(true);
      } else {
        setActiveStrategy(null);
        setHasActiveStrategy(false);
      }
    }
  }, [testMode, allStrategies]); // Separate from main loading effect

  const handleCreateStrategy = useCallback(() => {
    console.log('🔥 handleCreateStrategy called - setting viewMode to configure');
    setIsEditing(false);
    setViewMode('configure');
    console.log('🔥 viewMode should now be configure');
  }, []);

  const handleEditStrategy = useCallback(() => {
    if (activeStrategy && activeStrategy.configuration) {
      setStrategyConfig(prevConfig => ({ 
        ...prevConfig, 
        ...activeStrategy.configuration,
        name: activeStrategy.strategy_name || prevConfig.name
      }));
    }
    setIsEditing(true);
    setViewMode('configure');
  }, [activeStrategy]);

  const handleBackToOverview = useCallback(() => {
    setViewMode('overview');
    setActiveMenuItem('basic-settings');
  }, []);

  const handleSaveStrategy = useCallback(async () => {
    if (!user) return;
    
    try {
      if (isEditing && activeStrategy) {
        const { error } = await supabase
          .from('trading_strategies')
          .update({
            strategy_name: strategyConfig.name || 'My Trading Strategy',
            configuration: strategyConfig,
            test_mode: testMode,
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeStrategy.id)
          .eq('user_id', user.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('trading_strategies')
          .insert({
            user_id: user.id,
            strategy_name: strategyConfig.name || 'My Trading Strategy',
            configuration: strategyConfig,
            test_mode: testMode,
            is_active: false,
          });

        if (error) throw error;
      }

      toast({
        title: "Strategy saved",
        description: "Your trading strategy has been saved successfully.",
      });
      
      const activeField = testMode ? 'is_active_test' : 'is_active_live';
      const { data } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq(activeField, true)
        .maybeSingle();
      
      if (data) {
        setActiveStrategy(data);
        setHasActiveStrategy(true);
      }
      
      setViewMode('overview');
    } catch (error) {
      console.error('Error saving strategy:', error);
      toast({
        title: "Error",
        description: "Failed to save strategy. Please try again.",
        variant: "destructive",
      });
    }
  }, [user, isEditing, activeStrategy, strategyConfig, testMode, toast]);

  // Delete strategy
  const handleDeleteStrategy = useCallback(async (strategyId: string, strategyName: string) => {
    if (!user) return;
    
    try {
      const { error } = await supabase
        .from('trading_strategies')
        .delete()
        .eq('id', strategyId)
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: "Strategy deleted",
        description: `Strategy "${strategyName}" has been deleted permanently.`,
      });

      // Refresh strategies list
      const { data } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (data) {
        setAllStrategies(data);
        const activeStrategyData = data.find(s => 
          testMode ? s.is_active_test : s.is_active_live
        );
        
        if (activeStrategyData) {
          setHasActiveStrategy(true);
          setActiveStrategy(activeStrategyData);
        } else {
          setHasActiveStrategy(false);
          setActiveStrategy(null);
        }
      }
    } catch (error) {
      console.error('Error deleting strategy:', error);
      toast({
        title: "Error",
        description: "Unable to delete strategy.",
        variant: "destructive",
      });
    }
  }, [user, testMode, toast]);

  // Toggle strategy activation
  const handleToggleStrategy = useCallback(async (strategyId: string, isCurrentlyActive: boolean) => {
    if (!user) return;

    try {
      const activeField = testMode ? 'is_active_test' : 'is_active_live';
      
      if (isCurrentlyActive) {
        // Deactivate the strategy
        const { error } = await supabase
          .from('trading_strategies')
          .update({ [activeField]: false })
          .eq('id', strategyId)
          .eq('user_id', user.id);

        if (error) throw error;

        toast({
          title: "Strategy Deactivated",
          description: `Strategy has been deactivated in ${testMode ? 'Test' : 'Live'} mode.`,
        });
      } else {
        // First deactivate all other strategies in this mode
        await supabase
          .from('trading_strategies')
          .update({ [activeField]: false })
          .eq('user_id', user.id);

        // Then activate this strategy
        const { error } = await supabase
          .from('trading_strategies')
          .update({ [activeField]: true })
          .eq('id', strategyId)
          .eq('user_id', user.id);

        if (error) throw error;

        toast({
          title: "Strategy Activated",
          description: `Strategy has been activated in ${testMode ? 'Test' : 'Live'} mode.`,
        });
      }

      // Refresh the strategies list
      const { data } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (data) {
        setAllStrategies(data);
        const activeStrategyData = data.find(s => 
          testMode ? s.is_active_test : s.is_active_live
        );
        
        if (activeStrategyData) {
          setHasActiveStrategy(true);
          setActiveStrategy(activeStrategyData);
        } else {
          setHasActiveStrategy(false);
          setActiveStrategy(null);
        }
      }
    } catch (error) {
      console.error('Error toggling strategy:', error);
      toast({
        title: "Error",
        description: "Unable to modify strategy status.",
        variant: "destructive",
      });
    }
  }, [user, testMode, toast]);

  // Performance Overview Component
  const PerformanceOverview = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-green-400" />
          <h3 className="text-xl font-semibold text-white">Performance Overview</h3>
          {testMode && (
            <Badge variant="secondary" className="bg-orange-500/20 text-orange-400 border-orange-500/30">
              <TestTube className="h-3 w-3 mr-1" />
              Test Mode
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleEditStrategy}
            className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
          >
            <Edit className="w-4 h-4 mr-2" />
            Edit Strategy
          </Button>
        </div>
      </div>

      {/* Performance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Total P&L</p>
              <p className={`text-2xl font-bold ${
                (strategyPerformance?.total_profit_loss || 0) >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                €{(strategyPerformance?.total_profit_loss || 0).toFixed(2)}
              </p>
              <p className="text-xs text-slate-500">
                {(strategyPerformance?.total_profit_loss || 0) >= 0 ? 'Profit' : 'Loss'}
              </p>
            </div>
            {(strategyPerformance?.total_profit_loss || 0) >= 0 ? (
              <TrendingUp className="w-8 h-8 text-green-400" />
            ) : (
              <TrendingDown className="w-8 h-8 text-red-400" />
            )}
          </div>
        </Card>

        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Win Rate</p>
              <p className="text-2xl font-bold text-cyan-400">
                {strategyPerformance?.win_rate || 0}%
              </p>
              <p className="text-xs text-slate-500">
                {strategyPerformance ? 
                  `${strategyPerformance.winning_trades}W / ${strategyPerformance.losing_trades}L` : 
                  'Strategy not started'
                }
              </p>
            </div>
            <BarChart3 className="w-8 h-8 text-cyan-400" />
          </div>
        </Card>

        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Total Trades</p>
              <p className="text-2xl font-bold text-white">{strategyPerformance?.total_trades || 0}</p>
              <p className="text-xs text-slate-500">Executed trades</p>
            </div>
            <Target className="w-8 h-8 text-blue-400" />
          </div>
        </Card>

        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Total Fees</p>
              <p className="text-2xl font-bold text-white">
                €{(strategyPerformance?.total_fees || 0).toFixed(2)}
              </p>
              <p className="text-xs text-slate-500">Trading costs</p>
            </div>
            <Shield className="w-8 h-8 text-slate-400" />
          </div>
        </Card>
      </div>

      <Card className="p-6 bg-slate-700/30 border-slate-600">
        <h3 className="text-lg font-semibold text-white mb-4">Strategy Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-slate-400 text-sm">Risk Level</p>
            <p className="text-white font-medium">
              {strategyConfig.riskLevel === 'low' ? 'Conservative' : 
               strategyConfig.riskLevel === 'medium' ? 'Moderate' : 'Aggressive'}
            </p>
          </div>
          <div>
            <p className="text-slate-400 text-sm">Max Position</p>
            <p className="text-white font-medium">€{strategyConfig.maxPosition?.toLocaleString() || '5,000'}</p>
          </div>
          <div>
            <p className="text-slate-400 text-sm">Take Profit</p>
            <p className="text-white font-medium">{strategyConfig.takeProfit || 1.3}%</p>
          </div>
          <div>
            <p className="text-slate-400 text-sm">Stop Loss</p>
            <p className="text-white font-medium">{strategyConfig.stopLoss || 1.0}%</p>
          </div>
        </div>
      </Card>

      {/* All strategies list */}
      {allStrategies.length > 0 && (
        <Card className="p-6 bg-slate-700/30 border-slate-600">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">All Strategies</h3>
            <Button 
              onClick={() => {
                console.log('🔴 TEST MODE BUTTON CLICKED!', { testMode, allStrategies: allStrategies.length });
                console.log('🔴 About to call handleCreateStrategy...');
                handleCreateStrategy();
                console.log('🔴 handleCreateStrategy called!');
              }}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add a strategy
            </Button>
          </div>
          <div className="space-y-3">
            {allStrategies.map((strategy) => (
              <Card key={strategy.id} className="p-4 bg-slate-800/30 border-slate-600">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h4 className="text-white font-medium">{strategy.strategy_name}</h4>
                      {/* Show Active badge based on current mode */}
                      {((testMode && strategy.is_active_test) || (!testMode && strategy.is_active_live)) && (
                        <Badge className="bg-green-500 text-white">Active</Badge>
                      )}
                      {/* Show mode badge based on where strategy was created or can be activated */}
                      {strategy.test_mode && (
                        <Badge variant="secondary" className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                          <TestTube className="h-3 w-3 mr-1" />
                          Test
                        </Badge>
                      )}
                    </div>
                    <p className="text-slate-400 text-sm mt-1">
                      Created on {new Date(strategy.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {/* Only show edit for inactive strategies */}
                    {!((testMode && strategy.is_active_test) || (!testMode && strategy.is_active_live)) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setActiveStrategy(strategy);
                          setStrategyConfig(prevConfig => ({ 
                            ...prevConfig, 
                            ...(strategy.configuration as Record<string, any>) 
                          }));
                          handleEditStrategy();
                        }}
                        className="bg-slate-600 border-slate-500 text-slate-300 hover:bg-slate-500"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                    )}
                    
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className={`${
                            ((testMode && strategy.is_active_test) || (!testMode && strategy.is_active_live))
                              ? 'bg-green-500/20 border-green-500 text-green-400 hover:bg-green-500/30' 
                              : 'bg-slate-600 border-slate-500 text-slate-300 hover:bg-slate-500'
                          }`}
                        >
                         {((testMode && strategy.is_active_test) || (!testMode && strategy.is_active_live)) ? (
                           <>
                             <Pause className="w-4 h-4 mr-2" />
                             Deactivate
                           </>
                         ) : (
                           <>
                             <Play className="w-4 h-4 mr-2" />
                             Activate
                           </>
                         )}
                       </Button>
                     </AlertDialogTrigger>
                    <AlertDialogContent className="bg-slate-800 border-slate-700">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-white">
                          {((testMode && strategy.is_active_test) || (!testMode && strategy.is_active_live)) ? 'Deactivate Strategy' : 'Activate Strategy'}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">
                          {((testMode && strategy.is_active_test) || (!testMode && strategy.is_active_live))
                            ? `Are you sure you want to deactivate the strategy "${strategy.strategy_name}" in ${testMode ? 'Test' : 'Live'} mode? This will stop all automated trading.`
                            : `Are you sure you want to activate the strategy "${strategy.strategy_name}" in ${testMode ? 'Test' : 'Live'} mode? This will automatically deactivate any other active strategy in this mode.`
                          }
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600">
                          Cancel
                        </AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={() => handleToggleStrategy(strategy.id, (testMode && strategy.is_active_test) || (!testMode && strategy.is_active_live))}
                          className={`${
                            ((testMode && strategy.is_active_test) || (!testMode && strategy.is_active_live))
                              ? 'bg-red-600 hover:bg-red-700' 
                              : 'bg-green-600 hover:bg-green-700'
                          } text-white`}
                        >
                          {((testMode && strategy.is_active_test) || (!testMode && strategy.is_active_live)) ? 'Deactivate' : 'Activate'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                     </AlertDialogContent>
                   </AlertDialog>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-red-500/20 border-red-500 text-red-400 hover:bg-red-500/30"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-slate-800 border-slate-700">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-white">Delete Strategy</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">
                          Are you sure you want to delete "{strategy.strategy_name}"? 
                          This action is irreversible and will delete all associated data.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600">
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => handleDeleteStrategy(strategy.id, strategy.strategy_name)}
                          className="bg-red-600 hover:bg-red-700 text-white"
                        >
                          Delete Permanently
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </Card>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
  
  // Create Strategy View - Shows existing strategies when no strategy is active
  const CreateStrategyView = () => (
    <div className="space-y-6">
      {allStrategies.length > 0 ? (
        <>
          <div className="text-center">
            <h3 className="text-xl font-semibold text-white mb-2">No Active Strategy</h3>
            <p className="text-slate-400 mb-6">Activate an existing strategy or create a new one</p>
            <Button onClick={handleCreateStrategy} className="bg-cyan-500 hover:bg-cyan-600 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Create New Strategy
            </Button>
          </div>
          
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <h3 className="text-lg font-semibold text-white mb-4">Your Strategies</h3>
            <div className="space-y-3">
              {allStrategies.map((strategy) => (
                <Card key={strategy.id} className="p-4 bg-slate-800/30 border-slate-600">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h4 className="text-white font-medium">{strategy.strategy_name}</h4>
                        {strategy.test_mode && (
                          <Badge variant="secondary" className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                            <TestTube className="h-3 w-3 mr-1" />
                            Test
                          </Badge>
                        )}
                      </div>
                      <p className="text-slate-400 text-sm mt-1">
                        Created on {new Date(strategy.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    
                     <div className="flex items-center gap-3">
                       <Button
                         size="sm"
                         className="bg-green-500 hover:bg-green-600 text-white"
                         onClick={() => handleToggleStrategy(strategy.id, false)}
                       >
                         <Play className="w-4 h-4 mr-2" />
                         Activate
                       </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="bg-red-500/20 border-red-500 text-red-400 hover:bg-red-500/30"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-slate-800 border-slate-700">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-white">Delete Strategy</AlertDialogTitle>
                              <AlertDialogDescription className="text-slate-400">
                                Are you sure you want to delete "{strategy.strategy_name}"? 
                                This action is irreversible and will delete all associated data.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600">
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleDeleteStrategy(strategy.id, strategy.strategy_name)}
                                className="bg-red-600 hover:bg-red-700 text-white"
                              >
                                Delete Permanently
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </Card>
          </>
        ) : (
          <div className="text-center">
            <h3 className="text-xl font-semibold text-white mb-2">No Strategies Found</h3>
            <p className="text-slate-400 mb-6">Create your first trading strategy to get started</p>
            <Button onClick={handleCreateStrategy} className="bg-cyan-500 hover:bg-cyan-600 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Create Strategy
            </Button>
          </div>
        )}
      </div>
    );

  // Main render logic
  if (viewMode === 'configure') {
    return (
      <ComprehensiveStrategyConfig 
        onBack={handleBackToOverview}
        existingStrategy={activeStrategy}
        isEditing={isEditing}
      />
    );
  }

  if (hasActiveStrategy) {
    return <PerformanceOverview />;
  }

  return <CreateStrategyView />;
};