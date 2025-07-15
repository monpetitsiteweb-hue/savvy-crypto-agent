
import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Settings, Trash2, Plus, TrendingUp, Activity } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { StrategyBuilder } from './strategy/StrategyBuilder';

interface Strategy {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  riskLevel: 'Low' | 'Medium' | 'High';
  maxPosition: number;
  stopLoss: number;
  takeProfit: number;
  performance: {
    totalTrades: number;
    profitLoss: number;
    successRate: number;
  };
}

export const StrategyConfig = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(0);

  // Use a ref to force immediate DOM updates
  const containerRef = useRef<HTMLDivElement>(null);

  const showBuilderPanel = () => {
    console.log('BUTTON CLICKED - showBuilderPanel triggered');
    setShowBuilder(true);
  };
  useEffect(() => {
    if (user) {
      fetchStrategies();
    }
  }, [user]);

  const fetchStrategies = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Convert Supabase data to Strategy interface
      const formattedStrategies: Strategy[] = (data || []).map(strategy => ({
        id: strategy.id,
        name: strategy.strategy_name,
        description: strategy.description || '',
        isActive: strategy.is_active,
        riskLevel: 'Medium', // This would come from configuration
        maxPosition: 1000, // This would come from configuration
        stopLoss: 2, // This would come from configuration
        takeProfit: 3, // This would come from configuration
        performance: {
          totalTrades: 0, // Would need to calculate from trading_history
          profitLoss: 0, // Would need to calculate from trading_history
          successRate: 0 // Would need to calculate from trading_history
        }
      }));
      
      setStrategies(formattedStrategies);
    } catch (error) {
      console.error('Error fetching strategies:', error);
      toast({
        title: "Error",
        description: "Failed to load trading strategies",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleStrategy = async (id: string) => {
    try {
      const strategy = strategies.find(s => s.id === id);
      if (!strategy) return;

      const { error } = await supabase
        .from('trading_strategies')
        .update({ is_active: !strategy.isActive })
        .eq('id', id);

      if (error) throw error;

      setStrategies(prev => prev.map(strategy => 
        strategy.id === id ? { ...strategy, isActive: !strategy.isActive } : strategy
      ));

      toast({
        title: "Strategy Updated",
        description: `Strategy ${strategy.isActive ? 'paused' : 'activated'} successfully`,
      });
    } catch (error) {
      console.error('Error updating strategy:', error);
      toast({
        title: "Error",
        description: "Failed to update strategy",
        variant: "destructive",
      });
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'Low': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'Medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'High': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Loading strategies...</div>
      </div>
    );
  }

  if (strategies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-16 h-16 bg-slate-700/50 rounded-full flex items-center justify-center">
          <TrendingUp className="w-8 h-8 text-slate-500" />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-semibold text-white mb-2">No Trading Strategies</h3>
          <p className="text-slate-400 mb-4">Create your first automated trading strategy to get started.</p>
          <Button onClick={showBuilderPanel} className="bg-green-500 hover:bg-green-600 text-white">
            <Plus className="w-4 h-4 mr-2" />
            Create Strategy
          </Button>
        </div>
      </div>
    );
  }

  // Force complete re-render with key
  if (showBuilder) {
    return (
      <div key={`builder-${forceUpdate}`}>
        <StrategyBuilder onCancel={() => {
          setShowBuilder(false);
          setForceUpdate(prev => prev + 1);
          fetchStrategies();
        }} />
      </div>
    );
  }

  return (
    <div ref={containerRef} key={`config-${forceUpdate}`} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Strategy Configuration</h2>
          <p className="text-sm text-slate-400 mt-1">Manage and configure your trading strategies</p>
        </div>
        <Button onClick={() => {
          alert('Button clicked!');
          showBuilderPanel();
        }} className="bg-green-500 hover:bg-green-600 text-white">
          <Plus className="w-4 h-4 mr-2" />
          New Strategy
        </Button>
      </div>

      {/* Global Settings */}
      <Card className="p-6 bg-slate-700/30 border-slate-600">
        <h3 className="text-lg font-semibold text-white mb-4">Global Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="text-sm text-slate-400 mb-2 block">Max Total Position (€)</label>
            <Slider
              defaultValue={[5000]}
              max={20000}
              min={1000}
              step={500}
              className="mb-2"
            />
            <div className="flex justify-between text-xs text-slate-400">
              <span>€1,000</span>
              <span>€5,000</span>
              <span>€20,000</span>
            </div>
          </div>
          
          <div>
            <label className="text-sm text-slate-400 mb-2 block">Risk Tolerance</label>
            <Slider
              defaultValue={[60]}
              max={100}
              min={0}
              step={10}
              className="mb-2"
            />
            <div className="flex justify-between text-xs text-slate-400">
              <span>Conservative</span>
              <span>Moderate</span>
              <span>Aggressive</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Strategy List */}
      <div className="space-y-4">
        {strategies.map((strategy) => (
          <Card key={strategy.id} className="p-6 bg-slate-700/30 border-slate-600">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-semibold text-white">{strategy.name}</h3>
                  <Badge variant="outline" className={getRiskColor(strategy.riskLevel)}>
                    {strategy.riskLevel} Risk
                  </Badge>
                  <Switch
                    checked={strategy.isActive}
                    onCheckedChange={() => toggleStrategy(strategy.id)}
                  />
                </div>
                <p className="text-sm text-slate-400 mb-3">{strategy.description}</p>
                
                {/* Performance Metrics */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-slate-400">Total Trades</p>
                    <p className="font-medium text-white">{strategy.performance.totalTrades}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">P&L</p>
                    <p className={`font-medium ${
                      strategy.performance.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {strategy.performance.profitLoss >= 0 ? '+' : ''}€{strategy.performance.profitLoss}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Success Rate</p>
                    <p className="font-medium text-white">{strategy.performance.successRate}%</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-4">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => toggleStrategy(strategy.id)}
                  className="border-slate-600 text-slate-300"
                >
                  {strategy.isActive ? (
                    <>
                      <Pause className="w-4 h-4 mr-1" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-1" />
                      Start
                    </>
                  )}
                </Button>
                <Button variant="outline" size="sm" className="border-slate-600 text-slate-300">
                  <Settings className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" className="border-red-600 text-red-400 hover:bg-red-500/10">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Strategy Parameters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-slate-600">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Max Position (€)</label>
                <div className="flex items-center gap-2">
                  <Slider
                    defaultValue={[strategy.maxPosition]}
                    max={2000}
                    min={100}
                    step={50}
                    className="flex-1"
                  />
                  <span className="text-sm text-white min-w-[60px]">€{strategy.maxPosition}</span>
                </div>
              </div>
              
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Stop Loss (%)</label>
                <div className="flex items-center gap-2">
                  <Slider
                    defaultValue={[strategy.stopLoss]}
                    max={10}
                    min={0.5}
                    step={0.5}
                    className="flex-1"
                  />
                  <span className="text-sm text-white min-w-[40px]">{strategy.stopLoss}%</span>
                </div>
              </div>
              
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Take Profit (%)</label>
                <div className="flex items-center gap-2">
                  <Slider
                    defaultValue={[strategy.takeProfit]}
                    max={15}
                    min={1}
                    step={0.5}
                    className="flex-1"
                  />
                  <span className="text-sm text-white min-w-[40px]">{strategy.takeProfit}%</span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
