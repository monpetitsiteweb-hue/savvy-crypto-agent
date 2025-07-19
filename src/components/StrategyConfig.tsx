import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Pause, Settings, Trash2, Plus, TrendingUp, ArrowUpDown, DollarSign, Shield, AlertTriangle, BarChart3, ArrowLeft, Save, Edit, TestTube } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ComprehensiveStrategyConfig } from './strategy/ComprehensiveStrategyConfig';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type ViewMode = 'overview' | 'configure';
type MenuItem = 'basic-settings' | 'exchange' | 'notifications' | 'buy-settings' | 'coins-amounts' | 'strategy' | 'trailing-stop-buy' | 'sell-settings' | 'sell-strategy' | 'stop-loss' | 'trailing-stop-loss' | 'auto-close' | 'shorting-settings' | 'dollar-cost-averaging';

const menuItems = {
  general: [
    { id: 'basic-settings', label: 'Basic settings', icon: Settings },
    { id: 'exchange', label: 'Exchange', icon: ArrowUpDown },
    { id: 'notifications', label: 'Notifications', icon: AlertTriangle },
  ],
  buying: [
    { id: 'buy-settings', label: 'Buy settings', icon: DollarSign },
    { id: 'coins-amounts', label: 'Coins and amounts', icon: BarChart3 },
    { id: 'strategy', label: 'Strategy', icon: TrendingUp },
    { id: 'trailing-stop-buy', label: 'Trailing stop-buy', icon: ArrowUpDown },
  ],
  selling: [
    { id: 'sell-settings', label: 'Sell settings', icon: DollarSign },
    { id: 'sell-strategy', label: 'Sell strategy', icon: TrendingUp },
    { id: 'stop-loss', label: 'Stop-loss', icon: AlertTriangle },
    { id: 'trailing-stop-loss', label: 'Trailing stop-loss', icon: ArrowUpDown },
    { id: 'auto-close', label: 'Auto close', icon: Settings },
    { id: 'shorting-settings', label: 'Shorting settings', icon: ArrowUpDown },
    { id: 'dollar-cost-averaging', label: 'Dollar Cost Averaging', icon: DollarSign },
  ],
};

export const StrategyConfig = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { testMode } = useTestMode();
  
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [activeMenuItem, setActiveMenuItem] = useState<MenuItem>('basic-settings');
  const [hasActiveStrategy, setHasActiveStrategy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [activeStrategy, setActiveStrategy] = useState<any>(null);
  const [allStrategies, setAllStrategies] = useState<any[]>([]);
  const [strategyPerformance, setStrategyPerformance] = useState<any>(null);
  const [mockTrades, setMockTrades] = useState<any[]>([]);
  const [strategyConfig, setStrategyConfig] = useState({
    name: '',
    maxPosition: 5000,
    riskLevel: 'medium',
    autoTrading: false,
    aiStrategy: false,
    strategyType: 'trend-following',
    trailingStopBuy: false,
    trailingStopBuyPercentage: 1.5,
    takeProfit: 1.3,
    orderType: 'limit',
    stopLoss: false,
    stopLossPercentage: 3,
  });

  // Load all strategies, performance data, and mock trades
  useEffect(() => {
    const loadStrategies = async () => {
      if (!user) return;
      
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
          
          // Load strategy configuration from the database
          if (activeStrategyData.configuration && typeof activeStrategyData.configuration === 'object') {
            setStrategyConfig(prevConfig => ({ ...prevConfig, ...(activeStrategyData.configuration as Record<string, any>) }));
          }
          
          // Load performance data
          await loadStrategyPerformance(activeStrategyData.id);
          await loadTradingHistory(activeStrategyData.id);
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
  }, [user]);

  const loadStrategyPerformance = async (strategyId: string) => {
    try {
      const { data, error } = await supabase
        .from('strategy_performance')
        .select('*')
        .eq('strategy_id', strategyId)
        .order('execution_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setStrategyPerformance(data);
      }
    } catch (error) {
      console.error('Error loading strategy performance:', error);
    }
  };


  const loadTradingHistory = async (strategyId: string) => {
    try {
      const { data, error } = await supabase
        .from('trading_history')
        .select('*')
        .eq('strategy_id', strategyId)
        .eq('is_sandbox', testMode)
        .order('executed_at', { ascending: false })
        .limit(10);

      if (!error && data) {
        setMockTrades(data);
      }
    } catch (error) {
      console.error('Error loading trading history:', error);
    }
  };

  const handleCreateStrategy = () => {
    setIsEditing(false);
    setViewMode('configure');
  };

  const handleEditStrategy = () => {
    if (activeStrategy && activeStrategy.configuration) {
      // Load the current strategy configuration
      setStrategyConfig(prevConfig => ({ 
        ...prevConfig, 
        ...activeStrategy.configuration,
        name: activeStrategy.strategy_name || prevConfig.name
      }));
    }
    setIsEditing(true);
    setViewMode('configure');
  };

  const handleBackToOverview = () => {
    setViewMode('overview');
    setActiveMenuItem('basic-settings');
  };

  const handleSaveStrategy = async () => {
    if (!user) return;
    
    try {
      if (isEditing && activeStrategy) {
        // Update existing strategy - keep current activation status
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
        // Create new strategy - inactive by default
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
      
      // Refresh the active strategy state for current mode
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
  };

  // Delete strategy
  const handleDeleteStrategy = async (strategyId: string, strategyName: string) => {
    if (!user) return;
    
    try {
      const { error } = await supabase
        .from('trading_strategies')
        .delete()
        .eq('id', strategyId)
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: "Stratégie supprimée",
        description: `La stratégie "${strategyName}" a été supprimée définitivement.`,
      });

      // Recharger les stratégies
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
      } else {
        setAllStrategies([]);
        setHasActiveStrategy(false);
        setActiveStrategy(null);
      }
    } catch (error) {
      console.error('Error deleting strategy:', error);
      toast({
        title: "Error",
        description: "Unable to delete strategy.",
        variant: "destructive",
      });
    }
  };

  // Toggle strategy activation
  const handleToggleStrategy = async (strategyId: string, currentlyActive: boolean) => {
    if (!user) return;
    
    try {
      const activeField = testMode ? 'is_active_test' : 'is_active_live';
      
      if (currentlyActive) {
        // Deactivate the strategy in the current mode
        const { error } = await supabase
          .from('trading_strategies')
          .update({ [activeField]: false })
          .eq('id', strategyId)
          .eq('user_id', user.id);

        if (error) throw error;

        toast({
          title: "Stratégie désactivée",
          description: `Votre stratégie de trading a été désactivée en mode ${testMode ? 'Test' : 'Live'}.`,
        });
      } else {
        // Deactivate all other strategies in the current mode first
        await supabase
          .from('trading_strategies')
          .update({ [activeField]: false })
          .eq('user_id', user.id);

        // Activate the selected strategy in the current mode
        const { error } = await supabase
          .from('trading_strategies')
          .update({ [activeField]: true })
          .eq('id', strategyId)
          .eq('user_id', user.id);

        if (error) throw error;

        toast({
          title: "Stratégie activée",
          description: `Votre stratégie de trading a été activée en mode ${testMode ? 'Test' : 'Live'}.`,
        });
      }

      // Reload strategies
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
        title: "Erreur",
        description: "Impossible de modifier l'état de la stratégie.",
        variant: "destructive",
      });
    }
  };

  // Performance Overview Component
  const PerformanceOverview = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white">{activeStrategy?.strategy_name || 'My Trading Strategy'}</h2>
            <p className="text-slate-400">Performance overview and key metrics</p>
          </div>
          {testMode && (
            <Badge variant="secondary" className="bg-orange-500/20 text-orange-400 border-orange-500/30">
              <TestTube className="h-3 w-3 mr-1" />
              Test Mode
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleEditStrategy} className="bg-cyan-500 hover:bg-cyan-600 text-white">
            <Edit className="w-4 h-4 mr-2" />
            Edit Strategy
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Total Profit</p>
              <p className={`text-2xl font-bold ${
                (strategyPerformance?.total_profit_loss || 0) >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                ${(strategyPerformance?.total_profit_loss || 0).toFixed(2)}
              </p>
              <p className="text-xs text-slate-500">
                {strategyPerformance ? `${strategyPerformance.total_trades} trades` : 'No trades executed yet'}
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-green-400" />
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
              <p className="text-xs text-slate-500">
                {testMode ? 'Test mode active' : 'Live trading'}
              </p>
            </div>
            <BarChart3 className="w-8 h-8 text-slate-400" />
          </div>
        </Card>

        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Total Fees</p>
              <p className="text-2xl font-bold text-white">
                ${(strategyPerformance?.total_fees || 0).toFixed(2)}
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
            <p className="text-white font-medium">{strategyConfig.stopLossPercentage || 3}%</p>
          </div>
        </div>
        </Card>

        {/* Recent Trades Display */}
        {mockTrades.length > 0 && (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <h3 className="text-lg font-semibold text-white mb-4">Recent {testMode ? 'Sandbox' : 'Live'} Trades</h3>
            <div className="space-y-3">
              {mockTrades.slice(0, 5).map((trade) => (
                <div key={trade.id} className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg border border-slate-600">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      trade.trade_type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {trade.trade_type === 'buy' ? '↓' : '↑'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant={trade.trade_type === 'buy' ? 'default' : 'secondary'}>
                          {trade.trade_type.toUpperCase()}
                        </Badge>
                        <span className="text-white font-medium">{trade.cryptocurrency}</span>
                        {testMode && (
                          <Badge variant="outline" className="text-orange-400 border-orange-400/30">
                            🧪 Sandbox
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">
                        {new Date(trade.executed_at).toLocaleDateString()} at {new Date(trade.executed_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-medium">${Number(trade.total_value).toFixed(2)}</p>
                    {trade.coinbase_order_id && (
                      <p className="text-xs text-slate-400">Order: {trade.coinbase_order_id.slice(0, 8)}...</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Liste de toutes les stratégies */}
        {allStrategies.length > 0 && (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Toutes les stratégies</h3>
              <Button onClick={handleCreateStrategy} className="bg-green-600 hover:bg-green-700 text-white">
                <Plus className="w-4 h-4 mr-2" />
                Add a strategy
              </Button>
            </div>
            <div className="space-y-3">
              {allStrategies.map((strategy) => (
                <div key={strategy.id} className="flex items-center justify-between p-4 bg-slate-800/30 rounded-lg border border-slate-600">
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
                      Créée le {new Date(strategy.created_at).toLocaleDateString()}
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
                              Activer
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
                            Annuler
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
                          <AlertDialogTitle className="text-white">
                            Delete Strategy
                          </AlertDialogTitle>
                          <AlertDialogDescription className="text-slate-400">
                            Are you sure you want to permanently delete the strategy "{strategy.strategy_name}"? 
                            This action is irreversible and will delete all associated data.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600">
                            Annuler
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
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  
  // Create Strategy View - Modifié pour montrer les stratégies existantes
  const CreateStrategyView = () => (
    <div className="space-y-6">
      {allStrategies.length > 0 ? (
        <>
          <div className="text-center">
            <h3 className="text-xl font-semibold text-white mb-2">Aucune stratégie active</h3>
            <p className="text-slate-400 mb-6">Activez une stratégie existante ou créez-en une nouvelle</p>
            <Button onClick={handleCreateStrategy} className="bg-cyan-500 hover:bg-cyan-600 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Créer une nouvelle stratégie
            </Button>
          </div>
          
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <h3 className="text-lg font-semibold text-white mb-4">Stratégies existantes</h3>
            <div className="space-y-3">
              {allStrategies.map((strategy) => (
                <div key={strategy.id} className="flex items-center justify-between p-4 bg-slate-800/30 rounded-lg border border-slate-600">
                  <div className="flex-1">
                    <h4 className="text-white font-medium">{strategy.strategy_name}</h4>
                    <p className="text-slate-400 text-sm mt-1">
                      Créée le {new Date(strategy.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          className="bg-green-500 hover:bg-green-600 text-white"
                        >
                          <Play className="w-4 h-4 mr-2" />
                          Activer
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-slate-800 border-slate-700">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-white">Activer la stratégie</AlertDialogTitle>
                          <AlertDialogDescription className="text-slate-400">
                            Êtes-vous sûr de vouloir activer la stratégie "{strategy.strategy_name}" ? Cela commencera les trades automatiques selon la configuration définie.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600">
                            Annuler
                          </AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={() => handleToggleStrategy(strategy.id, false)}
                            className="bg-green-600 hover:bg-green-700 text-white"
                          >
                            Activer
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
                          <AlertDialogTitle className="text-white">
                            Delete Strategy
                          </AlertDialogTitle>
                          <AlertDialogDescription className="text-slate-400">
                            Are you sure you want to permanently delete the strategy "{strategy.strategy_name}"? 
                            This action is irreversible and will delete all associated data.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600">
                            Annuler
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
              ))}
            </div>
          </Card>
        </>
      ) : (
        <div className="flex items-center justify-center h-full">
          <Card className="p-8 bg-slate-700/30 border-slate-600 text-center max-w-md">
            <TrendingUp className="w-16 h-16 mx-auto mb-4 text-cyan-400" />
            <h3 className="text-xl font-semibold text-white mb-2">Aucune stratégie</h3>
            <p className="text-slate-400 mb-6">Créez votre première stratégie de trading pour commencer</p>
            <Button onClick={handleCreateStrategy} className="bg-cyan-500 hover:bg-cyan-600 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Créer une nouvelle stratégie
            </Button>
          </Card>
        </div>
      )}
    </div>
  );

  // Configuration Panel
  const renderConfigPanel = () => {
    switch (activeMenuItem) {
      case 'basic-settings':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Basic settings</h3>
              <p className="text-sm text-slate-400">Configure your general trading parameters.</p>
            </div>
            
            <div className="space-y-6">
              <div>
                <Label className="text-slate-300 mb-2 block">Strategy Name</Label>
                <Input 
                  type="text" 
                  value={strategyConfig.name}
                  onChange={(e) => {
                    const newName = e.target.value;
                    setStrategyConfig(prev => ({ ...prev, name: newName }));
                  }}
                  placeholder="Enter strategy name"
                  className="bg-slate-600 border-slate-500 text-white"
                  autoComplete="off"
                />
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Max Total Position (€)</Label>
                <Input 
                  type="number" 
                  value={strategyConfig.maxPosition}
                  onChange={(e) => setStrategyConfig(prev => ({ ...prev, maxPosition: Number(e.target.value) }))}
                  className="bg-slate-600 border-slate-500 text-white"
                />
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Risk Tolerance</Label>
                <Select value={strategyConfig.riskLevel} onValueChange={(value) => setStrategyConfig(prev => ({ ...prev, riskLevel: value }))}>
                  <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Conservative</SelectItem>
                    <SelectItem value="medium">Moderate</SelectItem>
                    <SelectItem value="high">Aggressive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300 block">Test Mode</Label>
                  <p className="text-xs text-slate-400">Use global test mode toggle at the top to switch between Coinbase Sandbox and Live environment</p>
                </div>
                <Badge variant="secondary" className={testMode ? "bg-orange-500/20 text-orange-400" : "bg-green-500/20 text-green-400"}>
                  {testMode ? "Sandbox" : "Live"}
                </Badge>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch 
                  id="auto-trading" 
                  checked={strategyConfig.autoTrading}
                  onCheckedChange={(checked) => setStrategyConfig(prev => ({ ...prev, autoTrading: checked }))}
                />
                <Label htmlFor="auto-trading" className="text-slate-300">Enable auto trading</Label>
              </div>
            </div>
          </Card>
        );

      case 'strategy':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Strategy</h3>
              <p className="text-sm text-slate-400">Configure your trading strategy and AI settings.</p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300 block">Enable AI Strategy</Label>
                  <p className="text-xs text-slate-400">Use AI to automatically create and manage strategies</p>
                </div>
                <Switch 
                  checked={strategyConfig.aiStrategy}
                  onCheckedChange={(checked) => setStrategyConfig(prev => ({ ...prev, aiStrategy: checked }))}
                />
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Strategy Type</Label>
                <Select value={strategyConfig.strategyType} onValueChange={(value) => setStrategyConfig(prev => ({ ...prev, strategyType: value }))}>
                  <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trend-following">Trend Following</SelectItem>
                    <SelectItem value="mean-reversion">Mean Reversion</SelectItem>
                    <SelectItem value="momentum">Momentum</SelectItem>
                    <SelectItem value="arbitrage">Arbitrage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        );

      case 'trailing-stop-buy':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Trailing stop-buy</h3>
              <p className="text-sm text-slate-400">Trailing stop-buy will track the currency price downwards.</p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center space-x-2">
                <Switch 
                  id="trailing-stop-buy" 
                  checked={strategyConfig.trailingStopBuy}
                  onCheckedChange={(checked) => setStrategyConfig(prev => ({ ...prev, trailingStopBuy: checked }))}
                />
                <Label htmlFor="trailing-stop-buy" className="text-slate-300">Enable</Label>
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Trailing stop-buy percentage</Label>
                <Input 
                  type="number" 
                  value={strategyConfig.trailingStopBuyPercentage}
                  onChange={(e) => setStrategyConfig(prev => ({ ...prev, trailingStopBuyPercentage: Number(e.target.value) }))}
                  className="bg-slate-600 border-slate-500 text-white"
                />
              </div>
            </div>
          </Card>
        );

      case 'sell-settings':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Sell settings</h3>
              <p className="text-sm text-slate-400">Configure the sell settings of your hopper.</p>
            </div>
            
            <div className="space-y-6">
              <div>
                <Label className="text-slate-300 mb-2 block">Take profit at</Label>
                <Input 
                  type="number" 
                  value={strategyConfig.takeProfit}
                  onChange={(e) => setStrategyConfig(prev => ({ ...prev, takeProfit: Number(e.target.value) }))}
                  className="bg-slate-600 border-slate-500 text-white"
                />
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Order type</Label>
                <Select value={strategyConfig.orderType} onValueChange={(value) => setStrategyConfig(prev => ({ ...prev, orderType: value }))}>
                  <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="limit">Limit</SelectItem>
                    <SelectItem value="market">Market</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        );

      case 'exchange':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Exchange</h3>
              <p className="text-sm text-slate-400">Configure your exchange settings.</p>
            </div>
            
            <div className="space-y-6">
              <div>
                <Label className="text-slate-300 mb-2 block">Exchange</Label>
                <Select value="coinbase" disabled>
                  <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="coinbase">Coinbase</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400 mt-1">Currently only Coinbase is supported</p>
              </div>
            </div>
          </Card>
        );

      case 'notifications':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Notifications</h3>
              <p className="text-sm text-slate-400">Configure your notification preferences.</p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300 block">Trade notifications</Label>
                  <p className="text-xs text-slate-400">Get notified when trades are executed</p>
                </div>
                <Switch defaultChecked />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300 block">Email alerts</Label>
                  <p className="text-xs text-slate-400">Receive email notifications for important events</p>
                </div>
                <Switch defaultChecked />
              </div>
            </div>
          </Card>
        );

      case 'buy-settings':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Buy settings</h3>
              <p className="text-sm text-slate-400">Configure your buy order settings.</p>
            </div>
            
            <div className="space-y-6">
              <div>
                <Label className="text-slate-300 mb-2 block">Order type</Label>
                <Select value="market" disabled>
                  <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market">Market</SelectItem>
                    <SelectItem value="limit">Limit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Base order amount (€)</Label>
                <Input 
                  type="number" 
                  defaultValue={100}
                  className="bg-slate-600 border-slate-500 text-white"
                />
              </div>
            </div>
          </Card>
        );

      case 'coins-amounts':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Coins and amounts</h3>
              <p className="text-sm text-slate-400">Configure which coins to trade and position sizes.</p>
            </div>
            
            <div className="space-y-6">
              <div>
                <Label className="text-slate-300 mb-2 block">Allowed coins</Label>
                <div className="grid grid-cols-3 gap-2">
                  {['BTC', 'ETH', 'ADA', 'SOL', 'DOT', 'MATIC'].map((coin) => (
                    <div key={coin} className="flex items-center space-x-2 p-2 bg-slate-600 rounded">
                      <input type="checkbox" defaultChecked className="rounded" />
                      <span className="text-white text-sm">{coin}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        );

      case 'stop-loss':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Stop-loss</h3>
              <p className="text-sm text-slate-400">Enable stop-loss orders.</p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center space-x-2">
                <Switch 
                  id="stop-loss" 
                  checked={strategyConfig.stopLoss}
                  onCheckedChange={(checked) => setStrategyConfig(prev => ({ ...prev, stopLoss: checked }))}
                />
                <Label htmlFor="stop-loss" className="text-slate-300">Enable</Label>
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Stop-loss percentage</Label>
                <Input 
                  type="number" 
                  value={strategyConfig.stopLossPercentage}
                  onChange={(e) => setStrategyConfig(prev => ({ ...prev, stopLossPercentage: Number(e.target.value) }))}
                  className="bg-slate-600 border-slate-500 text-white"
                />
                <p className="text-xs text-slate-400 mt-1">(Enter as positive, example: 2.8)</p>
              </div>
            </div>
          </Card>
        );

      case 'sell-strategy':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Sell strategy</h3>
              <p className="text-sm text-slate-400">Configure your selling strategy.</p>
            </div>
            
            <div className="space-y-6">
              <div>
                <Label className="text-slate-300 mb-2 block">Sell strategy type</Label>
                <Select defaultValue="take-profit">
                  <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="take-profit">Take Profit</SelectItem>
                    <SelectItem value="trailing">Trailing</SelectItem>
                    <SelectItem value="time-based">Time Based</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        );

      case 'trailing-stop-loss':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Trailing stop-loss</h3>
              <p className="text-sm text-slate-400">Configure trailing stop-loss orders.</p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center space-x-2">
                <Switch id="trailing-stop-loss" />
                <Label htmlFor="trailing-stop-loss" className="text-slate-300">Enable</Label>
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Trailing percentage</Label>
                <Input 
                  type="number" 
                  defaultValue={2.5}
                  className="bg-slate-600 border-slate-500 text-white"
                />
              </div>
            </div>
          </Card>
        );

      case 'auto-close':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Auto close</h3>
              <p className="text-sm text-slate-400">Automatically close positions based on conditions.</p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center space-x-2">
                <Switch id="auto-close" />
                <Label htmlFor="auto-close" className="text-slate-300">Enable auto close</Label>
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Auto close after (hours)</Label>
                <Input 
                  type="number" 
                  defaultValue={24}
                  className="bg-slate-600 border-slate-500 text-white"
                />
              </div>
            </div>
          </Card>
        );

      default:
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="text-center text-slate-400">
              <Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <h4 className="text-lg font-medium mb-2">Configuration Panel</h4>
              <p className="text-sm">Select an option from the menu to configure your settings</p>
            </div>
          </Card>
        );
    }
  };

  // Configuration View
  const ConfigurationView = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={handleBackToOverview}
            className="text-slate-300 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Strategies
          </Button>
          <h1 className="text-xl font-semibold text-white">
            {isEditing ? 'Edit Strategy' : 'Create New Strategy'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleBackToOverview}>
            Cancel
          </Button>
          <Button onClick={handleSaveStrategy} className="bg-green-600 hover:bg-green-700 text-white">
            <Save className="w-4 h-4 mr-2" />
            {isEditing ? 'Save Changes' : 'Save Strategy'}
          </Button>
        </div>
      </div>

      {/* Configuration Content */}
      <div className="flex h-full">
        {/* Left Sidebar */}
        <div className="w-80 bg-slate-800/50 border-r border-slate-600 p-4">
        {/* General Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">GENERAL</h3>
          <div className="space-y-1">
            {menuItems.general.map((item) => {
              const Icon = item.icon;
              const isActive = activeMenuItem === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveMenuItem(item.id as MenuItem)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    isActive 
                      ? 'bg-cyan-500 text-white' 
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{item.label}</span>
                  {item.id === 'basic-settings' && isActive && (
                    <div className="ml-auto w-2 h-2 bg-green-400 rounded-full"></div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Buying Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">BUYING</h3>
          <div className="space-y-1">
            {menuItems.buying.map((item) => {
              const Icon = item.icon;
              const isActive = activeMenuItem === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveMenuItem(item.id as MenuItem)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    isActive 
                      ? 'bg-cyan-500 text-white' 
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{item.label}</span>
                  {item.id === 'strategy' && (
                    <div className="ml-auto w-2 h-2 bg-green-400 rounded-full"></div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selling Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">SELLING</h3>
          <div className="space-y-1">
            {menuItems.selling.map((item) => {
              const Icon = item.icon;
              const isActive = activeMenuItem === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveMenuItem(item.id as MenuItem)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    isActive 
                      ? 'bg-cyan-500 text-white' 
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

        {/* Main Content */}
        <div className="flex-1 p-6">
          {renderConfigPanel()}
        </div>
      </div>
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