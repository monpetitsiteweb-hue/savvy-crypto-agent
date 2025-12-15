// WALLET-STYLE VIEW: Shows portfolio value with live crypto prices
// Aggregates from RPC for totals, live prices for per-asset display
import { getAllTradingPairs } from '@/data/coinbaseCoins';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMockWallet } from "@/hooks/useMockWallet";
import { useTestMode } from "@/hooks/useTestMode";
import { useAuth } from "@/hooks/useAuth";
import { usePortfolioMetrics } from "@/hooks/usePortfolioMetrics";
import { useOpenTrades } from "@/hooks/useOpenTrades";
import { supabase } from '@/integrations/supabase/client';
import { Wallet, RefreshCw, Loader2, TestTube, RotateCcw } from "lucide-react";
import { logger } from '@/utils/logger';
import { PortfolioNotInitialized } from "@/components/PortfolioNotInitialized";
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { afterReset } from '@/utils/resetHelpers';
import { toBaseSymbol } from '@/utils/symbols';

// Wallet-style position aggregated from open trades (cost basis only)
interface WalletAsset {
  symbol: string;
  totalAmount: number;
  totalCostBasis: number;
  avgEntryPrice: number;
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

// Wallet-style position with live value
interface WalletPosition {
  symbol: string;
  totalAmount: number;
  totalCostBasis: number;
  avgEntryPrice: number;
  livePrice: number | null;
  liveValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
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
  
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [fetchingPortfolio, setFetchingPortfolio] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [connections, setConnections] = useState<any[]>([]);
  // Wallet assets aggregated from open trades (cost basis only - no live price calculations)
  const [walletAssets, setWalletAssets] = useState<WalletAsset[]>([]);

  // Fetch connections for production mode
  useEffect(() => {
    if (!testMode && user) {
      fetchConnections();
    }
  }, [testMode, user]);

  // TRADE-BASED: Aggregate positions from open trades (cost basis only)
  // NO frontend P&L calculations - aggregate unrealized P&L comes from RPC metrics
  useEffect(() => {
    if (!testMode || !isInitialized || openTrades.length === 0) {
      setWalletAssets([]);
      return;
    }
    
    // Group open trades by symbol and aggregate (cost basis only)
    const assetMap = new Map<string, WalletAsset>();
    
    for (const trade of openTrades) {
      const symbol = toBaseSymbol(trade.cryptocurrency);
      const existing = assetMap.get(symbol);
      const tradeCostBasis = trade.total_value;
      
      if (existing) {
        existing.totalAmount += trade.amount;
        existing.totalCostBasis += tradeCostBasis;
        existing.avgEntryPrice = existing.totalCostBasis / existing.totalAmount;
      } else {
        assetMap.set(symbol, {
          symbol,
          totalAmount: trade.amount,
          totalCostBasis: tradeCostBasis,
          avgEntryPrice: trade.price
        });
      }
    }
    
    setWalletAssets(Array.from(assetMap.values()));
  }, [testMode, isInitialized, openTrades]);

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
        refreshOpenLots: refreshOpenTrades, // Now uses trades, not lots
      });
    } catch (error) {
      logger.error('Failed to reset portfolio:', error);
    }
  };

  // WALLET VIEW: Render asset card (cost basis only, no per-asset P&L)
  // Aggregate unrealized P&L comes from RPC metrics in header
  const renderWalletAssetCard = (asset: WalletAsset) => {
    return (
      <Card key={asset.symbol} className="p-4 bg-slate-700/50 border-slate-600">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <span className="text-sm font-medium text-slate-300">{asset.symbol}</span>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-white">
                {formatEuro(asset.totalCostBasis)}
              </div>
              <div className="text-xs text-slate-400">
                {asset.totalAmount.toLocaleString(undefined, {
                  maximumFractionDigits: asset.symbol === 'XRP' ? 0 : 6
                })} {asset.symbol}
              </div>
            </div>
          </div>
          
          <div className="flex justify-between items-center text-xs text-slate-500">
            <span>Avg Entry: {formatEuro(asset.avgEntryPrice)}</span>
            <span>Cost Basis</span>
          </div>
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
