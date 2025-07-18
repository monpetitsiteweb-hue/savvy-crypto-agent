import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TestTube, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { useMockWallet } from '@/hooks/useMockWallet';
import { useRealTimeMarketData } from '@/hooks/useRealTimeMarketData';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface PortfolioData {
  accounts: Array<{
    uuid: string;
    name: string;
    currency: string;
    available_balance: {
      value: string;
      currency: string;
    };
  }>;
}

interface Connection {
  id: string;
  api_name_encrypted: string;
  connected_at: string;
}

export const MergedPortfolioDisplay = () => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { balances: mockBalances } = useMockWallet();
  const { marketData, getCurrentData } = useRealTimeMarketData();
  
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [realTimePrices, setRealTimePrices] = useState<Record<string, number>>({});

  // Fetch connections for production mode
  useEffect(() => {
    if (!testMode && user) {
      fetchConnections();
    }
  }, [testMode, user]);

  // In test mode, use mock wallet data
  useEffect(() => {
    if (testMode && mockBalances && mockBalances.length > 0) {
      const mockPortfolio: PortfolioData = {
        accounts: mockBalances.map((balance) => ({
          uuid: `mock-${balance.currency}`,
          name: `${balance.currency} Wallet`,
          currency: balance.currency,
          available_balance: {
            value: balance.amount.toString(),
            currency: balance.currency
          }
        }))
      };
      setPortfolioData(mockPortfolio);
    }
  }, [testMode, mockBalances]);

  // Fetch real-time prices every 30 seconds
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const response = await getCurrentData(['BTC-EUR', 'ETH-EUR', 'XRP-EUR']);
        const prices: Record<string, number> = {};
        
        Object.entries(response).forEach(([symbol, data]) => {
          const currency = symbol.split('-')[0];
          prices[currency] = data.price;
        });
        
        setRealTimePrices(prices);
      } catch (error) {
        console.error('Error fetching real-time prices:', error);
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, [getCurrentData]);

  const fetchConnections = async () => {
    try {
      const { data, error } = await supabase
        .from('user_coinbase_connections')
        .select('id, api_name_encrypted, connected_at')
        .eq('user_id', user?.id)
        .eq('is_active', true);

      if (error) throw error;

      setConnections(data || []);
      
      // Auto-select first connection if none selected
      if (data && data.length > 0 && !selectedConnectionId) {
        setSelectedConnectionId(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching connections:', error);
    }
  };

  const fetchProductionPortfolio = async () => {
    if (!selectedConnectionId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('coinbase-portfolio', {
        body: { connectionId: selectedConnectionId }
      });

      if (error) throw error;
      setPortfolioData(data);
    } catch (error) {
      console.error('Error fetching portfolio:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTotalPortfolioValue = () => {
    if (!portfolioData) return 0;
    
    return portfolioData.accounts.reduce((total, account) => {
      const balance = parseFloat(account.available_balance.value);
      const currency = account.currency;
      
      if (currency === 'EUR') {
        return total + balance;
      }
      
      // Convert crypto to EUR using real-time prices
      const price = realTimePrices[currency] || 0;
      return total + (balance * price);
    }, 0);
  };

  const renderCoinCard = (account: any) => {
    const balance = parseFloat(account.available_balance.value);
    const currency = account.currency;
    const price = realTimePrices[currency] || 0;
    const eurValue = currency === 'EUR' ? balance : balance * price;

    return (
      <Card key={account.uuid} className="p-4 bg-slate-700/30 border-slate-600">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-white">{currency}</h4>
            {currency !== 'EUR' && (
              <div className="flex items-center gap-1">
                {marketData[`${currency}-EUR`] && (
                  <>
                    <span className="text-xs text-slate-400">
                      €{price.toFixed(2)}
                    </span>
                    <TrendingUp className="h-3 w-3 text-green-400" />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-400 text-sm">Balance:</span>
            <span className="text-white font-medium">
              {balance.toFixed(8)} {currency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 text-sm">EUR Value:</span>
            <span className="text-green-400 font-medium">
              €{eurValue.toFixed(2)}
            </span>
          </div>
        </div>
      </Card>
    );
  };

  return (
    <Card className={`p-6 bg-slate-800/50 border-slate-600 ${testMode ? "border-orange-500/20" : ""}`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-white">Portfolio</h3>
          {testMode && (
            <Badge variant="secondary" className="bg-orange-500/20 text-orange-400 border-orange-500/30">
              <TestTube className="h-3 w-3 mr-1" />
              Test Mode
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          {!testMode && connections.length > 0 && (
            <Select 
              value={selectedConnectionId} 
              onValueChange={setSelectedConnectionId}
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
          
          {!testMode && (
            <Button 
              onClick={fetchProductionPortfolio}
              disabled={!selectedConnectionId || loading}
              size="sm"
              className="bg-blue-500 hover:bg-blue-600"
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh
            </Button>
          )}
        </div>
      </div>

      {/* Total Portfolio Value */}
      <div className="mb-6 p-4 bg-slate-700/30 rounded-lg border border-slate-600">
        <div className="text-center">
          <p className="text-slate-400 text-sm mb-1">Total Portfolio Value</p>
          <p className="text-3xl font-bold text-white">
            €{getTotalPortfolioValue().toFixed(2)}
          </p>
        </div>
      </div>

      {/* Portfolio Holdings */}
      {loading ? (
        <div className="text-center py-8">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-slate-400" />
          <p className="text-slate-400">Loading portfolio data...</p>
        </div>
      ) : portfolioData && portfolioData.accounts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {portfolioData.accounts.map(renderCoinCard)}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-slate-400">
            {testMode 
              ? 'No test portfolio data available. Execute some trades to see your portfolio.'
              : 'No portfolio data available. Please select a connection and refresh.'
            }
          </p>
        </div>
      )}
    </Card>
  );
};