import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMockWallet } from "@/hooks/useMockWallet";
import { useTestMode } from "@/hooks/useTestMode";
import { useAuth } from "@/hooks/useAuth";
import { useRealTimeMarketData } from "@/hooks/useRealTimeMarketData";
import { supabase } from '@/integrations/supabase/client';
import { Wallet, TrendingUp, TrendingDown, RefreshCw, Loader2, TestTube, DollarSign } from "lucide-react";

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

export const UnifiedPortfolioDisplay = () => {
  const { testMode } = useTestMode();
  const { user } = useAuth();
  const { balances, getTotalValue, refreshFromDatabase, isLoading } = useMockWallet();
  const { getCurrentData } = useRealTimeMarketData();
  
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [fetchingPortfolio, setFetchingPortfolio] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [connections, setConnections] = useState<any[]>([]);
  const [realTimePrices, setRealTimePrices] = useState<{[key: string]: number}>({});

  // Fetch real-time prices for all displayed cryptocurrencies
  useEffect(() => {
    const updateRealTimePrices = async () => {
      try {
        const data = await getCurrentData(['BTC-EUR', 'ETH-EUR', 'XRP-EUR']);
        
        const prices: {[key: string]: number} = { EUR: 1 };
        
        if (data['BTC-EUR']?.price) {
          prices.BTC = data['BTC-EUR'].price;
        }
        if (data['ETH-EUR']?.price) {
          prices.ETH = data['ETH-EUR'].price;
        }
        if (data['XRP-EUR']?.price) {
          prices.XRP = data['XRP-EUR'].price;
        }
        
        setRealTimePrices(prices);
      } catch (error) {
        console.error('Error fetching real-time prices:', error);
      }
    };

    updateRealTimePrices();
    const interval = setInterval(updateRealTimePrices, 30000); // Update every 30 seconds
    
    return () => clearInterval(interval);
  }, [getCurrentData]);

  // Fetch connections for production mode
  useEffect(() => {
    if (!testMode && user) {
      fetchConnections();
    }
  }, [testMode, user]);

  // Auto-refresh portfolio when balances change in test mode
  useEffect(() => {
    if (testMode && balances.length > 0) {
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

      setPortfolioData({ accounts: mockAccounts });
    }
  }, [balances, testMode]);

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
      
      // Auto-select first connection if none selected
      const savedConnectionId = localStorage.getItem(`selectedConnection_${user.id}`);
      if (savedConnectionId && data?.find(c => c.id === savedConnectionId)) {
        setSelectedConnectionId(savedConnectionId);
      } else if (data && data.length > 0) {
        const firstConnectionId = data[0].id;
        setSelectedConnectionId(firstConnectionId);
        localStorage.setItem(`selectedConnection_${user.id}`, firstConnectionId);
      }
    } catch (error) {
      console.error('Error fetching connections:', error);
    }
  };

  const fetchProductionPortfolio = async () => {
    if (!selectedConnectionId) return;

    setFetchingPortfolio(true);
    try {
      const session = await supabase.auth.getSession();
      const response = await fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/coinbase-portfolio', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ connectionId: selectedConnectionId }),
      });
      
      const data = await response.json();
      if (!data.error) {
        setPortfolioData(data);
      }
    } catch (error) {
      console.error('Production portfolio fetch error:', error);
    } finally {
      setFetchingPortfolio(false);
    }
  };

  const getTotalPortfolioValue = () => {
    if (testMode) {
      return getTotalValue();
    } else if (portfolioData?.accounts) {
      // Calculate total value from production portfolio using real-time prices
      return portfolioData.accounts.reduce((total, account) => {
        const amount = parseFloat(account.available_balance?.value || '0');
        if (account.currency === 'EUR') {
          return total + amount;
        } else {
          const price = realTimePrices[account.currency] || 0;
          return total + (amount * price);
        }
      }, 0);
    }
    return 0;
  };

  const renderCoinCard = (account: any) => {
    const amount = parseFloat(account.available_balance?.value || '0');
    const currency = account.currency;
    const currentPrice = realTimePrices[currency] || 0;
    const valueInEur = currency === 'EUR' ? amount : amount * currentPrice;

    return (
      <Card key={account.uuid} className="p-4 bg-slate-700/50 border-slate-600">
        <div className="space-y-3">
          {/* Euro Value (Primary) */}
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-slate-300">{currency}</span>
            <div className="text-right">
              <div className="text-lg font-bold text-white">
                €{valueInEur.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
              {currency !== 'EUR' && (
                <div className="text-xs text-slate-400">
                  {amount.toLocaleString(undefined, {
                    maximumFractionDigits: currency === 'XRP' ? 0 : 6
                  })} {currency}
                </div>
              )}
            </div>
          </div>
          
          {/* Real-time Price */}
          {currency !== 'EUR' && (
            <div className="flex justify-between items-center pt-2 border-t border-slate-600/50">
              <span className="text-xs text-slate-400">Current Price:</span>
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-green-400">
                  €{currentPrice.toFixed(currency === 'XRP' ? 4 : 2)}
                </span>
                {Math.random() > 0.5 ? (
                  <TrendingUp className="h-3 w-3 text-green-400" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-400" />
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <Card className={`${testMode ? 'border-orange-500/20' : 'border-blue-500/20'} bg-slate-800/50 border-slate-600`}>
      <CardHeader className="pb-3">
        {/* FORCED VERTICAL LAYOUT */}
        <div className="flex flex-col gap-4 w-full">
          {/* Title Row */}
          <div className="w-full">
            <CardTitle className={`flex items-center gap-2 ${testMode ? 'text-orange-400' : 'text-blue-400'}`}>
              {testMode ? <TestTube className="h-5 w-5" /> : <DollarSign className="h-5 w-5" />}
              {testMode ? 'Test Portfolio' : 'Live Portfolio'}
              <Badge variant="secondary" className={`${testMode ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'}`}>
                {testMode ? 'Mock Data' : 'Live Data'}
              </Badge>
            </CardTitle>
          </div>
          
          {/* Dropdown Row */}
          {!testMode && connections.length > 0 && (
            <div className="w-full">
              <select
                value={selectedConnectionId}
                onChange={(e) => {
                  setSelectedConnectionId(e.target.value);
                  localStorage.setItem(`selectedConnection_${user?.id}`, e.target.value);
                }}
                className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 text-sm"
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.api_name_encrypted || 'Coinbase Account'}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          {/* Button Row */}
          <div className="w-full">
            <Button
              variant="default"
              size="sm"
              onClick={testMode ? refreshFromDatabase : fetchProductionPortfolio}
              disabled={isLoading || fetchingPortfolio || (!testMode && !selectedConnectionId)}
              className={`w-full ${testMode ? "bg-orange-600 hover:bg-orange-700" : "bg-blue-600 hover:bg-blue-700"} text-white`}
            >
              {(isLoading || fetchingPortfolio) ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh Portfolio
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          {(isLoading || fetchingPortfolio) && (
            <div className="flex justify-center items-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              <span className="ml-2 text-blue-400">
                {testMode ? 'Syncing with trades...' : 'Fetching live portfolio...'}
              </span>
            </div>
          )}
          
          {/* Total Portfolio Value */}
          <div className="flex justify-between items-center p-4 bg-slate-700/50 rounded-lg border border-slate-600/50">
            <span className="font-medium text-white">Total Portfolio Value</span>
            <span className="text-2xl font-bold text-green-400">
              €{getTotalPortfolioValue().toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
          
          {/* Portfolio Breakdown */}
          {portfolioData?.accounts && portfolioData.accounts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {portfolioData.accounts.map(renderCoinCard)}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-slate-300">
                {testMode 
                  ? 'No test portfolio data available. Start trading to see balances.'
                  : 'No portfolio data available. Select a connection and refresh.'
                }
              </p>
            </div>
          )}

          {/* Real-time sync indicator */}
          {testMode && (
            <div className="text-xs text-slate-400 text-center mt-2">
              💫 Real-time prices • Updates automatically after trades
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};