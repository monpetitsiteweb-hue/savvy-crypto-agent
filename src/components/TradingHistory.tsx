import { useState, useEffect } from 'react';
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
import { NoActiveStrategyState } from './NoActiveStrategyState';
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
  const [stats, setStats] = useState({
    totalTrades: 0,
    totalVolume: 0,
    netProfitLoss: 0,
    openPositions: 0,
    totalInvested: 0,
    currentPL: 0,
    totalPL: 0,
    currentlyInvested: 0,
    pastInvestments: 0,
    realizedPL: 0
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
      
      // Calculate P&L if missing from database
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

  // FIFO helper functions - FIXED to match database logic
  const buildFifoLots = (allTrades: Trade[]) => {
    const sorted = [...allTrades].sort((a,b)=> new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());
    const lotsBySymbol = new Map<string, { trade: Trade; remaining: number }[]>();
    for (const t of sorted) {
      const sym = t.cryptocurrency;
      if (!lotsBySymbol.has(sym)) lotsBySymbol.set(sym, []);
      if (t.trade_type === 'buy') {
        lotsBySymbol.get(sym)!.push({ trade: t, remaining: t.amount });
      } else if (t.trade_type === 'sell' && t.original_purchase_amount) {
        // Use original_purchase_amount which reflects actual FIFO consumption in database
        let sellRemaining = t.original_purchase_amount;
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
        if (remaining > 1e-8) {  // Increased threshold to match database precision
          const ratio = remaining / trade.amount;
          openLots.push({
            ...trade,
            amount: remaining, // Show actual remaining amount
            total_value: trade.total_value * ratio,
            fees: 0,
            notes: remaining < trade.amount ? 
              `Partial: ${remaining.toFixed(8)} of ${trade.amount.toFixed(8)} remaining` : 
              trade.notes
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
          pastInvestments: pastInvestments,
          realizedPL: realizedPL
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

  // Add debugging at component mount level
  useEffect(() => {
    console.log('=== TRADING HISTORY COMPONENT MOUNTED ===');
    console.log('User:', user?.id);
    console.log('HasActiveStrategy:', hasActiveStrategy);
    
    // Test if onClick works at all
    const testButton = document.createElement('button');
    testButton.textContent = 'TEST BUTTON';
    testButton.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;background:red;color:white;padding:10px;';
    testButton.onclick = () => {
      console.log('TEST BUTTON CLICKED - JavaScript is working');
      alert('JavaScript click events work!');
    };
    document.body.appendChild(testButton);
    
    return () => {
      console.log('=== TRADING HISTORY COMPONENT UNMOUNTING ===');
      const testBtn = document.querySelector('button[style*="position:fixed"]');
      if (testBtn) testBtn.remove();
    };
  }, []);

  // Handle direct sell - bypassing modal for debugging  
  const handleDirectSell = async (trade: Trade) => {
    console.log('============ HANDLE DIRECT SELL STARTED ============');
    console.log(`[UI] DIRECT SELL CLICKED - symbol=${trade.cryptocurrency}, id=${trade.id}`);
    
    if (!user) {
      console.error('[UI] SELL FAILED - no user');
      toast({
        title: "Sell Failed",
        description: "User not authenticated",
        variant: "destructive"
      });
      return;
    }
    console.log(`[UI] SELL CONFIRMED - processing ${trade.cryptocurrency} trade ${trade.id}`);
    
    try {
      console.log('[UI] Converting symbols...');
      
      // Check if utils are available, fallback if needed
      if (typeof toBaseSymbol !== 'function') {
        console.error('[UI] toBaseSymbol not available - import failed');
        throw new Error('Symbol utilities not available');
      }
      
      const baseSymbol = toBaseSymbol(trade.cryptocurrency);
      console.log(`[UI] Base symbol: ${baseSymbol}`);
      
      if (typeof toPairSymbol !== 'function') {
        console.error('[UI] toPairSymbol not available - import failed');
        throw new Error('Symbol utilities not available');
      }
      
      const pairSymbol = toPairSymbol(baseSymbol);
      console.log(`[UI] Pair symbol: ${pairSymbol}`);
      
      console.log('[UI] Getting current price...');
      
      if (!sharedPriceCache) {
        console.error('[UI] sharedPriceCache not available - import failed');
        throw new Error('Price cache not available');
      }
      
      const currentPrice = sharedPriceCache.getPrice(pairSymbol);
      console.log(`[UI] Current price: ${currentPrice}`);
      
      if (!currentPrice) {
        const errorMsg = `Current price not available for ${pairSymbol}`;
        console.error(`[UI] SELL FAILED - ${errorMsg}`);
        toast({
          title: "Sell Failed",
          description: errorMsg,
          variant: "destructive"
        });
        return;
      }

      // Calculate current P&L for confirmation display
      console.log('[UI] Calculating performance...');
      const performance = calculateTradePerformance(trade);
      console.log('[UI] Performance:', performance);

      // Build trade intent with full context
      const tradeIntent = {
        userId: user.id,
        strategyId: trade.strategy_id,
        symbol: trade.cryptocurrency,
        side: 'SELL' as const,
        source: 'manual',
        confidence: 0.95,
        reason: 'Manual sell from Trading History UI',
        qtySuggested: trade.amount, // This is already the remaining amount from FIFO calculation
        metadata: {
          mode: 'mock', // Ensure paper trading mode
          context: 'MANUAL',
          origin: 'UI',
          manualOverride: true,
          originalTradeId: trade.id,
          notes: `Manual sell from Trading History UI - ${trade.notes || 'Original position'}`,
          uiTimestamp: new Date().toISOString(),
          currentPrice,
          expectedPnl: performance.gainLoss || 0,
          expectedPnlPct: performance.gainLossPercentage || 0
        },
        idempotencyKey: `idem_${Math.random().toString(36).substr(2, 8)}`
      };

      console.log('[UI] SELL PAYLOAD (before invoke):', JSON.stringify(tradeIntent, null, 2));

      // Send to coordinator
      console.log('[UI] → Invoking coordinator for SELL...');
      const { data: result, error } = await supabase.functions.invoke('trading-decision-coordinator', {
        body: { intent: tradeIntent }
      });

      console.log('[UI] ← Raw coordinator response:', { result, error });
      console.log('[UI] Decision details:', {
        action: result?.decision?.action,
        reason: result?.decision?.reason,
        request_id: result?.request_id
      });

      if (error) {
        throw new Error(`Network error: ${error.message}`);
      }
      
      // Check for successful SELL decision
      if (result?.ok === true && result?.decision?.action === 'SELL') {
        console.log('[UI] ✅ SELL SUCCESS - position closed');
        toast({
          title: "Position Sold",
          description: `Successfully sold ${trade.cryptocurrency} position`,
          variant: "default"
        });
        
        // Refresh data after successful sell
        fetchTradingHistory();
        return;
      }

      // Handle DEFER/HOLD or other non-SELL actions
      const actionReason = result?.decision?.reason || 'Decision not available';
      console.log(`[UI] ❌ SELL NOT EXECUTED - Action: ${result?.decision?.action}, Reason: ${actionReason}`);
      
      toast({
        title: "Sell Not Executed",
        description: actionReason,
        variant: "destructive"
      });
      
    } catch (error) {
      console.error('[UI] SELL ERROR:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      toast({
        title: "Sell Failed",
        description: errorMessage,
        variant: "destructive"
      });
    }
  };

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
      <Card className="p-4 hover:shadow-md transition-shadow" data-testid="past-position-card">
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
              <div>
                <p className="text-muted-foreground">P&L (€)</p>
                <p className={`font-medium ${
                  (performance.gainLoss || 0) > 0 ? 'text-emerald-600' : 
                (performance.gainLoss || 0) < -0.01 ? 'text-red-600' : ''
              }`} data-testid="realized-pnl">
                {formatEuro(performance.gainLoss || 0)}
              </p>
            </div>
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
            {/* DEBUG: Show button conditions */}
            <div className="text-xs text-red-500">
              Debug: showSellButton={String(showSellButton)}, trade_type={trade.trade_type}
            </div>
            
            {showSellButton && trade.trade_type === 'buy' && (
              <button
                className="px-3 py-1 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50"
                onClick={(e) => {
                  console.log('============ BUTTON CLICKED ============');
                  console.log('Event:', e);
                  console.log('Trade:', trade);
                  console.log('ShowSellButton:', showSellButton);
                  console.log('Trade Type:', trade.trade_type);
                  e.preventDefault();
                  e.stopPropagation();
                  handleDirectSell(trade);
                }}
                style={{ zIndex: 9999, position: 'relative' }}
              >
                SELL NOW
              </button>
            )}
            
            {/* DEBUG: Show why button isn't showing */}
            {showSellButton && trade.trade_type !== 'buy' && (
              <div className="text-xs text-orange-500">
                Button hidden: trade_type is "{trade.trade_type}", need "buy"
              </div>
            )}
            
            {!showSellButton && (
              <div className="text-xs text-orange-500">
                Button hidden: showSellButton is false
              </div>
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
                <span className="text-xs text-muted-foreground">Realized P&L</span>
                <span className={`text-sm ${stats.realizedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(stats.realizedPL)}
                </span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-xs text-muted-foreground font-medium">Total P&L</span>
                <span className={`text-sm font-semibold ${stats.totalPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
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
          <TabsTrigger value="past" className="flex items-center gap-2" data-testid="past-positions-tab">
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
              <p>No past positions</p>
              <p className="text-sm mt-2">Your completed trades will appear here</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

    </Card>
  );
}

// Debug helper function for DevTools console
if (typeof window !== 'undefined') {
  // Expose utilities globally for debugging
  (window as any).toBaseSymbol = toBaseSymbol;
  (window as any).toPairSymbol = toPairSymbol;
  (window as any).sharedPriceCache = sharedPriceCache;
  
  (window as any).debugManualSell = (symbol: string) => {
    console.log(`[DEBUG] Manual sell triggered for symbol: ${symbol}`);
    console.log(`[DEBUG] toBaseSymbol available: ${typeof toBaseSymbol}`);
    console.log(`[DEBUG] toPairSymbol available: ${typeof toPairSymbol}`);
    console.log(`[DEBUG] sharedPriceCache available: ${typeof sharedPriceCache}`);
    
    if (typeof toBaseSymbol === 'function') {
      const baseSymbol = toBaseSymbol(symbol);
      console.log(`[DEBUG] Base symbol: ${baseSymbol}`);
      
      if (typeof toPairSymbol === 'function') {
        const pairSymbol = toPairSymbol(baseSymbol);
        console.log(`[DEBUG] Pair symbol: ${pairSymbol}`);
        
        if (sharedPriceCache) {
          const price = sharedPriceCache.getPrice(pairSymbol);
          console.log(`[DEBUG] Current price: ${price}`);
        }
      }
    }
    
    const mockTrade = {
      id: 'debug-' + Date.now(),
      cryptocurrency: symbol,
      amount: 1.0,
      price: 100,
      trade_type: 'buy',
      strategy_id: 'debug-strategy',
      executed_at: new Date().toISOString(),
      total_value: 100
    };
    
    console.log('[DEBUG] Mock trade object:', mockTrade);
    console.log('[DEBUG] This would trigger the same coordinator path as the UI button');
    console.log('[DEBUG] To test fully, use the actual UI button or implement a real position');
  };
  
  console.log('[DEBUG] Utils exposed globally. Test with:');
  console.log('- toBaseSymbol("BTC-EUR")');
  console.log('- toPairSymbol("BTC")'); 
  console.log('- sharedPriceCache.getPrice("BTC-EUR")');
  console.log('- debugManualSell("BTC-EUR")');
}