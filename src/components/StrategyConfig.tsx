import { useState, useEffect } from 'react';
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
  monthlyReturn: number;
  winRate: number;
  totalTrades: number;
  profitLoss: number;
  lastExecuted: string;
  nextExecution: string;
}

export const StrategyConfig = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);

  const showBuilderPanel = () => {
    setShowBuilder(true);
  };

  useEffect(() => {
    if (user) {
      fetchStrategies();
    }
  }, [user]);

  const fetchStrategies = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user?.id);

      if (error) {
        console.error('Error fetching strategies:', error);
        toast({
          title: "Error",
          description: "Failed to fetch strategies",
          variant: "destructive",
        });
        return;
      }

      // Transform the data to match our interface
      const transformedStrategies = (data || []).map(strategy => ({
        id: strategy.id,
        name: strategy.strategy_name,
        description: strategy.description || '',
        isActive: strategy.is_active,
        riskLevel: (strategy.configuration as any)?.riskLevel || 'Medium',
        maxPosition: (strategy.configuration as any)?.maxPosition || 1000,
        monthlyReturn: Math.random() * 10 - 2, // Mock data
        winRate: Math.random() * 40 + 40, // Mock data
        totalTrades: Math.floor(Math.random() * 100), // Mock data
        profitLoss: Math.random() * 2000 - 500, // Mock data
        lastExecuted: new Date(Date.now() - Math.random() * 86400000).toISOString(),
        nextExecution: new Date(Date.now() + Math.random() * 86400000).toISOString()
      }));

      setStrategies(transformedStrategies);
    } catch (error) {
      console.error('Error fetching strategies:', error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
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

      if (error) {
        console.error('Error updating strategy:', error);
        toast({
          title: "Error",
          description: "Failed to update strategy",
          variant: "destructive",
        });
        return;
      }

      setStrategies(prev => prev.map(s => 
        s.id === id ? { ...s, isActive: !s.isActive } : s
      ));

      toast({
        title: "Success",
        description: `Strategy ${!strategy.isActive ? 'activated' : 'paused'}`,
      });
    } catch (error) {
      console.error('Error toggling strategy:', error);
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

  if (showBuilder) {
    return (
      <StrategyBuilder onCancel={() => {
        setShowBuilder(false);
        fetchStrategies();
      }} />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Strategy Performance</h2>
          <p className="text-sm text-slate-400 mt-1">Monitor your trading strategies performance</p>
        </div>
        <Button onClick={showBuilderPanel} className="bg-green-500 hover:bg-green-600 text-white">
          <Plus className="w-4 h-4 mr-2" />
          New Strategy
        </Button>
      </div>

      {/* Strategies List */}
      {strategies.length === 0 ? (
        <Card className="p-8 bg-slate-700/30 border-slate-600 text-center">
          <div className="text-slate-400 mb-4">
            <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <h4 className="text-lg font-medium mb-2">No Strategies Yet</h4>
            <p className="text-sm">Create your first trading strategy to get started</p>
          </div>
          <Button onClick={showBuilderPanel} className="bg-green-500 hover:bg-green-600 text-white">
            <Plus className="w-4 h-4 mr-2" />
            Create Strategy
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Active Strategies</h3>
          {strategies.map((strategy) => (
            <Card key={strategy.id} className="p-6 bg-slate-700/30 border-slate-600">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="text-lg font-semibold text-white">{strategy.name}</h4>
                    <Badge className={`text-xs ${getRiskColor(strategy.riskLevel)}`}>
                      {strategy.riskLevel} Risk
                    </Badge>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={strategy.isActive}
                        onCheckedChange={() => toggleStrategy(strategy.id)}
                      />
                      <span className={`text-sm ${strategy.isActive ? 'text-green-400' : 'text-slate-400'}`}>
                        {strategy.isActive ? 'Active' : 'Paused'}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-400 mb-4">{strategy.description}</p>
                  
                  {/* Strategy Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="text-lg font-bold text-white">
                        {strategy.monthlyReturn >= 0 ? '+' : ''}{strategy.monthlyReturn.toFixed(1)}%
                      </div>
                      <div className="text-xs text-slate-400">Monthly Return</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-white">{strategy.winRate.toFixed(0)}%</div>
                      <div className="text-xs text-slate-400">Win Rate</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-white">{strategy.totalTrades}</div>
                      <div className="text-xs text-slate-400">Total Trades</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-lg font-bold ${strategy.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {strategy.profitLoss >= 0 ? '+' : ''}€{strategy.profitLoss.toFixed(0)}
                      </div>
                      <div className="text-xs text-slate-400">P&L</div>
                    </div>
                  </div>
                </div>
                
                {/* Action Buttons */}
                <div className="flex items-center gap-2 ml-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-white"
                    onClick={() => toggleStrategy(strategy.id)}
                  >
                    {strategy.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-white"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Performance Overview */}
      <Card className="p-6 bg-slate-700/30 border-slate-600">
        <h3 className="text-lg font-semibold text-white mb-4">Performance Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Activity className="w-5 h-5 text-green-400" />
            </div>
            <div className="text-2xl font-bold text-white">
              {strategies.filter(s => s.isActive).length}
            </div>
            <div className="text-sm text-slate-400">Active Strategies</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <TrendingUp className="w-5 h-5 text-blue-400" />
            </div>
            <div className="text-2xl font-bold text-white">
              +{(strategies.reduce((acc, s) => acc + s.monthlyReturn, 0) / (strategies.length || 1)).toFixed(1)}%
            </div>
            <div className="text-sm text-slate-400">Avg. Monthly Return</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Settings className="w-5 h-5 text-yellow-400" />
            </div>
            <div className="text-2xl font-bold text-white">
              {(strategies.reduce((acc, s) => acc + s.winRate, 0) / (strategies.length || 1)).toFixed(0)}%
            </div>
            <div className="text-sm text-slate-400">Overall Win Rate</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Activity className="w-5 h-5 text-purple-400" />
            </div>
            <div className="text-2xl font-bold text-white">
              {strategies.reduce((acc, s) => acc + s.totalTrades, 0)}
            </div>
            <div className="text-sm text-slate-400">Total Trades</div>
          </div>
        </div>
      </Card>
    </div>
  );
};