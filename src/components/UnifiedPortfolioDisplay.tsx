// WALLET-STYLE VIEW: Shows portfolio value with live crypto prices
// Uses portfolioMath utility for consistent calculations across all views
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
import { Wallet, RefreshCw, Loader2, TestTube, RotateCcw, AlertCircle, Fuel } from "lucide-react";
import { logger } from '@/utils/logger';
import { PortfolioNotInitialized } from "@/components/PortfolioNotInitialized";
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { afterReset } from '@/utils/resetHelpers';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import { 
  computeFullPortfolioValuation, 
  formatPnlWithSign,
  type MarketPrices,
  type PortfolioValuation 
} from '@/utils/portfolioMath';

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

  // State for total traded volume (for gas calculation)
  const [totalTradedVolume, setTotalTradedVolume] = useState(0);
  
  // Fetch total traded volume for gas calculation
  useEffect(() => {
    if (!user || !testMode) return;
    
    const fetchTradedVolume = async () => {
      const { data } = await supabase
        .from('mock_trades')
        .select('total_value')
        .eq('user_id', user.id)
        .eq('is_test_mode', true)
        .eq('is_corrupted', false);
      
      if (data) {
        const total = data.reduce((sum, t) => sum + (t.total_value || 0), 0);
        setTotalTradedVolume(total);
      }
    };
    
    fetchTradedVolume();
  }, [user, testMode, metrics]); // Re-fetch when metrics change (trade happened)

  // SINGLE SOURCE OF TRUTH: Use portfolioMath utility for all calculations
  const portfolioValuation: PortfolioValuation = useMemo(() => {
    return computeFullPortfolioValuation(
      metrics,
      openTrades,
      marketData as MarketPrices,
      totalTradedVolume,
      testMode
    );
  }, [metrics, openTrades, marketData, totalTradedVolume, testMode]);

  // Wallet asset display (positions breakdown) — price mapping must match portfolioMath
  const liveAggregates = useMemo(() => {
    if (!testMode || !isInitialized || openTrades.length === 0) {
      return {
        costBasisEur: 0,
        currentValueEur: 0,
        unrealizedEur: 0,
        unrealizedPct: 0,
        hasMissingPrices: false,
        missingSymbols: [] as string[],
        walletAssets: [] as WalletAsset[],
      };
    }

    const missingSymbols: string[] = [];

    // Group open trades by base symbol and aggregate
    const assetMap = new Map<string, { symbol: string; totalAmount: number; totalCostBasis: number }>();

    for (const trade of openTrades) {
      const symbol = toBaseSymbol(trade.cryptocurrency);
      const existing = assetMap.get(symbol);
      // Cost basis includes fees for accurate P&L calculation
      const tradeCostBasis = trade.total_value + (trade.fees || 0);

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

    // Compute totals with live prices (exclude missing prices; warn loudly)
    let costBasisEur = 0;
    let currentValueEur = 0;

    const marketKeys = Object.keys(marketData || {});

    const resolveLivePrice = (baseSymbol: string): number | null => {
      const base = toBaseSymbol(baseSymbol);
      const pair = toPairSymbol(base);

      const direct = marketData[pair]?.price;
      if (typeof direct === 'number' && direct > 0) return direct;

      const baseDirect = marketData[base]?.price;
      if (typeof baseDirect === 'number' && baseDirect > 0) return baseDirect;

      const foundKey =
        marketKeys.find((k) => k.toUpperCase() === pair.toUpperCase()) ||
        marketKeys.find((k) => k.toUpperCase() === base.toUpperCase()) ||
        null;

      const p = foundKey ? marketData[foundKey]?.price : undefined;
      return typeof p === 'number' && p > 0 ? p : null;
    };

    const walletAssets: WalletAsset[] = Array.from(assetMap.values()).map((asset) => {
      const livePrice = resolveLivePrice(asset.symbol);

      costBasisEur += asset.totalCostBasis;

      let liveValue: number | null = null;
      let unrealizedPnl: number | null = null;

      if (livePrice !== null) {
        liveValue = asset.totalAmount * livePrice;
        unrealizedPnl = liveValue - asset.totalCostBasis;
        currentValueEur += liveValue;
      } else {
        if (!missingSymbols.includes(asset.symbol)) {
          missingSymbols.push(asset.symbol);
        }
      }

      return {
        symbol: asset.symbol,
        totalAmount: asset.totalAmount,
        totalCostBasis: asset.totalCostBasis,
        avgEntryPrice: asset.totalAmount > 0 ? asset.totalCostBasis / asset.totalAmount : 0,
        livePrice,
        liveValue,
        unrealizedPnl,
      };
    });

    // Unrealized here is only on priced assets; missing prices are excluded.
    const pricedCostBasis = walletAssets
      .filter((a) => a.liveValue !== null)
      .reduce((sum, a) => sum + a.totalCostBasis, 0);

    const unrealizedEur = currentValueEur - pricedCostBasis;
    const unrealizedPct = pricedCostBasis > 0 ? (unrealizedEur / pricedCostBasis) * 100 : 0;
    const hasMissingPrices = missingSymbols.length > 0;

    return { costBasisEur, currentValueEur, unrealizedEur, unrealizedPct, hasMissingPrices, missingSymbols, walletAssets };
  }, [testMode, isInitialized, openTrades, marketData]);

  // STRUCTURED PROOF LOG: prove all runtime values
  useEffect(() => {
    if (!testMode || !isInitialized) return;
    const keys = Object.keys(marketData || {});
    const openSyms = openTrades.map((t) => toBaseSymbol(t.cryptocurrency));

    const resolveKey = (base: string): string | null => {
      const pair = toPairSymbol(base);
      if (marketData[pair]?.price && marketData[pair]!.price > 0) return pair;
      if (marketData[base]?.price && marketData[base]!.price > 0) return base;
      return (
        keys.find((k) => k.toUpperCase() === pair.toUpperCase()) ||
        keys.find((k) => k.toUpperCase() === base.toUpperCase()) ||
        null
      );
    };

    // Build positions array with lookup info
    const positions = liveAggregates.walletAssets.map((a) => {
      const base = toBaseSymbol(a.symbol);
      const pairKey = toPairSymbol(base);
      const matchedKey = resolveKey(base);
      const matchedPrice = matchedKey ? (marketData[matchedKey]?.price ?? null) : null;

      return {
        symbol: a.symbol,
        amount: a.totalAmount,
        livePrice: a.livePrice,
        liveValue: a.liveValue,
        costBasis: a.totalCostBasis,
        pairKey,
        matchedKey,
        matchedPrice,
      };
    });

    // Structured proof object
    console.log('[portfolio-proof]', {
      cashEur: portfolioValuation.cashEur,
      startingCapitalEur: portfolioValuation.startingCapitalEur,
      gasSpentEur: portfolioValuation.gasSpentEur,
      openPositionsValueEur: portfolioValuation.openPositionsValueEur,
      totalPortfolioValueEur: portfolioValuation.totalPortfolioValueEur,
      totalPnlEur: portfolioValuation.totalPnlEur,
      missingSymbols: portfolioValuation.missingSymbols,
      positions,
    });

    // Log marketData keys (first 50) for reference
    console.log('[portfolio-proof] marketData keys (first 50):', keys.slice(0, 50));
    console.log('[portfolio-proof] lookup per symbol:', openSyms.map((s) => ({
      symbol: s,
      pairKey: toPairSymbol(s),
      matchedKey: resolveKey(s),
      priceFound: resolveKey(s) ? marketData[resolveKey(s) as string]?.price : null,
    })));
  }, [testMode, isInitialized, openTrades, marketData, portfolioValuation, liveAggregates]);

  // RUNTIME ASSERTION: Check if math adds up (test mode only)
  const mathMismatch = useMemo(() => {
    if (!testMode || !isInitialized) return null;
    const expected = portfolioValuation.cashEur + portfolioValuation.openPositionsValueEur - portfolioValuation.gasSpentEur;
    const actual = portfolioValuation.totalPortfolioValueEur;
    const diff = Math.abs(actual - expected);
    if (diff > 0.01) {
      return {
        expected,
        actual,
        diff,
        cash: portfolioValuation.cashEur,
        open: portfolioValuation.openPositionsValueEur,
        gas: portfolioValuation.gasSpentEur,
      };
    }
    return null;
  }, [testMode, isInitialized, portfolioValuation]);

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
    const unrealizedPnlPct =
      asset.unrealizedPnl !== null && asset.totalCostBasis > 0
        ? (asset.unrealizedPnl / asset.totalCostBasis) * 100
        : null;
    const isProfit = asset.unrealizedPnl !== null && asset.unrealizedPnl > 0;
    const isLoss = asset.unrealizedPnl !== null && asset.unrealizedPnl < 0;

    const showPriceUnavailable = !hasPriceData && asset.totalAmount > 0;

    return (
      <Card key={asset.symbol} className="p-4 bg-slate-700/50 border-slate-600">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-300">{asset.symbol}</span>
              {showPriceUnavailable && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1">
                        <AlertCircle className="h-3 w-3 text-amber-400" />
                        <Badge variant="outline" className="text-amber-400 border-amber-400/40">
                          Price unavailable
                        </Badge>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Live price missing — excluded from total valuation</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-white">
                {hasPriceData && asset.liveValue !== null ? formatEuro(asset.liveValue) : '—'}
              </div>
              <div className="text-xs text-slate-400">
                {asset.totalAmount.toLocaleString(undefined, {
                  maximumFractionDigits: asset.symbol === 'XRP' ? 0 : 6,
                })}{' '}
                {asset.symbol}
              </div>
            </div>
          </div>

          {/* Live price and entry price */}
          <div className="flex justify-between items-center text-xs text-slate-500">
            <span>Entry: {formatEuro(asset.avgEntryPrice)}</span>
            <span>{hasPriceData ? `Now: ${formatEuro(asset.livePrice!)}` : 'Price unavailable'}</span>
          </div>

          {/* Unrealized P&L per asset */}
          {hasPriceData && asset.unrealizedPnl !== null && (
            <div
              className={`text-xs flex justify-between items-center ${
                isProfit ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-slate-400'
              }`}
            >
              <span>Unrealized P&L</span>
              <span>
                {asset.unrealizedPnl >= 0 ? '+' : ''}
                {formatEuro(asset.unrealizedPnl)}
                {unrealizedPnlPct !== null &&
                  ` (${unrealizedPnlPct >= 0 ? '+' : ''}${formatPercentage(unrealizedPnlPct)})`}
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
          
          {/* Math Mismatch Banner (test mode assertion) */}
          {mathMismatch && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg flex flex-col gap-1">
              <div className="flex items-center gap-2 text-red-400 font-semibold">
                <AlertCircle className="h-4 w-4" />
                Portfolio math mismatch!
              </div>
              <div className="text-xs text-red-300 font-mono">
                Expected: {mathMismatch.expected.toFixed(2)} (cash {mathMismatch.cash.toFixed(2)} + open {mathMismatch.open.toFixed(2)} - gas {mathMismatch.gas.toFixed(2)})
              </div>
              <div className="text-xs text-red-300 font-mono">
                Actual totalPortfolioValueEur: {mathMismatch.actual.toFixed(2)} — Diff: {mathMismatch.diff.toFixed(2)}
              </div>
            </div>
          )}

          {/* Partial Valuation Warning Badge */}
          {portfolioValuation.hasMissingPrices && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 flex-shrink-0" />
              <span className="text-sm text-amber-400">
                Partial valuation (missing: {portfolioValuation.missingSymbols.join(', ')})
              </span>
            </div>
          )}

          {/* Total Portfolio Value - using portfolioMath utility */}
          {(() => {
            // Use shared portfolioMath for consistent calculations
            const pnlDisplay = formatPnlWithSign(portfolioValuation.totalPnlEur);
            
            return (
              <div className="flex justify-between items-center p-4 bg-slate-700/50 rounded-lg border border-slate-600/50">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">Total Portfolio Value</span>
                  </div>
                  {testMode && isInitialized && (
                    <div className="text-xs text-slate-400 mt-1">
                      Started with {formatEuro(portfolioValuation.startingCapitalEur)}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <span className={`text-2xl font-bold ${pnlDisplay.colorClass}`}>
                    {formatEuro(portfolioValuation.totalPortfolioValueEur)}
                  </span>
                  {/* Total P&L with explicit sign */}
                  {testMode && isInitialized && portfolioValuation.startingCapitalEur > 0 && (
                    <div className={`text-sm ${pnlDisplay.colorClass}`}>
                      {pnlDisplay.sign}{pnlDisplay.value} ({formatPercentage(portfolioValuation.totalPnlPct)}) — {pnlDisplay.label}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Portfolio Metrics Grid - using portfolioMath utility */}
          {testMode && isInitialized && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {/* Starting Capital */}
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="text-xs text-slate-400">Starting Capital</div>
                <div className="text-lg font-semibold text-white">{formatEuro(portfolioValuation.startingCapitalEur)}</div>
              </div>
              
              {/* Cash */}
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="text-xs text-slate-400">Cash</div>
                <div className="text-lg font-semibold text-white">{formatEuro(portfolioValuation.cashEur)}</div>
                {metrics.reserved_eur > 0 && (
                  <div className="text-xs text-amber-400">Reserved: {formatEuro(metrics.reserved_eur)}</div>
                )}
              </div>
              
              {/* Open Positions Value */}
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  Open Positions
                  {portfolioValuation.hasMissingPrices && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger><AlertCircle className="h-3 w-3 text-amber-400" /></TooltipTrigger>
                        <TooltipContent><p className="text-xs">Partial: {portfolioValuation.missingSymbols.join(', ')}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <div className="text-lg font-semibold text-white">{formatEuro(portfolioValuation.openPositionsValueEur)}</div>
                <div className="text-xs text-slate-500">Cost: {formatEuro(liveAggregates.costBasisEur)}</div>
              </div>
              
              {/* Gas Spent (est.) */}
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <Fuel className="h-3 w-3" />
                  Gas (est.)
                </div>
                <div className="text-lg font-semibold text-amber-400">−{formatEuro(portfolioValuation.gasSpentEur)}</div>
                <div className="text-xs text-slate-500">0.20% of volume</div>
              </div>
              
              {/* Total P&L */}
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="text-xs text-slate-400">Total P&L</div>
                {(() => {
                  const pnl = formatPnlWithSign(portfolioValuation.totalPnlEur);
                  return (
                    <>
                      <div className={`text-lg font-semibold ${pnl.colorClass}`}>
                        {pnl.sign}{pnl.value}
                      </div>
                      <div className={`text-xs ${pnl.colorClass}`}>
                        {formatPercentage(portfolioValuation.totalPnlPct)} — {pnl.label}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
          
          {/* P&L Breakdown Row */}
          {testMode && isInitialized && (
            <div className="grid grid-cols-2 gap-3">
              {/* Unrealized P&L */}
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  Unrealized P&L
                  {portfolioValuation.hasMissingPrices && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger><AlertCircle className="h-3 w-3 text-amber-400" /></TooltipTrigger>
                        <TooltipContent><p className="text-xs">Partial: {portfolioValuation.missingSymbols.join(', ')}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                {(() => {
                  const unrealPnl = formatPnlWithSign(portfolioValuation.unrealizedPnlEur);
                  const unrealPct = liveAggregates.costBasisEur > 0 
                    ? (portfolioValuation.unrealizedPnlEur / liveAggregates.costBasisEur) * 100 
                    : 0;
                  return (
                    <>
                      <div className={`text-lg font-semibold ${unrealPnl.colorClass}`}>
                        {unrealPnl.sign}{unrealPnl.value}
                      </div>
                      <div className={`text-xs ${unrealPnl.colorClass}`}>
                        {formatPercentage(unrealPct)}
                      </div>
                    </>
                  );
                })()}
              </div>
              
              {/* Realized P&L */}
              <div className="p-3 bg-slate-700/30 rounded-lg">
                <div className="text-xs text-slate-400">Realized P&L</div>
                {(() => {
                  const realPnl = formatPnlWithSign(portfolioValuation.realizedPnlEur);
                  return (
                    <>
                      <div className={`text-lg font-semibold ${realPnl.colorClass}`}>
                        {realPnl.sign}{realPnl.value}
                      </div>
                      <div className={`text-xs ${realPnl.colorClass}`}>
                        {formatPercentage(realizedPnlPct)}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Fees Summary */}
          {testMode && isInitialized && (
            <div className="flex justify-between items-center p-3 bg-slate-700/30 rounded-lg">
              <div className="text-sm text-slate-400">Total Fees Paid</div>
              <div className="text-sm text-slate-300">{formatEuro(metrics.total_fees_eur)}</div>
            </div>
          )}
          
          {/* WALLET VIEW: Crypto holdings breakdown by asset */}
          {testMode ? (
            liveAggregates.walletAssets.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {liveAggregates.walletAssets.map(renderWalletAssetCard)}
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
              📊 Live prices from market stream • Trades-only model
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
