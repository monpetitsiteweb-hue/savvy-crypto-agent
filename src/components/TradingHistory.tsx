
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
import { formatEuro } from '@/utils/currencyFormatter';

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
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { toast } = useToast();
  const { getTotalValue } = useMockWallet();
  
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

  useEffect(() => {
    if (user) {
      // Clear trades immediately when switching modes to prevent cached data display
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
    
    // Create subscription for the appropriate table based on test mode
    const tableName = testMode ? 'mock_trades' : 'trading_history';
    const filter = `user_id=eq.${user.id}`;

    const channel = supabase
      .channel(`trading-history-${tableName}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all changes (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: tableName,
          filter: filter
        },
        (payload) => {
          console.log('📈 Trading history changed:', payload);
          // Refresh trading history when changes occur
          fetchTradingHistory();
        }
      )
      .subscribe();

    return () => {
      console.log('🔌 Cleaning up trading history subscription');
      supabase.removeChannel(channel);
    };
  }, [user, testMode]);

  const fetchConnections = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('user_coinbase_connections')
        .select('id, is_active, connected_at, user_id, api_name_encrypted')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('connected_at', { ascending: false });

      if (error) throw error;
      
      setConnections(data || []);
      
      // Use saved connection from localStorage or auto-select first
      const savedConnectionId = localStorage.getItem(`selectedConnection_${user.id}`);
      if (savedConnectionId && data?.find(c => c.id === savedConnectionId)) {
        setSelectedConnection(savedConnectionId);
      } else if (data && data.length > 0) {
        const firstConnectionId = data[0].id;
        setSelectedConnection(firstConnectionId);
        localStorage.setItem(`selectedConnection_${user.id}`, firstConnectionId);
      }
    } catch (error) {
      console.error('Error fetching connections:', error);
    }
  };

  const fetchTradingHistory = async () => {
    if (!user) return;
    
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
    }
  };

  const fetchFromCoinbase = async () => {
    // In live mode, this just refreshes the data since we always fetch from Coinbase API
    await fetchTradingHistory();
    
    toast({
      title: "Refreshed",
      description: "Trading history refreshed from Coinbase",
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Only show NoActiveStrategyState if no trades exist and not loading
  if (trades.length === 0 && !loading && testMode) {
    return (
      <NoActiveStrategyState 
        onCreateStrategy={onCreateStrategy}
        className="min-h-[400px]"
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Loading trading history...</div>
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="space-y-4">
        {/* Connection Selector - Only show in live mode */}
        {!testMode && connections.length > 0 && (
          <Card className="p-4 bg-slate-700/30 border-slate-600">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm text-slate-400 mb-2 block">Coinbase Connection:</label>
                <select
                  value={selectedConnection}
                  onChange={(e) => {
                    setSelectedConnection(e.target.value);
                    localStorage.setItem(`selectedConnection_${user.id}`, e.target.value);
                  }}
                  className="w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-white"
                >
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.api_name_encrypted || `Coinbase Account ${connections.findIndex(c => c.id === connection.id) + 1}`}
                    </option>
                  ))}
                </select>
              </div>
              <Button 
                onClick={fetchFromCoinbase}
                disabled={fetching || !selectedConnection}
                className="bg-green-500 hover:bg-green-600 text-white"
              >
                {fetching ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Fetch from Coinbase
                  </>
                )}
              </Button>
            </div>
          </Card>
        )}

        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <div className="w-16 h-16 bg-slate-700/50 rounded-full flex items-center justify-center">
            <Activity className="w-8 h-8 text-slate-500" />
          </div>
          <div className="text-center">
            <h3 className="text-xl font-semibold text-white mb-2">No Trading History</h3>
            <p className="text-slate-400">
              {testMode 
                ? "No test trades yet. Create a strategy and enable test mode to start automated trading." 
                : "No trading history available. In Live mode, trades from your connected Coinbase account will appear here once they occur."
              }
            </p>
          </div>
        </div>
      </div>
    );
  }

    return (
      <div className="space-y-4">
        {/* Connection Selector - Only show in live mode */}
        {!testMode && connections.length > 0 && (
          <Card className="p-4 bg-slate-700/30 border-slate-600">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm text-slate-400 mb-2 block">Coinbase Connection:</label>
                <select
                  value={selectedConnection}
                  onChange={(e) => {
                    setSelectedConnection(e.target.value);
                    localStorage.setItem(`selectedConnection_${user.id}`, e.target.value);
                  }}
                  className="w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-white"
                >
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.api_name_encrypted || `Coinbase Account ${connections.findIndex(c => c.id === connection.id) + 1}`}
                    </option>
                  ))}
                </select>
              </div>
              <Button 
                onClick={fetchFromCoinbase}
                disabled={fetching || !selectedConnection}
                className="bg-green-500 hover:bg-green-600 text-white"
              >
                {fetching ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Fetch from Coinbase
                  </>
                )}
              </Button>
            </div>
          </Card>
        )}

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <p className="text-sm text-slate-400">Portfolio Value</p>
          <p className="text-xl font-bold text-white">{formatEuro(portfolioValue)}</p>
        </Card>
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <p className="text-sm text-slate-400">Total Trades</p>
          <p className="text-xl font-bold text-white">{stats.totalTrades}</p>
        </Card>
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <p className="text-sm text-slate-400">Volume Traded</p>
          <p className="text-xl font-bold text-white">{formatEuro(stats.totalVolume)}</p>
        </Card>
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <p className="text-sm text-slate-400">Net P&L</p>
          <p className={`text-xl font-bold ${stats.netProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatEuro(stats.netProfitLoss)}
          </p>
        </Card>
      </div>

      {/* Trade List */}
      <Card className="bg-slate-700/30 border-slate-600">
        <div className="p-4 border-b border-slate-600">
          <h3 className="text-lg font-semibold text-white">Recent Trades</h3>
        </div>
        <div className="divide-y divide-slate-600">
          {trades.map((trade) => (
            <div key={trade.id} className="p-4 hover:bg-slate-700/20 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Trade Type Icon */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    trade.trade_type.toLowerCase() === 'buy' 
                      ? 'bg-green-500/20 text-green-400' 
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {trade.trade_type.toLowerCase() === 'buy' ? (
                      <ArrowDownLeft className="w-5 h-5" />
                    ) : (
                      <ArrowUpRight className="w-5 h-5" />
                    )}
                  </div>
                  
                  {/* Trade Details */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge 
                        variant={trade.trade_type.toLowerCase() === 'buy' ? 'default' : 'secondary'}
                        className={trade.trade_type.toLowerCase() === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}
                      >
                        {trade.trade_type.toUpperCase()}
                      </Badge>
                      <span className="font-medium text-white">{trade.cryptocurrency}</span>
                    </div>
                    {trade.strategy_trigger && testMode && (
                      <p className="text-sm text-blue-400">🎯 {trade.strategy_trigger}</p>
                    )}
                    {trade.notes && (
                      <p className="text-sm text-slate-400">{trade.notes}</p>
                    )}
                  </div>
                </div>
                
                {/* Trade Info */}
                <div className="text-right">
                  <div className="flex items-center gap-4 mb-1">
                    <div>
                      <p className="text-sm text-slate-400">Amount</p>
                      <p className="font-medium text-white">{Number(trade.amount).toLocaleString()}</p>
                    </div>
                     <div>
                       <p className="text-sm text-slate-400">Price</p>
                       <p className="font-medium text-white">{formatEuro(Number(trade.price))}</p>
                     </div>
                     <div>
                       <p className="text-sm text-slate-400">Total</p>
                       <p className="font-medium text-white">{formatEuro(Number(trade.total_value))}</p>
                     </div>
                     <div>
                       <p className="text-sm text-slate-400">Fees</p>
                       <p className="font-medium text-white">
                         {trade.fees && trade.fees > 0 ? formatEuro(trade.fees) : formatEuro(0)}
                       </p>
                     </div>
                   </div>
                  <div className="flex items-center gap-1 justify-end">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span className="text-xs text-slate-400">{formatTime(trade.executed_at)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
