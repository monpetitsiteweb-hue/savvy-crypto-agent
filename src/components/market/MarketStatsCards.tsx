import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface MarketStat {
  title: string;
  value: string;
  change: string;
  isPositive: boolean;
}

const marketStats: MarketStat[] = [
  {
    title: 'Market Cap',
    value: '$2.1T',
    change: '2.4%',
    isPositive: true
  },
  {
    title: '24h Volume',
    value: '$84.2B',
    change: '5.1%',
    isPositive: true
  },
  {
    title: 'BTC Dominance',
    value: '42.1%',
    change: '0.8%',
    isPositive: false
  }
];

export const MarketStatsCards = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
      {marketStats.map((stat, index) => (
        <Card key={index} className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium mb-2">
                  {stat.title}
                </p>
                <p className="text-white text-2xl font-bold">
                  {stat.value}
                </p>
                <div className={`flex items-center gap-1 mt-2 ${
                  stat.isPositive ? 'text-green-400' : 'text-red-400'
                }`}>
                  {stat.isPositive ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  <span className="text-sm font-medium">
                    {stat.isPositive ? '+' : '-'}{stat.change}
                  </span>
                </div>
              </div>
              <div className="text-slate-600">
                {stat.isPositive ? (
                  <TrendingUp className="h-8 w-8" />
                ) : (
                  <TrendingDown className="h-8 w-8" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};