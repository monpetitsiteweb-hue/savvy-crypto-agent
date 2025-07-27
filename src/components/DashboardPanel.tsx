import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { CoinbaseConnectionSelector } from './CoinbaseConnectionSelector';
import { UnifiedPortfolioDisplay } from './UnifiedPortfolioDisplay';
import { useMockWallet } from '@/hooks/useMockWallet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Trash2, Edit, Plus, RefreshCw, TestTube } from 'lucide-react';

interface Connection {
  id: string;
  api_name_encrypted: string;
  connected_at: string;
  is_active: boolean;
}

interface PortfolioData {
  accounts?: Array<{
    uuid: string;
    name: string;
    currency: string;
    available_balance?: {
      value: string;
      currency: string;
    };
    hold?: {
      value: string;
      currency: string;
    };
  }>;
}

export const DashboardPanel = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { testMode } = useTestMode();
  const { balances } = useMockWallet();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnectionSelector, setShowConnectionSelector] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [fetchingPortfolio, setFetchingPortfolio] = useState(false);

  // Load saved portfolio data and selected connection from localStorage on mount
  useEffect(() => {
    if (user) {
      const savedConnectionId = localStorage.getItem(`selectedConnection_${user.id}`);
      
      if (savedConnectionId) {
        setSelectedConnectionId(savedConnectionId);
      }
      
      fetchConnections();
    }
  }, [user, testMode]);

  // Auto-refresh portfolio when balances change in test mode
  useEffect(() => {
    if (testMode && balances && Array.isArray(balances) && balances.length > 0) {
      const mockAccounts = balances.map(balance => ({
        uuid: `mock-${balance.currency.toLowerCase()}-account`,
        name: `${balance.currency} Wallet`,
        currency: balance.currency,
        available_balance: {
          value: balance.amount.toFixed(balance.currency === 'EUR' ? 2 : 8),
          currency: balance.currency
        },
        hold: {
          value: '0',
          currency: balance.currency
        }
      }));

      const mockData = { accounts: mockAccounts };
      setPortfolioData(mockData);
      
      if (user) {
        localStorage.setItem(`testPortfolio_${user.id}`, JSON.stringify(mockData));
      }
    }
  }, [balances, testMode, user]);

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
      
      // Auto-select first connection if none selected and no saved selection
      if (data && Array.isArray(data) && data.length > 0 && !selectedConnectionId) {
        const firstConnectionId = data[0].id;
        setSelectedConnectionId(firstConnectionId);
        localStorage.setItem(`selectedConnection_${user.id}`, firstConnectionId);
      }
    } catch (error) {
      console.error('Error fetching connections:', error);
      toast({
        title: "Error",
        description: "Failed to load connections",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const generateMockPortfolioData = (): PortfolioData => {
    const mockAccounts = [
      {
        uuid: 'mock-btc-account',
        name: 'Bitcoin Wallet',
        currency: 'BTC',
        available_balance: {
          value: (Math.random() * 2 + 0.5).toFixed(8),
          currency: 'BTC'
        },
        hold: {
          value: (Math.random() * 0.1).toFixed(8),
          currency: 'BTC'
        }
      },
      {
        uuid: 'mock-eth-account',
        name: 'Ethereum Wallet',
        currency: 'ETH',
        available_balance: {
          value: (Math.random() * 10 + 2).toFixed(6),
          currency: 'ETH'
        },
        hold: {
          value: (Math.random() * 0.5).toFixed(6),
          currency: 'ETH'
        }
      },
      {
        uuid: 'mock-usd-account',
        name: 'USD Wallet',
        currency: 'USD',
        available_balance: {
          value: (Math.random() * 5000 + 1000).toFixed(2),
          currency: 'USD'
        },
        hold: {
          value: (Math.random() * 100).toFixed(2),
          currency: 'USD'
        }
      },
      {
        uuid: 'mock-ada-account',
        name: 'Cardano Wallet',
        currency: 'ADA',
        available_balance: {
          value: (Math.random() * 1000 + 100).toFixed(2),
          currency: 'ADA'
        },
        hold: {
          value: (Math.random() * 50).toFixed(2),
          currency: 'ADA'
        }
      }
    ];

    return { accounts: mockAccounts };
  };

  const fetchPortfolio = async (connectionId?: string) => {
    const targetConnectionId = connectionId || selectedConnectionId;
    if (!targetConnectionId && !testMode) {
      toast({
        title: "No Connection Selected",
        description: "Please select a connection to fetch portfolio data",
        variant: "destructive",
      });
      return;
    }

    setFetchingPortfolio(true);
    try {
      if (testMode) {
        // Use real wallet data from mock trades
        const mockAccounts = balances.map(balance => ({
          uuid: `mock-${balance.currency.toLowerCase()}-account`,
          name: `${balance.currency} Wallet`,
          currency: balance.currency,
          available_balance: {
            value: balance.amount.toFixed(balance.currency === 'EUR' ? 2 : 8),
            currency: balance.currency
          },
          hold: {
            value: '0',
            currency: balance.currency
          }
        }));

        const mockData = { accounts: mockAccounts };
        setPortfolioData(mockData);
        
        // Save mock data to localStorage with test mode prefix
        if (user) {
          localStorage.setItem(`testPortfolio_${user.id}`, JSON.stringify(mockData));
        }
        
        toast({
          title: "Portfolio Refreshed",
          description: "Portfolio updated with latest trading data",
        });
      } else {
        // Real Coinbase API call
        const session = await supabase.auth.getSession();
        const response = await fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/coinbase-portfolio', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.data.session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ connectionId: targetConnectionId }),
        });
        
        const data = await response.json();
        console.log('Portfolio response:', data);
        
        if (data.error) {
          toast({
            title: "Portfolio Fetch Failed",
            description: data.error,
            variant: "destructive",
          });
        } else {
          setPortfolioData(data);
          // Save portfolio data to localStorage
          if (user) {
            localStorage.setItem(`portfolio_${user.id}`, JSON.stringify(data));
          }
        }
      }
    } catch (error) {
      console.error('Portfolio fetch error:', error);
      toast({
        title: "Portfolio Fetch Failed",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
    } finally {
      setFetchingPortfolio(false);
    }
  };

  const deleteConnection = async (connectionId: string) => {
    try {
      const { error } = await supabase
        .from('user_coinbase_connections')
        .update({ is_active: false })
        .eq('id', connectionId);

      if (error) throw error;
      
      await fetchConnections();
      if (selectedConnectionId === connectionId) {
        setSelectedConnectionId('');
        setPortfolioData(null);
        // Clear saved data when connection is deleted
        if (user) {
          localStorage.removeItem(`portfolio_${user.id}`);
          localStorage.removeItem(`testPortfolio_${user.id}`);
          localStorage.removeItem(`selectedConnection_${user.id}`);
        }
      }
      
      toast({
        title: "Connection Removed",
        description: "Connection has been deactivated",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to remove connection",
        variant: "destructive",
      });
    }
  };

  const editConnection = (connectionId: string) => {
    // Find the connection and allow editing the API name
    const connection = connections.find(c => c.id === connectionId);
    if (connection) {
      const newName = prompt("Enter new connection name:", connection.api_name_encrypted || "");
      if (newName && newName !== connection.api_name_encrypted) {
        updateConnectionName(connectionId, newName);
      }
    }
  };

  const updateConnectionName = async (connectionId: string, newName: string) => {
    try {
      const { error } = await supabase
        .from('user_coinbase_connections')
        .update({ api_name_encrypted: newName })
        .eq('id', connectionId);

      if (error) throw error;

      toast({
        title: "Connection Updated",
        description: "Connection name updated successfully",
      });
      
      fetchConnections(); // Refresh the list
    } catch (error) {
      console.error('Error updating connection:', error);
      toast({
        title: "Error",
        description: "Failed to update connection name",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (showConnectionSelector) {
    return (
      <CoinbaseConnectionSelector 
        onConnectionEstablished={() => {
          fetchConnections();
          setShowConnectionSelector(false);
        }} 
      />
    );
  }

  return (
    <div className="space-y-6">
      <UnifiedPortfolioDisplay />
      
      {/* Connections Management */}
      <Card className="p-6 bg-slate-800/50 border-slate-600">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Coinbase Connections</h3>
          <Button onClick={() => setShowConnectionSelector(true)} size="sm" className="bg-blue-500 hover:bg-blue-600">
            <Plus className="h-4 w-4 mr-2" />
            Add Connection
          </Button>
        </div>
        
        {!connections || connections.length === 0 ? (
          <p className="text-slate-300">No connections found. Add your first connection to get started.</p>
        ) : (
          <div className="space-y-3">
            {connections.map((connection) => (
              <div key={connection.id} className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg border border-slate-600/50">
                <div className="flex items-center space-x-3">
                  <Badge variant="secondary" className="bg-green-500/20 text-green-400 border-green-500/30">
                    {connection.api_name_encrypted || 'Coinbase Connection'}
                  </Badge>
                  <span className="text-sm text-slate-300">
                    Connected {new Date(connection.connected_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => editConnection(connection.id)}
                    className="border-slate-500 text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteConnection(connection.id)}
                    className="border-red-500/50 text-red-400 hover:bg-red-500/20 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Portfolio Selection & Display */}
      {connections.length > 0 && (
        <Card className="p-6 bg-slate-800/50 border-slate-600">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <h3 className="text-lg font-semibold text-white">Portfolio Dashboard</h3>
              {testMode && (
                <Badge variant="secondary" className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                  <TestTube className="h-3 w-3 mr-1" />
                  Test Mode
                </Badge>
              )}
            </div>
            <div className="flex items-center space-x-3">
              {!testMode && (
                <Select 
                  value={selectedConnectionId} 
                  onValueChange={(value) => {
                    setSelectedConnectionId(value);
                    // Save selected connection to localStorage
                    if (user) {
                      localStorage.setItem(`selectedConnection_${user.id}`, value);
                    }
                  }}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select connection" />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.api_name_encrypted || 'Coinbase Account'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button 
                onClick={() => fetchPortfolio()} 
                disabled={(!selectedConnectionId && !testMode) || fetchingPortfolio}
                className="bg-blue-500 hover:bg-blue-600"
              >
                {fetchingPortfolio ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {testMode ? 'Generate Test Portfolio' : 'Fetch Portfolio'}
              </Button>
            </div>
          </div>

          {/* Portfolio Data Display */}
          {portfolioData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {portfolioData.accounts?.map((account) => (
                  <Card key={account.uuid} className="p-4 bg-slate-700/50 border-slate-600">
                    <h4 className="font-medium text-white mb-3">{account.name}</h4>
                    <div className="text-sm space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-300">Currency:</span>
                        <span className="text-white font-medium">{account.currency}</span>
                      </div>
                      {account.available_balance && (
                        <div className="flex justify-between">
                          <span className="text-slate-300">Available:</span>
                          <span className="text-green-400 font-medium">
                            {account.available_balance.value} {account.available_balance.currency}
                          </span>
                        </div>
                      )}
                      {account.hold && parseFloat(account.hold.value) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-300">On Hold:</span>
                          <span className="text-yellow-400 font-medium">
                            {account.hold.value} {account.hold.currency}
                          </span>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
              
              {portfolioData.accounts && portfolioData.accounts.length === 0 && (
                <p className="text-slate-300 text-center py-8">No accounts found in your portfolio.</p>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-slate-300 mb-4">
                {testMode 
                  ? 'Click "Generate Test Portfolio" to create mock data for testing'
                  : 'Select a connection and click "Fetch Portfolio" to view your data'
                }
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};