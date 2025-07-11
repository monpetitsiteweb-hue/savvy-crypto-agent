
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUpRight, ArrowDownLeft, Clock, Activity } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
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
}

export const TradingHistory = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalTrades: 0,
    totalValue: 0,
    totalFees: 0
  });

  useEffect(() => {
    if (user) {
      fetchTradingHistory();
    }
  }, [user]);

  const fetchTradingHistory = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('trading_history')
        .select('*')
        .order('executed_at', { ascending: false })
        .limit(50);

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
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-16 h-16 bg-slate-700/50 rounded-full flex items-center justify-center">
          <Activity className="w-8 h-8 text-slate-500" />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-semibold text-white mb-2">No Trading History</h3>
          <p className="text-slate-400">Your trading history will appear here once you start trading.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
