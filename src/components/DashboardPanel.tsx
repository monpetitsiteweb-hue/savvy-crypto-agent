
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, AlertCircle } from 'lucide-react';

export const DashboardPanel = () => {
  const portfolioData = {
    totalValue: 12450.32,
    dayChange: 245.67,
    dayChangePercent: 2.01,
    activeStrategies: 3,
    totalTrades: 127,
    successRate: 68.5
  };

  const holdings = [
    { symbol: 'XRP', amount: 15420.50, value: 8234.12, change: 3.2, allocation: 66.2 },
    { symbol: 'BTC', amount: 0.1847, value: 3216.89, change: -1.8, allocation: 25.8 },
    { symbol: 'ETH', amount: 0.8923, value: 999.31, change: 4.1, allocation: 8.0 }
  ];

  const activeStrategies = [
    { name: 'XRP RSI Scalping', status: 'active', profit: 234.56, trades: 45 },
    { name: 'BTC Trend Following', status: 'paused', profit: -23.12, trades: 12 },
    { name: 'Multi-Asset Momentum', status: 'active', profit: 567.89, trades: 78 }
  ];

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Portfolio Value</p>
              <p className="text-2xl font-bold text-white">€{portfolioData.totalValue.toLocaleString()}</p>
              <div className="flex items-center gap-1 mt-1">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <span className="text-sm text-green-400">
                  +€{portfolioData.dayChange} ({portfolioData.dayChangePercent}%)
                </span>
              </div>
            </div>
            <DollarSign className="w-8 h-8 text-green-400" />
          </div>
        </Card>

        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Active Strategies</p>
              <p className="text-2xl font-bold text-white">{portfolioData.activeStrategies}</p>
              <p className="text-sm text-slate-400 mt-1">{portfolioData.totalTrades} total trades</p>
            </div>
            <Activity className="w-8 h-8 text-blue-400" />
          </div>
        </Card>

        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Success Rate</p>
              <p className="text-2xl font-bold text-white">{portfolioData.successRate}%</p>
              <p className="text-sm text-green-400 mt-1">Above average</p>
            </div>
            <Target className="w-8 h-8 text-purple-400" />
          </div>
        </Card>
      </div>

      {/* Holdings */}
      <Card className="p-6 bg-slate-700/30 border-slate-600">
        <h3 className="text-lg font-semibold text-white mb-4">Current Holdings</h3>
        <div className="space-y-4">
          {holdings.map((holding) => (
            <div key={holding.symbol} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-sm">{holding.symbol}</span>
                </div>
                <div>
                  <p className="font-medium text-white">{holding.symbol}</p>
                  <p className="text-sm text-slate-400">{holding.amount.toLocaleString()} coins</p>
                </div>
              </div>
              
              <div className="text-right">
                <p className="font-medium text-white">€{holding.value.toLocaleString()}</p>
                <div className="flex items-center gap-2">
                  {holding.change >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-400" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-400" />
                  )}
                  <span className={`text-sm ${holding.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {holding.change >= 0 ? '+' : ''}{holding.change}%
                  </span>
                </div>
              </div>
              
              <div className="text-right">
                <p className="text-sm text-slate-400">Allocation</p>
                <p className="font-medium text-white">{holding.allocation}%</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Active Strategies */}
      <Card className="p-6 bg-slate-700/30 border-slate-600">
        <h3 className="text-lg font-semibold text-white mb-4">Active Strategies</h3>
        <div className="space-y-3">
          {activeStrategies.map((strategy, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  strategy.status === 'active' ? 'bg-green-400' : 'bg-yellow-400'
                }`} />
                <div>
                  <p className="font-medium text-white">{strategy.name}</p>
                  <p className="text-sm text-slate-400">{strategy.trades} trades executed</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <Badge variant={strategy.status === 'active' ? 'default' : 'secondary'}>
                  {strategy.status}
                </Badge>
                <div className="text-right">
                  <p className={`font-medium ${
                    strategy.profit >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {strategy.profit >= 0 ? '+' : ''}€{strategy.profit}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
