// TRADE-BASED MODEL: Each BUY is one position, each SELL fully closes one BUY
// Uses portfolioMath utility for consistent calculations across all views
import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownLeft, Clock, Activity, RefreshCw, TrendingUp, DollarSign, PieChart, ChevronLeft, ChevronRight, AlertTriangle, Fuel } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTradeViewFilter';
import { supabase } from '@/integrations/supabase/client';
import { useMockWallet } from '@/hooks/useMockWallet';
import { usePortfolioMetrics } from '@/hooks/usePortfolioMetrics';
import { useOpenTrades, OpenTrade } from '@/hooks/useOpenTrades';
import { useMarketData } from '@/contexts/MarketDataContext';
import { OpenTradeCard } from '@/components/trading/OpenTradeCard';
import { NoActiveStrategyState } from './NoActiveStrategyState';
import { PortfolioNotInitialized } from './PortfolioNotInitialized';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { processPastPosition } from '@/utils/valuationService';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  computeFullPortfolioValuation, 
  formatPnlWithSign,
  type MarketPrices,
  type PortfolioValuation 
} from '@/utils/portfolioMath';

import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
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
  // TRADE-BASED: Use open trades instead of lots
  const { openTrades, isLoading: tradesLoading, refresh: refreshOpenTrades } = useOpenTrades();
  // Live prices for aggregate unrealized P&L calculation
  const { marketData } = useMarketData();
  const { toast } = useToast();
  
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [openPage, setOpenPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'open' | 'past'>('open');
  const [txCount, setTxCount] = useState(0);
  const [sellConfirmation, setSellConfirmation] = useState<{ open: boolean; trade: OpenTrade | null }>({
    open: false, 
    trade: null 
  });

  // SINGLE SOURCE OF TRUTH: Use portfolioMath utility for all calculations
  // Fetch transaction count for gas calculation (each mock_trade row = 1 tx)
  useEffect(() => {
    if (!user || !testMode) return;
    
    const fetchTxCount = async () => {
      const { count } = await supabase
        .from('mock_trades')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_test_mode', true)
        .eq('is_corrupted', false);
      
      setTxCount(count || 0);
    };
    
    fetchTxCount();
  }, [user, testMode, metrics]); // Re-fetch when metrics change (trade happened)

  // SINGLE SOURCE OF TRUTH: Use portfolioMath for consistent calculations
  const portfolioValuation: PortfolioValuation = useMemo(() => {
    return computeFullPortfolioValuation(
      metrics,
      openTrades,
      marketData as MarketPrices,
      txCount,
      testMode
    );
  }, [metrics, openTrades, marketData, txCount, testMode]);

  // SINGLE SOURCE OF TRUTH: Past positions use DB snapshot fields only (no frontend calculation)
  const calculateTradePerformance = (trade: Trade): TradePerformance => {
    if (trade.trade_type === 'sell') {
      // Past positions - use snapshot fields ONLY from database
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
      
      // Only compute if DB values missing (legacy data)
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
        gainLoss,
        gainLossPercentage,
        isAutomatedWithoutPnL: false
      };
    }
    
    // Open positions (BUY trades) - show cost basis only, no live P&L calculation
    // Aggregate unrealized P&L comes from RPC (get_portfolio_metrics)
    const purchaseValue = trade.amount * trade.price;
    return {
      currentPrice: null, // Not computed in frontend
      currentValue: null, // Not computed in frontend
      purchaseValue,
      purchasePrice: trade.price,
      gainLoss: null, // See aggregate P&L from RPC
      gainLossPercentage: null,
      isCorrupted: false,
      corruptionReasons: []
    };
  };

  // Fetch trading history - filter by is_test_mode consistently
  const fetchTradingHistory = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_test_mode', testMode)
        .eq('is_corrupted', false)
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

  // Handle direct sell of an open trade - ONLY via trading-decision-coordinator
  // TRADE-BASED: Sell entire position (1 BUY = 1 position, 1 SELL = full closure)
  const handleDirectSell = async (trade: OpenTrade) => {
    if (!user) {
      toast({ title: 'Sell Failed', description: 'User not authenticated', variant: 'destructive' });
      return;
    }

    if (trade.amount <= 0) {
      toast({ title: 'Sell Failed', description: 'No amount to sell', variant: 'destructive' });
      return;
    }

    try {
      const base = toBaseSymbol(trade.cryptocurrency);
      const strategyId = trade.strategy_id;
      
      if (!strategyId) {
        toast({ title: 'Sell Failed', description: 'No valid strategy found for this trade', variant: 'destructive' });
        return;
      }

      // Get live price from shared market data (required by coordinator fast-path)
      const pairSymbol = toPairSymbol(base);
      const liveData = marketData[pairSymbol];
      const currentPrice = liveData?.price;
      
      if (!currentPrice || currentPrice <= 0) {
        toast({ title: 'Sell Failed', description: 'Live market price not available. Please wait and try again.', variant: 'destructive' });
        return;
      }

      // Build payload - SELL entire position (not partial)
      const sellPayload = {
        userId: user.id,
        strategyId,
        symbol: base,
        side: 'SELL' as const,
        source: 'manual',
        confidence: 0.95,
        reason: 'Manual sell from Trading History UI',
        qtySuggested: trade.amount, // Full trade amount
        mode: 'mock',
        metadata: {
          context: 'MANUAL',
          origin: 'UI',
          manualOverride: true,
          originalTradeId: trade.id, // Link to specific BUY trade
          uiTimestamp: new Date().toISOString(),
          force: true,
          currentPrice, // CRITICAL: Required by coordinator fast-path
        },
        idempotencyKey: `manual_${user.id}_${trade.id}_${Date.now()}`,
      };

      const { data: result, error } = await supabase.functions.invoke('trading-decision-coordinator', { 
        body: { intent: sellPayload } 
      });

      if (error) {
        throw new Error(`Coordinator error: ${error.message}`);
      }

      if (result?.ok === true && result?.decision?.action === 'SELL') {
        toast({ title: 'Position Sold', description: `Sold ${trade.cryptocurrency}`, variant: 'default' });
        refreshOpenTrades();
        fetchTradingHistory();
        refreshMetrics();
        return;
      }

      toast({ 
        title: 'Sell Not Executed', 
        description: result?.decision?.reason || 'Coordinator declined the request', 
        variant: 'destructive' 
      });
    } catch (err: any) {
      toast({ 
        title: 'Sell Failed', 
        description: err?.message || 'Unknown error occurred', 
        variant: 'destructive' 
      });
    }
  };

  // TradeCard component for rendering past SELL trades
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
        {/* Trade linkage indicator for SELL trades */}
        {trade.trade_type === 'sell' && (
          <div className="flex gap-2 mb-2">
            <Badge variant="outline" className={`text-xs ${trade.original_trade_id ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : 'bg-slate-500/10 text-slate-400 border-slate-500/30'}`}>
              {trade.original_trade_id ? 'Linked SELL' : 'SELL'}
            </Badge>
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
      // Refresh ALL data sources after hard reset
      setTimeout(() => {
        refreshMetrics();
        refreshOpenTrades();
        fetchTradingHistory();
      }, 500);
    };
    return <PortfolioNotInitialized onReset={handleReset} isLoading={walletLoading} />;
  }

  if (!hasActiveStrategy) {
    return <NoActiveStrategyState onCreateStrategy={onCreateStrategy} />;
  }

  // TRADE-BASED: Open trades from hook, past positions from query
  const buyTrades = trades.filter(t => t.trade_type === 'buy');
  const sellTrades = trades.filter(t => t.trade_type === 'sell');
  
  // Pagination  
  const totalPastPages = Math.ceil(sellTrades.length / PAGE_SIZE);
  const totalOpenPages = Math.ceil(openTrades.length / PAGE_SIZE);
  
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedPastPositions = sellTrades.slice(startIndex, endIndex);
  
  const openStartIndex = (openPage - 1) * PAGE_SIZE;
  const openEndIndex = openStartIndex + PAGE_SIZE;
  const paginatedOpenTrades = openTrades.slice(openStartIndex, openEndIndex);

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
        
        {/* Partial Valuation Warning Badge */}
        {portfolioValuation.hasMissingPrices && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-400">
              Partial valuation (missing: {portfolioValuation.missingSymbols.join(', ')})
            </span>
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Positions - TRADE-BASED counts */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-muted-foreground">Trade Counts</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Open Positions</span>
                <span className="text-lg font-bold">{openTrades.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Closed (SELL)</span>
                <span className="text-sm">{sellTrades.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total BUY Trades</span>
                <span className="text-sm">{buyTrades.length}</span>
              </div>
            </div>
          </Card>
          
          {/* Trading Exposure - using portfolioMath for consistency */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-medium text-muted-foreground">Portfolio Value</span>
              {portfolioValuation.hasMissingPrices && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger><AlertTriangle className="h-3 w-3 text-amber-400" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs">Partial: missing price for {portfolioValuation.missingSymbols.join(', ')}</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Cash</span>
                <span className="text-sm">{formatEuro(portfolioValuation.cashEur)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Open Positions</span>
                <span className="text-sm">{formatEuro(portfolioValuation.openPositionsValueEur)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Fuel className="h-3 w-3" /> Gas (est.)
                </span>
                <span className="text-sm text-amber-400">−{formatEuro(portfolioValuation.gasSpentEur)}</span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-xs text-muted-foreground font-medium">Total Value</span>
                <span className="text-lg font-bold">{formatEuro(portfolioValuation.totalPortfolioValueEur)}</span>
              </div>
            </div>
          </Card>
          
          {/* Performance - using portfolioMath for consistency */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-muted-foreground">Performance</span>
            </div>
            <div className="space-y-2">
              {(() => {
                // Use portfolioMath for consistent P&L calculation
                const unrealPnl = formatPnlWithSign(portfolioValuation.unrealizedPnlEur);
                const realPnl = formatPnlWithSign(portfolioValuation.realizedPnlEur);
                const totalPnl = formatPnlWithSign(portfolioValuation.totalPnlEur);
                
                return (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        Unrealized P&L
                        {portfolioValuation.hasMissingPrices && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger><AlertTriangle className="h-3 w-3 text-amber-400" /></TooltipTrigger>
                              <TooltipContent><p className="text-xs">Partial: missing price for {portfolioValuation.missingSymbols.join(', ')}</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                      <span className={`text-lg font-bold ${unrealPnl.colorClass}`}>
                        {unrealPnl.sign}{unrealPnl.value}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Realized P&L</span>
                      <span className={`text-sm ${realPnl.colorClass}`}>
                        {realPnl.sign}{realPnl.value}
                      </span>
                    </div>
                    <div className="flex justify-between items-center border-t pt-2">
                      <span className="text-xs text-muted-foreground font-medium">Total P&L</span>
                      <span className={`text-sm font-semibold ${totalPnl.colorClass}`}>
                        {totalPnl.sign}{totalPnl.value} ({formatPercentage(portfolioValuation.totalPnlPct)}) — {totalPnl.label}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          </Card>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value: any) => setActiveTab(value)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="open" className="flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4" />
            Open Positions ({openTrades.length})
          </TabsTrigger>
          <TabsTrigger value="past" className="flex items-center gap-2" data-testid="past-positions-tab">
            <ArrowDownLeft className="w-4 h-4" />
            SELL Trades ({sellTrades.length})
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="open" className="mt-4">
          {tradesLoading ? (
            <div className="animate-pulse space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-muted rounded"></div>
              ))}
            </div>
          ) : openTrades.length > 0 ? (
            <>
              <div className="space-y-4">
                {paginatedOpenTrades.map(trade => (
                  <OpenTradeCard
                    key={trade.id}
                    trade={trade}
                    onRequestSell={(t) => setSellConfirmation({ open: true, trade: t })}
                  />
                ))}
              </div>
              
              {/* Pagination for Open Trades */}
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
          {sellTrades.length > 0 ? (
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
      <Dialog open={sellConfirmation.open} onOpenChange={(open) => setSellConfirmation({ open, trade: open ? sellConfirmation.trade : null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Sell</DialogTitle>
            <DialogDescription>
              {sellConfirmation.trade ? (
                <div className="space-y-2 mt-2 text-sm">
                  <div><span className="text-muted-foreground">Asset:</span> <span className="font-medium">{sellConfirmation.trade.cryptocurrency}</span></div>
                  <div><span className="text-muted-foreground">Amount:</span> <span className="font-medium">{sellConfirmation.trade.amount.toFixed(8)}</span></div>
                  <div><span className="text-muted-foreground">Entry Price:</span> <span className="font-medium">€{sellConfirmation.trade.price.toFixed(2)}</span></div>
                  <div className="text-xs text-muted-foreground mt-2">
                    This will sell the entire position via the coordinator. Execution depends on gating rules.
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
