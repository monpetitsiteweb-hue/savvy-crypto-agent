import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingDown, TrendingUp } from 'lucide-react';

interface CryptoCurrency {
  name: string;
  symbol: string;
  price: string;
  change24h: string;
  volume: string;
  isPositive: boolean;
  icon: string;
}

const cryptocurrencies: CryptoCurrency[] = [
  {
    name: 'Bitcoin',
    symbol: 'BTC',
    price: '$113,544',
    change24h: '1.43%',
    volume: '$59.6B',
    isPositive: false,
    icon: '₿'
  },
  {
    name: 'Ethereum',
    symbol: 'ETH',
    price: '$3,508.12',
    change24h: '4.76%',
    volume: '$41.8B',
    isPositive: false,
    icon: 'Ξ'
  },
  {
    name: 'XRP',
    symbol: 'XRP',
    price: '$2.97',
    change24h: '0.11%',
    volume: '$8.3B',
    isPositive: false,
    icon: '◉'
  },
  {
    name: 'Tether',
    symbol: 'USDT',
    price: '$1',
    change24h: '0.03%',
    volume: '$108.4B',
    isPositive: false,
    icon: '₮'
  },
  {
    name: 'BNB',
    symbol: 'BNB',
    price: '$763.69',
    change24h: '2.88%',
    volume: '$2.0B',
    isPositive: false,
    icon: '◆'
  }
];

export const CryptocurrencyTable = () => {
  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white text-xl font-semibold">
          Top Cryptocurrencies
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-700 hover:bg-transparent">
              <TableHead className="text-slate-400 font-medium">Name</TableHead>
              <TableHead className="text-slate-400 font-medium">Price</TableHead>
              <TableHead className="text-slate-400 font-medium">24h Change</TableHead>
              <TableHead className="text-slate-400 font-medium">Volume</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cryptocurrencies.map((crypto, index) => (
              <TableRow 
                key={index} 
                className="border-slate-700 hover:bg-slate-700/30 transition-colors"
              >
                <TableCell className="py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-orange-500 to-yellow-500 flex items-center justify-center text-white font-bold text-sm">
                      {crypto.icon}
                    </div>
                    <div>
                      <p className="text-white font-medium">{crypto.name}</p>
                      <p className="text-slate-400 text-sm">{crypto.symbol}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-white font-medium">
                  {crypto.price}
                </TableCell>
                <TableCell>
                  <div className={`flex items-center gap-1 ${
                    crypto.isPositive ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {crypto.isPositive ? (
                      <TrendingUp className="h-4 w-4" />
                    ) : (
                      <TrendingDown className="h-4 w-4" />
                    )}
                    <span className="font-medium">
                      {crypto.isPositive ? '+' : '-'}{crypto.change24h}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-slate-300 font-medium">
                  {crypto.volume}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};