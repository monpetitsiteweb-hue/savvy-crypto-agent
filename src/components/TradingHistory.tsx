import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownLeft, Clock, Activity, RefreshCw, TrendingUp, DollarSign, PieChart, Target } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useMockWallet } from '@/hooks/useMockWallet';
import { NoActiveStrategyState } from './NoActiveStrategyState';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { useRealTimeMarketData } from '@/hooks/useRealTimeMarketData';
import { checkIntegrity, calculateValuation } from '@/utils/valuationService';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Lock } from 'lucide-react';
import { useCoordinatorToast } from '@/hooks/useCoordinatorToast';

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
  // PHASE 2: New snapshot fields for SELL trades
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
  currentPrice: number;
  currentValue: number;
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

export const TradingHistory = ({ hasActiveStrategy, onCreateStrategy }: TradingHistoryProps) => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { toast } = useToast();
  const { handleCoordinatorResponse } = useCoordinatorToast();
  
  // RESTORED: useMockWallet provides real portfolio data (not related to blinking issue)
  const { getTotalValue, balances } = useMockWallet();
  
  const { getCurrentData, marketData } = useRealTimeMarketData();
  const [feeRate, setFeeRate] = useState<number>(0);
  
  console.log('🔍 HISTORY: MarketData from context:', marketData);
  console.log('🔍 HISTORY: MarketData keys:', Object.keys(marketData));
  console.log('🔍 HISTORY: Sample prices:', Object.entries(marketData).slice(0,3).map(([k,v]) => `${k}: €${v.price}`));
  
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<any[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [fetching, setFetching] = useState(false);
  const [portfolioValue, setPortfolioValue] = useState<number>(0);
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
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  
  // Fetch real-time prices directly from edge function (bypassing context issues)
  useEffect(() => {
    const fetchCurrentPrices = async () => {
      try {
        console.log('🔍 HISTORY: Fetching prices directly from edge function...');
        const response = await fetch('https://fuieplftlcxdfkxyqzlt.functions.supabase.co/real-time-market-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: ['BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'ADA-EUR', 'SOL-EUR'] })
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('🔍 HISTORY: Got prices from edge function:', data);
          
          const prices: Record<string, number> = {};
          Object.entries(data).forEach(([symbol, marketData]: [string, any]) => {
            if (marketData?.price) {
              prices[symbol] = marketData.price;
              // Also store without -EUR suffix for compatibility
              const baseSymbol = symbol.replace('-EUR', '');
              prices[baseSymbol] = marketData.price;
            }
          });
          
          console.log('🔍 HISTORY: Setting current prices:', prices);
          setCurrentPrices(prices);
        }
      } catch (error) {
        console.error('❌ HISTORY: Error fetching prices from edge function:', error);
      }
    };

    fetchCurrentPrices();
    const interval = setInterval(fetchCurrentPrices, 30000); // Every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Use ValuationService for all P&L calculations (single source of truth)
  const calculateTradePerformance = async (trade: Trade): Promise<TradePerformance> => {
    
    if (trade.trade_type === 'sell') {
      // Past Positions: Use stored snapshot data when available  
      if (trade.original_purchase_value && trade.original_purchase_price) {
        return {
          currentPrice: trade.price, // Exit price
          currentValue: trade.total_value, // Exit value  
          purchaseValue: trade.original_purchase_value,
          purchasePrice: trade.original_purchase_price,
          gainLoss: trade.realized_pnl || ((trade.total_value || 0) - (trade.original_purchase_value || 0)),
          gainLossPercentage: trade.realized_pnl_pct || (trade.original_purchase_price > 0 ? ((trade.price / trade.original_purchase_price) - 1) * 100 : 0),
          isAutomatedWithoutPnL: false
        };
      }
      
      // Remove fallback logic - return null for incomplete data
      return {
        currentPrice: trade.price,
        currentValue: trade.total_value,
        purchaseValue: null,
        purchasePrice: null,  
        gainLoss: null,
        gainLossPercentage: null,
        isAutomatedWithoutPnL: true
      };
    }
    
  // For BUY trades (open positions): Use exact trade data without fallbacks
  const actualPurchasePrice = trade.price;
  
  // FIXED: Handle symbol format mismatch - trade.cryptocurrency might be "BTC-EUR" or just "BTC"
  const symbol = trade.cryptocurrency;
  const baseSymbol = symbol.replace('-EUR', ''); // Get "BTC" from "BTC-EUR"
  const fullSymbol = symbol.includes('-EUR') ? symbol : `${symbol}-EUR`; // Ensure "-EUR" suffix
  
  console.log('🔍 HISTORY: Looking for price for', symbol, 'checking as baseSymbol:', baseSymbol, 'fullSymbol:', fullSymbol);
  console.log('🔍 HISTORY: Available market data keys:', Object.keys(marketData));
  console.log('🔍 HISTORY: Available current prices keys:', Object.keys(currentPrices));
  
  // Try multiple symbol formats to find the current price
  let displayCurrentPrice = marketData[symbol]?.price || 
                           marketData[fullSymbol]?.price || 
                           marketData[baseSymbol]?.price ||
                           currentPrices[symbol] || 
                           currentPrices[fullSymbol] || 
                           currentPrices[baseSymbol];
                           
  console.log('🔍 HISTORY: Found current price:', displayCurrentPrice, 'for', symbol);
    
    // Simple calculations using market data directly (no API calls)
    if (!displayCurrentPrice) {
      return {
        currentPrice: null,
        currentValue: null,
        purchaseValue: trade.amount * actualPurchasePrice,
        purchasePrice: actualPurchasePrice,
        gainLoss: null,
        gainLossPercentage: null,
        isCorrupted: false,
        corruptionReasons: ['Current price not available from market data']
      };
    }

    // Direct calculations - no external service calls
    const currentValue = trade.amount * displayCurrentPrice;
    const purchaseValue = trade.amount * actualPurchasePrice;
    const gainLoss = currentValue - purchaseValue;
    const gainLossPercentage = actualPurchasePrice > 0 
      ? ((displayCurrentPrice / actualPurchasePrice) - 1) * 100 
      : 0;

    return {
      currentPrice: displayCurrentPrice,
      currentValue: Math.round(currentValue * 100) / 100,
      purchaseValue: Math.round(purchaseValue * 100) / 100,
      purchasePrice: actualPurchasePrice,
      gainLoss: Math.round(gainLoss * 100) / 100,
      gainLossPercentage: Math.round(gainLossPercentage * 100) / 100,
      isCorrupted: false,
      corruptionReasons: []
    };
  };

  // Helper functions: FIFO per-trade lots and counts
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
            fees: 0, // Zero fees for all transactions
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

  // Realized P&L using strict FIFO 
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

  // Unrealized P&L from open lots - EXCLUDES CORRUPTED
  const computeUnrealizedPLFromOpenLots = async (openLots: Trade[]) => {
    let unrealizedPL = 0;
    let invested = 0;
    let corruptedCount = 0;
    
    for (const lot of openLots) {
      // Check position integrity and exclude corrupted positions from KPIs
      const performance = await calculateTradePerformance(lot);
      
      if (performance.isCorrupted) {
        corruptedCount++;
        // Skip corrupted positions in KPI calculations (logging removed to prevent spam)
        continue;
      }

      // Use ValuationService for consistent calculations
      unrealizedPL += performance.gainLoss || 0;
      invested += performance.purchaseValue || 0;
    }

    if (corruptedCount > 0) {
      // Corrupted positions excluded from KPI calculations (logging reduced)
    }

    return { unrealizedPL, invested };
  };

  const sellPosition = async (trade: Trade) => {
    if (!user) return;
    
    try {
      // CRITICAL FIX: Apply regression guards and use deterministic pricing
      const { validateTradePrice, validatePurchaseValue, logValidationFailure } = await import('../utils/regressionGuards');
      
      // Get current price from market data
      let currentPrice = marketData[trade.cryptocurrency]?.price || currentPrices[trade.cryptocurrency];
      
      // Try to get deterministic price from snapshots first
      try {
        const normalizedSymbol = trade.cryptocurrency.replace('-EUR', '');
        const { data: snapshot } = await supabase
          .from('price_snapshots')
          .select('price')
          .eq('symbol', normalizedSymbol)
          .order('ts', { ascending: false })
          .limit(1);
        
        if (snapshot?.[0]?.price) {
          currentPrice = snapshot[0].price;
          console.log('🎯 HISTORY: Using snapshot price for sell:', currentPrice, 'for', normalizedSymbol);
        }
      } catch (error) {
        console.warn('⚠️ HISTORY: Could not fetch price snapshot for sell, using market price');
      }

      // Apply price validation guard - Block €100 exactly
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

      // Calculate sell value and validate consistency
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

      // Insert the sell trade with proper validation
      const sellTrade = {
        user_id: user.id,
        strategy_id: trade.strategy_id,
        trade_type: 'sell',
        cryptocurrency: trade.cryptocurrency,
        amount: trade.amount,
        price: currentPrice,
        total_value: sellAmount,
        fees: 0, // Zero fees for all transactions
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

      // Refresh data
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

  // Fetch trading history with proper error handling
  const fetchTradingHistory = async () => {
    if (!user) return;

    try {
      setLoading(true);
      console.log('🔍 HISTORY: Fetching trading history for user:', user.id);

      const { data, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .order('executed_at', { ascending: false });

      if (error) throw error;

      console.log('✅ HISTORY: Fetched', data?.length || 0, 'trades');
      setTrades(data || []);

      // Calculate stats with ValuationService
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
      console.error('❌ HISTORY: Error fetching trading history:', error);
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
        console.log('📊 HISTORY: Fees set to 0.00 for all transactions');
      }
    } catch (error) {
      console.error('❌ HISTORY: Error fetching user profile:', error);
    }
  };

  // Load data on component mount and when user changes
  useEffect(() => {
    if (user) {
      fetchTradingHistory();
      fetchUserProfile();
    }
  }, [user, testMode]);

  // Real-time subscription to mock_trades changes (throttled to prevent blinking)
  useEffect(() => {
    if (!user) return;

    console.log('🔄 HISTORY: Setting up real-time subscription for user:', user.id);

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
          // Throttle updates to prevent constant blinking
          clearTimeout(refreshTimeout);
          refreshTimeout = setTimeout(() => {
            fetchTradingHistory();
          }, 1000); // Wait 1 second before refreshing
        }
      )
      .subscribe();

    return () => {
      console.log('🔄 HISTORY: Cleaning up real-time subscription');
      clearTimeout(refreshTimeout);
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Badge component with single strip layout and tooltips
  const StatusBadges = ({ trade, coordinatorReason }: { trade: Trade; coordinatorReason?: string }) => {
    const isCorrupted = trade.is_corrupted;
    const isLocked = coordinatorReason === 'blocked_by_lock';
    
    if (!isCorrupted && !isLocked) return null;

    return (
      <TooltipProvider>
        <div className="flex gap-1 mb-1">
          {isCorrupted && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Corrupted
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">
                  <strong>Data Integrity Issue:</strong><br />
                  {trade.integrity_reason || 'Unknown corruption detected'}
                  <br /><br />
                  This position has corrupted data and needs manual review.
                </p>
              </TooltipContent>
            </Tooltip>
          )}
          {isLocked && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-xs">
                  <Lock className="w-3 h-3 mr-1" />
                  Locked
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">
                  <strong>Trade Processing Lock:</strong><br />
                  Concurrent trading activity detected for this symbol.
                  <br />
                  This prevents race conditions and ensures data integrity.
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    );
  };

  // TradeCard component for rendering individual trades
  const TradeCard = ({ trade, showSellButton = false }: { trade: Trade; showSellButton?: boolean }) => {
    const [performance, setPerformance] = useState<TradePerformance | null>(null);
    const [loading, setLoading] = useState(true);

    // FIXED: Extract only the specific price values to prevent infinite re-renders
    const specificTradePrice = marketData[trade.cryptocurrency]?.price;
    const specificCurrentPrice = currentPrices[trade.cryptocurrency];
    
    useEffect(() => {
      const loadPerformance = async () => {
        try {
          const perf = await calculateTradePerformance(trade);
          setPerformance(perf);
        } catch (error) {
          console.error('Error calculating trade performance:', error);
        } finally {
          setLoading(false);
        }
      };

      loadPerformance();
    }, [trade.id, specificTradePrice, specificCurrentPrice]); // FIXED: Only specific price values, prevents object reference changes

    if (loading || !performance) {
      return (
        <Card className="p-4 animate-pulse">
          <div className="h-4 bg-muted rounded w-1/3 mb-2"></div>
          <div className="h-3 bg-muted rounded w-1/2"></div>
        </Card>
      );
    }

    const isProfit = (performance.gainLoss || 0) > 0;
    const isLoss = (performance.gainLoss || 0) < 0;

    return (
      <Card className="p-4 hover:shadow-md transition-shadow">
        <StatusBadges trade={trade} />
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
            <p className="text-muted-foreground">Purchase Value</p>
            <p className="font-medium">
              {trade.trade_type === 'buy' 
                ? formatEuro(trade.total_value) 
                : formatEuro(trade.original_purchase_value || 0)
              }
            </p>
          </div>
          
          <div>
            <p className="text-muted-foreground">
              {trade.trade_type === 'buy' ? 'Purchase Price' : 'Exit Price'}
            </p>
            <p className="font-medium">{formatEuro(performance.purchasePrice || performance.currentPrice)}</p>
          </div>
          
          {trade.trade_type === 'buy' && (
            <>
              <div>
                <p className="text-muted-foreground">Current Value</p>
                <p className="font-medium">{formatEuro(performance.currentValue)}</p>
              </div>
              
              <div>
                <p className="text-muted-foreground">Current Price</p>
                <p className="font-medium">{formatEuro(performance.currentPrice)}</p>
              </div>
            </>
          )}
          
          {trade.trade_type === 'sell' && (
            <div>
              <p className="text-muted-foreground">Exit Value</p>
              <p className="font-medium">{formatEuro(performance.currentValue)}</p>
            </div>
          )}
          
          {!performance.isAutomatedWithoutPnL && performance.gainLoss !== null && (
            <>
              <div>
                <p className="text-muted-foreground">P&L (EUR)</p>
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
        
        {showSellButton && trade.trade_type === 'buy' && !performance.isCorrupted && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => sellPosition(trade)}
            className="w-full mt-3"
          >
            Sell Position
          </Button>
        )}
      </Card>
    );
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <Activity className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Trading History</h2>
          <RefreshCw className="w-4 h-4 animate-spin ml-auto" />
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
          {openPositions.length > 0 ? (
            <div className="space-y-4">
              {openPositions.map(trade => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  showSellButton={true}
                />
              ))}
            </div>
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
            <div className="space-y-4">
              {pastPositions.map(trade => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  showSellButton={false}
                />
              ))}
            </div>
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
};