
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownLeft, Clock, Activity, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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

export const TradingHistory = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { testMode } = useTestMode();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<any[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [fetching, setFetching] = useState(false);
  const [stats, setStats] = useState({
    totalTrades: 0,
    totalValue: 0,
    totalFees: 0
  });

  useEffect(() => {
    if (user) {
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
        // In test mode, fetch from mock_trades table (real test trading data)
        const result = await supabase
          .from('mock_trades')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_test_mode', true)
          .order('executed_at', { ascending: false })
          .limit(50);
        
        data = result.data;
        error = result.error;
      } else {
        // In live mode, fetch from trading_history table (real Coinbase trades)
        const result = await supabase
          .from('trading_history')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_sandbox', false)
          .order('executed_at', { ascending: false })
          .limit(50);
        
        data = result.data;
        error = result.error;
      }

      if (error) throw error;
      
      setTrades(data || []);
      
      // Calculate stats
      const totalTrades = data?.length || 0;
      const totalValue = data?.reduce((sum, trade) => sum + Number(trade.total_value), 0) || 0;
      const totalFees = data?.reduce((sum, trade) => sum + Number(trade.fees || 0), 0) || 0;
      
      setStats({ totalTrades, totalValue, totalFees });
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
    if (!selectedConnection) {
      toast({
        title: "No Connection Selected",
        description: "Please select a Coinbase connection first",
        variant: "destructive",
      });
      return;
    }

    setFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke('coinbase-trading-history', {
        body: { 
          connectionId: selectedConnection,
          testMode: testMode
        }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Fetched ${data.trades} trades from Coinbase`,
      });
      
      // Refresh local data
      await fetchTradingHistory();
    } catch (error) {
      console.error('Error fetching from Coinbase:', error);
      toast({
        title: "Error",
        description: "Failed to fetch trading history from Coinbase",
        variant: "destructive",
      });
    } finally {
      setFetching(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

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
                : "Historical trades will appear here automatically when available."
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <p className="text-sm text-slate-400">Total Trades</p>
          <p className="text-xl font-bold text-white">{stats.totalTrades}</p>
        </Card>
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <p className="text-sm text-slate-400">Total Value</p>
          <p className="text-xl font-bold text-white">${stats.totalValue.toFixed(2)}</p>
        </Card>
        <Card className="p-4 bg-slate-700/30 border-slate-600">
          <p className="text-sm text-slate-400">Total Fees</p>
          <p className="text-xl font-bold text-slate-400">${stats.totalFees.toFixed(2)}</p>
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
                      {trade.fees && (
                        <Badge variant="outline" className="text-amber-400 border-amber-400/30">
                          Fee: ${trade.fees}
                        </Badge>
                      )}
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
                      <p className="font-medium text-white">${Number(trade.price).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Total</p>
                      <p className="font-medium text-white">${Number(trade.total_value).toFixed(2)}</p>
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
