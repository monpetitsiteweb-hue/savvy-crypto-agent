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
}

interface TradePerformance {
  currentPrice: number;
  currentValue: number;
  purchaseValue: number | null;
  purchasePrice: number | null;
  gainLoss: number | null;
  gainLossPercentage: number | null;
  isAutomatedWithoutPnL?: boolean;
}

interface TradingHistoryProps {
  hasActiveStrategy: boolean;
  onCreateStrategy?: () => void;
}

export const TradingHistory = ({ hasActiveStrategy, onCreateStrategy }: TradingHistoryProps) => {
  console.log('🔍 TradingHistory: Render with props:', { hasActiveStrategy, testMode: undefined });
  
  const { user } = useAuth();
  console.log('🔍 TradingHistory: useAuth result:', { user: !!user, userEmail: user?.email, userId: user?.id });
  
  const { testMode } = useTestMode();
  console.log('🔍 TradingHistory: testMode from hook:', testMode);
  
  // IMMEDIATE FETCH ON COMPONENT LOAD  
  useEffect(() => {
    console.log('🔍 TradingHistory: Component mounted, user:', !!user, 'testMode:', testMode);
    console.log('🔍 TradingHistory: User object:', user);
    if (user) {
      console.log('🔍 TradingHistory: IMMEDIATE FETCH triggered');
      fetchTradingHistory();
    } else {
      console.log('🔍 TradingHistory: NO USER - not fetching');
    }
  }, [user]);
  
  const { toast } = useToast();
  const { getTotalValue } = useMockWallet();
  const { getCurrentData, marketData } = useRealTimeMarketData();
  const [feeRate, setFeeRate] = useState<number>(0);
  
  console.log('🔍 TradingHistory: Component state:', { 
    user: !!user, 
    userId: user?.id,
    testMode, 
    hasActiveStrategy 
  });
  
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
  // User's fee rate is fetched from their profile settings

  // Simple past positions loading with better error handling
  const [allPastTrades, setAllPastTrades] = useState<Trade[]>([]);
  const [pastLoading, setPastLoading] = useState(true);
  
  console.log('🚨 PAST_TRADES_DEBUG: Component render -', {
    user: !!user,
    userId: user?.id,
    allPastTrades: allPastTrades.length,
    pastLoading
  });
  
  useEffect(() => {
    const fetchAllPastTrades = async () => {
      console.log('🔄 PAST_TRADES: useEffect triggered, user:', !!user, 'userId:', user?.id);
      
      if (!user) {
        console.log('❌ PAST_TRADES: No user, skipping fetch');
        setPastLoading(false);
        return;
      }
      
      console.log('🔄 PAST_TRADES: Fetching all sell trades for user:', user.id);
      
      try {
        const { data, error } = await supabase
          .from('mock_trades')
          .select('*')
          .eq('user_id', user.id)
          .eq('trade_type', 'sell')
          .order('executed_at', { ascending: false });
        
        if (error) {
          console.error('❌ PAST_TRADES: Database error:', error);
          throw error;
        }
        
        console.log('✅ PAST_TRADES: Database query successful, found', data?.length || 0, 'sell trades');
        console.log('📄 PAST_TRADES: Sample data:', data?.slice(0, 2));
        setAllPastTrades(data || []);
      } catch (error) {
        console.error('❌ Error fetching past trades:', error);
        setAllPastTrades([]);
      } finally {
        setPastLoading(false);
      }
    };
    
    fetchAllPastTrades();
  }, [user]);

  // SIMPLE P&L CALCULATION - DIRECT AND CLEAR
  const calculateTradePerformance = (trade: Trade) => {
    
    if (trade.trade_type === 'sell') {
      // PAST POSITIONS: Use stored snapshot data (already calculated at trade time)
      return {
        currentPrice: trade.price, // Exit price
        currentValue: trade.total_value, // Exit value  
        purchaseValue: trade.original_purchase_value || 0, // Stored purchase value
        purchasePrice: trade.original_purchase_price || 0, // Stored purchase price
        gainLoss: trade.realized_pnl || 0, // Stored realized P&L
        gainLossPercentage: trade.realized_pnl_pct || 0, // Stored P&L percentage
        isAutomatedWithoutPnL: false
      };
    }
    
    // OPEN POSITIONS: Simple direct calculations
    const purchasePrice = trade.price;
    const purchaseValue = trade.total_value;
    const currentMarketPrice = marketData[trade.cryptocurrency]?.price || currentPrices[trade.cryptocurrency] || purchasePrice;
    const currentValue = trade.amount * currentMarketPrice;
    const unrealizedPL = currentValue - purchaseValue;
    const gainLossPercentage = purchaseValue > 0 ? (unrealizedPL / purchaseValue) * 100 : 0;
    
    return {
      currentPrice: currentMarketPrice,
      currentValue: currentValue,
      purchaseValue: purchaseValue,
      purchasePrice: purchasePrice,
      gainLoss: unrealizedPL,
      gainLossPercentage: gainLossPercentage
    };
  };

  // Helper functions: FIFO per-trade lots and counts (each trade = one position)
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
            fees: (trade.fees || 0) * ratio,
          });
        } else {
          closedCount += 1;
        }
      });
    });
    return { openLots, closedCount };
  };

  const computeLifecycleCounts = (allTrades: Trade[]) => {
    const { openLots, closedCount } = buildFifoLots(allTrades);
    return { openCount: openLots.length, closedCount };
  };

  const getOpenPositionsList = () => {
    if (trades.length === 0) return [] as Trade[];
    const { openLots } = buildFifoLots(trades);
    // Sort open positions by execution date (newest first)
    return openLots.sort((a, b) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime());
  };

  // Realized P&L using strict FIFO and price-only formula (no fees)
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

  // Unrealized P&L from open lots and current investment (price-only, no fees)
  const computeUnrealizedPLFromOpenLots = (openLots: Trade[]) => {
    let unrealizedPL = 0;
    let invested = 0;
    openLots.forEach((lot) => {
      const currentPrice = marketData[lot.cryptocurrency]?.price || currentPrices[lot.cryptocurrency] || lot.price;
      unrealizedPL += (currentPrice - lot.price) * lot.amount;
      invested += lot.price * lot.amount;
    });
    return { unrealizedPL, invested };
  };


  // Preserve original pro-rated method for P&L/invested calculations (do not change metrics)
  const getOpenPositionsForPL = () => {
    if (trades.length === 0) return [] as Trade[];
    
    // Group trades by cryptocurrency to calculate net positions
    const positionsBySymbol = new Map<string, { 
      netAmount: number, 
      buyTrades: Trade[], 
      sellTrades: Trade[], 
      totalBought: number, 
      totalSold: number 
    }>();
    
    trades.forEach(trade => {
      const crypto = trade.cryptocurrency;
      if (!positionsBySymbol.has(crypto)) {
        positionsBySymbol.set(crypto, { 
          netAmount: 0, 
          buyTrades: [], 
          sellTrades: [],
          totalBought: 0,
          totalSold: 0
        });
      }
      const position = positionsBySymbol.get(crypto)!;
      if (trade.trade_type === 'buy') {
        position.netAmount += trade.amount;
        position.totalBought += trade.amount;
        position.buyTrades.push(trade);
      } else if (trade.trade_type === 'sell') {
        position.netAmount -= trade.amount;
        position.totalSold += trade.amount;
        position.sellTrades.push(trade);
      }
    });
    
    // Return buy trades for positions that still have net positive amount
    const openTrades: Trade[] = [];
    positionsBySymbol.forEach((position) => {
      if (position.netAmount > 0.000001) {
        // Show most recent buys representing the open portion
        const sortedBuys = position.buyTrades.sort((a, b) => 
          new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime()
        );
        let remainingAmount = position.netAmount;
        for (const buyTrade of sortedBuys) {
          if (remainingAmount <= 0) break;
          const usedAmount = Math.min(buyTrade.amount, remainingAmount);
          const amountRatio = usedAmount / buyTrade.amount;
          openTrades.push({
            ...buyTrade,
            amount: usedAmount,
            total_value: buyTrade.total_value * amountRatio,
            fees: (buyTrade.fees || 0) * amountRatio,
          });
          remainingAmount -= usedAmount;
        }
      }
    });
    
    return openTrades;
  };
  
  // PHASE 2: Use past_positions_view for Past Positions
  const [pastPositions, setPastPositions] = useState<Trade[]>([]);
  
  const fetchPastPositions = async () => {
    console.log('🔍 PAST_POSITIONS: Starting fetchPastPositions, filtering from existing trades:', trades.length);
    
    // Debug: Check trade types distribution
    if (trades.length > 0) {
      const tradeTypes = trades.reduce((acc, trade) => {
        acc[trade.trade_type] = (acc[trade.trade_type] || 0) + 1;
        return acc;
      }, {});
      console.log('🔍 PAST_POSITIONS: Trade types distribution:', tradeTypes);
      console.log('🔍 PAST_POSITIONS: Sample trades (first 3):', trades.slice(0, 3).map(t => ({
        id: t.id,
        trade_type: t.trade_type,
        cryptocurrency: t.cryptocurrency,
        amount: t.amount,
        executed_at: t.executed_at
      })));
    }
    
    // Filter existing trades to show ALL sell trades (not just ones with snapshot data)
    const closedTrades = trades.filter(trade => trade.trade_type === 'sell');
    
    console.log('🔍 PAST_POSITIONS: Found', closedTrades.length, 'sell trades');
    
    // Sort by execution date (newest first)
    const sortedClosedTrades = closedTrades.sort((a, b) => 
      new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime()
    );
    
    setPastPositions(sortedClosedTrades);
    console.log('🔍 PAST_POSITIONS: Set pastPositions to', sortedClosedTrades.length, 'trades');
  };
  
  const getPastPositions = () => {
    console.log('🔍 PAST_POSITIONS: getPastPositions called - returning', pastPositions.length, 'items');
    return pastPositions;
  };
  const sellPosition = async (trade: Trade) => {
    if (!user) return;
    
    try {
      const currentPrice = marketData[trade.cryptocurrency]?.price || currentPrices[trade.cryptocurrency] || trade.price;
      const sellValue = trade.amount * currentPrice;
      const buyValue = trade.total_value; // Already pro-rated for partials in getOpenPositions

      // Derive fee rate from original buy if available; fallback to profile fee rate (stored as decimal)
      const inferredBuyFeeRate = trade.total_value > 0 && (trade.fees || 0) > 0
        ? (trade.fees || 0) / trade.total_value
        : feeRate;
      const sellFee = sellValue * inferredBuyFeeRate;
      const buyFeeProrated = trade.fees || 0; // pro-rated in getOpenPositions

      const realizedPL = (sellValue - sellFee) - (buyValue + buyFeeProrated);
      
      const { error } = await supabase
        .from('mock_trades')
        .insert({
          user_id: user.id,
          strategy_id: trade.strategy_id,
          trade_type: 'sell',
          cryptocurrency: trade.cryptocurrency,
          amount: trade.amount,
          price: currentPrice,
          total_value: sellValue,
          profit_loss: realizedPL,
          fees: sellFee,
          executed_at: new Date().toISOString(),
          is_test_mode: true,
          market_conditions: {
            price: currentPrice,
            timestamp: new Date().toISOString()
          }
        });

      if (error) throw error;

      toast({
        title: "Position Sold",
        description: `Successfully sold ${trade.amount.toFixed(6)} ${trade.cryptocurrency}. Realized ${formatEuro(realizedPL)} ${realizedPL >= 0 ? 'profit' : 'loss'} (fees included)`,
      });

      // Refresh the trades
      fetchTradingHistory();
    } catch (error) {
      console.error('Error selling position:', error);
      toast({
        title: "Error",
        description: "Failed to sell position",
        variant: "destructive",
      });
    }
  };

  // Trade card component for reusability
  const TradeCard = ({ trade }: { trade: Trade }) => {
    const performance = calculateTradePerformance(trade);
    const isOpen = trade.trade_type === 'buy';
    const tradeValue = trade.amount * trade.price;
    
    return (
      <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-700">
        {/* Desktop Layout */}
        <div className="hidden md:block">
          <div className="grid grid-cols-10 gap-3 items-center text-sm">
            {/* Trade Type & Symbol */}
            <div className="col-span-1">
              <div className="flex items-center gap-2">
                <Badge 
                  variant={trade.trade_type === 'buy' ? 'default' : 'secondary'}
                  className={trade.trade_type === 'buy' ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'}
                >
                  {trade.trade_type.toUpperCase()}
                </Badge>
              </div>
              <div className="font-medium text-white mt-1">{trade.cryptocurrency}</div>
            </div>
            
            {/* Amount */}
            <div className="col-span-1">
              <div className="text-slate-400 text-xs">Amount</div>
              <div className="font-medium text-white">{trade.amount.toFixed(6)}</div>
            </div>
            
            {/* EUR Value at Trade */}
            <div className="col-span-1">
              <div className="text-slate-400 text-xs">
                {isOpen ? 'Purchase Value' : 'Purchase Value'}
              </div>
              <div className="font-medium text-white">
                {performance.isAutomatedWithoutPnL ? (
                  <span className="text-orange-400 text-xs">Automated</span>
                ) : (
                  `€${performance.purchaseValue.toFixed(2)}`
                )}
              </div>
            </div>

            {/* Current EUR Value */}
            <div className="col-span-1">
              <div className="text-slate-400 text-xs">
                {isOpen ? 'Current Value' : 'Exit Value'}
              </div>
              <div className="font-medium text-white">€{performance.currentValue.toFixed(2)}</div>
            </div>

            {/* Price */}
            <div className="col-span-1">
              <div className="text-slate-400 text-xs">
                {isOpen ? 'Purchase Price' : 'Purchase Price'}
              </div>
              <div className="font-medium text-white">
                {performance.isAutomatedWithoutPnL ? (
                  <span className="text-orange-400 text-xs">Unknown</span>
                ) : isOpen ? (
                  `€${trade.price.toLocaleString()}`
                ) : (
                  `€${(performance.purchasePrice || 0).toLocaleString()}`
                )}
              </div>
            </div>

            {/* Current/Exit Price */}
            <div className="col-span-1">
              <div className="text-slate-400 text-xs">
                {isOpen ? 'Current Price' : 'Exit Price'}
              </div>
              <div className="font-medium text-white">€{performance.currentPrice.toLocaleString()}</div>
            </div>
            
            {/* P&L */}
            <div className="col-span-1">
              <div className="text-slate-400 text-xs">P&L</div>
              <div className={`font-medium ${performance.isAutomatedWithoutPnL ? 'text-orange-400' : performance.gainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {performance.isAutomatedWithoutPnL ? 'N/A' : `€${performance.gainLoss.toFixed(2)}`}
              </div>
            </div>
            
            {/* P&L % */}
            <div className="col-span-1">
              <div className="text-slate-400 text-xs">P&L %</div>
              <div className={`font-medium ${performance.isAutomatedWithoutPnL ? 'text-orange-400' : performance.gainLossPercentage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {performance.isAutomatedWithoutPnL ? 'N/A' : `${performance.gainLossPercentage >= 0 ? '+' : ''}${performance.gainLossPercentage.toFixed(2)}%`}
              </div>
            </div>
            
            {/* Date */}
            <div className="col-span-1 text-xs text-slate-400">
              {new Date(trade.executed_at).toLocaleDateString()}
              <div className="text-xs mt-1">{new Date(trade.executed_at).toLocaleTimeString()}</div>
            </div>
            
            {/* Status */}
            <div className="col-span-1 flex items-center justify-center">
              <Badge variant="outline" className={isOpen ? 'text-blue-400 border-blue-400' : 'text-slate-400 border-slate-400'}>
                {isOpen ? 'OPEN' : 'CLOSED'}
              </Badge>
            </div>
            
            {/* Actions */}
            <div className="col-span-1">
              {trade.trade_type === 'buy' && testMode && (
                <Button
                  onClick={() => sellPosition(trade)}
                  size="sm"
                  variant="outline"
                  className="bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
                >
                  Sell
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Layout */}
        <div className="md:hidden space-y-3">
          {/* Header Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge 
                variant={trade.trade_type === 'buy' ? 'default' : 'secondary'}
                className={trade.trade_type === 'buy' ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'}
              >
                {trade.trade_type.toUpperCase()}
              </Badge>
              <span className="font-bold text-white text-lg">{trade.cryptocurrency}</span>
            </div>
            {trade.trade_type === 'buy' && testMode && (
              <Button
                onClick={() => sellPosition(trade)}
                size="sm"
                variant="outline"
                className="bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
              >
                Sell Position
              </Button>
            )}
          </div>

          {/* Amount Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-slate-400 text-sm">Amount</div>
              <div className="font-semibold text-white text-lg">{trade.amount.toFixed(6)}</div>
            </div>
            <div>
              <div className="text-slate-400 text-sm">Date</div>
              <div className="font-medium text-white">{new Date(trade.executed_at).toLocaleDateString()}</div>
            </div>
          </div>

           {/* EUR Values Row */}
           <div className="grid grid-cols-2 gap-4">
             <div>
               <div className="text-slate-400 text-sm">
                 {isOpen ? 'Entry Value' : 'Purchase Value'}
               </div>
               <div className="font-semibold text-white text-lg">
                 {performance.isAutomatedWithoutPnL ? (
                   <span className="text-orange-400 text-sm">Automated</span>
                 ) : (
                   `€${performance.purchaseValue.toFixed(2)}`
                 )}
               </div>
             </div>
             <div>
               <div className="text-slate-400 text-sm">
                 {isOpen ? 'Market Value' : 'Sale Value'}
               </div>
               <div className="font-semibold text-white text-lg">€{performance.currentValue.toFixed(2)}</div>
             </div>
           </div>

           {/* Price Row */}
           <div className="grid grid-cols-2 gap-4">
             <div>
               <div className="text-slate-400 text-sm">
                 {isOpen ? 'Entry Price' : 'Sale Price'}
               </div>
               <div className="font-semibold text-white text-lg">€{trade.price.toLocaleString()}</div>
             </div>
             <div>
               <div className="text-slate-400 text-sm">
                 {isOpen ? 'Market Price' : 'Exit Price'}
               </div>
               <div className="font-semibold text-white text-lg">€{performance.currentPrice.toLocaleString()}</div>
             </div>
           </div>

          {/* P&L Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-slate-400 text-sm">Profit/Loss</div>
              <div className={`font-bold text-xl ${performance.isAutomatedWithoutPnL ? 'text-orange-400' : performance.gainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {performance.isAutomatedWithoutPnL ? 'N/A' : `€${performance.gainLoss.toFixed(2)}`}
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-sm">Profit/Loss %</div>
              <div className={`font-bold text-xl ${performance.isAutomatedWithoutPnL ? 'text-orange-400' : performance.gainLossPercentage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {performance.isAutomatedWithoutPnL ? 'N/A' : `${performance.gainLossPercentage >= 0 ? '+' : ''}${performance.gainLossPercentage.toFixed(2)}%`}
              </div>
            </div>
          </div>

          {/* Additional Info Row */}
          <div className="pt-2 border-t border-slate-600 grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-slate-400">Total Value: </span>
              <span className="text-white font-medium">€{trade.total_value.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-slate-400">Fees: </span>
              <span className="text-white font-medium">€{(trade.fees || 0).toFixed(2)}</span>
            </div>
            <div className="flex items-center">
              <span className="text-slate-400 mr-2">Status: </span>
              <Badge variant="outline" className={isOpen ? 'text-blue-400 border-blue-400' : 'text-slate-400 border-slate-400'}>
                {isOpen ? 'OPEN' : 'CLOSED'}
              </Badge>
            </div>
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (user) {
      console.log('🔄 TradingHistory: User or testMode changed, clearing trades and fetching fresh data');
      // CRITICAL: Clear trades immediately when switching modes or users to prevent stale data
      setTrades([]);
      setPastPositions([]);
      setStats({
        totalTrades: 0,
        totalVolume: 0,
        netProfitLoss: 0,
        openPositions: 0,
        totalInvested: 0,
        currentPL: 0,
        totalPL: 0,
        currentlyInvested: 0
      });
      
      // Fetch trading history for the user
      console.log('🔄 TradingHistory: Fetching trading history for user change');
      fetchTradingHistory();
    }
  }, [user, testMode]);

  useEffect(() => {
    // Auto-fetch data when connection is selected in live mode
    if (!testMode && selectedConnection && user) {
      fetchTradingHistory();
    }
  }, [selectedConnection, testMode, user]);

  // Fetch past positions when trades are updated
  useEffect(() => {
    console.log('🔄 TRADES_EFFECT: Effect triggered! Current render ID:', Math.random().toString(36).substr(2, 5));
    console.log('🔄 TRADES_EFFECT: Trades length:', trades?.length || 0);
    console.log('🔄 TRADES_EFFECT: Trades array type:', typeof trades, 'isArray:', Array.isArray(trades));
    console.log('🔄 TRADES_EFFECT: Trades reference:', trades === trades ? 'same' : 'different');
    
    if (trades && trades.length > 0) {
      console.log('🔄 TRADES_EFFECT: Processing', trades.length, 'trades');
      console.log('🔄 TRADES_EFFECT: Sample trades:', trades.slice(0, 2));
      fetchPastPositions();
    } else {
      console.log('🔄 TRADES_EFFECT: No trades or empty array, clearing past positions');
      // Clear past positions when no trades
      setPastPositions([]);
    }
  }, [trades]);

  // Add a separate effect to monitor trades changes
  useEffect(() => {
    console.log('🔄 TRADES_MONITOR: Trades changed to length:', trades?.length || 0);
    console.log('🔄 TRADES_MONITOR: First trade sample:', trades?.[0] ? {
      id: trades[0].id,
      trade_type: trades[0].trade_type,
      cryptocurrency: trades[0].cryptocurrency
    } : 'no trades');
  }, [trades]);

  // Fetch user profile fee rate (used as authoritative fee when needed)
  useEffect(() => {
    const fetchProfileFeeRate = async () => {
      if (!user) return;
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('fee_rate')
          .eq('id', user.id)
          .maybeSingle();
        if (!error && data) {
          setFeeRate(Number(data.fee_rate || 0));
        }
      } catch (e) {
        console.warn('Could not fetch profile fee rate, defaulting to 0', e);
      }
    };
    fetchProfileFeeRate();
  }, [user]);

  // Set up real-time subscription for trading history
  useEffect(() => {
    if (!user) return;

    console.log('🔄 Setting up real-time subscription for trading history');
    
    const channel = supabase
      .channel('mock-trades-changes')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'mock_trades', filter: `user_id=eq.${user.id}` },
        (payload) => {
          console.log('🔄 Real-time INSERT detected:', payload);
          if (testMode) {
            fetchTradingHistory();
          }
        }
      )
      .on('postgres_changes', 
        { event: 'UPDATE', schema: 'public', table: 'mock_trades', filter: `user_id=eq.${user.id}` },
        (payload) => {
          console.log('🔄 Real-time UPDATE detected:', payload);
          if (testMode) {
            fetchTradingHistory();
          }
        }
      )
      .subscribe();

    return () => {
      console.log('🔄 Cleaning up real-time subscription');
      supabase.removeChannel(channel);
    };
  }, [user, testMode]);

  // Recompute P&L dynamically when market data updates
  useEffect(() => {
    if (!trades || trades.length === 0) return;
    if (!testMode) return; // In live mode, rely on Coinbase metrics to avoid inconsistency
    const openLots = getOpenPositionsList();
    const { unrealizedPL, invested } = computeUnrealizedPLFromOpenLots(openLots);
    const realizedPL = computeRealizedPLFIFO(trades);
    setStats((prev) => ({
      ...prev,
      currentPL: unrealizedPL,
      totalPL: unrealizedPL + realizedPL,
      netProfitLoss: unrealizedPL + realizedPL,
      currentlyInvested: invested,
    }));
  }, [marketData, currentPrices, trades, testMode]);

  const fetchConnections = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('user_coinbase_connections')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true);
      
      if (error) throw error;
      
      setConnections(data || []);
      // Auto-select first connection if available
      if (data && data.length > 0 && !selectedConnection) {
        setSelectedConnection(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching connections:', error);
    }
  };

  const fetchTradingHistory = async () => {
    if (!user) {
      console.log('🚨 FETCH_TRADING: No user found, aborting');
      return;
    }
    
    setFetching(true);
    console.log('🔍 FETCH_TRADING: Starting for user:', user.id, 'testMode:', testMode);
    
    try {
      let data, error;
      
      // Always check mock_trades first since that's where the trading data is stored
      console.log('🔍 Fetching mock trades for user:', user.id);
      
      const result = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .order('executed_at', { ascending: false });
      
      console.log('🔍 FETCH_TRADING: Mock trades query result:', { count: result.data?.length, error: result.error });
      console.log('🔍 FETCH_TRADING: First few trades:', result.data?.slice(0, 3));
      
      data = result.data;
      error = result.error;
      
      // If we have mock trades data, use it
      if (data && data.length > 0) {
        setPortfolioValue(getTotalValue());
      } else if (!testMode) {
        // In live mode, fetch directly from Coinbase API
        console.log('🔍 Fetching live trading history directly from Coinbase API');
        
        if (!selectedConnection) {
          console.log('No connection selected, clearing trades');
          setTrades([]);
          setPortfolioValue(0);
           setStats({ 
             totalTrades: 0, 
             totalVolume: 0, 
             netProfitLoss: 0,
             openPositions: 0,
             totalInvested: 0,
             currentPL: 0,
             totalPL: 0,
             currentlyInvested: 0
           });
          return;
        }

        try {
          const { data: coinbaseData, error: coinbaseError } = await supabase.functions.invoke('coinbase-trading-history', {
            body: { 
              connectionId: selectedConnection,
              testMode: false
            }
          });

          if (coinbaseError) throw coinbaseError;

          console.log('📊 Coinbase API response:', coinbaseData);
          
          // Prefer normalized trades mapped by the Edge Function; fallback to mapping raw orders
          if (coinbaseData?.normalizedTrades && Array.isArray(coinbaseData.normalizedTrades)) {
            data = coinbaseData.normalizedTrades;
          } else if (coinbaseData?.tradingHistory && Array.isArray(coinbaseData.tradingHistory)) {
            data = coinbaseData.tradingHistory.map((order: any) => {
              const cryptocurrency = order.product_id?.split('-')[0] || '';
              const amount = parseFloat(order.filled_size || '0');
              const total_value = parseFloat(order.filled_value || '0');
              const price = amount > 0 ? total_value / amount : 0;
              return {
                id: order.order_id,
                trade_type: (order.side || '').toLowerCase(),
                cryptocurrency,
                amount,
                price,
                total_value,
                executed_at: order.created_time,
                fees: parseFloat(order.total_fees || order.fill_fees || '0'),
                notes: `Coinbase ${order.order_type || 'market'} order`,
                coinbase_order_id: order.order_id,
              } as Trade;
            });
          } else {
            data = [];
          }

          // If Coinbase provides aggregated metrics, use them as source of truth (no local recalculation)
          if (coinbaseData?.metrics) {
            const m = coinbaseData.metrics as any;
            const totalPositions = Number(m.totalPositions ?? ((m.openPositions ?? 0) + (m.closedPositions ?? 0)));
            setTrades(data || []);
            setStats({
              totalTrades: totalPositions,
              totalVolume: Number(m.totalVolume ?? 0),
              netProfitLoss: Number(m.totalPL ?? ((m.unrealizedPL || 0) + (m.realizedPL || 0))),
              openPositions: Number(m.openPositions ?? 0),
              totalInvested: Number(m.totalInvested ?? 0),
              currentPL: Number(m.unrealizedPL ?? 0),
              totalPL: Number(m.totalPL ?? ((m.unrealizedPL || 0) + (m.realizedPL || 0))),
              currentlyInvested: Number(m.currentlyInvested ?? 0)
            });
            setLoading(false);
            setFetching(false);
            return; // IMPORTANT: do not proceed to local calculations
          }
          error = null;
        } catch (apiError) {
          console.error('Error fetching from Coinbase API:', apiError);
          data = [];
          error = null; // Don't treat API errors as fatal
        }
        
        // In live mode, portfolio value would come from Coinbase portfolio API
        setPortfolioValue(0); // Will be updated when Coinbase portfolio integration is complete
      }

      if (error) throw error;
      
      // CRITICAL: Always clear previous state first to prevent UI/DB mismatch
      console.log('📊 Setting trades data:', data?.length || 0, 'trades');
      
      // If no data from database, ensure UI reflects that
      if (!data || data.length === 0) {
        console.log('📊 No trades found in database, resetting all state');
        setTrades([]);
        setStats({ 
          totalTrades: 0, 
          totalVolume: 0, 
          netProfitLoss: 0,
          openPositions: 0,
          totalInvested: 0,
          currentPL: 0,
          totalPL: 0,
          currentlyInvested: 0
        });
        setLoading(false);
        setFetching(false);
        return;
      }
      
      // Only process if we have actual data
      console.log('💾 FETCH_TRADING: About to set trades with', data?.length || 0, 'items');
      setTrades(data);
      console.log('💾 FETCH_TRADING: Trades state updated successfully');
      
      // IMMEDIATE FIX: Call fetchPastPositions directly since useEffect isn't firing
      if (data && data.length > 0) {
        console.log('💾 CALLING fetchPastPositions directly with', data.length, 'trades');
        // Filter for sell trades immediately
        const closedTrades = data.filter(trade => trade.trade_type === 'sell');
        console.log('💾 Found', closedTrades.length, 'sell trades for past positions');
        setPastPositions(closedTrades.sort((a, b) => 
          new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime()
        ));
      }
      
      // Fetch current prices for all cryptocurrencies in trades
      const symbols = [...new Set((data as Trade[]).map(trade => `${trade.cryptocurrency}-EUR`))];
      try {
        const priceData = await getCurrentData(symbols);
        const prices: Record<string, number> = {};
        Object.entries(priceData).forEach(([symbol, data]) => {
          const crypto = symbol.replace('-EUR', '');
          prices[crypto] = data.price;
        });
        setCurrentPrices(prices);
      } catch (error) {
        console.error('Error fetching current prices:', error);
      }
      
      // Calculate comprehensive trading statistics with proper validation
      const allTrades = data || [];
      console.log('📊 Calculating stats for trades:', allTrades.length);
      console.log('📊 First few trades:', allTrades.slice(0, 3));
      
      // Calculate position summaries by cryptocurrency
      const positionSummary = new Map<string, { 
        netAmount: number, 
        totalBought: number, 
        totalSold: number,
        buyValue: number,
        sellValue: number,
        buyTrades: Trade[],
        sellTrades: Trade[],
        hasEverHadPosition: boolean,
        isCurrentlyOpen: boolean,
        isClosed: boolean
      }>();
      
      let lifetimeTotalInvested = 0;
      
      // Process all trades to build position summary
      allTrades.forEach(trade => {
        const crypto = trade.cryptocurrency;
        if (!positionSummary.has(crypto)) {
          positionSummary.set(crypto, { 
            netAmount: 0, 
            totalBought: 0, 
            totalSold: 0,
            buyValue: 0,
            sellValue: 0,
            buyTrades: [],
            sellTrades: [],
            hasEverHadPosition: false,
            isCurrentlyOpen: false,
            isClosed: false
          });
        }
        
        const position = positionSummary.get(crypto)!;
        
        if (trade.trade_type === 'buy') {
          position.netAmount += trade.amount;
          position.totalBought += trade.amount;
          position.buyValue += trade.total_value;
          position.buyTrades.push(trade);
          position.hasEverHadPosition = true;
          lifetimeTotalInvested += trade.total_value;
        } else if (trade.trade_type === 'sell') {
          position.netAmount -= trade.amount;
          position.totalSold += trade.amount;
          position.sellValue += trade.total_value;
          position.sellTrades.push(trade);
        }
      });
      
      // Compute P&L strictly per requested formulas (no fees)
      const realizedFromFIFO = computeRealizedPLFIFO(allTrades as Trade[]);
      const openLots = getOpenPositionsList();
      const { unrealizedPL: currentUnrealizedPL, invested: currentlyInvested } = computeUnrealizedPLFromOpenLots(openLots);
      
      // Count positions using lifecycle grouping
      const { openCount: lifecycleOpen, closedCount: lifecycleClosed } = computeLifecycleCounts(allTrades as Trade[]);
      const totalPositions = lifecycleOpen + lifecycleClosed;
      const totalVolume = (allTrades as Trade[]).reduce((sum, t) => sum + Number(t.total_value || 0), 0);

      setStats({ 
        totalTrades: totalPositions,
        totalVolume, 
        netProfitLoss: currentUnrealizedPL + realizedFromFIFO,
        openPositions: lifecycleOpen,
        totalInvested: lifetimeTotalInvested,
        currentPL: currentUnrealizedPL,
        totalPL: currentUnrealizedPL + realizedFromFIFO,
        currentlyInvested
      });
    } catch (error) {
      console.error('Error fetching trading history:', error);
      toast({
        title: "Error",
        description: "Failed to load trading history",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setFetching(false);
    }
  };

  if (!hasActiveStrategy) {
    return (
      <NoActiveStrategyState 
        onCreateStrategy={onCreateStrategy}
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Trading History</h2>
        </div>
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mx-auto"></div>
          <p className="text-slate-400 mt-2">Loading trading history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Trading History</h2>
          <p className="text-slate-400">
            {testMode ? 'Mock trading history (Test Mode)' : 'Live trading history'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={fetchTradingHistory}
            disabled={fetching}
            variant="outline"
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${fetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPIs Summary */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Strategy KPIs Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* POSITIONS SUMMARY */}
          <div className="bg-slate-900/60 border border-slate-600 p-5 rounded-lg">
            <h4 className="text-md font-semibold text-slate-300 mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-blue-400" />
              Positions Summary
            </h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Open Positions</span>
                <div className="text-right">
                  {loading ? (
                    <div className="w-8 h-6 bg-slate-700 animate-pulse rounded"></div>
                  ) : (
                    <div className="text-lg font-bold text-white">{stats.openPositions}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Total Positions</span>
                <div className="text-right">
                  {loading ? (
                    <div className="w-8 h-6 bg-slate-700 animate-pulse rounded"></div>
                  ) : (
                    <div className="text-lg font-bold text-white">{stats.totalTrades}</div>
                  )}
                  <div className="text-xs text-slate-500">Open + closed</div>
                </div>
              </div>
            </div>
          </div>
          
          {/* INVESTMENT METRICS */}
          <div className="bg-slate-900/60 border border-slate-600 p-5 rounded-lg">
            <h4 className="text-md font-semibold text-slate-300 mb-4 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-orange-400" />
              Investment Metrics
            </h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Currently Invested</span>
                <div className="text-right">
                  {loading ? (
                    <div className="w-16 h-6 bg-slate-700 animate-pulse rounded"></div>
                  ) : (
                    <div className="text-lg font-bold text-white">{formatEuro(stats.currentlyInvested)}</div>
                  )}
                  <div className="text-xs text-slate-500">In open positions</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Total Invested</span>
                <div className="text-right">
                  {loading ? (
                    <div className="w-16 h-6 bg-slate-700 animate-pulse rounded"></div>
                  ) : (
                    <div className="text-lg font-bold text-white">{formatEuro(stats.totalInvested)}</div>
                  )}
                  <div className="text-xs text-slate-500">Lifetime</div>
                </div>
              </div>
            </div>
          </div>
          
          {/* PERFORMANCE METRICS */}
          <div className="bg-slate-900/60 border border-slate-600 p-5 rounded-lg">
            <h4 className="text-md font-semibold text-slate-300 mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              Performance Metrics
            </h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Unrealized P&L</span>
                <div className="text-right">
                  {loading ? (
                    <div className="w-16 h-6 bg-slate-700 animate-pulse rounded"></div>
                  ) : (
                    <div className={`text-lg font-bold ${stats.currentPL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatEuro(stats.currentPL)}
                    </div>
                  )}
                  <div className="text-xs text-slate-500">Open positions</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Realized P&L</span>
                <div className="text-right">
                  {loading ? (
                    <div className="w-16 h-6 bg-slate-700 animate-pulse rounded"></div>
                  ) : (
                    <div className={`text-lg font-bold ${(stats.totalPL - stats.currentPL) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatEuro(stats.totalPL - stats.currentPL)}
                    </div>
                  )}
                  <div className="text-xs text-slate-500">Closed positions</div>
                </div>
              </div>
              <div className="border-t border-slate-700 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">Total P&L</span>
                  <div className="text-right">
                    <div className={`text-xl font-bold ${stats.netProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatEuro(stats.netProfitLoss)}
                    </div>
                    <div className="text-xs text-slate-500">
                      {stats.totalInvested > 0 ? formatPercentage((stats.netProfitLoss / stats.totalInvested) * 100) : '-'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trading History Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'open' | 'past')} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 bg-slate-800 border border-slate-700">
          <TabsTrigger 
            value="open" 
            className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400"
          >
            Open Positions ({computeLifecycleCounts(trades).openCount})
          </TabsTrigger>
          <TabsTrigger 
            value="past" 
            className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400"
          >
            Past Positions ({allPastTrades.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="space-y-4">
          {getOpenPositionsList().length > 0 ? (
            <div className="space-y-4">
              {getOpenPositionsList().map((trade, index) => (
                <TradeCard key={`open-${trade.id}-${index}`} trade={trade} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 border border-slate-600 rounded-lg bg-slate-800/30">
              <Target className="w-12 h-12 text-slate-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-300 mb-2">No Open Positions</h3>
              <p className="text-slate-400">All positions have been closed</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="past" className="space-y-4">
          {pastLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
              <p className="text-slate-400 mt-2">Loading past trades...</p>
            </div>
          ) : allPastTrades.length > 0 ? (
            <div className="space-y-4">
              {allPastTrades.map((trade, index) => (
                <TradeCard key={`past-${trade.id}-${index}`} trade={trade} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 border border-slate-600 rounded-lg bg-slate-800/30">
              <Clock className="w-12 h-12 text-slate-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-300 mb-2">No Past Trades</h3>
              <p className="text-slate-400">No closed positions found</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
      
      {trades.length === 0 && (
        <div className="text-center py-8 border border-slate-600 rounded-lg bg-slate-800/30">
          <Activity className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-300 mb-2">No trades yet</h3>
          <p className="text-slate-400 mb-4">
            {testMode ? 'Your mock trades will appear here' : 'Your live trades will appear here'}
          </p>
        </div>
      )}
    </div>
  );
};