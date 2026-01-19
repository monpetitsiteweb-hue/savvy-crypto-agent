// WALLET-STYLE VIEW: Shows portfolio value with live crypto prices
// Uses portfolioMath utility for consistent calculations across all views
import { getAllTradingPairs } from '@/data/coinbaseCoins';
import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMockWallet } from "@/hooks/useMockWallet";
import { useTradeViewFilter } from "@/hooks/useTradeViewFilter";
import { useAuth } from "@/hooks/useAuth";
import { usePortfolioMetrics } from "@/hooks/usePortfolioMetrics";
import { useOpenTrades } from "@/hooks/useOpenTrades";
import { useMarketData } from "@/contexts/MarketDataContext";
import { useHoldingsPrices } from "@/hooks/useHoldingsPrices";
import { supabase } from '@/integrations/supabase/client';
import { Wallet, RefreshCw, Loader2, TestTube, RotateCcw, AlertCircle, Fuel, BarChart3 } from "lucide-react";
import { WalletRealityPanel } from "@/components/wallet/WalletRealityPanel";
import { logger } from '@/utils/logger';
import { PortfolioNotInitialized } from "@/components/PortfolioNotInitialized";
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { afterReset } from '@/utils/resetHelpers';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import { 
  computeFullPortfolioValuation, 
  formatPnlWithSign,
  MOCK_GAS_PER_TX_EUR,
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
  const { testMode } = useTradeViewFilter();
  const { user } = useAuth();

  // Opt-in diagnostics: append ?debugPortfolio=1 to the URL
  const DEBUG_PORTFOLIO = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('debugPortfolio') === '1';
    } catch {
      return false;
    }
  }, []);
  
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
  
  // Holdings-driven pricing: fetch ONLY for positions held
  const { marketData } = useMarketData();
  const { holdingsPrices, isLoadingPrices, failedSymbols, debugInfo } = useHoldingsPrices(openTrades);
  
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

  // State for transaction count (for gas calculation)
  const [txCount, setTxCount] = useState(0);
  
  // Fetch transaction count for gas calculation (each mock_trade row = 1 tx)
  useEffect(() => {
    if (!user || !testMode) return;
    
    const fetchTxCount = async () => {
      const { count } = await supabase
        .from('mock_trades')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_test_mode', true)
        .eq('is_corrupted', false);
      
      setTxCount(count || 0);
    };
    
    fetchTxCount();
  }, [user, testMode, metrics]); // Re-fetch when metrics change (trade happened)

  // SINGLE SOURCE OF TRUTH: Use portfolioMath utility for all calculations
  // Prefer holdingsPrices (specific to user holdings), fallback to marketData for broader coverage
  const effectivePrices = useMemo(() => {
    // Merge: holdingsPrices takes priority, then marketData for any missing
    const merged: MarketPrices = { ...marketData as MarketPrices };
    for (const [key, val] of Object.entries(holdingsPrices)) {
      if (val && val.price > 0) {
        merged[key] = val;
      }
    }
    return merged;
  }, [holdingsPrices, marketData]);

  const portfolioValuation: PortfolioValuation = useMemo(() => {
    return computeFullPortfolioValuation(
      metrics,
      openTrades,
      effectivePrices,
      txCount,
      testMode
    );
  }, [metrics, openTrades, effectivePrices, txCount, testMode]);

  // Wallet asset display (positions breakdown) — use effectivePrices to stay consistent with valuation
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

    // USE effectivePrices (not marketData) to stay consistent with portfolioValuation
    const priceKeys = Object.keys(effectivePrices || {});

    const resolveLivePrice = (baseSymbol: string): number | null => {
      const base = toBaseSymbol(baseSymbol);
      const pair = toPairSymbol(base);

      // Use effectivePrices (merged holdingsPrices + marketData) for consistency
      const direct = effectivePrices[pair]?.price;
      if (typeof direct === 'number' && direct > 0) return direct;

      const baseDirect = effectivePrices[base]?.price;
      if (typeof baseDirect === 'number' && baseDirect > 0) return baseDirect;

      const foundKey =
        priceKeys.find((k) => k.toUpperCase() === pair.toUpperCase()) ||
        priceKeys.find((k) => k.toUpperCase() === base.toUpperCase()) ||
        null;

      const p = foundKey ? effectivePrices[foundKey]?.price : undefined;
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
  }, [testMode, isInitialized, openTrades, effectivePrices]);

  // STRUCTURED PROOF LOG: prove all runtime values (dev only)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!testMode || !isInitialized) return;
    
    const keys = Object.keys(effectivePrices || {});
    const openSyms = openTrades.map((t) => toBaseSymbol(t.cryptocurrency));

    const resolveKey = (base: string): string | null => {
      const pair = toPairSymbol(base);
      if (effectivePrices[pair]?.price && effectivePrices[pair]!.price > 0) return pair;
      if (effectivePrices[base]?.price && effectivePrices[base]!.price > 0) return base;
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
      const matchedPrice = matchedKey ? (effectivePrices[matchedKey]?.price ?? null) : null;

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

    // Structured proof object with gas calculation details
    console.log('[portfolio-proof]', {
      txCount,
      MOCK_GAS_PER_TX_EUR,
      gasSpentEur: portfolioValuation.gasSpentEur,
      cashEur: portfolioValuation.cashEur,
      unrealizedPnlEur: portfolioValuation.unrealizedPnlEur,
      openPositionsValueEur: portfolioValuation.openPositionsValueEur,
      totalPortfolioValueEur: portfolioValuation.totalPortfolioValueEur,
      equation: `${portfolioValuation.cashEur.toFixed(2)} + ${portfolioValuation.unrealizedPnlEur.toFixed(2)} - ${portfolioValuation.gasSpentEur.toFixed(2)} = ${portfolioValuation.totalPortfolioValueEur.toFixed(2)}`,
      totalPnlEur: portfolioValuation.totalPnlEur,
      missingSymbols: portfolioValuation.missingSymbols,
      positions,
    });

    // Log effectivePrices keys (first 50) for reference
    console.log('[portfolio-proof] effectivePrices keys (first 50):', keys.slice(0, 50));
    console.log('[portfolio-proof] lookup per symbol:', openSyms.map((s) => ({
      symbol: s,
      pairKey: toPairSymbol(s),
      matchedKey: resolveKey(s),
      priceFound: resolveKey(s) ? effectivePrices[resolveKey(s) as string]?.price : null,
    })));
  }, [testMode, isInitialized, openTrades, effectivePrices, portfolioValuation, liveAggregates, txCount]);

  // Math mismatch check removed per user request

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
                  maximumFractionDigits: currency === 'XRP' ? 0 : 6,
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
    // FACT LOG: show the exact gate inputs (helps pinpoint why this renders)
    console.info('[UnifiedPortfolioDisplay] PortfolioNotInitialized gate', {
      testMode,
      metricsLoading,
      isInitialized,
      metricsSuccess: metrics?.success,
      metricsReason: (metrics as any)?.reason,
    });

    // Optional UI dump for "facts only" debugging (opt-in via ?debugPortfolio=1)
    if (DEBUG_PORTFOLIO) {
      return (
        <div className="space-y-3">
          <PortfolioNotInitialized onReset={handleResetPortfolio} isLoading={walletLoading} />
          <Card>
            <CardContent className="p-4">
              <pre className="text-xs whitespace-pre-wrap break-words">{JSON.stringify({
                testMode,
                metricsLoading,
                isInitialized,
                metrics,
              }, null, 2)}</pre>
            </CardContent>
          </Card>
        </div>
      );
    }

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
        <div className="space-y-6">
          {(metricsLoading || fetchingPortfolio) && (
            <div className="flex justify-center items-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              <span className="ml-2 text-blue-400">
                {testMode ? 'Loading portfolio metrics...' : 'Fetching live portfolio...'}
              </span>
            </div>
          )}
          

          {/* Partial Valuation Warning Badge - improved messaging */}
          {isLoadingPrices && openTrades.length > 0 && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-center gap-2">
              <Loader2 className="h-4 w-4 text-blue-400 animate-spin flex-shrink-0" />
              <span className="text-sm text-blue-400">
                Loading prices for your positions...
              </span>
            </div>
          )}
          {!isLoadingPrices && (portfolioValuation.hasMissingPrices || failedSymbols.length > 0) && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-400 flex-shrink-0" />
                <span className="text-sm text-amber-400">
                  Partial valuation — some positions excluded from totals
                </span>
              </div>
              <div className="text-xs text-amber-400/70 ml-6">
                {failedSymbols.length > 0 
                  ? failedSymbols.map(f => `${f.symbol}: ${f.reason.replace('_', ' ')}`).join(', ')
                  : `Price unavailable: ${portfolioValuation.missingSymbols.join(', ')}`
                }
              </div>
              {/* DEBUG: Development only - remove after validation */}
              {import.meta.env.DEV && (failedSymbols.some(f => ['BTC', 'ETH', 'SOL'].includes(f.symbol))) && (
                <div className="text-xs text-red-400 mt-1 font-mono">
                  DEBUG: pairs={JSON.stringify(debugInfo.holdingsPairs)}, fetched={debugInfo.fetchedCount}
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════
              TOP — PRIMARY METRIC (FULL WIDTH)
              Total Live Portfolio Value - the anchor metric
          ═══════════════════════════════════════════════════════════════════════ */}
          {testMode && isInitialized && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="text-center cursor-help py-2">
                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Total Live Portfolio Value</div>
                    <div className={`text-4xl font-bold ${portfolioValuation.totalPnlEur >= 0 ? 'text-white' : 'text-red-400'}`}>
                      {formatEuro(portfolioValuation.totalPortfolioValueEur)}
                    </div>
                    {(() => {
                      const pnlDisplay = formatPnlWithSign(portfolioValuation.totalPnlEur);
                      return (
                        <div className={`text-sm mt-1 ${pnlDisplay.colorClass}`}>
                          {pnlDisplay.sign}{pnlDisplay.value} ({formatPercentage(portfolioValuation.totalPnlPct)}) vs Initial Capital
                        </div>
                      );
                    })()}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-xs">Cash + current market value of open positions − costs.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════
              MIDDLE SECTION — 2 COLUMNS
              Left: Results (Performance logic) | Right: Where Your Money Is Now (Vertical bar)
          ═══════════════════════════════════════════════════════════════════════ */}
          {testMode && isInitialized && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* ═══════════════════════════════════════════════════════════════════════
                  LEFT COLUMN — RESULTS (Performance Logic)
              ═══════════════════════════════════════════════════════════════════════ */}
              <div className="p-4 bg-slate-800/40 rounded-lg border border-slate-600/30 space-y-3">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Results</div>
                
                {/* Initial Capital - inline, compact */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 cursor-help text-sm">
                        <span className="text-slate-400">Initial Capital:</span>
                        <span className="font-semibold text-slate-200">{formatEuro(portfolioValuation.startingCapitalEur)}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Money initially committed to trading (excluding later deposits).</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                
                {/* Divider */}
                <div className="border-t border-slate-600/40"></div>
                
                {/* Total P&L - Primary, visually dominant */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="cursor-help">
                        <div className="text-xs text-slate-400 mb-1">Total P&L</div>
                        {(() => {
                          const pnl = formatPnlWithSign(portfolioValuation.totalPnlEur);
                          return (
                            <div className={`text-2xl font-bold ${pnl.colorClass}`}>
                              {pnl.sign}{pnl.value}
                              <span className="text-base font-semibold ml-1.5">({formatPercentage(portfolioValuation.totalPnlPct)})</span>
                            </div>
                          );
                        })()}
                        <div className="text-xs text-slate-500 mt-0.5">Overall performance vs Initial Capital</div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Overall gain or loss compared to your initial capital.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                
                {/* Unrealized P&L - nested, subordinate */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="ml-3 pl-3 border-l-2 border-slate-500/40 cursor-help py-1">
                        <div className="flex items-center gap-1.5 text-xs text-slate-400/80 mb-0.5">
                          <span>Unrealized P&L</span>
                          <span className="text-[10px] text-slate-500">(Live)</span>
                          {portfolioValuation.hasMissingPrices && (
                            <AlertCircle className="h-3 w-3 text-amber-400" />
                          )}
                        </div>
                        {(() => {
                          const unrealPnl = formatPnlWithSign(portfolioValuation.unrealizedPnlEur);
                          return (
                            <div className={`text-lg font-semibold ${unrealPnl.colorClass} opacity-90`}>
                              {unrealPnl.sign}{unrealPnl.value}
                            </div>
                          );
                        })()}
                        <div className="text-[10px] text-slate-500 mt-0.5">Included in Total P&L · Trades in progress</div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-xs">Profit or loss on open trades. Included in Total P&L.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              {/* ═══════════════════════════════════════════════════════════════════════
                  RIGHT COLUMN — WHERE YOUR MONEY IS NOW (Vertical Bar)
              ═══════════════════════════════════════════════════════════════════════ */}
              <div className="p-4 bg-slate-800/40 rounded-lg border border-slate-600/30 flex flex-col">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Where Your Money Is Now</div>
                
                {(() => {
                  const cash = portfolioValuation.cashEur;
                  const invested = portfolioValuation.openPositionsValueEur;
                  const gas = portfolioValuation.gasSpentEur;
                  const total = cash + invested;
                  
                  const cashPct = total > 0 ? (cash / total) * 100 : 100;
                  const investedPct = total > 0 ? (invested / total) * 100 : 0;
                  
                  return (
                    <div className="flex gap-4 flex-1 items-stretch">
                      {/* Vertical Stacked Bar - fixed narrow width, stretches to container height */}
                      <div className="w-10 shrink-0 rounded-md overflow-hidden flex flex-col bg-slate-900/50 border border-slate-600/30">
                        {/* Cash segment (green) - top */}
                        {cashPct > 0 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div 
                                  className="bg-emerald-500/80 hover:bg-emerald-500 transition-colors cursor-help w-full"
                                  style={{ height: `${cashPct}%`, minHeight: cashPct > 5 ? '8px' : '0' }}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="right">
                                <p className="text-xs">Funds not currently invested.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        
                        {/* Invested segment (blue) - bottom */}
                        {investedPct > 0 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div 
                                  className="bg-blue-500/80 hover:bg-blue-500 transition-colors cursor-help w-full"
                                  style={{ height: `${investedPct}%`, minHeight: investedPct > 5 ? '8px' : '0' }}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="right">
                                <p className="text-xs">Current market value of open positions.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                      
                      {/* Legend with values */}
                      <div className="flex flex-col justify-center gap-2 text-xs">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-2 cursor-help">
                                <div className="w-3 h-3 rounded-sm bg-emerald-500/80"></div>
                                <div>
                                  <span className="text-slate-400">Cash (secured)</span>
                                  <div className="font-semibold text-emerald-400">{formatEuro(cash)}</div>
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Funds not currently invested.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-2 cursor-help">
                                <div className="w-3 h-3 rounded-sm bg-blue-500/80"></div>
                                <div>
                                  <span className="text-slate-400">Invested (live)</span>
                                  <div className="flex items-center gap-1 font-semibold text-blue-400">
                                    {formatEuro(invested)}
                                    {portfolioValuation.hasMissingPrices && (
                                      <AlertCircle className="h-3 w-3 text-amber-400" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Current market value of open positions.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-2 cursor-help">
                                <Fuel className="w-3 h-3 text-amber-400" />
                                <div>
                                  <span className="text-slate-400">Costs (gas)</span>
                                  <div className="font-semibold text-amber-400">−{formatEuro(gas)}</div>
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Estimated transaction costs.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                  );
                })()}
              </div>
              
            </div>
          )}
          
          {/* ═══════════════════════════════════════════════════════════════════════
              OPEN POSITIONS
              Existing crypto holdings breakdown
          ═══════════════════════════════════════════════════════════════════════ */}
          {testMode && isInitialized && (
            <div className="space-y-2">
              {liveAggregates.walletAssets.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Open Positions</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {liveAggregates.walletAssets.map(renderWalletAssetCard)}
                  </div>
                </>
              )}
              
              {liveAggregates.walletAssets.length === 0 && !tradesLoading && (
                <div className="text-center py-6">
                  <p className="text-slate-400 text-sm">No open positions. Start trading to see holdings.</p>
                </div>
              )}
            </div>
          )}
          
          {/* ═══════════════════════════════════════════════════════════════════════
              LIVE MODE: LEDGER VIEW (SYSTEM ACCOUNTING)
              This is the existing dashboard view - unchanged, authoritative for trading
          ═══════════════════════════════════════════════════════════════════════ */}
          {!testMode && (
            <div className="space-y-6">
              {/* Ledger Label */}
              <div className="flex items-center gap-2 border-b border-slate-700 pb-2">
                <BarChart3 className="h-4 w-4 text-blue-400" />
                <span className="text-sm font-medium text-slate-300">Ledger (System Accounting)</span>
                <span className="text-xs text-slate-500">— Source of truth for trading decisions</span>
              </div>
              
              {/* Ledger Total Value */}
              <div className="text-center py-2">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Total Portfolio Value (Ledger)</div>
                <div className="text-4xl font-bold text-white">
                  {formatEuro(metrics.total_portfolio_value_eur)}
                </div>
                <div className="text-sm text-slate-400 mt-1">
                  Cash: {formatEuro(metrics.cash_balance_eur)} • Positions: {formatEuro(metrics.current_position_value_eur)}
                </div>
              </div>

              {/* Coinbase Account View (if connected) */}
              {portfolioData?.accounts && portfolioData.accounts.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Connected Coinbase Account
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {portfolioData.accounts.map(renderCoinCard)}
                  </div>
                </div>
              )}
              
              {!portfolioData?.accounts?.length && !fetchingPortfolio && (
                <div className="text-center py-4">
                  <p className="text-slate-400 text-sm">
                    No Coinbase account connected. Ledger data shown above.
                  </p>
                </div>
              )}

              {/* ═══════════════════════════════════════════════════════════════════════
                  LIVE MODE: WALLET REALITY VIEW (ON-CHAIN)
                  Read-only view of actual on-chain wallet balances
                  Shows drift between ledger and reality - NO AUTO-SYNC
              ═══════════════════════════════════════════════════════════════════════ */}
              <div className="mt-6 pt-4 border-t border-slate-700">
                <WalletRealityPanel 
                  ledgerTotalEur={metrics.total_portfolio_value_eur}
                  openPositionSymbols={openTrades.map(t => t.cryptocurrency.replace('-EUR', '').replace('-USD', ''))}
                />
              </div>
            </div>
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
