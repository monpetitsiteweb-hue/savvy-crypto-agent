import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Settings, Activity, TrendingUp, Play, Pause, Edit, Copy, AlertTriangle, Trash2, Download, Upload, Rocket } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTradeViewFilter';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';
import { ComprehensiveStrategyConfig } from './strategy/ComprehensiveStrategyConfig';
import { StrategyImportModal } from './strategy/StrategyImportModal';
import { PushToLiveModal } from './strategy/PushToLiveModal';
import { formatEuro, formatPercentage, formatDuration } from '@/utils/currencyFormatter';
import { normalizeStrategy, StrategyData } from '@/types/strategy';
import { serializeStrategy, generateExportFilename, downloadStrategyAsJson } from '@/utils/strategySerializer';
import { useToast } from '@/hooks/use-toast';

interface StrategyConfigProps {
  onLayoutChange?: (isFullWidth: boolean) => void;
}

interface StrategyPerformance {
  totalTrades: number;
  winRate: number;
  avgDuration: number;
  avgProfit: number;
}

export const StrategyConfig: React.FC<StrategyConfigProps> = ({ onLayoutChange }) => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { isAdmin } = useUserRole();
  const { toast } = useToast();
  const [strategies, setStrategies] = useState<StrategyData[]>([]);
  const [currentView, setCurrentView] = useState<'list' | 'create' | 'edit' | 'comprehensive'>('list');
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProductionActivationModal, setShowProductionActivationModal] = useState(false);
  const [strategyToActivate, setStrategyToActivate] = useState<StrategyData | null>(null);
  const [strategyPerformance, setStrategyPerformance] = useState<Record<string, StrategyPerformance>>({});
  const [showImportModal, setShowImportModal] = useState(false);
  const [importedFormData, setImportedFormData] = useState<Record<string, any> | null>(null);
  const [showPushToLiveModal, setShowPushToLiveModal] = useState(false);
  const [strategyToPush, setStrategyToPush] = useState<StrategyData | null>(null);

  useEffect(() => {
    if (user) {
      fetchStrategies();
    }
  }, [user, testMode]);

  // Set up real-time subscription for strategy updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('strategy-list-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trading_strategies',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          // Refresh the strategy list when any strategy for this user is updated
          fetchStrategies();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

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
      const { data, error } = await (supabase as any)
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq('test_mode', testMode)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setStrategies((data || []).map(normalizeStrategy));
      
      // Fetch performance data for each strategy
      await fetchPerformanceData((data || []).map(normalizeStrategy));
    } catch (error) {
      logger.error('Error fetching strategies:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPerformanceData = async (strategies: StrategyData[]) => {
    if (!user || strategies.length === 0) return;

    try {
      const performanceMap: Record<string, StrategyPerformance> = {};

      for (const strategy of strategies) {
        const { data: trades, error } = await supabase
          .from('mock_trades')
          .select('*')
          .eq('user_id', user.id)
          .eq('strategy_id', strategy.id);

        if (error) {
          logger.error(`Error fetching trades for strategy ${strategy.id}:`, error);
          continue;
        }

        if (trades && trades.length > 0) {
          const totalTrades = trades.length;
          const winningTrades = trades.filter(t => (t.profit_loss || 0) > 0).length;
          const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
          const avgProfit = totalTrades > 0 ? trades.reduce((sum, t) => sum + (t.profit_loss || 0), 0) / totalTrades : 0;
          
          // Calculate average duration (simplified - would need proper date analysis)
          const avgDuration = 2.4; // Placeholder for now

          performanceMap[strategy.id] = {
            totalTrades,
            winRate,
            avgDuration,
            avgProfit
          };
        } else {
          // No trades yet
          performanceMap[strategy.id] = {
            totalTrades: 0,
            winRate: 0,
            avgDuration: 0,
            avgProfit: 0
          };
        }
      }

      setStrategyPerformance(performanceMap);
    } catch (error) {
      logger.error('Error fetching performance data:', error);
    }
  };

  const handleStrategyToggle = (strategy: StrategyData, isTest: boolean) => {
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

  const toggleStrategy = async (strategy: StrategyData, isTest: boolean) => {
    if (!user) return;

    try {
      // FIX: Use correct database fields - is_active (not is_active_test/is_active_live)
      const currentValue = strategy.is_active;
      
      // If activating, first deactivate all other strategies in the same test/live environment
      if (!currentValue) {
        await (supabase as any)
          .from('trading_strategies')
          .update({ is_active: false })
          .eq('user_id', user.id)
          .eq('test_mode', isTest)
          .neq('id', strategy.id);
      }
      
      const { error } = await supabase
        .from('trading_strategies')
        .update({ is_active: !currentValue })
        .eq('id', strategy.id)
        .eq('user_id', user.id);

      if (error) throw error;

      await fetchStrategies();
    } catch (error) {
      logger.error('Error toggling strategy:', error);
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
    } catch (error) {
      logger.error('Error deleting strategy:', error);
    }
  };

  const handleStrategyEdit = (strategy: StrategyData) => {
    setSelectedStrategy(strategy);
    setCurrentView('comprehensive');
  };

  // Legacy handlePushToProduction removed - now using PushToLiveModal with RPC

  const handleCloneStrategy = async (strategy: StrategyData) => {
    if (!user) return;

    try {
      // Ensure canonical keys are present when cloning
      const config = (strategy.configuration && typeof strategy.configuration === 'object' && !Array.isArray(strategy.configuration))
        ? strategy.configuration as Record<string, any>
        : {};
      const unifiedConfig = (config.unifiedConfig && typeof config.unifiedConfig === 'object') ? config.unifiedConfig as Record<string, any> : {};
      const aiConfig = (config.aiIntelligenceConfig && typeof config.aiIntelligenceConfig === 'object') ? config.aiIntelligenceConfig as Record<string, any> : {};

      const configWithCanonicalKeys = {
        ...config,
        minHoldPeriodMs: config.minHoldPeriodMs ?? unifiedConfig.minHoldPeriodMs ?? 120000,
        cooldownBetweenOppositeActionsMs: config.cooldownBetweenOppositeActionsMs ?? unifiedConfig.cooldownBetweenOppositeActionsMs ?? 30000,
        aiConfidenceThreshold: config.aiConfidenceThreshold ?? aiConfig.aiConfidenceThreshold ?? 50,
        takeProfitPercentage: config.takeProfitPercentage ?? 2.5,
        stopLossPercentage: config.stopLossPercentage ?? 3.0,
      };

      const { error } = await supabase
        .from('trading_strategies')
        .insert({
          user_id: user.id,
          strategy_name: `${strategy.strategy_name} (Clone)`,
          description: `Clone of ${strategy.strategy_name}`,
          configuration: configWithCanonicalKeys,
          test_mode: true,
          is_active: false
        });

      if (error) throw error;

      await fetchStrategies();
    } catch (error) {
      logger.error('Error cloning strategy:', error);
    }
  };

  // Handle export
  const handleExportStrategy = (strategy: StrategyData) => {
    try {
      const exported = serializeStrategy({
        strategy_name: strategy.strategy_name,
        description: strategy.description || undefined,
        configuration: (strategy.configuration as Record<string, any>) || {},
        created_at: strategy.created_at,
      });
      const filename = generateExportFilename(strategy.strategy_name);
      downloadStrategyAsJson(exported, filename);
      
      toast({
        title: "Strategy exported",
        description: `Downloaded ${filename}`,
      });
    } catch (error) {
      logger.error('Error exporting strategy:', error);
      toast({
        title: "Export failed",
        description: "Failed to export strategy. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Handle import callback
  const handleImportStrategy = async (formData: Record<string, any>) => {
    if (!user) return;
    
    try {
      // Build configuration from imported data
      const configuration = { ...formData };
      delete configuration.strategyName;
      delete configuration.notes;
      
      // Ensure required root-level config fields exist (coordinator requires these)
      const REQUIRED_DEFAULTS = {
        aiConfidenceThreshold: 0.5,
        priceStaleMaxMs: 15000,
        spreadThresholdBps: 150,
        minHoldPeriodMs: configuration.unifiedConfig?.minHoldPeriodMs ?? 120000,
        cooldownBetweenOppositeActionsMs: configuration.unifiedConfig?.cooldownBetweenOppositeActionsMs ?? 5000,
      };
      
      // Apply defaults only if not already present
      for (const [key, defaultValue] of Object.entries(REQUIRED_DEFAULTS)) {
        if (configuration[key] === undefined || configuration[key] === null) {
          configuration[key] = defaultValue;
        }
      }
      
      const strategyData = {
        user_id: user.id,
        strategy_name: formData.strategyName,
        description: formData.notes || null,
        configuration: configuration as any,
        test_mode: true, // Always import to test mode
        is_active: false,
      };
      
      const { error } = await supabase
        .from('trading_strategies')
        .insert(strategyData);
      
      if (error) throw error;
      
      toast({
        title: "Strategy imported",
        description: `"${formData.strategyName}" has been created in test mode.`,
      });
      
      await fetchStrategies();
    } catch (error) {
      logger.error('Error importing strategy:', error);
      toast({
        title: "Import failed",
        description: "Failed to create strategy from import. Please try again.",
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
          setImportedFormData(null);
          fetchStrategies();
        }}
        existingStrategy={currentView === 'comprehensive' ? selectedStrategy : null}
        isEditing={currentView === 'comprehensive'}
        isCollapsed={false}
        initialFormData={importedFormData}
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
            variant="outline"
            onClick={() => setShowImportModal(true)}
          >
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
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
            {isAdmin && (
              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md mb-4">
                <strong>Admin Diagnostic:</strong> 0 strategies matched filters. user_id={user?.id}, testMode={testMode ? 'ON' : 'OFF'}, filters=user_id={user?.id} & test_mode={testMode}
              </div>
            )}
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
                <div>
                  <div className="mb-3">
                    <CardTitle className="text-lg font-semibold">
                      {strategy.strategy_name}
                    </CardTitle>
                  </div>
                  <div className="mb-3">
                    <p className="text-sm text-muted-foreground">
                      {strategy.description || 'No description provided'}
                    </p>
                  </div>
                  <div className="mb-3">
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
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExportStrategy(strategy)}
                      title="Export Strategy"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
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
                    {/* Push to Live button - show for all MOCK strategies in test mode */}
                    {testMode && (
                      <Button
                        variant="default"
                        size="sm"
                        className="bg-primary hover:bg-primary/90 font-semibold"
                        title="Push to Live"
                        onClick={() => {
                          setStrategyToPush(strategy);
                          setShowPushToLiveModal(true);
                        }}
                      >
                        <Rocket className="h-4 w-4 mr-1" />
                        Push to Live
                      </Button>
                    )}
                    <Button
                      variant={strategy.is_active ? "destructive" : "default"}
                      size="sm"
                      onClick={() => handleStrategyToggle(strategy, testMode)}
                    >
                      {strategy.is_active ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  
                  {/* Performance indicators */}
                  {strategyPerformance[strategy.id] && (
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div className="text-center">
                        <div className="font-semibold text-lg">
                          {strategyPerformance[strategy.id].totalTrades}
                        </div>
                        <div className="text-muted-foreground">Total Trades</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-lg">
                          {formatPercentage(strategyPerformance[strategy.id].winRate)}
                        </div>
                        <div className="text-muted-foreground">Win Rate</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-lg">
                          {formatDuration(strategyPerformance[strategy.id].avgDuration)}
                        </div>
                        <div className="text-muted-foreground">Avg Duration</div>
                      </div>
                      <div className="text-center">
                        <div className={`font-semibold text-lg ${strategyPerformance[strategy.id].avgProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatEuro(strategyPerformance[strategy.id].avgProfit)}
                        </div>
                        <div className="text-muted-foreground">Avg P&L</div>
                      </div>
                    </div>
                  )}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Production Activation Modal */}
      <AlertDialog open={showProductionActivationModal} onOpenChange={setShowProductionActivationModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Production Trading Warning
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p className="font-bold text-red-600">
                ⚠️ You are about to activate live trading with real money!
              </p>
              <p className="text-sm text-muted-foreground">
                This strategy will start making actual trades using your connected Coinbase account.
                Make sure you have:
              </p>
              <ul className="text-sm list-disc list-inside space-y-1 text-muted-foreground">
                <li>Tested the strategy thoroughly</li>
                <li>Set appropriate risk limits</li>
                <li>Connected your Coinbase account</li>
                <li>Sufficient funds in your account</li>
              </ul>
              <p className="text-sm font-semibold text-red-600">
                This action cannot be undone automatically. You will need to manually deactivate the strategy to stop trading.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelProductionActivation}>
              Cancel – Keep Testing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleProductionActivation}
              className="bg-red-600 hover:bg-red-700"
            >
              Yes, Activate Live Trading
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Import Modal */}
      <StrategyImportModal
        open={showImportModal}
        onOpenChange={setShowImportModal}
        onImport={handleImportStrategy}
      />
      
      {/* Push to Live Modal */}
      <PushToLiveModal
        open={showPushToLiveModal}
        onOpenChange={setShowPushToLiveModal}
        strategy={strategyToPush}
        onSuccess={(newStrategyId) => {
          logger.info('Strategy promoted to LIVE:', newStrategyId);
          setShowPushToLiveModal(false);
          setStrategyToPush(null);
          fetchStrategies();
          toast({
            title: 'Strategy promoted!',
            description: 'Switch to Live view to see your new strategy.',
          });
        }}
      />
    </div>
  );
};