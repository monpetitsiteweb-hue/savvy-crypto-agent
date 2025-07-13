
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
  is_active: boolean;
  connected_at: string;
  last_sync: string | null;
  user_id: string;
  coinbase_user_id: string | null;
  expires_at: string | null;
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
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [lastError, setLastError] = useState<string>('');

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
        .from('user_coinbase_connections')
        .select('id, is_active, connected_at, last_sync, user_id, coinbase_user_id, expires_at')
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
      setDebugInfo('Starting portfolio fetch...');
      setLastError('');
      
      const session = await supabase.auth.getSession();
      setDebugInfo(`Session check - Has session: ${!!session.data.session}, Has token: ${!!session.data.session?.access_token}`);
      
      if (!session.data.session?.access_token) {
        throw new Error('No valid session found');
      }

      setDebugInfo('Calling coinbase-portfolio function...');
      
      // Make raw fetch call to see the actual response
      const functionUrl = `https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/coinbase-portfolio`;
      
      try {
        const rawResponse = await fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.data.session.access_token}`,
            'Content-Type': 'application/json',
          },
        });
        
        const responseText = await rawResponse.text();
        setDebugInfo(`Raw Response - Status: ${rawResponse.status}, Text: ${responseText.substring(0, 500)}`);
        
        if (!rawResponse.ok) {
          throw new Error(`HTTP ${rawResponse.status}: ${responseText}`);
        }
        
        const responseData = JSON.parse(responseText);
        if (responseData.success) {
          setPortfolioData(responseData);
          setDebugInfo('Portfolio data loaded successfully!');
          toast({
            title: "Portfolio Synced",
            description: `Successfully loaded ${responseData.accounts?.length || 0} accounts`,
          });
        } else {
          throw new Error(responseData.error || 'Function returned unsuccessful');
        }
        
      } catch (fetchError) {
        // Fallback to supabase.functions.invoke
        setDebugInfo('Raw fetch failed, trying Supabase client...');
        
        const { data, error } = await supabase.functions.invoke('coinbase-portfolio', {
          headers: {
            Authorization: `Bearer ${session.data.session.access_token}`,
          },
        });

        setDebugInfo(`Supabase Response - Data: ${data ? 'received' : 'null'}, Error: ${error ? 'yes' : 'no'}`);

        if (error) {
          const errorDetails = {
            message: error.message,
            context: error.context,
            details: error.details,
            status: error.context?.response?.status,
            statusText: error.context?.response?.statusText,
            body: error.context?.response?.body
          };
          
          const fullErrorMsg = `Supabase error: ${error.message} | Status: ${errorDetails.status} | Body: ${JSON.stringify(errorDetails.body)} | Fetch error: ${fetchError.message}`;
          setLastError(fullErrorMsg);
          throw new Error(`Function call failed: ${error.message}`);
        }
        
        if (data?.success) {
          setPortfolioData(data);
          setDebugInfo('Portfolio data loaded successfully!');
          toast({
            title: "Portfolio Synced", 
            description: `Successfully loaded ${data.accounts?.length || 0} accounts`,
          });
        } else {
          const errorMsg = data?.error || 'Failed to fetch portfolio data';
          setLastError(`Portfolio fetch failed: ${errorMsg}`);
          throw new Error(errorMsg);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setLastError(`Catch block: ${errorMessage}`);
      setDebugInfo('Error occurred during portfolio fetch');
      toast({
        title: "Portfolio Sync Failed",
        description: `Unable to fetch portfolio data: ${errorMessage}`,
        variant: "destructive",
      });
    } finally {
      setPortfolioLoading(false);
    }
  };

  const handleConnectCoinbase = async () => {
    if (!user) return;
    
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session?.access_token) {
        throw new Error('No valid session found');
      }

      const { data, error } = await supabase.functions.invoke('coinbase-oauth', {
        headers: {
          Authorization: `Bearer ${session.data.session.access_token}`,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data?.success && data?.oauth_url) {
        // Redirect to Coinbase OAuth
        window.location.href = data.oauth_url;
      } else {
        throw new Error('Failed to generate OAuth URL');
      }
    } catch (error) {
      console.error('OAuth initiation error:', error);
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : 'Failed to start OAuth flow',
        variant: "destructive",
      });
    }
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
                  <p className="font-medium text-white">Coinbase Connection</p>
                  <p className="text-sm text-slate-400">
                    Connected: {new Date(connection.connected_at).toLocaleDateString()}
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
            
            {/* Debug Information */}
            {(debugInfo || lastError) && (
              <div className="mt-6 space-y-2">
                {debugInfo && (
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                    <p className="text-sm text-blue-200 font-medium">Debug Info:</p>
                    <p className="text-sm text-blue-300">{debugInfo}</p>
                  </div>
                )}
                {lastError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                    <p className="text-sm text-red-200 font-medium">Last Error:</p>
                    <p className="text-sm text-red-300 break-words">{lastError}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};
