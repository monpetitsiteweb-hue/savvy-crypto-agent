// P1: UI reads portfolio from RPC only. NO client-side trade inserts. NO FIFO recomputation.
import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownLeft, Clock, Activity, RefreshCw, TrendingUp, DollarSign, PieChart, ChevronLeft, ChevronRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useMockWallet } from '@/hooks/useMockWallet';
import { usePortfolioMetrics } from '@/hooks/usePortfolioMetrics';
import { NoActiveStrategyState } from './NoActiveStrategyState';
import { PortfolioNotInitialized } from './PortfolioNotInitialized';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { calculateOpenPosition, processPastPosition } from '@/utils/valuationService';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle } from 'lucide-react';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import { sharedPriceCache } from '@/utils/SharedPriceCache';
import { useToast } from '@/hooks/use-toast';

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
  original_trade_id?: string;
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
  pnl_at_decision_pct?: number;
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
  const { resetPortfolio, isLoading: walletLoading } = useMockWallet();
  const { 
    metrics, 
    loading: metricsLoading, 
    isInitialized,
    refresh: refreshMetrics,
    unrealizedPnlPct,
    realizedPnlPct,
    totalPnlPct
  } = usePortfolioMetrics();
  const { toast } = useToast();
  
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [openPage, setOpenPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'open' | 'past'>('open');
  const [sellConfirmation, setSellConfirmation] = useState<{ open: boolean; trade: Trade | null }>({ 
    open: false, 
    trade: null 
  });

  // Initialize shared price cache on mount
  useEffect(() => {
    return () => {
      sharedPriceCache.clear();
    };
  }, []);

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
      
      let gainLoss = pastPosition.realizedPnL;
      let gainLossPercentage = pastPosition.realizedPnLPct;
      
      if (gainLoss === null && pastPosition.exitValue !== null && pastPosition.purchaseValue !== null) {
        gainLoss = pastPosition.exitValue - pastPosition.purchaseValue;
      }
      
      if (gainLossPercentage === null && gainLoss !== null && pastPosition.purchaseValue !== null && pastPosition.purchaseValue > 0) {
        gainLossPercentage = (gainLoss / pastPosition.purchaseValue) * 100;
      }
      
      return {
        currentPrice: pastPosition.exitPrice,
        currentValue: pastPosition.exitValue,
        purchaseValue: pastPosition.purchaseValue,
        purchasePrice: pastPosition.entryPrice,
        gainLoss: gainLoss,
        gainLossPercentage: gainLossPercentage,
        isAutomatedWithoutPnL: false
      };
    }
    
    // Open positions - use shared price cache, return null if missing (NOT 0)
    const baseSymbol = toBaseSymbol(trade.cryptocurrency);
    const pairSymbol = toPairSymbol(baseSymbol);
    const cached = sharedPriceCache.get(pairSymbol);
    const currentPrice = cached?.price ?? null;
    
    if (currentPrice === null) {
      // No price available - return nulls, UI will show "—"
      return {
        currentPrice: null,
        currentValue: null,
        purchaseValue: trade.amount * trade.price,
        purchasePrice: trade.price,
        gainLoss: null,
        gainLossPercentage: null,
        isCorrupted: false,
        corruptionReasons: ['Current price not available']
      };
    }
    
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
      corruptionReasons: []
    };
  };

  // Get raw BUY trades as open positions (NO FIFO recomputation in UI)
  // Backend RPC provides accurate open lot data; this is a fallback display of raw buys
  const getOpenBuyTrades = (): Trade[] => {
    return trades
      .filter(t => t.trade_type === 'buy')
      .sort((a, b) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime());
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
    } catch (error) {
      // Silent error - just stop loading
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

  // Handle direct sell - ONLY via trading-decision-coordinator
  // NO client-side inserts, NO fallbacks, NO watchdogs
  const handleDirectSell = async (trade: Trade) => {
    if (!user) {
      toast({ title: 'Sell Failed', description: 'User not authenticated', variant: 'destructive' });
      return;
    }

    try {
      // Get current price from cache
      const base = toBaseSymbol(trade.cryptocurrency);
      const pair = toPairSymbol(base);
      const cached = sharedPriceCache.get(pair);
      const price = cached?.price;
      
      if (!price) {
        toast({ title: 'Sell Failed', description: `Current price not available for ${pair}`, variant: 'destructive' });
        return;
      }

      // Calculate expected P&L for logging (display only)
      const perf = calculateTradePerformance(trade);

      // Get strategy ID
      const { data: strategies, error: stratError } = await supabase
        .from('trading_strategies')
        .select('id, strategy_name')
        .eq('user_id', user.id);
      
      if (stratError) throw stratError;
      
      const strategyId = trade.strategy_id || (strategies && strategies[0]?.id);
      if (!strategyId) {
        toast({ title: 'Sell Failed', description: 'No valid strategy found for manual sell', variant: 'destructive' });
        return;
      }

      // Build payload for coordinator
      const sellPayload = {
        userId: user.id,
        strategyId,
        symbol: base,
        side: 'SELL' as const,
        source: 'manual',
        confidence: 0.95,
        reason: 'Manual sell from Trading History UI',
        qtySuggested: trade.amount,
        mode: 'mock',
        metadata: {
          context: 'MANUAL',
          origin: 'UI',
          manualOverride: true,
          originalTradeId: trade.id,
          uiTimestamp: new Date().toISOString(),
          currentPrice: price,
          expectedPnl: perf.gainLoss || 0,
          expectedPnlPct: perf.gainLossPercentage || 0,
          force: true,
        },
        idempotencyKey: `manual_${user.id}_${trade.id}_${Date.now()}`,
      };

      // Invoke coordinator - this is the ONLY path to insert trades
      const { data: result, error } = await supabase.functions.invoke('trading-decision-coordinator', { 
        body: { intent: sellPayload } 
      });

      if (error) {
        throw new Error(`Coordinator error: ${error.message}`);
      }

      if (result?.ok === true && result?.decision?.action === 'SELL') {
        toast({ title: 'Position Sold', description: `Sold ${trade.cryptocurrency}`, variant: 'default' });
        // Refresh trades and portfolio metrics from RPC
        fetchTradingHistory();
        refreshMetrics();
        return;
      }

      // Coordinator returned but didn't execute SELL - show reason
      toast({ 
        title: 'Sell Not Executed', 
        description: result?.decision?.reason || 'Coordinator declined the request', 
        variant: 'destructive' 
      });
    } catch (err: any) {
      // Error = show toast and STOP. No fallbacks, no emergency inserts.
      toast({ 
        title: 'Sell Failed', 
        description: err?.message || 'Unknown error occurred', 
        variant: 'destructive' 
      });
    }
  };

  // TradeCard component for rendering individual trades
  const TradeCard = ({ trade, showSellButton = false, onRequestSell }: { 
    trade: Trade; 
    showSellButton?: boolean;
    onRequestSell?: (t: Trade) => void;
  }) => {
    const [performance, setPerformance] = useState<TradePerformance | null>(null);
    const [cardLoading, setCardLoading] = useState(true);
    
    useEffect(() => {
      const loadPerformance = () => {
        try {
          const perf = calculateTradePerformance(trade);
          setPerformance(perf);
        } catch (error) {
          // Silent error
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
      <Card className="p-4 hover:shadow-md transition-shadow" data-testid="past-position-card">
        {/* Lot-Linked Indicator for SELL trades */}
        {trade.trade_type === 'sell' && (
          <div className="flex gap-2 mb-2">
            {trade.original_trade_id ? (
              <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                Lot-Linked
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                Legacy (FIFO)
              </Badge>
            )}
          </div>
        )}
        
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
            <p className="font-medium">
              {trade.trade_type === 'sell' 
                ? (trade.original_purchase_amount || trade.amount).toFixed(8)
                : trade.amount.toFixed(8)
              }
            </p>
          </div>
          
          <div>
            <p className="text-muted-foreground">Purchase Price</p>
            <p className="font-medium" data-testid="purchase-price">
              {trade.trade_type === 'sell' 
                ? formatEuro(performance.purchasePrice || 0)
                : formatEuro(trade.price)
              }
            </p>
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
            <>
              <div>
                <p className="text-muted-foreground">Exit Price</p>
                <p className="font-medium" data-testid="exit-price">{formatEuro(performance.currentPrice || trade.price)}</p>
              </div>
              
              <div>
                <p className="text-muted-foreground">Exit Value</p>
                <p className="font-medium">
                  {formatEuro(trade.exit_value || trade.total_value)}
                </p>
              </div>
            </>
          )}
          
          {trade.trade_type === 'sell' ? (
            <>
              {trade.pnl_at_decision_pct !== null && trade.pnl_at_decision_pct !== undefined && (
                <div>
                  <p className="text-muted-foreground">P&L at decision</p>
                  <p className={`font-medium ${
                    trade.pnl_at_decision_pct > 0 ? 'text-emerald-600' : 
                    trade.pnl_at_decision_pct < -0.01 ? 'text-red-600' : ''
                  }`}>
                    {formatPercentage(trade.pnl_at_decision_pct)}
                  </p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">Realized P&L</p>
                <p className={`font-medium ${
                  (performance.gainLoss || 0) > 0 ? 'text-emerald-600' : 
                  (performance.gainLoss || 0) < -0.01 ? 'text-red-600' : ''
                }`} data-testid="realized-pnl">
                  {formatEuro(performance.gainLoss || 0)}
                  {' '}
                  <span className="text-xs">
                    ({formatPercentage(
                      performance.gainLossPercentage !== null 
                        ? performance.gainLossPercentage 
                        : (performance.purchaseValue && performance.purchaseValue > 0 
                            ? ((performance.gainLoss || 0) / performance.purchaseValue) * 100 
                            : 0)
                    )})
                  </span>
                </p>
              </div>
            </>
          ) : performance.gainLoss !== null && performance.gainLossPercentage !== null && (
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
          <div className="flex items-center justify-between">
            <div>
              <p>Executed: {new Date(trade.executed_at).toLocaleString()}</p>
              {trade.notes && <p className="mt-1">Note: {trade.notes}</p>}
            </div>
            
            {showSellButton && trade.trade_type === 'buy' && (
              <Button
                variant="destructive"
                size="sm"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onRequestSell) {
                    onRequestSell(trade);
                  }
                }}
              >
                SELL NOW
              </Button>
            )}
            
          </div>
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

  // Show not initialized state
  if (testMode && !metricsLoading && !isInitialized) {
    const handleReset = async () => {
      await resetPortfolio();
      setTimeout(() => refreshMetrics(), 500);
    };
    return <PortfolioNotInitialized onReset={handleReset} isLoading={walletLoading} />;
  }

  if (!hasActiveStrategy) {
    return <NoActiveStrategyState onCreateStrategy={onCreateStrategy} />;
  }

  // Show raw BUY trades as "buys" (NO FIFO recomputation in UI)
  const openBuyTrades = getOpenBuyTrades();
  const pastPositions = trades.filter(t => t.trade_type === 'sell');
  
  // Pagination for both open and past positions  
  const totalPastPages = Math.ceil(pastPositions.length / PAGE_SIZE);
  const totalOpenPages = Math.ceil(openBuyTrades.length / PAGE_SIZE);
  
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedPastPositions = pastPositions.slice(startIndex, endIndex);
  
  const openStartIndex = (openPage - 1) * PAGE_SIZE;
  const openEndIndex = openStartIndex + PAGE_SIZE;
  const paginatedOpenBuys = openBuyTrades.slice(openStartIndex, openEndIndex);

  return (
    <div className="space-y-6">
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

      {/* Portfolio Summary - FROM RPC */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <PieChart className="w-5 h-5" />
          Portfolio Summary
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Positions - local counts only */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-muted-foreground">Positions (counts)</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">BUY Trades</span>
                <span className="text-lg font-bold">{openBuyTrades.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">SELL Trades</span>
                <span className="text-sm">{pastPositions.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total Trades</span>
                <span className="text-sm">{trades.length}</span>
              </div>
            </div>
          </Card>
          
          {/* Investment - FROM RPC */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-medium text-muted-foreground">Investment</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Invested (Cost Basis)</span>
                <span className="text-lg font-bold">{formatEuro(metrics.invested_cost_basis_eur)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Current Value</span>
                <span className="text-sm">{formatEuro(metrics.current_position_value_eur)}</span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-xs text-muted-foreground font-medium">Cash Available</span>
                <span className="text-sm font-semibold">{formatEuro(metrics.available_eur)}</span>
              </div>
            </div>
          </Card>
          
          {/* Performance - FROM RPC */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-muted-foreground">Performance</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Unrealized P&L</span>
                <span className={`text-lg font-bold ${metrics.unrealized_pnl_eur >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(metrics.unrealized_pnl_eur)} <span className="text-xs">({formatPercentage(unrealizedPnlPct)})</span>
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Realized P&L</span>
                <span className={`text-sm ${metrics.realized_pnl_eur >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(metrics.realized_pnl_eur)} <span className="text-xs">({formatPercentage(realizedPnlPct)})</span>
                </span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-xs text-muted-foreground font-medium">Total P&L</span>
                <span className={`text-sm font-semibold ${metrics.total_pnl_eur >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(metrics.total_pnl_eur)} <span className="text-xs">({formatPercentage(totalPnlPct)})</span>
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
            BUY Trades ({openBuyTrades.length})
          </TabsTrigger>
          <TabsTrigger value="past" className="flex items-center gap-2" data-testid="past-positions-tab">
            <ArrowDownLeft className="w-4 h-4" />
            SELL Trades ({pastPositions.length})
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="open" className="mt-4">
          {openBuyTrades.length > 0 ? (
            <>
              <div className="space-y-4">
                {paginatedOpenBuys.map(trade => (
                  <TradeCard
                    key={trade.id}
                    trade={trade}
                    showSellButton={true}
                    onRequestSell={(t) => setSellConfirmation({ open: true, trade: t })}
                  />
                ))}
              </div>
              
              {/* Pagination for BUY Trades */}
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
              <p>No BUY trades</p>
              <p className="text-sm mt-2">Your buy trades will appear here when you make trades</p>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="past" className="mt-4">
          {pastPositions.length > 0 ? (
            <>
              <div className="space-y-4" data-testid="past-positions-list">
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
              <p>No SELL trades</p>
              <p className="text-sm mt-2">Your completed trades will appear here</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Confirmation Modal */}
      <Dialog open={sellConfirmation.open} onOpenChange={(open) => setSellConfirmation(prev => ({ open, trade: open ? prev.trade : null }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Sell</DialogTitle>
            <DialogDescription>
              {sellConfirmation.trade ? (
                <div className="space-y-2 mt-2 text-sm">
                  <div><span className="text-muted-foreground">Asset:</span> <span className="font-medium">{sellConfirmation.trade.cryptocurrency}</span></div>
                  <div><span className="text-muted-foreground">Amount:</span> <span className="font-medium">{sellConfirmation.trade.amount}</span></div>
                  <div><span className="text-muted-foreground">Entry Price:</span> <span className="font-medium">€{sellConfirmation.trade.price.toFixed(2)}</span></div>
                  <div className="text-xs text-muted-foreground mt-2">
                    This will request a manual SELL via the coordinator. Execution depends on gating rules.
                  </div>
                </div>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setSellConfirmation({ open: false, trade: null })}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!sellConfirmation.trade) return;
                const t = sellConfirmation.trade;
                setSellConfirmation({ open: false, trade: null });
                await handleDirectSell(t);
              }}
            >
              Confirm Sell
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </Card>
    </div>
  );
}
