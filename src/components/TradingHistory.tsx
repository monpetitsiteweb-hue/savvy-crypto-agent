import { useState, useEffect, useRef, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownLeft, Clock, Activity, RefreshCw, TrendingUp, DollarSign, PieChart, Target } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useMockWallet } from '@/hooks/useMockWallet';
import { NoActiveStrategyState } from './NoActiveStrategyState';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { checkIntegrity, calculateOpenPosition, processPastPosition } from '@/utils/valuationService';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Lock } from 'lucide-react';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import { setSymbols, getPriceMap } from '@/price/PriceCache';
import { logEvent } from '@/log/NotificationSink';

// Row capping for performance
const ROW_CAP = 50;

// Match actual Supabase schema
interface Trade {
  id: string;
  user_id: string;
  cryptocurrency: string;
  amount: number;
  price: number;
  total_value: number;
  trade_type: string;
  executed_at: string;
  is_test_mode: boolean | null;
  strategy_id: string;
  buy_fees?: number | null;
  exit_value?: number | null;
  fees?: number | null;
  integrity_reason?: string | null;
  is_corrupted?: boolean;
}

interface Position {
  symbol: string;
  remaining_amount: number;
  average_purchase_price: number;
  total_invested: number;
  oldest_purchase_date: string;
}

interface TradingHistoryProps {
  hasActiveStrategy?: boolean;
  onCreateStrategy?: () => void;
}

export function TradingHistory({ hasActiveStrategy, onCreateStrategy }: TradingHistoryProps = {}) {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { getTotalValue, balances } = useMockWallet();
  
  // Shared price cache (forced ON)
  const [priceMap, setPriceMap] = useState(getPriceMap());
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [feeRate, setFeeRate] = useState<number>(0);
  const rowCapLoggedRef = useRef(false);

  // Compute symbols and update price cache
  useEffect(() => {
    if (trades.length > 0) {
      const uniqueAssets = Array.from(new Set(trades.map(t => t.cryptocurrency)));
      const symbolPairs = uniqueAssets.map(asset => `${asset}-EUR`);
      setSymbols(symbolPairs);
      
      // Update price map from cache
      const currentPriceMap = getPriceMap();
      setPriceMap(currentPriceMap);
    }
  }, [trades]);

  // Subscribe to price cache updates
  useEffect(() => {
    const interval = setInterval(() => {
      const currentPriceMap = getPriceMap();
      setPriceMap(currentPriceMap);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Market data from shared price cache only
  const marketData = priceMap;
  
  // Log row cap once
  useEffect(() => {
    if (!rowCapLoggedRef.current) {
      console.log(`[HistoryPerf] rowCap=${ROW_CAP}`);
      rowCapLoggedRef.current = true;
    }
  }, []);

  const fetchTradingHistory = async (source: string = 'initial') => {
    if (!user) return;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_test_mode', testMode)
        .order('executed_at', { ascending: false });

      if (error) {
        logEvent({ level: 'error', code: 'fetch_history_error', message: 'Failed to fetch trading history' });
        return;
      }

      setTrades(data || []);
    } catch (error) {
      console.error('❌ HISTORY: Error fetching trading history:', error);
      logEvent({ level: 'error', code: 'fetch_history_error', message: 'Failed to fetch trading history' });
    } finally {
      setLoading(false);
    }
  };

  const sellPosition = async (trade: Trade) => {
    try {
      const baseSymbol = toBaseSymbol(trade.cryptocurrency);
      const pairSymbol = toPairSymbol(baseSymbol);
      
      // Get current price from cache
      const p = priceMap[pairSymbol];
      const currentPrice = p?.price ?? null;
      
      if (!currentPrice) {
        logEvent({ level: 'error', code: 'sell_no_price', message: `No price available for ${baseSymbol}` });
        return;
      }

      const sellAmount = trade.amount * currentPrice;
      const sellTrade = {
        user_id: user!.id,
        cryptocurrency: trade.cryptocurrency,
        amount: trade.amount,
        price: currentPrice,
        total_value: sellAmount,
        trade_type: 'sell',
        executed_at: new Date().toISOString(),
        is_test_mode: testMode,
        strategy_id: trade.strategy_id || '',
      };

      const { error } = await supabase
        .from('mock_trades')
        .insert(sellTrade);

      if (error) {
        logEvent({ level: 'error', code: 'sell_failed', message: error.message });
        return;
      }

      logEvent({ 
        level: 'success', 
        code: 'trade_executed', 
        message: `Sold ${trade.amount} ${trade.cryptocurrency} at ${formatEuro(currentPrice)}` 
      });

      fetchTradingHistory('strategyEvent');
    } catch (error) {
      console.error('Error in sellPosition:', error);
      logEvent({ level: 'error', code: 'sell_position_error', message: 'Failed to sell position' });
    }
  };

  const calculatePositions = (trades: Trade[]): Position[] => {
    const positions: Record<string, Position> = {};
    
    trades.forEach(trade => {
      const symbol = trade.cryptocurrency;
      
      if (trade.trade_type === 'buy') {
        if (!positions[symbol]) {
          positions[symbol] = {
            symbol,
            remaining_amount: 0,
            average_purchase_price: 0,
            total_invested: 0,
            oldest_purchase_date: trade.executed_at,
          };
        }
        
        const position = positions[symbol];
        const tradeValue = trade.amount * trade.price;
        const newTotalAmount = position.remaining_amount + trade.amount;
        const newTotalInvested = position.total_invested + tradeValue;
        
        position.remaining_amount = newTotalAmount;
        position.total_invested = newTotalInvested;
        position.average_purchase_price = newTotalInvested / newTotalAmount;
        
        if (trade.executed_at < position.oldest_purchase_date) {
          position.oldest_purchase_date = trade.executed_at;
        }
      } else if (trade.trade_type === 'sell') {
        const symbol = trade.cryptocurrency.replace('-EUR', '');
        if (positions[symbol]) {
          positions[symbol].remaining_amount -= trade.amount;
          if (positions[symbol].remaining_amount <= 0.000001) {
            delete positions[symbol];
          }
        }
      }
    });
    
    return Object.values(positions).filter(p => p.remaining_amount > 0.000001);
  };

  useEffect(() => {
    fetchTradingHistory();
  }, [user, testMode]);

  if (!user) {
    return <NoActiveStrategyState onCreateStrategy={onCreateStrategy || (() => {})} />;
  }

  if (loading) {
    return <div>Loading...</div>;
  }

  const openPositions = calculatePositions(trades).slice(0, ROW_CAP);
  const pastTrades = trades.filter(t => t.trade_type === 'sell').slice(0, ROW_CAP);

  return (
    <div className="space-y-6">
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="open">Open Positions ({openPositions.length})</TabsTrigger>
          <TabsTrigger value="past">Past Trades ({pastTrades.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Portfolio Summary</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="text-2xl font-bold">{formatEuro(getTotalValue())}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Open Positions</p>
                <p className="text-2xl font-bold">{openPositions.length}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Trades</p>
                <p className="text-2xl font-bold">{trades.length}</p>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="open" className="space-y-4">
          {openPositions.map((position, index) => {
            const p = priceMap[`${position.symbol}-EUR`];
            const currentPrice = p?.price ?? 0;
            const currentValue = position.remaining_amount * currentPrice;
            const unrealizedPL = currentValue - position.total_invested;
            const unrealizedPLPercentage = position.total_invested > 0 ? (unrealizedPL / position.total_invested) * 100 : 0;

            return (
              <Card key={`${position.symbol}-${index}`} className="p-4">
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{position.symbol}</Badge>
                      <span className="text-sm text-muted-foreground">
                        {position.remaining_amount.toFixed(8)} units
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Avg Price</p>
                        <p className="font-medium">{formatEuro(position.average_purchase_price)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Current Price</p>
                        <p className="font-medium">{formatEuro(currentPrice)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Invested</p>
                        <p className="font-medium">{formatEuro(position.total_invested)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Current Value</p>
                        <p className="font-medium">{formatEuro(currentValue)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={unrealizedPL >= 0 ? "default" : "destructive"}>
                        {unrealizedPL >= 0 ? "+" : ""}{formatEuro(unrealizedPL)}
                      </Badge>
                      <span className={`text-sm ${unrealizedPL >= 0 ? "text-green-600" : "text-red-600"}`}>
                        ({formatPercentage(unrealizedPLPercentage)})
                      </span>
                    </div>
                  </div>
                    <Button
                    variant="outline"
                    size="sm"
                    onClick={() => sellPosition({
                      id: position.symbol,
                      user_id: user.id,
                      cryptocurrency: position.symbol,
                      amount: position.remaining_amount,
                      price: position.average_purchase_price,
                      total_value: position.total_invested,
                      trade_type: 'buy',
                      executed_at: position.oldest_purchase_date,
                      is_test_mode: testMode,
                      strategy_id: ''
                    })}
                  >
                    <ArrowDownLeft className="h-4 w-4 mr-1" />
                    Sell
                  </Button>
                </div>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="past" className="space-y-4">
          {pastTrades.map((trade, index) => (
            <Card key={`${trade.id}-${index}`} className="p-4">
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{trade.cryptocurrency}</Badge>
                    <ArrowDownLeft className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium">SELL</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Amount</p>
                      <p className="font-medium">{trade.amount.toFixed(8)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Price</p>
                      <p className="font-medium">{formatEuro(trade.price)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Value</p>
                      <p className="font-medium">{formatEuro(trade.total_value)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Date</p>
                      <p className="font-medium">{new Date(trade.executed_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
