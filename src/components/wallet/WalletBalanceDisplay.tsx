import { useState, useEffect, useRef, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, Wallet, TrendingUp, DollarSign, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface TokenBalance {
  symbol: string;
  amount: number;
  amount_wei?: string;
  amount_raw?: string;
  value_usd: number;
  value_eur: number;
  price_usd: number;
}

interface WalletBalanceData {
  success: boolean;
  address: string;
  chain_id: number;
  balances: {
    ETH: TokenBalance;
    WETH: TokenBalance;
    USDC: TokenBalance;
  };
  total_value_usd: number;
  total_value_eur: number;
  is_funded: boolean;
  fetched_at: string;
  error?: string;
}

interface WalletBalanceDisplayProps {
  walletAddress: string;
  onBalanceUpdate?: (isFunded: boolean, totalValue: number, balances?: {
    ETH: { symbol: string; amount: number };
    WETH: { symbol: string; amount: number };
    USDC: { symbol: string; amount: number };
  }) => void;
}

// Polling interval in ms
const POLL_INTERVAL_MS = 30000;
// Minimum time between fetches to prevent spam
const MIN_FETCH_INTERVAL_MS = 5000;
// Backoff multiplier on errors
const ERROR_BACKOFF_MULTIPLIER = 2;
const MAX_BACKOFF_MS = 120000;

export function WalletBalanceDisplay({ walletAddress, onBalanceUpdate }: WalletBalanceDisplayProps) {
  const [balanceData, setBalanceData] = useState<WalletBalanceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Refs to prevent re-renders from causing loops
  const isFetchingRef = useRef(false);
  const lastFetchTimeRef = useRef(0);
  const errorBackoffRef = useRef(POLL_INTERVAL_MS);
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null);
  const onBalanceUpdateRef = useRef(onBalanceUpdate);
  
  // Keep callback ref updated without triggering effects
  useEffect(() => {
    onBalanceUpdateRef.current = onBalanceUpdate;
  }, [onBalanceUpdate]);

  const fetchBalances = useCallback(async (showToast = false) => {
    // In-flight lock: don't start a new fetch if one is running
    if (isFetchingRef.current) {
      console.log('[WalletBalanceDisplay] Fetch already in progress, skipping');
      return;
    }

    // Rate limit: don't fetch if we fetched recently (unless manual refresh)
    const now = Date.now();
    if (!showToast && now - lastFetchTimeRef.current < MIN_FETCH_INTERVAL_MS) {
      console.log('[WalletBalanceDisplay] Rate limited, skipping fetch');
      return;
    }

    isFetchingRef.current = true;
    lastFetchTimeRef.current = now;
    
    if (showToast) {
      setIsRefreshing(true);
    } else if (!balanceData) {
      // Only show loading skeleton on initial load
      setIsLoading(true);
    }
    
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke<WalletBalanceData>(
        'execution-wallet-balance'
      );

      if (fnError) {
        throw new Error(fnError.message || 'Failed to fetch balances');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Balance fetch failed');
      }

      setBalanceData(data);
      // Reset backoff on success
      errorBackoffRef.current = POLL_INTERVAL_MS;
      
      // Call callback via ref (doesn't trigger re-render loop)
      if (onBalanceUpdateRef.current) {
        onBalanceUpdateRef.current(data.is_funded, data.total_value_usd, {
          ETH: { symbol: 'ETH', amount: data.balances.ETH.amount },
          WETH: { symbol: 'WETH', amount: data.balances.WETH.amount },
          USDC: { symbol: 'USDC', amount: data.balances.USDC.amount },
        });
      }

      if (showToast) {
        toast({
          title: "Balances Updated",
          description: `Total: $${data.total_value_usd.toFixed(2)}`,
        });
      }
    } catch (err) {
      console.error('[WalletBalanceDisplay] Error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      
      // Exponential backoff on errors
      errorBackoffRef.current = Math.min(
        errorBackoffRef.current * ERROR_BACKOFF_MULTIPLIER, 
        MAX_BACKOFF_MS
      );
      console.log(`[WalletBalanceDisplay] Next retry in ${errorBackoffRef.current}ms`);
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [balanceData, toast]); // Minimal deps - balanceData only for initial load check

  // Setup polling on mount, cleanup on unmount
  useEffect(() => {
    // Initial fetch
    fetchBalances();
    
    // Setup interval for polling
    const setupInterval = () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }
      intervalIdRef.current = setInterval(() => {
        fetchBalances();
      }, errorBackoffRef.current);
    };
    
    setupInterval();
    
    // Cleanup on unmount
    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
  }, []); // Empty deps - run once on mount

  const handleManualRefresh = () => {
    fetchBalances(true);
  };

  const formatAmount = (amount: number, decimals = 6): string => {
    if (amount === 0) return '0';
    if (amount < 0.000001) return '<0.000001';
    return amount.toLocaleString(undefined, { 
      minimumFractionDigits: 2,
      maximumFractionDigits: decimals 
    });
  };

  const formatUsd = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatEur = (amount: number): string => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  if (isLoading && !balanceData) {
    return (
      <Card className="p-6 bg-slate-900 border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-32 bg-slate-800" />
          <Skeleton className="h-8 w-8 rounded bg-slate-800" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-20 w-full bg-slate-800" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-16 w-full bg-slate-800" />
            <Skeleton className="h-16 w-full bg-slate-800" />
            <Skeleton className="h-16 w-full bg-slate-800" />
          </div>
        </div>
      </Card>
    );
  }

  if (error && !balanceData) {
    return (
      <Card className="p-6 bg-slate-900 border-slate-700">
        <div className="flex items-center gap-3 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>Failed to load balances: {error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleManualRefresh}
            className="ml-auto text-slate-400 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </Card>
    );
  }

  if (!balanceData) return null;

  const { balances, total_value_usd, total_value_eur, is_funded } = balanceData;

  return (
    <Card className="p-6 bg-slate-900 border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Wallet className="w-5 h-5 text-blue-400" />
          Wallet Balances
        </h3>
        <div className="flex items-center gap-2">
          {is_funded ? (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
              Funded
            </Badge>
          ) : (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
              Not Funded
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="text-slate-400 hover:text-white"
          >
            {isRefreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Total Value */}
      <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-lg p-4 mb-4 border border-blue-500/30">
        <div className="flex items-center gap-2 text-blue-400 mb-1">
          <TrendingUp className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wide">Total Portfolio Value</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold text-white">{formatUsd(total_value_usd)}</span>
          <span className="text-sm text-slate-400">{formatEur(total_value_eur)}</span>
        </div>
      </div>

      {/* Token Balances */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* ETH */}
        <div className={`bg-slate-800/50 rounded-lg p-4 ${balances.ETH.amount > 0 ? 'border border-blue-500/30' : ''}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
              <span className="text-xs font-bold text-blue-400">Ξ</span>
            </div>
            <span className="font-medium text-white">ETH</span>
          </div>
          <div className="text-lg font-semibold text-white">
            {formatAmount(balances.ETH.amount, 6)}
          </div>
          <div className="text-sm text-slate-400">
            {formatUsd(balances.ETH.value_usd)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            @ {formatUsd(balances.ETH.price_usd)}/ETH
          </div>
        </div>

        {/* WETH */}
        <div className={`bg-slate-800/50 rounded-lg p-4 ${balances.WETH.amount > 0 ? 'border border-purple-500/30' : ''}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center">
              <span className="text-xs font-bold text-purple-400">W</span>
            </div>
            <span className="font-medium text-white">WETH</span>
          </div>
          <div className="text-lg font-semibold text-white">
            {formatAmount(balances.WETH.amount, 6)}
          </div>
          <div className="text-sm text-slate-400">
            {formatUsd(balances.WETH.value_usd)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            @ {formatUsd(balances.WETH.price_usd)}/WETH
          </div>
        </div>

        {/* USDC */}
        <div className={`bg-slate-800/50 rounded-lg p-4 ${balances.USDC.amount > 0 ? 'border border-green-500/30' : ''}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
              <DollarSign className="w-3 h-3 text-green-400" />
            </div>
            <span className="font-medium text-white">USDC</span>
          </div>
          <div className="text-lg font-semibold text-white">
            {formatAmount(balances.USDC.amount, 2)}
          </div>
          <div className="text-sm text-slate-400">
            {formatUsd(balances.USDC.value_usd)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Stablecoin
          </div>
        </div>
      </div>

      {/* Last Updated */}
      <div className="mt-4 text-xs text-slate-500 text-right">
        Last updated: {new Date(balanceData.fetched_at).toLocaleTimeString()}
      </div>
    </Card>
  );
}
