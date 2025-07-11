
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Settings, Trash2, Plus, TrendingUp } from 'lucide-react';

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
  const [strategies, setStrategies] = useState<Strategy[]>([
    {
      id: '1',
      name: 'XRP RSI Scalping',
      description: 'Buy XRP when RSI < 30, sell when RSI > 70',
      isActive: true,
      riskLevel: 'Medium',
      maxPosition: 1000,
      stopLoss: 2,
      takeProfit: 3,
      performance: {
        totalTrades: 45,
        profitLoss: 234.56,
        successRate: 73.3
      }
    },
    {
      id: '2',
      name: 'BTC Trend Following',
      description: 'Follow Bitcoin momentum with moving average crossovers',
      isActive: false,
      riskLevel: 'High',
      maxPosition: 500,
      stopLoss: 3,
      takeProfit: 5,
      performance: {
        totalTrades: 12,
        profitLoss: -23.12,
        successRate: 41.7
      }
    },
    {
      id: '3',
      name: 'Multi-Asset Momentum',
      description: 'Trade multiple assets based on volume and price momentum',
      isActive: true,
      riskLevel: 'Low',
      maxPosition: 750,
      stopLoss: 1.5,
      takeProfit: 2.5,
      performance: {
        totalTrades: 78,
        profitLoss: 567.89,
        successRate: 84.6
      }
    }
  ]);

  const toggleStrategy = (id: string) => {
    setStrategies(prev => prev.map(strategy => 
      strategy.id === id ? { ...strategy, isActive: !strategy.isActive } : strategy
    ));
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'Low': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'Medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'High': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Strategy Configuration</h2>
          <p className="text-sm text-slate-400 mt-1">Manage and configure your trading strategies</p>
        </div>
        <Button className="bg-green-500 hover:bg-green-600 text-white">
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
