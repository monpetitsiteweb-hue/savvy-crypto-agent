// WALLET-STYLE VIEW: Shows portfolio value with live crypto prices
// Aggregates from RPC for totals, live prices for per-asset display
import { getAllTradingPairs } from '@/data/coinbaseCoins';
import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMockWallet } from "@/hooks/useMockWallet";
import { useTestMode } from "@/hooks/useTestMode";
import { useAuth } from "@/hooks/useAuth";
import { usePortfolioMetrics } from "@/hooks/usePortfolioMetrics";
import { useOpenTrades } from "@/hooks/useOpenTrades";
import { useMarketData } from "@/contexts/MarketDataContext";
import { supabase } from '@/integrations/supabase/client';
import { Wallet, RefreshCw, Loader2, TestTube, RotateCcw, AlertCircle, Info } from "lucide-react";
import { logger } from '@/utils/logger';
import { PortfolioNotInitialized } from "@/components/PortfolioNotInitialized";
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { afterReset } from '@/utils/resetHelpers';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';

// Wallet-style position aggregated from open trades with live price
interface WalletAsset {
  symbol: string;
  totalAmount: number;
  totalCostBasis: number;
  avgEntryPrice: number;
  livePrice: number | null;
  liveValue: number | null;
  unrealizedPnl: number | null;
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

export const UnifiedPortfolioDisplay = () => {
  const { testMode } = useTestMode();
  const { user } = useAuth();
  
  const { resetPortfolio, isLoading: walletLoading } = useMockWallet();
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
  
  // TRADE-BASED: Use open trades (not lots)
  const { openTrades, isLoading: tradesLoading, refresh: refreshOpenTrades } = useOpenTrades();
  
  // Live price stream for per-asset display
  const { marketData } = useMarketData();
  
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [fetchingPortfolio, setFetchingPortfolio] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [connections, setConnections] = useState<any[]>([]);

  // Fetch connections for production mode
  useEffect(() => {
    if (!testMode && user) {
      fetchConnections();
    }
  }, [testMode, user]);

  // TRADE-BASED: Aggregate positions from open trades with LIVE PRICES
  // This provides accurate current values when price_snapshots is incomplete
  const walletAssets = useMemo<WalletAsset[]>(() => {
    if (!testMode || !isInitialized || openTrades.length === 0) {
      return [];
    }
    
    // Group open trades by symbol and aggregate
    const assetMap = new Map<string, { symbol: string; totalAmount: number; totalCostBasis: number }>();
    
    for (const trade of openTrades) {
      const symbol = toBaseSymbol(trade.cryptocurrency);
      const existing = assetMap.get(symbol);
      const tradeCostBasis = trade.total_value;
      
      if (existing) {
        existing.totalAmount += trade.amount;
        existing.totalCostBasis += tradeCostBasis;
      } else {
        assetMap.set(symbol, {
          symbol,
          totalAmount: trade.amount,
          totalCostBasis: tradeCostBasis,
        });
      }
    }
    
    // Enrich with live prices from market data
    return Array.from(assetMap.values()).map(asset => {
      const pairSymbol = toPairSymbol(asset.symbol);
      const liveData = marketData[pairSymbol];
      const livePrice = liveData?.price || null;
      const liveValue = livePrice !== null ? asset.totalAmount * livePrice : null;
      const unrealizedPnl = liveValue !== null ? liveValue - asset.totalCostBasis : null;
      
      return {
        symbol: asset.symbol,
        totalAmount: asset.totalAmount,
        totalCostBasis: asset.totalCostBasis,
        avgEntryPrice: asset.totalCostBasis / asset.totalAmount,
        livePrice,
        liveValue,
        unrealizedPnl,
      };
    });
  }, [testMode, isInitialized, openTrades, marketData]);
  
  // Compute live aggregate unrealized P&L from wallet assets (for comparison with RPC)
  const liveAggregateUnrealizedPnl = useMemo(() => {
    const total = walletAssets.reduce((sum, asset) => {
      return sum + (asset.unrealizedPnl ?? 0);
    }, 0);
    const hasMissingPrices = walletAssets.some(a => a.livePrice === null);
    return { total, hasMissingPrices };
  }, [walletAssets]);

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

  // P2 FIX: Deterministic reset - await all refreshes via afterReset helper
  const handleResetPortfolio = async () => {
    try {
      await resetPortfolio();
      // Use centralized afterReset for deterministic refresh (no setTimeout)
      await afterReset({
        refreshPortfolioMetrics: refreshMetrics,
        refreshOpenTrades: refreshOpenTrades,
      });
    } catch (error) {
      logger.error('Failed to reset portfolio:', error);
    }
  };

  // WALLET VIEW: Render asset card with LIVE PRICE and value
  // Shows current value and P&L using live market prices
  const renderWalletAssetCard = (asset: WalletAsset) => {
    const hasPriceData = asset.livePrice !== null;
    const unrealizedPnlPct = asset.unrealizedPnl !== null && asset.totalCostBasis > 0
      ? (asset.unrealizedPnl / asset.totalCostBasis) * 100
      : null;
    const isProfit = asset.unrealizedPnl !== null && asset.unrealizedPnl > 0;
    const isLoss = asset.unrealizedPnl !== null && asset.unrealizedPnl < 0;
    
    return (
      <Card key={asset.symbol} className="p-4 bg-slate-700/50 border-slate-600">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-300">{asset.symbol}</span>
              {!hasPriceData && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <AlertCircle className="h-3 w-3 text-amber-400" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Live price unavailable</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="text-right">
              {/* Show live value if available, otherwise cost basis */}
              <div className="text-lg font-bold text-white">
                {hasPriceData ? formatEuro(asset.liveValue!) : formatEuro(asset.totalCostBasis)}
              </div>
              <div className="text-xs text-slate-400">
                {asset.totalAmount.toLocaleString(undefined, {
                  maximumFractionDigits: asset.symbol === 'XRP' ? 0 : 6
                })} {asset.symbol}
              </div>
            </div>
          </div>
          
          {/* Live price and entry price */}
          <div className="flex justify-between items-center text-xs text-slate-500">
            <span>Entry: {formatEuro(asset.avgEntryPrice)}</span>
            <span>
              {hasPriceData ? `Now: ${formatEuro(asset.livePrice!)}` : 'Price unavailable'}
            </span>
          </div>
          
          {/* Unrealized P&L per asset */}
          {hasPriceData && asset.unrealizedPnl !== null && (
            <div className={`text-xs flex justify-between items-center ${isProfit ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-slate-400'}`}>
              <span>Unrealized P&L</span>
              <span>
                {asset.unrealizedPnl >= 0 ? '+' : ''}{formatEuro(asset.unrealizedPnl)}
                {unrealizedPnlPct !== null && ` (${unrealizedPnlPct >= 0 ? '+' : ''}${formatPercentage(unrealizedPnlPct)})`}
              </span>
            </div>
          )}
        </div>
      </Card>
    );
  };

  // Production mode coin card (uses live price for display only, not P&L calculation)
  const renderCoinCard = (account: any) => {
    const amount = parseFloat(account.available_balance?.value || '0');
    const currency = account.currency;

    return (
      <Card key={account.uuid} className="p-4 bg-slate-700/50 border-slate-600">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-slate-300">{currency}</span>
            <div className="text-right">
              <div className="text-xs text-slate-400">
                {amount.toLocaleString(undefined, {
                  maximumFractionDigits: currency === 'XRP' ? 0 : 6
                })} {currency}
              </div>
            </div>
          </div>
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
          
          {/* Total Portfolio Value - Use live calculation when RPC has stale price data */}
          {(() => {
            // Compute live total from cash + live asset values
            const liveCryptoValue = walletAssets.reduce((sum, a) => sum + (a.liveValue ?? a.totalCostBasis), 0);
            const liveTotal = metrics.cash_balance_eur + liveCryptoValue;
            // Use live value if it differs meaningfully from RPC (indicates stale price_snapshots)
            const useRpcValue = Math.abs(liveTotal - metrics.total_portfolio_value_eur) < 1;
            const displayTotal = useRpcValue ? metrics.total_portfolio_value_eur : liveTotal;
            const displayGain = displayTotal - metrics.starting_capital_eur;
            const displayGainPct = metrics.starting_capital_eur > 0 ? (displayGain / metrics.starting_capital_eur) * 100 : 0;
            
            return (
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
                  <span className={`text-2xl font-bold ${displayGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatEuro(displayTotal)}
                  </span>
                  {/* Since start gain */}
                  {testMode && isInitialized && metrics.starting_capital_eur > 0 && (
                    <div className={`text-sm ${displayGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {displayGain >= 0 ? '+' : ''}{formatEuro(displayGain)} ({formatPercentage(displayGainPct)})
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

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
              
              {(() => {
                // Use live crypto value when RPC value seems stale (≈0 when positions exist)
                const liveCryptoValue = walletAssets.reduce((sum, a) => sum + (a.liveValue ?? a.totalCostBasis), 0);
                const displayCurrent = (metrics.current_position_value_eur < 1 && liveCryptoValue > 1) 
                  ? liveCryptoValue 
                  : metrics.current_position_value_eur;
                return (
                  <div className="p-3 bg-slate-700/30 rounded-lg">
                    <div className="text-xs text-slate-400">Invested</div>
                    <div className="text-lg font-semibold text-white">{formatEuro(metrics.invested_cost_basis_eur)}</div>
                    <div className="text-xs text-slate-500">Current: {formatEuro(displayCurrent)}</div>
                  </div>
                );
              })()}
              
              {(() => {
                // Use live unrealized P&L when RPC value is stale/zero
                const liveUnrealized = liveAggregateUnrealizedPnl.total;
                const useRpcValue = Math.abs(metrics.unrealized_pnl_eur) > 0.01 || liveAggregateUnrealizedPnl.hasMissingPrices;
                const displayUnrealized = useRpcValue ? metrics.unrealized_pnl_eur : liveUnrealized;
                const displayPct = metrics.invested_cost_basis_eur > 0 
                  ? (displayUnrealized / metrics.invested_cost_basis_eur) * 100 
                  : 0;
                
                return (
                  <div className="p-3 bg-slate-700/30 rounded-lg">
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      Unrealized P&L
                      {!useRpcValue && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <Info className="h-3 w-3 text-amber-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Live calculation (price_snapshots stale)</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <div className={`text-lg font-semibold ${displayUnrealized >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatEuro(displayUnrealized)}
                    </div>
                    <div className={`text-xs ${displayUnrealized >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                      {formatPercentage(displayPct)}
                    </div>
                  </div>
                );
              })()}
              
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

          {/* Total P&L and Fees Summary - use live unrealized when RPC stale */}
          {testMode && isInitialized && (() => {
            const liveUnrealized = liveAggregateUnrealizedPnl.total;
            const useRpcUnrealized = Math.abs(metrics.unrealized_pnl_eur) > 0.01 || liveAggregateUnrealizedPnl.hasMissingPrices;
            const displayUnrealized = useRpcUnrealized ? metrics.unrealized_pnl_eur : liveUnrealized;
            const displayTotalPnl = metrics.realized_pnl_eur + displayUnrealized;
            const displayTotalPnlPct = metrics.starting_capital_eur > 0 
              ? (displayTotalPnl / metrics.starting_capital_eur) * 100 
              : 0;
            
            return (
              <div className="flex justify-between items-center p-3 bg-slate-700/30 rounded-lg">
                <div>
                  <div className="text-sm text-slate-400">Total P&L</div>
                  <div className={`text-xl font-bold ${displayTotalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatEuro(displayTotalPnl)} <span className="text-sm">({formatPercentage(displayTotalPnlPct)})</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-slate-400">Total Fees</div>
                  <div className="text-sm text-slate-300">{formatEuro(metrics.total_fees_eur)}</div>
                </div>
              </div>
            );
          })()}
          
          {/* WALLET VIEW: Crypto holdings breakdown by asset */}
          {testMode ? (
            walletAssets.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {walletAssets.map(renderWalletAssetCard)}
              </div>
            ) : isInitialized && !tradesLoading ? (
              <div className="text-center py-8">
                <p className="text-slate-300">
                  No open positions. Start trading to see holdings.
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

          {/* Data source indicator */}
          {testMode && isInitialized && (
            <div className="text-xs text-slate-400 text-center mt-2">
              📊 All metrics from RPC (get_portfolio_metrics) • Trade-based
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
