import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownLeft, Activity, RefreshCw, TrendingUp, DollarSign, PieChart } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useMockWallet } from '@/hooks/useMockWallet';
import { NoActiveStrategyState } from './NoActiveStrategyState';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { useRealTimeMarketData } from '@/hooks/useRealTimeMarketData';
import { checkIntegrity, calculateOpenPosition, processPastPosition } from '@/utils/valuationService';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Lock } from 'lucide-react';
import { useCoordinatorToast } from '@/hooks/useCoordinatorToast';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import { OpenList } from '@/components/TradingHistoryOpenList';
import { PastList } from '@/components/TradingHistoryPastList';

interface Trade {
  id: string;
  trade_type: string;
  cryptocurrency: string;
  amount: number;
  price: number;
  total_value: number;
  executed_at: string;
  fees?: number;
  notes?: string;
  strategy_id?: string;
  strategy_trigger?: string;
  is_test_mode?: boolean;
  profit_loss?: number;
  original_purchase_amount?: number;
  original_purchase_price?: number;
  original_purchase_value?: number;
  exit_value?: number;
  realized_pnl?: number;
  realized_pnl_pct?: number;
  buy_fees?: number;
  sell_fees?: number;
  is_corrupted?: boolean;
  integrity_reason?: string;
}

interface TradePerformance {
  currentPrice: number | null;
  currentValue: number | null;
  purchaseValue: number | null;
  purchasePrice: number | null;
  gainLoss: number | null;
  gainLossPercentage: number | null;
  isAutomatedWithoutPnL?: boolean;
  isCorrupted?: boolean;
  corruptionReasons?: string[];
}

interface TradingHistoryProps {
  hasActiveStrategy: boolean;
  onCreateStrategy?: () => void;
}

export function TradingHistory({ hasActiveStrategy, onCreateStrategy }: TradingHistoryProps) {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { toast } = useToast();
  const { handleCoordinatorResponse } = useCoordinatorToast();
  const { getTotalValue, balances } = useMockWallet();
  const { marketData, getCurrentData } = useRealTimeMarketData();

  const [feeRate, setFeeRate] = useState<number>(0);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'open' | 'past'>('open');
  const [stats, setStats] = useState({
    totalTrades: 0,
    totalVolume: 0,
    netProfitLoss: 0,
    openPositions: 0,
    totalInvested: 0,
    currentPL: 0,
    totalPL: 0,
    currentlyInvested: 0
  });

  // Calculate trade performance using market data and valuation service
  const calculateTradePerformance = async (trade: Trade): Promise<TradePerformance> => {
    if (trade.trade_type === 'sell') {
      const pastPosition = processPastPosition({
        original_purchase_amount: trade.original_purchase_amount,
        original_purchase_value: trade.original_purchase_value,
        original_purchase_price: trade.original_purchase_price,
        price: trade.price,
        exit_value: trade.exit_value,
        realized_pnl: trade.realized_pnl,
        realized_pnl_pct: trade.realized_pnl_pct
      });
      
      return {
        currentPrice: pastPosition.exitPrice,
        currentValue: pastPosition.exitValue,
        purchaseValue: pastPosition.purchaseValue,
        purchasePrice: pastPosition.entryPrice,
        gainLoss: pastPosition.realizedPnL,
        gainLossPercentage: pastPosition.realizedPnLPct,
        isAutomatedWithoutPnL: false
      };
    }
    
    // Open position calculation
    const baseSymbol = toBaseSymbol(trade.cryptocurrency);
    const pairSymbol = toPairSymbol(baseSymbol);
    const currentPrice = marketData[pairSymbol]?.price || null;
    
    const openPositionInputs = {
      symbol: baseSymbol,
      amount: trade.amount,
      purchaseValue: trade.amount * trade.price,
      entryPrice: trade.price
    };
    
    const performance = calculateOpenPosition(openPositionInputs, currentPrice);
    
    return {
      currentPrice: performance.currentPrice,
      currentValue: performance.currentValue,
      purchaseValue: openPositionInputs.purchaseValue,
      purchasePrice: openPositionInputs.entryPrice,
      gainLoss: performance.pnlEur,
      gainLossPercentage: performance.pnlPct,
      isCorrupted: false,
      corruptionReasons: currentPrice === null ? ['Current price not available from MarketDataProvider'] : []
    };
  };

  // Build FIFO lots for open positions
  const buildFifoLots = (allTrades: Trade[]) => {
    const sorted = [...allTrades].sort((a,b)=> new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());
    const lotsBySymbol = new Map<string, { trade: Trade; remaining: number }[]>();
    for (const t of sorted) {
      const sym = t.cryptocurrency;
      if (!lotsBySymbol.has(sym)) lotsBySymbol.set(sym, []);
      if (t.trade_type === 'buy') {
        lotsBySymbol.get(sym)!.push({ trade: t, remaining: t.amount });
      } else if (t.trade_type === 'sell') {
        let sellRemaining = t.amount;
        const lots = lotsBySymbol.get(sym)!;
        for (let i = 0; i < lots.length && sellRemaining > 1e-12; i++) {
          const lot = lots[i];
          const used = Math.min(lot.remaining, sellRemaining);
          lot.remaining -= used;
          sellRemaining -= used;
        }
      }
    }
    const openLots: Trade[] = [];
    let closedCount = 0;
    lotsBySymbol.forEach((lots) => {
      lots.forEach(({ trade, remaining }) => {
        if (remaining > 1e-12) {
          const ratio = remaining / trade.amount;
          openLots.push({
            ...trade,
            amount: remaining,
            total_value: trade.total_value * ratio,
            fees: 0,
          });
        } else {
          closedCount += 1;
        }
      });
    });
    return { openLots, closedCount };
  };

  const getOpenPositionsList = () => {
    if (trades.length === 0) return [] as Trade[];
    const { openLots } = buildFifoLots(trades);
    return openLots.sort((a, b) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime());
  };

  // Calculate realized P&L using FIFO
  const computeRealizedPLFIFO = (allTrades: Trade[]) => {
    const sorted = [...allTrades].sort((a,b)=> new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());
    const lotsBySymbol = new Map<string, { price: number; remaining: number }[]>();
    let realized = 0;
    for (const t of sorted) {
      const sym = t.cryptocurrency;
      if (!lotsBySymbol.has(sym)) lotsBySymbol.set(sym, []);
      if (t.trade_type === 'buy') {
        lotsBySymbol.get(sym)!.push({ price: t.price, remaining: t.amount });
      } else if (t.trade_type === 'sell') {
        let q = t.amount;
        const lots = lotsBySymbol.get(sym)!;
        for (let i = 0; i < lots.length && q > 1e-12; i++) {
          const lot = lots[i];
          const used = Math.min(lot.remaining, q);
          realized += (t.price - lot.price) * used;
          lot.remaining -= used;
          q -= used;
        }
      }
    }
    return realized;
  };

  // Calculate unrealized P&L from open positions
  const computeUnrealizedPLFromOpenLots = async (openLots: Trade[]) => {
    let unrealizedPL = 0;
    let invested = 0;
    let corruptedCount = 0;
    
    for (const lot of openLots) {
      const performance = await calculateTradePerformance(lot);
      
      if (performance.isCorrupted) {
        corruptedCount++;
        continue;
      }

      unrealizedPL += performance.gainLoss || 0;
      invested += performance.purchaseValue || 0;
    }

    return { unrealizedPL, invested };
  };

  // Sell position function
  const sellPosition = async (trade: Trade) => {
    if (!user) return;
    
    try {
      const { validateTradePrice, validatePurchaseValue, logValidationFailure } = await import('../utils/regressionGuards');
      
      const baseSymbol = toBaseSymbol(trade.cryptocurrency);
      const pairSymbol = toPairSymbol(baseSymbol);
      let currentPrice = marketData[pairSymbol]?.price;
      
      // Try to get deterministic price from snapshots first
      try {
        const { data: snapshot } = await supabase
          .from('price_snapshots')
          .select('price')
          .eq('symbol', baseSymbol)
          .order('ts', { ascending: false })
          .limit(1);
        
        if (snapshot?.[0]?.price) {
          currentPrice = snapshot[0].price;
        }
      } catch (error) {
        console.warn('Could not fetch price snapshot for sell, using market price');
      }

      // Apply price validation guard
      const priceValidation = validateTradePrice(currentPrice, trade.cryptocurrency);
      if (!priceValidation.isValid) {
        logValidationFailure('sell_price_corruption_guard', priceValidation.errors, { currentPrice, symbol: trade.cryptocurrency });
        toast({
          title: "Sell Blocked",
          description: `Suspicious price detected: €${currentPrice}. Contact support.`,
          variant: "destructive",
        });
        return;
      }

      const sellAmount = trade.amount * currentPrice;
      const valueValidation = validatePurchaseValue(trade.amount, currentPrice, sellAmount);
      if (!valueValidation.isValid) {
        logValidationFailure('sell_value_consistency_guard', valueValidation.errors, { 
          amount: trade.amount, 
          price: currentPrice, 
          sellValue: sellAmount 
        });
        toast({
          title: "Sell Blocked",
          description: "Trade value inconsistency detected. Contact support.",
          variant: "destructive",
        });
        return;
      }

      const sellTrade = {
        user_id: user.id,
        strategy_id: trade.strategy_id,
        trade_type: 'sell',
        cryptocurrency: trade.cryptocurrency,
        amount: trade.amount,
        price: currentPrice,
        total_value: sellAmount,
        fees: 0,
        executed_at: new Date().toISOString(),
        is_test_mode: true,
        notes: `Manual sell from History panel`
      };

      const { error } = await supabase
        .from('mock_trades')
        .insert(sellTrade);

      if (error) {
        console.error('Error selling position:', error);
        toast({
          title: "Sell Failed",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Trade Executed",
        description: `Sold ${trade.amount} ${trade.cryptocurrency} at ${formatEuro(currentPrice)}`,
        variant: "default",
      });

      fetchTradingHistory();
    } catch (error) {
      console.error('Error in sellPosition:', error);
      toast({
        title: "Error",
        description: "Failed to sell position",
        variant: "destructive",
      });
    }
  };

  // Fetch trading history
  const fetchTradingHistory = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .order('executed_at', { ascending: false });

      if (error) throw error;

      setTrades(data || []);

      if (data && data.length > 0) {
        const openPositions = getOpenPositionsList();
        const realizedPL = computeRealizedPLFIFO(data);
        const { unrealizedPL, invested } = await computeUnrealizedPLFromOpenLots(openPositions);

        setStats({
          totalTrades: data.length,
          totalVolume: data.reduce((sum, t) => sum + t.total_value, 0),
          netProfitLoss: realizedPL + unrealizedPL,
          openPositions: openPositions.length,
          totalInvested: invested,
          currentPL: unrealizedPL,
          totalPL: realizedPL + unrealizedPL,
          currentlyInvested: invested
        });
      }
    } catch (error) {
      console.error('Error fetching trading history:', error);
      toast({
        title: "Error",
        description: "Failed to fetch trading history",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch user profile data
  const fetchUserProfile = async () => {
    if (!user) return;

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('fee_rate, account_type')
        .eq('id', user.id)
        .single();

      if (profile) {
        setFeeRate(0); // Always zero fees
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    }
  };

  // Load data on component mount
  useEffect(() => {
    if (user) {
      fetchTradingHistory();
      fetchUserProfile();
    }
  }, [user, testMode]);

  // Real-time subscription
  useEffect(() => {
    if (!user) return;

    let refreshTimeout: NodeJS.Timeout;

    const channel = supabase
      .channel('mock_trades_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mock_trades',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          clearTimeout(refreshTimeout);
          refreshTimeout = setTimeout(() => {
            fetchTradingHistory();
          }, 1000);
        }
      )
      .subscribe();

    return () => {
      clearTimeout(refreshTimeout);
      supabase.removeChannel(channel);
    };
  }, [user]);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <Activity className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Trading History</h2>
          <RefreshCw className="w-4 h-4 ml-auto animate-spin" />
        </div>
        <div className="animate-pulse">
          <div className="h-4 bg-muted rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (!hasActiveStrategy) {
    return <NoActiveStrategyState onCreateStrategy={onCreateStrategy} />;
  }

  const openPositions = getOpenPositionsList();
  const pastPositions = trades.filter(t => t.trade_type === 'sell');

  return (
    <Card className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Trading History</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchTradingHistory}
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Strategy KPIs Overview */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Strategy KPIs Overview
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Positions Summary */}
          <Card className="p-4 bg-card/50 border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <PieChart className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-muted-foreground">Positions Summary</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Open Positions</span>
                <span className="text-lg font-bold">{stats.openPositions}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total Positions</span>
                <span className="text-sm text-muted-foreground">Open + Closed</span>
              </div>
            </div>
          </Card>
          
          {/* Investment Metrics */}
          <Card className="p-4 bg-card/50 border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-medium text-muted-foreground">Investment Metrics</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Currently Invested</span>
                <span className="text-lg font-bold">{formatEuro(stats.currentlyInvested)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total Invested</span>
                <span className="text-sm">{formatEuro(stats.totalInvested)}</span>
              </div>
            </div>
          </Card>
          
          {/* Performance Metrics */}
          <Card className="p-4 bg-card/50 border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-muted-foreground">Performance Metrics</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Unrealized P&L</span>
                <span className={`text-lg font-bold ${stats.currentPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(stats.currentPL)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Realized P&L</span>
                <span className={`text-sm ${(stats.totalPL - stats.currentPL) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(stats.totalPL - stats.currentPL)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total P&L</span>
                <span className={`text-sm ${stats.totalPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(stats.totalPL)}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value: any) => setActiveTab(value)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="open" className="flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4" />
            Open Positions ({openPositions.length})
          </TabsTrigger>
          <TabsTrigger value="past" className="flex items-center gap-2">
            <ArrowDownLeft className="w-4 h-4" />
            Past Positions ({pastPositions.length})
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="open" className="mt-4">
          <OpenList 
            trades={openPositions}
            marketData={marketData} 
            onCancelOrder={() => {}}
          />
        </TabsContent>
        
        <TabsContent value="past" className="mt-4">
          <PastList 
            trades={pastPositions}
            marketData={marketData}
          />
        </TabsContent>
      </Tabs>
    </Card>
  );
}