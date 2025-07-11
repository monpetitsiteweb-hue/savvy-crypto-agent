
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, AlertCircle, Wallet, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface CoinbaseConnection {
  id: string;
  connection_name: string;
  is_active: boolean;
  is_sandbox: boolean;
}

interface CoinbaseAccount {
  id: string;
  currency: string;
  balance: string;
  available: string;
  hold: string;
  profile_id: string;
  trading_enabled: boolean;
}

interface PortfolioData {
  accounts: CoinbaseAccount[];
  connection: {
    name: string;
    is_sandbox: boolean;
    last_sync: string;
  };
}

export const DashboardPanel = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [connections, setConnections] = useState<CoinbaseConnection[]>([]);
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [portfolioLoading, setPortfolioLoading] = useState(false);

  useEffect(() => {
    if (user) {
      fetchConnections();
    }
  }, [user]);

  useEffect(() => {
    if (connections.length > 0 && !portfolioData) {
      fetchPortfolioData();
    }
  }, [connections]);

  const fetchConnections = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('coinbase_connections')
        .select('id, connection_name, is_active, is_sandbox')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (error) throw error;
      setConnections(data || []);
    } catch (error) {
      console.error('Error fetching connections:', error);
      toast({
        title: "Error",
        description: "Failed to load Coinbase connections",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchPortfolioData = async () => {
    if (!user) return;
    
    setPortfolioLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('coinbase-portfolio', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
      });

      if (error) throw error;
      
      if (data.success) {
        setPortfolioData(data);
        toast({
          title: "Portfolio Synced",
          description: "Successfully loaded your Coinbase portfolio data",
        });
      } else {
        throw new Error(data.error || 'Failed to fetch portfolio data');
      }
    } catch (error) {
      console.error('Error fetching portfolio:', error);
      toast({
        title: "Portfolio Sync Failed",
        description: "Unable to fetch portfolio data. Please check your API configuration.",
        variant: "destructive",
      });
    } finally {
      setPortfolioLoading(false);
    }
  };

  const handleConnectCoinbase = () => {
    navigate('/admin');
  };

  // Show loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Loading dashboard...</div>
      </div>
    );
  }

  // Show empty state if no active connections
  if (connections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-slate-700/50 rounded-full flex items-center justify-center mx-auto">
            <Wallet className="w-8 h-8 text-slate-500" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-white mb-2">Connect Your Coinbase Account</h3>
            <p className="text-slate-400 max-w-md">
              To start trading and manage your portfolio, you need to connect your Coinbase account first.
            </p>
          </div>
        </div>
        
        <Button 
          onClick={handleConnectCoinbase}
          className="bg-blue-600 hover:bg-blue-700 px-6 py-3"
        >
          <Plus className="w-4 h-4 mr-2" />
          Connect Coinbase Account
        </Button>
        
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 max-w-md">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="text-amber-200 font-medium">Getting Started</p>
              <p className="text-amber-300/80">
                Once connected, you'll be able to view your portfolio, execute trades, and configure automated trading strategies.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show connected state with connection info
  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <Card className="p-6 bg-slate-700/30 border-slate-600">
        <h3 className="text-lg font-semibold text-white mb-4">Connected Accounts</h3>
        <div className="space-y-3">
          {connections.map((connection) => (
            <div key={connection.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-400" />
                <div>
                  <p className="font-medium text-white">{connection.connection_name}</p>
                  <p className="text-sm text-slate-400">
                    {connection.is_sandbox ? 'Sandbox Environment' : 'Live Trading'}
                  </p>
                </div>
              </div>
              <Badge className="bg-green-600">Connected</Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* Portfolio Data */}
      {portfolioLoading ? (
        <Card className="p-6 bg-slate-700/30 border-slate-600">
          <div className="text-center py-8">
            <Activity className="w-12 h-12 text-slate-600 mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-semibold text-white mb-2">Loading Portfolio...</h3>
            <p className="text-slate-400">Fetching your account data from Coinbase</p>
          </div>
        </Card>
      ) : portfolioData ? (
        <div className="space-y-4">
          {/* Portfolio Overview */}
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Portfolio Overview</h3>
              <Button 
                onClick={fetchPortfolioData}
                variant="outline" 
                size="sm"
                disabled={portfolioLoading}
              >
                Refresh
              </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-800/50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-5 h-5 text-green-400" />
                  <span className="text-slate-400 text-sm">Total Accounts</span>
                </div>
                <p className="text-2xl font-bold text-white">{portfolioData.accounts.length}</p>
              </div>
              
              <div className="bg-slate-800/50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-5 h-5 text-blue-400" />
                  <span className="text-slate-400 text-sm">Environment</span>
                </div>
                <p className="text-lg font-semibold text-white">
                  {portfolioData.connection.is_sandbox ? 'Sandbox' : 'Live'}
                </p>
              </div>
              
              <div className="bg-slate-800/50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-5 h-5 text-purple-400" />
                  <span className="text-slate-400 text-sm">Last Sync</span>
                </div>
                <p className="text-sm text-white">
                  {new Date(portfolioData.connection.last_sync).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Account Balances */}
            <div>
              <h4 className="text-md font-semibold text-white mb-3">Account Balances</h4>
              <div className="space-y-2">
                {portfolioData.accounts.map((account) => (
                  <div key={account.id} className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-bold">
                          {account.currency.slice(0, 2)}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-white">{account.currency}</p>
                        <p className="text-sm text-slate-400">
                          Trading: {account.trading_enabled ? 'Enabled' : 'Disabled'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-white">
                        {parseFloat(account.balance).toFixed(8)}
                      </p>
                      <p className="text-sm text-slate-400">
                        Available: {parseFloat(account.available).toFixed(8)}
                      </p>
                    </div>
                  </div>
                ))}
                
                {portfolioData.accounts.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-slate-400">No accounts found in your portfolio</p>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <Card className="p-6 bg-slate-700/30 border-slate-600 border-dashed">
          <div className="text-center py-8">
            <Activity className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-400 mb-2">Load Portfolio Data</h3>
            <p className="text-slate-500 mb-4">
              Click below to fetch your portfolio data from Coinbase
            </p>
            <Button onClick={fetchPortfolioData} disabled={portfolioLoading}>
              <Activity className="w-4 h-4 mr-2" />
              Load Portfolio
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};
