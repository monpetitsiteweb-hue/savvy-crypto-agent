import { getAllTradingPairs } from '@/data/coinbaseCoins';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMockWallet } from "@/hooks/useMockWallet";
import { useTestMode } from "@/hooks/useTestMode";
import { useAuth } from "@/hooks/useAuth";
import { useRealTimeMarketData } from "@/hooks/useRealTimeMarketData";
import { usePortfolioMetrics } from "@/hooks/usePortfolioMetrics";
import { supabase } from '@/integrations/supabase/client';
import { Wallet, TrendingUp, TrendingDown, RefreshCw, Loader2, TestTube, DollarSign, RotateCcw, AlertTriangle } from "lucide-react";
import { logger } from '@/utils/logger';
import { calculateValuation, checkIntegrity, type OpenPositionInputs } from "@/utils/valuationService";
import { CorruptionWarning } from "@/components/CorruptionWarning";
import { PortfolioNotInitialized } from "@/components/PortfolioNotInitialized";
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';

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
  const { testMode } = useTestMode();
  const { user } = useAuth();
  
  const { resetPortfolio, isLoading: walletLoading } = useMockWallet();
  const { getCurrentData } = useRealTimeMarketData();
  const { 
    metrics, 
    loading: metricsLoading, 
    isInitialized, 
    refresh: refreshMetrics,
    sinceStartGainEur,
    sinceStartGainPct,
    unrealizedPnlPct,
    realizedPnlPct,
    totalPnlPct
  } = usePortfolioMetrics();
  
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
        const commonSymbols = getAllTradingPairs();
        const data = await getCurrentData(commonSymbols);
        
        const prices: {[key: string]: number} = { EUR: 1 };
        
        commonSymbols.forEach(symbol => {
          const crypto = symbol.split('-')[0];
          if (data[symbol]?.price && data[symbol].price > 0) {
            prices[crypto] = data[symbol].price;
            prices[symbol] = data[symbol].price;
          }
        });
        
        setRealTimePrices(prices);
      } catch (error) {
        logger.error('Error fetching real-time prices:', error);
      }
    };

    updateRealTimePrices();
    const interval = setInterval(updateRealTimePrices, 60000);
    
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
    if (testMode && user && isInitialized) {
      fetchPositionsData();
    }
  }, [testMode, user, isInitialized]);

  // Calculate valuations when positions or prices change
  useEffect(() => {
    const calculateAllValuations = async () => {
      const valuations: Record<string, any> = {};
      
      for (const position of positions) {
        if (position.is_corrupted) continue;
        
        const currentPrice = realTimePrices[position.symbol] || 0;
        
        if (currentPrice > 0) {
          try {
            const openPositionInputs: OpenPositionInputs = {
              symbol: position.symbol,
              amount: position.amount,
              entryPrice: position.entry_price,
              purchaseValue: position.purchase_value
            };
            const valuation = await calculateValuation(openPositionInputs, currentPrice);
            valuations[position.symbol] = valuation;
          } catch (error) {
            logger.error(`Error calculating valuation for ${position.symbol}:`, error);
          }
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
    
    try {
      const { data: trades, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('trade_type', 'buy')
        .eq('is_test_mode', true)
        .order('executed_at', { ascending: true });

      if (error) throw error;

      const positionMap = new Map<string, PositionData>();
      
      for (const trade of trades || []) {
        const symbol = trade.cryptocurrency.replace('-EUR', '');
        const existing = positionMap.get(symbol);
        
        if (existing) {
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
    } catch (error) {
      logger.error('Error fetching positions:', error);
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
      
      const savedConnectionId = localStorage.getItem(`selectedConnection_${user.id}`);
      if (savedConnectionId && data?.find(c => c.id === savedConnectionId)) {
        setSelectedConnectionId(savedConnectionId);
      } else if (data && data.length > 0) {
        const firstConnectionId = data[0].id;
        setSelectedConnectionId(firstConnectionId);
        localStorage.setItem(`selectedConnection_${user.id}`, firstConnectionId);
      }
    } catch (error) {
      logger.error('Error fetching connections:', error);
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
      logger.error('Production portfolio fetch error:', error);
    } finally {
      setFetchingPortfolio(false);
    }
  };

  const handleResetPortfolio = async () => {
    try {
      await resetPortfolio();
      // Refresh metrics after reset
      setTimeout(() => refreshMetrics(), 500);
    } catch (error) {
      logger.error('Failed to reset portfolio:', error);
    }
  };

  const renderPositionCard = (position: PositionData) => {
    const openPositionInputs: OpenPositionInputs = {
      symbol: position.symbol,
      amount: position.amount,
      entryPrice: position.entry_price,
      purchaseValue: position.purchase_value
    };
    const integrityCheck = checkIntegrity(openPositionInputs);
    const currentPrice = realTimePrices[position.symbol] || 0;
    const valuation = positionValuations[position.symbol];
    
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
                <div className="text-lg font-bold text-red-400">Corrupted Data</div>
                <div className="text-xs text-slate-400">Requires manual review</div>
              </div>
            </div>
          </div>
        </Card>
      );
    }

    if (!valuation) {
      return (
        <Card key={position.symbol} className="p-4 bg-slate-700/50 border-slate-600">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-slate-300">{position.symbol}</span>
              <div className="text-right">
                <div className="text-lg font-bold text-slate-400">Calculating...</div>
              </div>
            </div>
          </div>
        </Card>
      );
    }
    
    return (
      <Card key={position.symbol} className="p-4 bg-slate-700/50 border-slate-600">
        <div className="space-y-3">
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

  // Show not initialized state for test mode
  if (testMode && !metricsLoading && !isInitialized) {
    return <PortfolioNotInitialized onReset={handleResetPortfolio} isLoading={walletLoading} />;
  }

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
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshMetrics}
              disabled={metricsLoading}
              className="text-slate-400 hover:text-white"
            >
              <RefreshCw className={`h-4 w-4 ${metricsLoading ? 'animate-spin' : ''}`} />
            </Button>
            {testMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetPortfolio}
                disabled={walletLoading}
                className="text-red-400 border-red-400/50 hover:bg-red-400/10"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset Portfolio
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          {(metricsLoading || fetchingPortfolio) && (
            <div className="flex justify-center items-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              <span className="ml-2 text-blue-400">
                {testMode ? 'Loading portfolio metrics...' : 'Fetching live portfolio...'}
              </span>
            </div>
          )}
          
          {/* Total Portfolio Value - FROM RPC */}
          <div className="flex justify-between items-center p-4 bg-slate-700/50 rounded-lg border border-slate-600/50">
            <div>
              <span className="font-medium text-white">Total Portfolio Value</span>
              {testMode && isInitialized && (
                <div className="text-xs text-slate-400 mt-1">
                  Started with {formatEuro(metrics.starting_capital_eur)}
                </div>
              )}
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-green-400">
                {formatEuro(metrics.total_portfolio_value_eur)}
              </span>
              {/* Since start gain */}
              {testMode && isInitialized && metrics.starting_capital_eur > 0 && (
                <div className={`text-sm ${sinceStartGainEur >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {sinceStartGainEur >= 0 ? '+' : ''}{formatEuro(sinceStartGainEur)} ({formatPercentage(sinceStartGainPct)})
                </div>
              )}
            </div>
          </div>

          {/* Portfolio Metrics Grid - FROM RPC */}
          {testMode && isInitialized && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="text-xs text-slate-400">Cash Available</div>
                <div className="text-lg font-semibold text-white">{formatEuro(metrics.available_eur)}</div>
                {metrics.reserved_eur > 0 && (
                  <div className="text-xs text-amber-400">Reserved: {formatEuro(metrics.reserved_eur)}</div>
                )}
              </div>
              
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="text-xs text-slate-400">Invested</div>
                <div className="text-lg font-semibold text-white">{formatEuro(metrics.invested_cost_basis_eur)}</div>
                <div className="text-xs text-slate-500">Current: {formatEuro(metrics.current_position_value_eur)}</div>
              </div>
              
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="text-xs text-slate-400">Unrealized P&L</div>
                <div className={`text-lg font-semibold ${metrics.unrealized_pnl_eur >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatEuro(metrics.unrealized_pnl_eur)}
                </div>
                <div className={`text-xs ${metrics.unrealized_pnl_eur >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                  {formatPercentage(unrealizedPnlPct)}
                </div>
              </div>
              
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="text-xs text-slate-400">Realized P&L</div>
                <div className={`text-lg font-semibold ${metrics.realized_pnl_eur >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatEuro(metrics.realized_pnl_eur)}
                </div>
                <div className={`text-xs ${metrics.realized_pnl_eur >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                  {formatPercentage(realizedPnlPct)}
                </div>
              </div>
            </div>
          )}

          {/* Total P&L and Fees Summary */}
          {testMode && isInitialized && (
            <div className="flex justify-between items-center p-3 bg-slate-700/30 rounded-lg">
              <div>
                <div className="text-sm text-slate-400">Total P&L</div>
                <div className={`text-xl font-bold ${metrics.total_pnl_eur >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatEuro(metrics.total_pnl_eur)} <span className="text-sm">({formatPercentage(totalPnlPct)})</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-slate-400">Total Fees</div>
                <div className="text-sm text-slate-300">{formatEuro(metrics.total_fees_eur)}</div>
              </div>
            </div>
          )}
          
          {/* Portfolio Breakdown */}
          {testMode ? (
            positions.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {positions.map(renderPositionCard)}
              </div>
            ) : isInitialized ? (
              <div className="text-center py-8">
                <p className="text-slate-300">
                  No open positions. Start trading to see positions.
                </p>
              </div>
            ) : null
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
          {testMode && isInitialized && (
            <div className="text-xs text-slate-400 text-center mt-2">
              💫 Real-time prices • Updates automatically after trades
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
