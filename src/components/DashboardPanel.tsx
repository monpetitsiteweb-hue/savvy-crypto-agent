
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, AlertCircle, Wallet, Plus, Settings, Trash2, Terminal } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { CoinbaseConnectionSelector } from './CoinbaseConnectionSelector';

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
  const [showConnectionSelector, setShowConnectionSelector] = useState(false);
  const [editingConnection, setEditingConnection] = useState<CoinbaseConnection | null>(null);
  const [editApiKey, setEditApiKey] = useState('');
  const [editApiSecret, setEditApiSecret] = useState('');

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
        console.log('Making fetch request to:', functionUrl);
        const rawResponse = await fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.data.session.access_token}`,
            'Content-Type': 'application/json',
          },
        });
        
        console.log('Raw response status:', rawResponse.status);
        console.log('Raw response headers:', Object.fromEntries(rawResponse.headers.entries()));
        
        const responseText = await rawResponse.text();
        console.log('Raw response text:', responseText);
        
        setDebugInfo(`Raw Response - Status: ${rawResponse.status}, Text: ${responseText.substring(0, 500)}`);
        
        if (!rawResponse.ok) {
          console.error('Response not OK:', rawResponse.status, responseText);
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
          
          console.log('Full error details:', errorDetails);
          
          // Show detailed error in debug panel
          setDebugInfo(`Edge Function Error Details:
Status: ${errorDetails.status || 'unknown'}
Status Text: ${errorDetails.statusText || 'unknown'}
Body: ${JSON.stringify(errorDetails.body, null, 2)}
Original Fetch Error: ${fetchError.message}`);
          
          const fullErrorMsg = `Coinbase API Issue - Status: ${errorDetails.status} | Error: ${error.message}`;
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

  const handleDeleteConnection = async (connectionId: string) => {
    if (!user) return;
    
    try {
      const { error } = await supabase
        .from('user_coinbase_connections')
        .delete()
        .eq('id', connectionId)
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: "Connection Deleted",
        description: "Coinbase connection removed successfully",
      });

      fetchConnections();
      setPortfolioData(null);
    } catch (error) {
      console.error('Error deleting connection:', error);
      toast({
        title: "Error",
        description: "Failed to delete connection",
        variant: "destructive",
      });
    }
  };

  const handleUpdateApiConnection = async () => {
    if (!editingConnection || !editApiKey.trim() || !editApiSecret.trim()) {
      toast({
        title: "Missing Information",
        description: "Please provide both API key and secret",
        variant: "destructive",
      });
      return;
    }
    
    try {
      const { error } = await supabase
        .from('user_coinbase_connections')
        .update({
          access_token_encrypted: editApiKey,
          refresh_token_encrypted: editApiSecret,
        })
        .eq('id', editingConnection.id)
        .eq('user_id', user!.id);

      if (error) throw error;

      toast({
        title: "Connection Updated",
        description: "API credentials updated successfully",
      });

      setEditingConnection(null);
      setEditApiKey('');
      setEditApiSecret('');
      fetchConnections();
    } catch (error) {
      console.error('Error updating connection:', error);
      toast({
        title: "Error",
        description: "Failed to update API credentials",
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

  // Show connection selector if requested or no connections
  if (connections.length === 0 || showConnectionSelector) {
    return (
      <CoinbaseConnectionSelector 
        onConnectionEstablished={() => {
          fetchConnections();
          setShowConnectionSelector(false);
        }} 
      />
    );
  }

  // Show connected state with connection info
  return (
    <div className="space-y-6">
      {/* Debug Panel - Show console messages in UI for iPad */}
      <Card className="border-amber-200 bg-amber-50">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Terminal className="h-5 w-5 text-amber-700" />
            <h3 className="text-lg font-semibold text-amber-800">Debug Console (iPad View)</h3>
          </div>
          <div className="space-y-2">
            {debugInfo && (
              <div className="bg-blue-100 p-3 rounded text-sm font-mono">
                <strong>Status:</strong> {debugInfo}
              </div>
            )}
            {lastError && (
              <div className="bg-red-100 p-3 rounded text-sm font-mono">
                <strong>Error:</strong> {lastError}
              </div>
            )}
            <div className="text-xs text-gray-600">
              This panel shows debug information that would normally appear in browser console.
            </div>
          </div>
        </div>
      </Card>

      {/* Connection Status */}
      <Card className="p-6 bg-slate-700/30 border-slate-600">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Connected Accounts</h3>
          <Button 
            onClick={() => setShowConnectionSelector(true)}
            variant="outline" 
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Connection
          </Button>
        </div>
        <div className="space-y-3">
          {connections.map((connection) => {
            const isApiConnection = connection.coinbase_user_id === 'api_user';
            return (
              <div key={connection.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                  <div>
                    <p className="font-medium text-white">
                      {isApiConnection ? 'Coinbase API Keys' : 'Coinbase OAuth'}
                    </p>
                    <p className="text-sm text-slate-400">
                      Connected: {new Date(connection.connected_at).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-slate-500">
                      Method: {isApiConnection ? 'API Keys' : 'OAuth Token'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-600">Connected</Badge>
                  
                  {isApiConnection && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            setEditingConnection(connection);
                            setEditApiKey('');
                            setEditApiSecret('');
                          }}
                        >
                          <Settings className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="bg-slate-800 border-slate-600">
                        <DialogHeader>
                          <DialogTitle className="text-white">Edit API Connection</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="edit-api-key" className="text-white">API Key</Label>
                            <Input
                              id="edit-api-key"
                              type="password"
                              placeholder="Enter new API key"
                              value={editApiKey}
                              onChange={(e) => setEditApiKey(e.target.value)}
                              className="bg-slate-700 border-slate-600 text-white"
                            />
                          </div>
                          <div>
                            <Label htmlFor="edit-api-secret" className="text-white">API Secret</Label>
                            <Input
                              id="edit-api-secret"
                              type="password"
                              placeholder="Enter new API secret"
                              value={editApiSecret}
                              onChange={(e) => setEditApiSecret(e.target.value)}
                              className="bg-slate-700 border-slate-600 text-white"
                            />
                          </div>
                          <Button 
                            onClick={handleUpdateApiConnection}
                            disabled={!editApiKey.trim() || !editApiSecret.trim()}
                            className="w-full"
                          >
                            Update API Credentials
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}
                  
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => handleDeleteConnection(connection.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
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
