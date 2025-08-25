import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMockWallet } from "@/hooks/useMockWallet";
import { useTestMode } from "@/hooks/useTestMode";
import { useAuth } from "@/hooks/useAuth";
import { useRealTimeMarketData } from "@/hooks/useRealTimeMarketData";
import { supabase } from '@/integrations/supabase/client';
import { Wallet, TrendingUp, TrendingDown, RefreshCw, Loader2, TestTube, DollarSign, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { calculateValuation, checkIntegrity, type ValuationInputs } from "@/utils/valuationService";
import { CorruptionWarning } from "@/components/CorruptionWarning";

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

interface PositionData {
  symbol: string;
  amount: number;
  entry_price: number;
  purchase_value: number;
  is_corrupted?: boolean;
  integrity_reason?: string;
}

export const UnifiedPortfolioDisplay = () => {
  console.log('🔍 PORTFOLIO: Component rendered');
  const { testMode } = useTestMode();
  const { user } = useAuth();
  console.log('🔍 PORTFOLIO: testMode =', testMode, 'user =', !!user);
  
  const { balances, getTotalValue, refreshFromDatabase, resetPortfolio, isLoading } = useMockWallet();
  const { getCurrentData } = useRealTimeMarketData();
  const { toast } = useToast();
  
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [fetchingPortfolio, setFetchingPortfolio] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [connections, setConnections] = useState<any[]>([]);
  const [realTimePrices, setRealTimePrices] = useState<{[key: string]: number}>({});
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [positionValuations, setPositionValuations] = useState<Record<string, any>>({});

  // Fetch real-time prices for all displayed cryptocurrencies
  useEffect(() => {
    const updateRealTimePrices = async () => {
      try {
        const commonSymbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'ADA-EUR', 'SOL-EUR', 'DOT-EUR', 'MATIC-EUR', 'AVAX-EUR', 'LINK-EUR', 'LTC-EUR'];
        const data = await getCurrentData(commonSymbols);
        
        const prices: {[key: string]: number} = { EUR: 1 };
        
        // Update prices for all common symbols
        commonSymbols.forEach(symbol => {
          const crypto = symbol.split('-')[0];
          if (data[symbol]?.price && data[symbol].price > 0) {
            prices[crypto] = data[symbol].price;
            prices[symbol] = data[symbol].price; // Also store with full symbol for compatibility
          }
        });
        
        console.log('🔍 PORTFOLIO: Real-time prices updated:', prices);
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

  // Fetch positions for valuation service
  useEffect(() => {
    console.log('🔍 PORTFOLIO: fetchPositionsData useEffect called, testMode =', testMode, 'user =', !!user);
    if (testMode && user) {
      console.log('🔍 PORTFOLIO: About to fetch positions data');
      fetchPositionsData();
    } else {
      console.log('🔍 PORTFOLIO: NOT fetching positions - testMode:', testMode, 'user:', !!user);
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

  // Calculate valuations when positions or prices change
  useEffect(() => {
    const calculateAllValuations = async () => {
      const valuations: Record<string, any> = {};
      
      for (const position of positions) {
        // Skip corrupted positions from KPI calculations
        if (position.is_corrupted) {
          console.log(`⚠️ Skipping corrupted position ${position.symbol} from valuations`);
          continue;
        }
        
        const currentPrice = realTimePrices[position.symbol] || 0;
        console.log(`🔍 PORTFOLIO: Calculating valuation for ${position.symbol}:`, {
          currentPrice,
          position,
          availablePrices: Object.keys(realTimePrices)
        });
        
        if (currentPrice > 0) {
          try {
            const valuation = await calculateValuation(position, currentPrice);
            valuations[position.symbol] = valuation;
            console.log(`✅ PORTFOLIO: Valuation calculated for ${position.symbol}:`, valuation);
          } catch (error) {
            console.error(`❌ PORTFOLIO: Error calculating valuation for ${position.symbol}:`, error);
            // Don't set valuation if calculation fails
          }
        } else {
          console.warn(`⚠️ PORTFOLIO: No current price for ${position.symbol}, available prices:`, Object.keys(realTimePrices));
        }
      }
      
      setPositionValuations(valuations);
    };
    
    if (positions.length > 0 && Object.keys(realTimePrices).length > 0) {
      calculateAllValuations();
    }
  }, [positions, realTimePrices]);

  const fetchPositionsData = async () => {
    if (!user) return;
    
    console.log('🔍 PORTFOLIO: fetchPositionsData called for user', user.id);
    
    try {
      // Get open positions from buy trades that haven't been fully sold
      const { data: trades, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('trade_type', 'buy')
        .order('executed_at', { ascending: true });

      if (error) throw error;
      
      console.log('🔍 PORTFOLIO: Found', trades?.length || 0, 'buy trades');

      // Calculate net positions per symbol (simplified for demo)
      const positionMap = new Map<string, PositionData>();
      
      for (const trade of trades || []) {
        const symbol = trade.cryptocurrency.replace('-EUR', '');
        const existing = positionMap.get(symbol);
        
        if (existing) {
          // Average in new position
          const totalValue = existing.purchase_value + trade.total_value;
          const totalAmount = existing.amount + trade.amount;
          existing.purchase_value = totalValue;
          existing.amount = totalAmount;
          existing.entry_price = totalValue / totalAmount;
        } else {
          positionMap.set(symbol, {
            symbol,
            amount: trade.amount,
            entry_price: trade.price,
            purchase_value: trade.total_value,
            is_corrupted: trade.is_corrupted,
            integrity_reason: trade.integrity_reason
          });
        }
      }
      
      setPositions(Array.from(positionMap.values()));
      console.log('🔍 PORTFOLIO: Calculated', positionMap.size, 'positions:', Array.from(positionMap.keys()));
    } catch (error) {
      console.error('❌ PORTFOLIO: Error fetching positions:', error);
    }
  };

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

  const renderPositionCard = (position: PositionData) => {
    // Use valuation service for all calculations
    const integrityCheck = checkIntegrity(position);
    const currentPrice = realTimePrices[position.symbol] || 0;
    const valuation = positionValuations[position.symbol];
    
    console.log(`🔍 PORTFOLIO: Position ${position.symbol}:`, {
      realTimePrices: Object.keys(realTimePrices),
      currentPrice,
      hasValuation: !!valuation
    });
    
    // Skip calculation if corrupted and no current price
    if ((position.is_corrupted && !currentPrice) || !integrityCheck.is_valid) {
      return (
        <Card key={position.symbol} className="p-4 bg-slate-700/50 border-slate-600 border-red-500/30">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center">
                <span className="text-sm font-medium text-slate-300">{position.symbol}</span>
                <CorruptionWarning 
                  isCorrupted={position.is_corrupted || !integrityCheck.is_valid}
                  integrityReason={position.integrity_reason || integrityCheck.errors.join(', ')}
                />
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-red-400">
                  Corrupted Data
                </div>
                <div className="text-xs text-slate-400">
                  Requires manual review
                </div>
              </div>
            </div>
          </div>
        </Card>
      );
    }

    // Show loading state if valuation not yet calculated
    if (!valuation) {
      return (
        <Card key={position.symbol} className="p-4 bg-slate-700/50 border-slate-600">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-slate-300">{position.symbol}</span>
              <div className="text-right">
                <div className="text-lg font-bold text-slate-400">
                  Calculating...
                </div>
              </div>
            </div>
          </div>
        </Card>
      );
    }
    
    return (
      <Card key={position.symbol} className="p-4 bg-slate-700/50 border-slate-600">
        <div className="space-y-3">
          {/* Header with symbol and corruption warning */}
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <span className="text-sm font-medium text-slate-300">{position.symbol}</span>
              <CorruptionWarning 
                isCorrupted={position.is_corrupted}
                integrityReason={position.integrity_reason}
              />
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-white">
                €{valuation.current_value.toLocaleString()}
              </div>
              <div className="text-xs text-slate-400">
                {position.amount.toLocaleString(undefined, {
                  maximumFractionDigits: position.symbol === 'XRP' ? 0 : 6
                })} {position.symbol}
              </div>
            </div>
          </div>
          
          {/* P&L Display */}
          <div className="flex justify-between items-center pt-2 border-t border-slate-600/50">
            <span className="text-xs text-slate-400">P&L:</span>
            <div className="text-right">
              <div className={`text-sm font-medium ${
                valuation.pnl_eur >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                €{valuation.pnl_eur.toLocaleString()} ({valuation.pnl_pct.toFixed(2)}%)
              </div>
            </div>
          </div>
          
          {/* Current Price */}
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">Current Price:</span>
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium text-green-400">
                €{valuation.current_price.toFixed(position.symbol === 'XRP' ? 4 : 2)}
              </span>
              {Math.random() > 0.5 ? (
                <TrendingUp className="h-3 w-3 text-green-400" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-400" />
              )}
            </div>
          </div>
          
          {/* Entry Price for Reference */}
          <div className="flex justify-between items-center text-xs text-slate-500">
            <span>Entry: €{position.entry_price.toFixed(2)}</span>
            <span>Value: €{position.purchase_value.toFixed(2)}</span>
          </div>
        </div>
      </Card>
    );
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

  const handleResetPortfolio = async () => {
    try {
      await resetPortfolio();
      toast({
        title: "Portfolio Reset",
        description: "All trades deleted and portfolio reset to €30,000",
      });
    } catch (error) {
      toast({
        title: "Reset Failed",
        description: "Failed to reset portfolio. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className={`${testMode ? 'border-orange-500/20' : 'border-blue-500/20'} bg-slate-800/50 border-slate-600`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {testMode ? (
              <TestTube className="h-5 w-5 text-orange-400" />
            ) : (
              <Wallet className="h-5 w-5 text-blue-400" />
            )}
            <span className="text-white">
              {testMode ? 'Test Portfolio' : 'Live Portfolio'}
            </span>
            {testMode && (
              <Badge variant="outline" className="text-orange-400 border-orange-400/50">
                Test Mode
              </Badge>
            )}
          </div>
          {testMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetPortfolio}
              disabled={isLoading}
              className="text-red-400 border-red-400/50 hover:bg-red-400/10"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset Portfolio
            </Button>
          )}
        </CardTitle>
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
          {testMode ? (
            positions.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {positions.map(renderPositionCard)}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-300">
                  No open positions. Start trading to see positions.
                </p>
              </div>
            )
          ) : (
            portfolioData?.accounts && portfolioData.accounts.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {portfolioData.accounts.map(renderCoinCard)}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-300">
                  No portfolio data available. Select a connection and refresh.
                </p>
              </div>
            )
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