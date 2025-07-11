
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUpRight, ArrowDownLeft, Clock } from 'lucide-react';

interface Trade {
  id: string;
  type: 'buy' | 'sell';
  symbol: string;
  amount: number;
  price: number;
  total: number;
  timestamp: Date;
  strategy: string;
  profit?: number;
}

export const TradingHistory = () => {
  const trades: Trade[] = [
    {
      id: '1',
      type: 'sell',
      symbol: 'XRP',
      amount: 1000,
      price: 0.548,
      total: 548.00,
      timestamp: new Date('2024-01-15T14:30:00'),
      strategy: 'XRP RSI Scalping',
      profit: 23.45
    },
    {
      id: '2',
      type: 'buy',
      symbol: 'XRP',
      amount: 1000,
      price: 0.525,
      total: 525.00,
      timestamp: new Date('2024-01-15T13:45:00'),
      strategy: 'XRP RSI Scalping'
    },
    {
      id: '3',
      type: 'buy',
      symbol: 'BTC',
      amount: 0.025,
      price: 43280.50,
      total: 1082.01,
      timestamp: new Date('2024-01-15T10:15:00'),
      strategy: 'BTC Trend Following'
    },
    {
      id: '4',
      type: 'sell',
      symbol: 'ETH',
      amount: 0.5,
      price: 2845.30,
      total: 1422.65,
      timestamp: new Date('2024-01-15T09:20:00'),
      strategy: 'Multi-Asset Momentum',
      profit: 45.30
    },
    {
      id: '5',
      type: 'buy',
      symbol: 'XRP',
      amount: 2000,
      price: 0.532,
      total: 1064.00,
      timestamp: new Date('2024-01-14T16:45:00'),
      strategy: 'XRP RSI Scalping'
    }
  ];

  const formatTime = (date: Date) => {
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <p className="text-sm text-slate-400">Total Trades</p>
          <p className="text-xl font-bold text-white">127</p>
        </Card>
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <p className="text-sm text-slate-400">Successful</p>
          <p className="text-xl font-bold text-green-400">87</p>
        </Card>
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <p className="text-sm text-slate-400">Total Profit</p>
          <p className="text-xl font-bold text-green-400">+€1,234.56</p>
        </Card>
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <p className="text-sm text-slate-400">Avg. Trade</p>
          <p className="text-xl font-bold text-white">€623.45</p>
        </Card>
      </div>

      {/* Trade List */}
      <Card className="bg-slate-700/30 border-slate-600">
        <div className="p-4 border-b border-slate-600">
          <h3 className="text-lg font-semibold text-white">Recent Trades</h3>
        </div>
        <div className="divide-y divide-slate-600">
          {trades.map((trade) => (
            <div key={trade.id} className="p-4 hover:bg-slate-700/20 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Trade Type Icon */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    trade.type === 'buy' 
                      ? 'bg-green-500/20 text-green-400' 
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {trade.type === 'buy' ? (
                      <ArrowDownLeft className="w-5 h-5" />
                    ) : (
                      <ArrowUpRight className="w-5 h-5" />
                    )}
                  </div>
                  
                  {/* Trade Details */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge 
                        variant={trade.type === 'buy' ? 'default' : 'secondary'}
                        className={trade.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}
                      >
                        {trade.type.toUpperCase()}
                      </Badge>
                      <span className="font-medium text-white">{trade.symbol}</span>
                      {trade.profit && (
                        <Badge variant="outline" className="text-green-400 border-green-400/30">
                          +€{trade.profit}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-400">{trade.strategy}</p>
                  </div>
                </div>
                
                {/* Trade Info */}
                <div className="text-right">
                  <div className="flex items-center gap-4 mb-1">
                    <div>
                      <p className="text-sm text-slate-400">Amount</p>
                      <p className="font-medium text-white">{trade.amount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Price</p>
                      <p className="font-medium text-white">€{trade.price}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Total</p>
                      <p className="font-medium text-white">€{trade.total.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 justify-end">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span className="text-xs text-slate-400">{formatTime(trade.timestamp)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
