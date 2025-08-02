import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useState } from 'react';

// Mock data for Bitcoin price chart
const generateMockData = () => {
  const data = [];
  const basePrice = 113000;
  
  for (let i = 0; i < 100; i++) {
    const time = new Date(Date.now() - (100 - i) * 60 * 60 * 1000);
    const volatility = Math.random() * 2000 - 1000;
    const price = basePrice + volatility + (i * 10);
    
    data.push({
      time: time.toISOString(),
      price: price,
      volume: Math.random() * 1000
    });
  }
  
  return data;
};

const timeframes = [
  { label: '1m', value: '1m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: 'D', value: 'D' }
];

export const BitcoinPriceChart = () => {
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  const [data] = useState(generateMockData());
  
  const currentPrice = 113592.12;
  const priceChange = 294.19;
  const percentChange = 0.26;

  return (
    <Card className="bg-slate-800/50 border-slate-700 h-full">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-xl font-semibold">
            Bitcoin Price
          </CardTitle>
          <div className="flex items-center gap-2">
            {timeframes.map((timeframe) => (
              <Button
                key={timeframe.value}
                variant={selectedTimeframe === timeframe.value ? "default" : "ghost"}
                size="sm"
                onClick={() => setSelectedTimeframe(timeframe.value)}
                className={selectedTimeframe === timeframe.value 
                  ? "bg-slate-700 text-white" 
                  : "text-slate-400 hover:text-white"
                }
              >
                {timeframe.label}
              </Button>
            ))}
          </div>
        </div>
        
        {/* Price Info */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-orange-500 font-bold">₿</span>
            <span className="text-slate-400">Bitcoin / TetherUS</span>
            <span className="text-slate-600">• 1D • Binance</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <span className="text-slate-400">O</span>
          <span className="text-slate-300">113,297.93</span>
          <span className="text-slate-400">H</span>
          <span className="text-slate-300">113,909.30</span>
          <span className="text-slate-400">L</span>
          <span className="text-slate-300">113,198.63</span>
          <span className="text-slate-400">C</span>
          <span className="text-green-400">{currentPrice.toLocaleString()}</span>
          <span className="text-green-400">+{priceChange} (+{percentChange}%)</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Vol • BTC</span>
          <span className="text-slate-300">873</span>
        </div>
      </CardHeader>
      
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="time" 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#9CA3AF' }}
              tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            />
            <YAxis 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#9CA3AF' }}
              domain={['dataMin - 500', 'dataMax + 500']}
              tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
            />
            <ReferenceLine y={currentPrice} stroke="#10B981" strokeDasharray="2 2" />
            <Line 
              type="monotone" 
              dataKey="price" 
              stroke="#10B981" 
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};