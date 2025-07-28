import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TestTube, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { useMockWallet } from '@/hooks/useMockWallet';
import { useRealTimeMarketData } from '@/hooks/useRealTimeMarketData';
import { usePersistentDashboardData } from '@/hooks/usePersistentDashboardData';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NoActiveStrategyState } from './NoActiveStrategyState';
import { formatEuro } from '@/utils/currencyFormatter';

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

interface MergedPortfolioDisplayProps {
  hasActiveStrategy: boolean;
  onCreateStrategy?: () => void;
}

export const MergedPortfolioDisplay = ({ hasActiveStrategy, onCreateStrategy }: MergedPortfolioDisplayProps) => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { balances: mockBalances } = useMockWallet();
  const { marketData, getCurrentData } = useRealTimeMarketData();
  const { portfolioData, updatePortfolioData, shouldRefresh } = usePersistentDashboardData();
  
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

  // In test mode, use mock wallet data - prevent infinite loops
  useEffect(() => {
    console.log('🧪 MergedPortfolioDisplay: Test mode:', testMode, 'Mock balances:', mockBalances);
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
      console.log('📊 MergedPortfolioDisplay: Updating portfolio data with:', mockPortfolio);
      updatePortfolioData(mockPortfolio);
    }
  }, [testMode, mockBalances]); // Removed updatePortfolioData to prevent infinite loop

  // Fetch real-time prices every 60 seconds (less frequent to avoid rate limiting)
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        console.log('🔄 MergedPortfolioDisplay: Fetching prices...');
        const response = await getCurrentData(['BTC-EUR', 'ETH-EUR', 'XRP-EUR']);
        console.log('📊 MergedPortfolioDisplay: Got response:', response);
        const prices: Record<string, number> = {};
        
        Object.entries(response).forEach(([symbol, data]) => {
          const currency = symbol.split('-')[0];
          prices[currency] = data.price;
        });
        
        console.log('💰 MergedPortfolioDisplay: Setting prices:', prices);
        setRealTimePrices(prices);
      } catch (error) {
        console.error('❌ MergedPortfolioDisplay: Error fetching real-time prices:', error);
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 60000); // 60 seconds to avoid rate limiting
    return () => clearInterval(interval);
  }, []); // Removed getCurrentData to prevent infinite loop

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

  const fetchProductionPortfolio = async (force = false) => {
    if (!selectedConnectionId) return;
    
    // Don't fetch if we have recent data unless forced
    if (!force && !shouldRefresh()) return;
    
    setLoading(true);
    try {
      console.log('🔄 MergedPortfolio: Fetching portfolio with connection:', selectedConnectionId);
      
      const { data, error } = await supabase.functions.invoke('coinbase-portfolio', {
        body: { connectionId: selectedConnectionId }
      });

      console.log('📊 MergedPortfolio: Portfolio response:', { data, error });

      if (error) {
        console.error('❌ MergedPortfolio: Supabase function error:', error);
        throw error;
      }

      if (data?.error) {
        console.error('❌ MergedPortfolio: API error:', data.error);
        throw new Error(data.error);
      }

      if (data?.needsReconnection) {
        console.warn('🔑 MergedPortfolio: Authentication expired, user needs to reconnect');
        // Could trigger a toast or modal here to inform user
        return;
      }

      updatePortfolioData(data);
      console.log('✅ MergedPortfolio: Portfolio data updated successfully');
    } catch (error) {
      console.error('❌ MergedPortfolio: Error fetching portfolio:', error);
      // Don't throw the error to prevent white screen
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on mount or when connection changes if we need fresh data
  useEffect(() => {
    if (!testMode && selectedConnectionId && shouldRefresh()) {
      fetchProductionPortfolio();
    }
  }, [selectedConnectionId, testMode]); // Removed shouldRefresh to prevent infinite loop

  const getTotalPortfolioValue = () => {
    if (!portfolioData) return 0;
    
    return portfolioData.accounts.reduce((total, account) => {
      const balance = parseFloat(account.available_balance?.value || '0');
      // Handle currency as either string or object
      const currency = typeof account.currency === 'string' ? account.currency : (account.currency as any)?.code || (account.currency as any)?.name || 'Unknown';
      
      if (currency === 'EUR') {
        return total + balance;
      }
      
      // Convert crypto to EUR using real-time prices
      const price = realTimePrices[currency] || 0;
      return total + (balance * price);
    }, 0);
  };

  const renderCoinCard = (account: any) => {
    const balance = parseFloat(account.available_balance?.value || '0');
    // Handle currency as either string or object
    const currency = typeof account.currency === 'string' ? account.currency : (account.currency as any)?.code || (account.currency as any)?.name || 'Unknown';
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
                      {formatEuro(price)}
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
              {currency === 'EUR' ? balance.toFixed(2) : balance.toFixed(4)} {currency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 text-sm">EUR Value:</span>
            <span className="text-green-400 font-medium">
              {formatEuro(eurValue)}
            </span>
          </div>
        </div>
      </Card>
    );
  };

  // Portfolio is always visible regardless of strategy status

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
              onClick={() => fetchProductionPortfolio(true)}
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
            {formatEuro(getTotalPortfolioValue())}
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