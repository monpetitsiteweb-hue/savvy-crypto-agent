import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownLeft, Clock, Activity, RefreshCw } from 'lucide-react';
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
}

interface TradingHistoryProps {
  hasActiveStrategy: boolean;
  onCreateStrategy?: () => void;
}

export const TradingHistory = ({ hasActiveStrategy, onCreateStrategy }: TradingHistoryProps) => {
  console.log('🔍 TradingHistory: Render with props:', { hasActiveStrategy, testMode: undefined });
  
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { toast } = useToast();
  const { getTotalValue } = useMockWallet();
  const { getCurrentData, marketData } = useRealTimeMarketData();
  
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
  const [stats, setStats] = useState({
    totalTrades: 0,
    totalVolume: 0, // Changed from totalValue to totalVolume
    netProfitLoss: 0
  });
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});

  // Calculate trade performance including current prices and P&L
  const calculateTradePerformance = (trade: Trade) => {
    const purchasePrice = trade.price;
    const currentMarketPrice = marketData[trade.cryptocurrency]?.price || currentPrices[trade.cryptocurrency] || purchasePrice;
    
    if (trade.trade_type === 'sell') {
      // For sell orders, show the realized P&L
      return {
        currentPrice: currentMarketPrice,
        gainLoss: 0, // Sell orders don't have unrealized gains
        gainLossPercentage: 0
      };
    }
    
    const gainLoss = (currentMarketPrice - purchasePrice) * trade.amount;
    const gainLossPercentage = ((currentMarketPrice - purchasePrice) / purchasePrice) * 100;
    
    return {
      currentPrice: currentMarketPrice,
      gainLoss,
      gainLossPercentage
    };
  };

  // Sell position function
  const sellPosition = async (trade: Trade) => {
    if (!user) return;
    
    try {
      const currentPrice = marketData[trade.cryptocurrency]?.price || currentPrices[trade.cryptocurrency] || trade.price;
      
      const { error } = await supabase
        .from('mock_trades')
        .insert({
          user_id: user.id,
          strategy_id: trade.strategy_id,
          trade_type: 'sell',
          cryptocurrency: trade.cryptocurrency,
          amount: trade.amount,
          price: currentPrice,
          total_value: trade.amount * currentPrice,
          fees: 0,
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
        description: `Successfully sold ${trade.amount.toFixed(6)} ${trade.cryptocurrency}`,
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

  useEffect(() => {
    if (user) {
      // Clear trades immediately when switching modes
      setTrades([]);
      
      if (!testMode) {
        fetchConnections();
      }
      fetchTradingHistory();
    }
  }, [user, testMode]);

  useEffect(() => {
    // Auto-fetch data when connection is selected in live mode
    if (!testMode && selectedConnection && user) {
      fetchTradingHistory();
    }
  }, [selectedConnection, testMode, user]);

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
    if (!user) return;
    
    setFetching(true);
    console.log('🔍 Fetching trading history for user:', user.id, 'testMode:', testMode);
    
    try {
      let data, error;
      
      if (testMode) {
        // In test mode, fetch from mock_trades table for current user
        console.log('🔍 Fetching mock trades for user:', user.id);
        
        const result = await supabase
          .from('mock_trades')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_test_mode', true)
          .order('executed_at', { ascending: false })
          .limit(50);
        
        console.log('🔍 Mock trades query result:', { count: result.data?.length, error: result.error });
        
        data = result.data;
        error = result.error;
        
        // Get current portfolio value from mock wallet
        setPortfolioValue(getTotalValue());
      } else {
        // In live mode, fetch directly from Coinbase API
        console.log('🔍 Fetching live trading history directly from Coinbase API');
        
        if (!selectedConnection) {
          console.log('No connection selected, clearing trades');
          setTrades([]);
          setPortfolioValue(0);
          setStats({ totalTrades: 0, totalVolume: 0, netProfitLoss: 0 });
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
          
          // Use the trading history directly from Coinbase API response
          data = coinbaseData.tradingHistory || [];
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
      
      setTrades(data || []);
      
      // Fetch current prices for all cryptocurrencies in trades
      if (data && data.length > 0) {
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
      }
      
      // Calculate meaningful trading statistics
      const totalTrades = data?.length || 0;
      const totalVolume = data?.reduce((sum, trade) => sum + Number(trade.total_value), 0) || 0;
      
      // Calculate net profit/loss for test mode
      let netProfitLoss = 0;
      if (testMode && data) {
        // Starting value was 2,500,000 EUR
        const startingValue = 2500000;
        netProfitLoss = getTotalValue() - startingValue;
      }
      
      setStats({ totalTrades, totalVolume, netProfitLoss });
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

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/60 border-slate-700">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-slate-400">Total Trades</span>
            </div>
            <p className="text-2xl font-bold text-white mt-1">{stats.totalTrades}</p>
          </div>
        </Card>
        
        <Card className="bg-slate-800/60 border-slate-700">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-green-400" />
              <span className="text-sm text-slate-400">Total Volume</span>
            </div>
            <p className="text-2xl font-bold text-white mt-1">{formatEuro(stats.totalVolume)}</p>
          </div>
        </Card>
        
        {testMode && (
          <Card className="bg-slate-800/60 border-slate-700">
            <div className="p-4">
              <div className="flex items-center gap-2">
                <ArrowDownLeft className={`w-4 h-4 ${stats.netProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`} />
                <span className="text-sm text-slate-400">Net P&L</span>
              </div>
              <p className={`text-2xl font-bold mt-1 ${stats.netProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatEuro(stats.netProfitLoss)}
              </p>
            </div>
          </Card>
        )}
        
        {testMode && (
          <Card className="bg-slate-800/60 border-slate-700">
            <div className="p-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span className="text-sm text-slate-400">Portfolio Value</span>
              </div>
              <p className="text-2xl font-bold text-white mt-1">{formatEuro(portfolioValue)}</p>
            </div>
          </Card>
        )}
      </div>

      {/* Trades List */}
      {trades.length > 0 ? (
        <div className="space-y-4">
          {trades.map((trade, index) => {
            const performance = calculateTradePerformance(trade);
            
            return (
              <div key={`${trade.id}-${index}`} className="bg-slate-800/60 rounded-lg p-4 border border-slate-700">
                {/* Desktop Layout */}
                <div className="hidden md:block">
                  <div className="grid grid-cols-8 gap-4 items-center text-sm">
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
                      <div className="font-medium text-white">{trade.amount.toFixed(3)}</div>
                      <div className="text-slate-400 text-xs">€{(trade.amount * trade.price).toFixed(2)}</div>
                    </div>
                    
                    {/* Purchase Price */}
                    <div className="col-span-1">
                      <div className="text-slate-400 text-xs">Purchase Price</div>
                      <div className="font-medium text-white">€{trade.price.toLocaleString()}</div>
                    </div>
                    
                    {/* Current Price */}
                    <div className="col-span-1">
                      <div className="text-slate-400 text-xs">Current Price</div>
                      <div className="font-medium text-white">€{performance.currentPrice.toLocaleString()}</div>
                    </div>
                    
                    {/* P&L */}
                    <div className="col-span-1">
                      <div className="text-slate-400 text-xs">P&L</div>
                      <div className={`font-medium ${performance.gainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        €{performance.gainLoss.toFixed(2)}
                      </div>
                    </div>
                    
                    {/* P&L % */}
                    <div className="col-span-1">
                      <div className="text-slate-400 text-xs">P&L %</div>
                      <div className={`font-medium ${performance.gainLossPercentage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {performance.gainLossPercentage >= 0 ? '+' : ''}{performance.gainLossPercentage.toFixed(2)}%
                      </div>
                    </div>
                    
                    {/* Date */}
                    <div className="col-span-1 text-xs text-slate-400">
                      {new Date(trade.executed_at).toLocaleDateString()}
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

                  {/* Price Row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-slate-400 text-sm">Purchase Price</div>
                      <div className="font-semibold text-white text-lg">€{trade.price.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-sm">Current Price</div>
                      <div className="font-semibold text-white text-lg">€{performance.currentPrice.toLocaleString()}</div>
                    </div>
                  </div>

                  {/* P&L Row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-slate-400 text-sm">Profit/Loss</div>
                      <div className={`font-bold text-xl ${performance.gainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        €{performance.gainLoss.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-sm">Profit/Loss %</div>
                      <div className={`font-bold text-xl ${performance.gainLossPercentage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {performance.gainLossPercentage >= 0 ? '+' : ''}{performance.gainLossPercentage.toFixed(2)}%
                      </div>
                    </div>
                  </div>

                  {/* Additional Info Row */}
                  <div className="pt-2 border-t border-slate-600 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-slate-400">Total Value: </span>
                      <span className="text-white font-medium">€{trade.total_value.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Fees: </span>
                      <span className="text-white font-medium">€{(trade.fees || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="bg-slate-800/60 border-slate-700">
          <div className="p-8 text-center">
            <Activity className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">No Trading History</h3>
            <p className="text-slate-400 mb-4">
              {testMode 
                ? 'No mock trades found. Try asking the AI assistant to execute some test trades.'
                : 'No live trades found. Start trading to see your history here.'
              }
            </p>
          </div>
        </Card>
      )}
    </div>
  );
};