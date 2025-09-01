import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownLeft, Clock, Activity, RefreshCw, TrendingUp, DollarSign, PieChart, ChevronLeft, ChevronRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useMockWallet } from '@/hooks/useMockWallet';
import { NoActiveStrategyState } from './NoActiveStrategyState';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { calculateOpenPosition, processPastPosition } from '@/utils/valuationService';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle } from 'lucide-react';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import { sharedPriceCache } from '@/utils/SharedPriceCache';

const PAGE_SIZE = 20;

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
  const { getTotalValue, balances } = useMockWallet();
  
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [openPage, setOpenPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'open' | 'past'>('open');
  const [stats, setStats] = useState({
    totalTrades: 0,
    totalVolume: 0,
    netProfitLoss: 0,
    openPositions: 0,
    totalInvested: 0,
    currentPL: 0,
    totalPL: 0,
    currentlyInvested: 0,
    pastInvestments: 0
  });

  // Initialize shared price cache on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const debugMode = urlParams.get('debug') === 'history';
    
    // Always log the startup message for price cache
    if (debugMode) console.log('[HistoryPerf] priceCache=on intervalMs=30000');
    
    return () => {
      sharedPriceCache.cleanup();
    };
  }, []);

  // Update price cache symbols when trades change
  useEffect(() => {
    if (trades.length > 0) {
      const symbols = [...new Set(trades.map(trade => {
        const baseSymbol = toBaseSymbol(trade.cryptocurrency);
        return toPairSymbol(baseSymbol);
      }))];
      
      sharedPriceCache.updateSymbols(symbols);
      
      if (symbols.length > 0 && !sharedPriceCache.getAllPrices().size) {
        sharedPriceCache.initialize(symbols);
      }
    }
  }, [trades]);

  // Calculate trade performance using shared cache
  const calculateTradePerformance = (trade: Trade): TradePerformance => {
    if (trade.trade_type === 'sell') {
      // Past positions - use snapshot fields only
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
    
    // Open positions - use shared price cache
    const baseSymbol = toBaseSymbol(trade.cryptocurrency);
    const pairSymbol = toPairSymbol(baseSymbol);
    const currentPrice = sharedPriceCache.getPrice(pairSymbol);
    
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
      corruptionReasons: currentPrice === null ? ['Current price not available'] : []
    };
  };

  // FIFO helper functions
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

        // Calculate stats
      if (data && data.length > 0) {
        const openPositions = getOpenPositionsList();
        let realizedPL = 0;
        let unrealizedPL = 0;
        let invested = 0;
        let pastInvestments = 0;

        // Calculate realized P&L from sell trades
        const sellTrades = data.filter(t => t.trade_type === 'sell');
        realizedPL = sellTrades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);

        // Calculate past investments (purchase values of sold positions)
        pastInvestments = sellTrades.reduce((sum, t) => sum + (t.original_purchase_value || 0), 0);

        // Calculate unrealized P&L from open positions
        for (const trade of openPositions) {
          const performance = calculateTradePerformance(trade);
          if (!performance.isCorrupted) {
            unrealizedPL += performance.gainLoss || 0;
            invested += performance.purchaseValue || 0;
          }
        }

        // Total Volume = purchase values only (current + past investments)
        const totalInvestmentVolume = invested + pastInvestments;

        setStats({
          totalTrades: openPositions.length + sellTrades.length,
          totalVolume: totalInvestmentVolume,
          netProfitLoss: realizedPL + unrealizedPL,
          openPositions: openPositions.length,
          totalInvested: invested,
          currentPL: unrealizedPL,
          totalPL: realizedPL + unrealizedPL,
          currentlyInvested: invested,
          pastInvestments: pastInvestments
        });
      }
    } catch (error) {
      // Silent error handling - no UI toasts
      window.NotificationSink?.log({ message: 'Error fetching trading history', error });
    } finally {
      setLoading(false);
    }
  };

  // Load data on component mount and when user changes  
  useEffect(() => {
    if (user) {
      fetchTradingHistory();
    }
  }, [user, testMode]);

  // Real-time subscription to mock_trades changes
  useEffect(() => {
    if (!user) return;

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
        () => {
          // Throttle updates to prevent constant blinking
          setTimeout(() => {
            fetchTradingHistory();
          }, 1000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // TradeCard component for rendering individual trades
  const TradeCard = ({ trade, showSellButton = false }: { trade: Trade; showSellButton?: boolean }) => {
    const [performance, setPerformance] = useState<TradePerformance | null>(null);
    const [cardLoading, setCardLoading] = useState(true);
    
    useEffect(() => {
      const loadPerformance = () => {
        try {
          const perf = calculateTradePerformance(trade);
          setPerformance(perf);
        } catch (error) {
          window.NotificationSink?.log({ message: 'Error calculating trade performance', error });
        } finally {
          setCardLoading(false);
        }
      };

      loadPerformance();
    }, [trade.id]);

    if (cardLoading || !performance) {
      return (
        <Card className="p-4">
          <div className="h-4 bg-muted rounded w-1/3 mb-2"></div>
          <div className="h-3 bg-muted rounded w-1/2"></div>
        </Card>
      );
    }

    const isProfit = (performance.gainLoss || 0) > 0;
    const isLoss = (performance.gainLoss || 0) < 0;

    return (
      <Card className="p-4 hover:shadow-md transition-shadow">
        {trade.is_corrupted && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="text-xs mb-2">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Corrupted
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">
                  <strong>Data Integrity Issue:</strong><br />
                  {trade.integrity_reason || 'Unknown corruption detected'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              trade.trade_type === 'buy' ? 'bg-emerald-500' : 'bg-red-500'
            }`} />
            <span className="font-semibold text-lg">{trade.cryptocurrency}</span>
          </div>
          <Badge variant={trade.trade_type === 'buy' ? 'default' : 'secondary'}>
            {trade.trade_type.toUpperCase()}
          </Badge>
        </div>
        
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Amount</p>
            <p className="font-medium">{trade.amount.toFixed(8)}</p>
          </div>
          
          <div>
            <p className="text-muted-foreground">
              {trade.trade_type === 'buy' ? 'Purchase Price' : 'Average Purchase Price'}
            </p>
            <p className="font-medium">{formatEuro(performance.purchasePrice || performance.currentPrice)}</p>
          </div>
          
          <div>
            <p className="text-muted-foreground">Purchase Value</p>
            <p className="font-medium">
              {trade.trade_type === 'buy' 
                ? formatEuro(trade.total_value) 
                : formatEuro(trade.original_purchase_value || 0)
              }
            </p>
          </div>
          
          {trade.trade_type === 'buy' && (
            <>
              <div>
                <p className="text-muted-foreground">Current Price</p>
                <p className="font-medium">
                  {performance.currentPrice !== null ? formatEuro(performance.currentPrice) : "—"}
                </p>
              </div>
              
              <div>
                <p className="text-muted-foreground">Current Value</p>
                <p className="font-medium">
                  {performance.currentValue !== null ? formatEuro(performance.currentValue) : "—"}
                </p>
              </div>
            </>
          )}
          
          {trade.trade_type === 'sell' && (
            <div>
              <p className="text-muted-foreground">Exit Value</p>
              <p className="font-medium">{formatEuro(performance.currentValue)}</p>
            </div>
          )}
          
          {performance.gainLoss !== null && performance.gainLossPercentage !== null && (
            <>
              <div>
                <p className="text-muted-foreground">P&L (€)</p>
                <p className={`font-medium ${isProfit ? 'text-emerald-600' : isLoss ? 'text-red-600' : ''}`}>
                  {formatEuro(performance.gainLoss)}
                </p>
              </div>
              
              <div>
                <p className="text-muted-foreground">P&L (%)</p>
                <p className={`font-medium ${isProfit ? 'text-emerald-600' : isLoss ? 'text-red-600' : ''}`}>
                  {formatPercentage(performance.gainLossPercentage || 0)}
                </p>
              </div>
            </>
          )}
        </div>
        
        <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
          <p>Executed: {new Date(trade.executed_at).toLocaleString()}</p>
          {trade.notes && <p className="mt-1">Note: {trade.notes}</p>}
        </div>
      </Card>
    );
  };

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
  
  // Pagination for both open and past positions  
  const totalPastPages = Math.ceil(pastPositions.length / PAGE_SIZE);
  const totalOpenPages = Math.ceil(openPositions.length / PAGE_SIZE);
  
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedPastPositions = pastPositions.slice(startIndex, endIndex);
  
  const openStartIndex = (openPage - 1) * PAGE_SIZE;
  const openEndIndex = openStartIndex + PAGE_SIZE;
  const paginatedOpenPositions = openPositions.slice(openStartIndex, openEndIndex);

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

      {/* Portfolio Summary */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <PieChart className="w-5 h-5" />
          Portfolio Summary
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Positions */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-muted-foreground">Positions</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Open Positions</span>
                <span className="text-lg font-bold">{stats.openPositions}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Past Positions</span>
                <span className="text-sm">{pastPositions.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total Trades</span>
                <span className="text-sm">{stats.totalTrades}</span>
              </div>
            </div>
          </Card>
          
          {/* Investment */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-medium text-muted-foreground">Investment</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Currently Invested</span>
                <span className="text-lg font-bold">{formatEuro(stats.currentlyInvested)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Past Investments</span>
                <span className="text-sm">{formatEuro(stats.pastInvestments)}</span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-xs text-muted-foreground font-medium">Total</span>
                <span className="text-sm font-semibold">{formatEuro(stats.totalVolume)}</span>
              </div>
            </div>
          </Card>
          
          {/* Performance */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-muted-foreground">Performance</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Unrealized P&L</span>
                <span className={`text-lg font-bold ${stats.currentPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(stats.currentPL)}
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
          {openPositions.length > 0 ? (
            <>
              <div className="space-y-4">
                {paginatedOpenPositions.map(trade => (
                  <TradeCard
                    key={trade.id}
                    trade={trade}
                    showSellButton={true}
                  />
                ))}
              </div>
              
              {/* Pagination for Open Positions */}
              {totalOpenPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenPage(p => Math.max(1, p - 1))}
                    disabled={openPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </Button>
                  
                  <span className="text-sm text-muted-foreground mx-4">
                    Page {openPage} of {totalOpenPages}
                  </span>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenPage(p => Math.min(totalOpenPages, p + 1))}
                    disabled={openPage === totalOpenPages}
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No open positions</p>
              <p className="text-sm mt-2">Your open positions will appear here when you make trades</p>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="past" className="mt-4">
          {pastPositions.length > 0 ? (
            <>
              <div className="space-y-4">
                {paginatedPastPositions.map(trade => (
                  <TradeCard
                    key={trade.id}
                    trade={trade}
                    showSellButton={false}
                  />
                ))}
              </div>
              
              {/* Pagination Controls */}
              {totalPastPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </Button>
                  
                  <span className="text-sm text-muted-foreground mx-4">
                    Page {currentPage} of {totalPastPages}
                  </span>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPastPages, p + 1))}
                    disabled={currentPage === totalPastPages}
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No past positions</p>
              <p className="text-sm mt-2">Your completed trades will appear here</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}