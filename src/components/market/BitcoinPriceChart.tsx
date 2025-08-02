import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useState } from 'react';
import { 
  Search, 
  Plus, 
  TrendingUp, 
  Move, 
  Minus, 
  BarChart3,
  Activity,
  Pencil,
  Type,
  HelpCircle,
  Edit,
  MoreHorizontal,
  Settings
} from 'lucide-react';

// Mock data for Bitcoin candlestick chart
const generateCandlestickData = () => {
  const data = [];
  let basePrice = 113000;
  
  for (let i = 0; i < 50; i++) {
    const open = basePrice + (Math.random() - 0.5) * 1000;
    const close = open + (Math.random() - 0.5) * 2000;
    const high = Math.max(open, close) + Math.random() * 1000;
    const low = Math.min(open, close) - Math.random() * 1000;
    const volume = Math.random() * 1000 + 200;
    
    data.push({
      time: new Date(Date.now() - (50 - i) * 60 * 60 * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume,
      price: close
    });
    
    basePrice = close;
  }
  
  return data;
};

const timeframes = [
  { label: '1m', value: '1m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: 'D', value: 'D' }
];

const chartTools = [
  { icon: Plus, label: 'Add' },
  { icon: TrendingUp, label: 'Trend Line' },
  { icon: Move, label: 'Move' },
  { icon: Minus, label: 'Remove' },
  { icon: BarChart3, label: 'Bars' },
  { icon: Activity, label: 'Line Chart' },
  { icon: Pencil, label: 'Draw' },
  { icon: Type, label: 'Text' },
  { icon: HelpCircle, label: 'Help' },
  { icon: Edit, label: 'Edit' },
  { icon: MoreHorizontal, label: 'More' }
];

export const BitcoinPriceChart = () => {
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  const [data] = useState(generateCandlestickData());
  const [selectedTool, setSelectedTool] = useState<number | null>(null);
  
  const currentPrice = 113592.12;
  const priceChange = 294.19;
  const percentChange = 0.26;

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-xl font-semibold">
            Bitcoin Price
          </CardTitle>
        </div>
        
        {/* Trading Interface Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Search and Symbol */}
            <div className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <span className="text-white font-medium">BTCUSDT</span>
              <Plus className="h-4 w-4 text-slate-400" />
            </div>
            
            {/* Timeframes */}
            <div className="flex items-center gap-1">
              {timeframes.map((timeframe) => (
                <Button
                  key={timeframe.value}
                  variant={selectedTimeframe === timeframe.value ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedTimeframe(timeframe.value)}
                  className={selectedTimeframe === timeframe.value 
                    ? "bg-slate-600 text-white h-8 px-3" 
                    : "text-slate-400 hover:text-white h-8 px-3"
                  }
                >
                  {timeframe.label}
                </Button>
              ))}
            </div>
            
            {/* Chart Type Controls */}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white h-8 px-2">
                <BarChart3 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white h-8 px-2">
                <Activity className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white h-8 px-2">
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Indicators Button */}
          <Button variant="outline" size="sm" className="border-slate-600 text-slate-300 hover:text-white">
            <Activity className="h-4 w-4 mr-2" />
            Indicators
          </Button>
        </div>
        
        {/* Price Info */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-orange-500 font-bold text-lg">₿</span>
            <span className="text-slate-300">Bitcoin / TetherUS</span>
            <span className="text-slate-500">• 1D • Binance</span>
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          </div>
        </div>
        
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">O</span>
            <span className="text-slate-300">113,297.93</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">H</span>
            <span className="text-slate-300">113,909.30</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">L</span>
            <span className="text-slate-300">113,198.63</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">C</span>
            <span className="text-green-400">{currentPrice.toLocaleString()}</span>
          </div>
          <div className="text-green-400">
            +{priceChange} (+{percentChange}%)
          </div>
        </div>
        
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">Vol • BTC</span>
          <span className="text-slate-300">873</span>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <div className="flex">
          {/* Left Toolbar */}
          <div className="w-12 bg-slate-800/80 border-r border-slate-700 flex flex-col items-center py-4 gap-3">
            {chartTools.map((tool, index) => (
              <button
                key={index}
                onClick={() => setSelectedTool(selectedTool === index ? null : index)}
                className={`p-2 rounded hover:bg-slate-700/50 transition-colors ${
                  selectedTool === index ? 'bg-slate-700 text-white' : 'text-slate-400'
                }`}
                title={tool.label}
              >
                <tool.icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          
          {/* Chart Area */}
          <div className="flex-1 h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="time" 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#9CA3AF' }}
                  tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                />
                <YAxis 
                  yAxisId="price"
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#9CA3AF' }}
                  domain={['dataMin - 500', 'dataMax + 500']}
                  tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                />
                <YAxis 
                  yAxisId="volume"
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  tick={false}
                  domain={[0, 'dataMax']}
                />
                <ReferenceLine y={currentPrice} stroke="#10B981" strokeDasharray="2 2" yAxisId="price" />
                <Bar 
                  yAxisId="volume"
                  dataKey="volume" 
                  fill="#374151" 
                  opacity={0.3}
                />
                <Line 
                  yAxisId="price"
                  type="monotone" 
                  dataKey="price" 
                  stroke="#10B981" 
                  strokeWidth={1}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};