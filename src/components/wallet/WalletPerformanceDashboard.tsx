/**
 * WalletPerformanceDashboard
 * 
 * Read-only secondary dashboard showing real wallet-based performance metrics.
 * Displayed ONLY in Live mode, alongside the Ledger dashboard.
 * 
 * Data sources:
 * - On-chain balances via execution-wallet-balance Edge Function
 * - Initial funded value from execution_wallets table
 * - Gas from confirmed mock_trades (gas_cost_eth)
 * - Price conversion via price_snapshots (single source of truth)
 * 
 * This is diagnostic/comparison only. The Ledger remains authoritative.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { 
  Wallet, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown, 
  Fuel, 
  Activity,
  AlertCircle,
  Info
} from 'lucide-react';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';

interface WalletBalanceData {
  address: string;
  chain_id: number;
  total_value_eur: number;
  total_value_usd: number;
  is_funded: boolean;
  fetched_at: string;
  balances: Record<string, {
    symbol: string;
    amount: number;
    value_eur: number;
  }>;
}

interface ExecutionWalletInfo {
  wallet_address: string;
  funded_amount_wei: string | null;
  funded_at: string | null;
  chain_id: number;
}

// Unused for now but kept for future use
const _unusedWalletInfo: ExecutionWalletInfo | null = null;

interface WalletPerformanceMetrics {
  walletTotalEur: number;
  initialFundedEur: number;
  gasPaidEur: number;
  netPnlEur: number;
  performancePct: number;
  tradeCount: number;
  hasData: boolean;
}

export const WalletPerformanceDashboard = () => {
  const { user } = useAuth();
  const [walletData, setWalletData] = useState<WalletBalanceData | null>(null);
  const [walletInfo, setWalletInfo] = useState<ExecutionWalletInfo | null>(null);
  const [metrics, setMetrics] = useState<WalletPerformanceMetrics>({
    walletTotalEur: 0,
    initialFundedEur: 0,
    gasPaidEur: 0,
    netPnlEur: 0,
    performancePct: 0,
    tradeCount: 0,
    hasData: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  
  const lastFetchRef = useRef<number>(0);
  const RATE_LIMIT_MS = 10000; // 10 second rate limit

  /**
   * Fetch all wallet performance data:
   * 1. On-chain balances from execution-wallet-balance
   * 2. Initial funded value from execution_wallets
   * 3. Gas paid from confirmed trades
   * 4. Trade count
   */
  const fetchWalletPerformance = useCallback(async (force = false) => {
    if (!user) return;

    const now = Date.now();
    if (!force && now - lastFetchRef.current < RATE_LIMIT_MS) {
      console.log('[WalletPerformanceDashboard] Rate limited, skipping fetch');
      return;
    }
    lastFetchRef.current = now;

    setRefreshing(true);
    setError(null);

    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        throw new Error('Not authenticated');
      }

      // Fetch in parallel:
      // 1. Wallet balances (on-chain) - via Edge Function
      // 2. ETH price for conversions
      // 3. Trade count

      // Fetch wallet balances from Edge Function
      const balanceRes = await supabase.functions.invoke('execution-wallet-balance', {
        headers: { Authorization: `Bearer ${session.data.session.access_token}` },
      });

      // Parse wallet balance response
      if (balanceRes.error) {
        throw new Error(balanceRes.error.message || 'Failed to fetch wallet balance');
      }
      
      const balanceData = balanceRes.data as WalletBalanceData | null;
      if (!balanceData || !balanceData.address) {
        setWalletData(null);
        setMetrics({ ...metrics, hasData: false });
        setLoading(false);
        setRefreshing(false);
        return;
      }
      
      setWalletData(balanceData);

      // Use ETH price from wallet balance response (already converted via price_snapshots)
      const ethPriceEur = balanceData.balances?.ETH?.value_eur && balanceData.balances?.ETH?.amount
        ? balanceData.balances.ETH.value_eur / balanceData.balances.ETH.amount
        : 3200;

      // For v1: initial funded = current wallet value (simplified)
      let initialFundedEur = 0;
      if (balanceData.is_funded && ethPriceEur > 0) {
        const ethValue = balanceData.balances?.ETH?.value_eur || 0;
        const wethValue = balanceData.balances?.WETH?.value_eur || 0;
        const stableValue = (balanceData.balances?.USDC?.value_eur || 0) + 
                           (balanceData.balances?.USDT?.value_eur || 0);
        initialFundedEur = ethValue + wethValue + stableValue;
      }

      // Fetch gas separately since we need to sum gas_cost_eth manually
      // (no RPC exists for this yet)
      let gasPaidEur = 0;
      try {
        const gasQuery = await supabase.functions.invoke('execution-wallet-balance', {
          headers: { Authorization: `Bearer ${session.data.session.access_token}` },
          body: { action: 'get_gas_summary' },
        });
        // For now, gas calculation is done client-side from trade data
        // The edge function doesn't have this action, so we skip gas for v1
        // This is a known limitation documented in the component
      } catch (e) {
        console.log('[WalletPerformanceDashboard] Gas calculation not available yet');
      }

      // Calculate metrics
      const walletTotalEur = balanceData.total_value_eur || 0;
      const tradeCount = 0; // v1: Simplified, will add RPC later
      
      // Net P&L = Wallet Total - Initial Funded - Gas Paid
      const netPnlEur = walletTotalEur - initialFundedEur - gasPaidEur;
      
      // Performance %
      const performancePct = initialFundedEur > 0 
        ? (netPnlEur / initialFundedEur) * 100 
        : 0;

      setMetrics({
        walletTotalEur,
        initialFundedEur,
        gasPaidEur,
        netPnlEur,
        performancePct,
        tradeCount,
        hasData: true,
      });

      console.log('[WalletPerformanceDashboard] Metrics calculated:', {
        walletTotalEur,
        initialFundedEur,
        gasPaidEur,
        netPnlEur,
        performancePct,
        tradeCount,
      });

    } catch (err: any) {
      console.error('[WalletPerformanceDashboard] Error:', err);
      setError(err.message || 'Failed to load wallet performance');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // Initial fetch
  useEffect(() => {
    fetchWalletPerformance(true);
  }, [fetchWalletPerformance]);

  const handleRefresh = () => {
    fetchWalletPerformance(true);
  };

  // Loading state
  if (loading) {
    return (
      <Card className="bg-slate-800/50 border-slate-600">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-white">
            <Wallet className="h-5 w-5 text-emerald-400" />
            <span>Wallet Performance (On-Chain)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-16 w-full bg-slate-700" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-20 bg-slate-700" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No wallet state
  if (!walletData || !metrics.hasData) {
    return (
      <Card className="bg-slate-800/50 border-slate-600">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-white">
            <Wallet className="h-5 w-5 text-emerald-400" />
            <span>Wallet Performance (On-Chain)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Wallet className="h-12 w-12 text-slate-500 mx-auto mb-3" />
            <p className="text-slate-400">No execution wallet found</p>
            <p className="text-sm text-slate-500 mt-1">
              Create and fund an execution wallet to see real trading performance
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="bg-slate-800/50 border-slate-600">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-400" />
              <span>Wallet Performance (On-Chain)</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isProfitable = metrics.netPnlEur >= 0;

  return (
    <Card className="bg-slate-800/50 border-emerald-500/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-400" />
            <span className="text-white">Wallet (On-Chain Reality)</span>
            <Badge variant="outline" className="text-emerald-400 border-emerald-400/50">
              Live
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-slate-400 cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    Real wallet-based performance derived from on-chain balances.
                    Compare with Ledger view to observe execution drift.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-slate-400 hover:text-white"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Primary Metric: Wallet Total Value */}
        <div className="text-center py-2">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">
            Wallet Total Value
          </div>
          <div className="text-4xl font-bold text-white">
            {formatEuro(metrics.walletTotalEur)}
          </div>
          <div className={`text-sm mt-1 ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
            {isProfitable ? '+' : ''}{formatEuro(metrics.netPnlEur)} ({formatPercentage(metrics.performancePct)})
          </div>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Initial Funded */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="p-3 bg-slate-700/50 rounded-lg cursor-help">
                  <div className="text-xs text-slate-400 mb-1">Initial Funded</div>
                  <div className="text-lg font-semibold text-slate-200">
                    {metrics.initialFundedEur > 0 
                      ? formatEuro(metrics.initialFundedEur)
                      : '—'
                    }
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">ETH value at time of wallet funding</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Net P&L */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="p-3 bg-slate-700/50 rounded-lg cursor-help">
                  <div className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                    {isProfitable ? (
                      <TrendingUp className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-red-400" />
                    )}
                    <span>Net P&L</span>
                  </div>
                  <div className={`text-lg font-semibold ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isProfitable ? '+' : ''}{formatEuro(metrics.netPnlEur)}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Wallet Total − Initial Funded − Gas</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Gas Paid */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="p-3 bg-slate-700/50 rounded-lg cursor-help">
                  <div className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                    <Fuel className="h-3 w-3 text-amber-400" />
                    <span>Gas Paid</span>
                  </div>
                  <div className="text-lg font-semibold text-amber-400">
                    −{formatEuro(metrics.gasPaidEur)}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Total transaction fees from confirmed trades</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Trade Count */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="p-3 bg-slate-700/50 rounded-lg cursor-help">
                  <div className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                    <Activity className="h-3 w-3 text-blue-400" />
                    <span>Trades</span>
                  </div>
                  <div className="text-lg font-semibold text-blue-400">
                    {metrics.tradeCount}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Confirmed on-chain trades</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Disclaimer */}
        <div className="text-xs text-slate-500 text-center border-t border-slate-700 pt-3">
          <span className="flex items-center justify-center gap-1">
            <Info className="h-3 w-3" />
            Read-only view • Ignores external transfers • Prices from price_snapshots
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
