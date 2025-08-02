import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';

// Mock data for Bitcoin performance over time
const generatePerformanceData = () => {
  const months = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
  const data = [];
  let baseValue = 60000;
  
  months.forEach((month, index) => {
    // Simulate Bitcoin's general upward trend with some volatility
    const trend = index * 15000; // General upward trend
    const volatility = Math.random() * 10000 - 5000; // Random volatility
    const value = baseValue + trend + volatility;
    
    data.push({
      month,
      value: Math.max(30000, value) // Ensure minimum value
    });
  });
  
  return data;
};

export const BitcoinPerformanceChart = () => {
  const data = generatePerformanceData();
  
  return (
    <Card className="bg-slate-800/50 border-slate-700 h-full">
      <CardHeader className="pb-4">
        <CardTitle className="text-white text-xl font-semibold">
          Bitcoin Performance
        </CardTitle>
      </CardHeader>
      
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis 
              dataKey="month" 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#9CA3AF' }}
            />
            <YAxis 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#9CA3AF' }}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
            />
            <Line 
              type="monotone" 
              dataKey="value" 
              stroke="#8B5CF6" 
              strokeWidth={3}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};