/**
 * WalletRealityPanel - Read-only on-chain wallet view
 * 
 * PURPOSE: Display actual on-chain wallet balances alongside ledger view
 * This is for VISIBILITY ONLY - no ledger mutation, no reconciliation
 * 
 * SUPPORTED TOKENS: ETH, WETH, USDC, USDT (from execution-wallet-balance)
 * 
 * LIMITATIONS:
 * - Only shows base assets (ETH, WETH, USDC, USDT)
 * - Does NOT show traded tokens (BTC, SOL, etc.) held in wallet
 * - Labeled as "Partial Wallet View" if user has open positions in other tokens
 * 
 * DATA SOURCE: execution-wallet-balance Edge Function
 * PRICE SOURCE: CoinGecko via execution-wallet-balance (aligned with EUR)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, RefreshCw, Wallet, ExternalLink, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatEuro } from '@/utils/currencyFormatter';

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
    USDT?: TokenBalance;
  };
  total_value_usd: number;
  total_value_eur: number;
  is_funded: boolean;
  fetched_at: string;
  error?: string;
}

interface WalletRealityPanelProps {
  ledgerTotalEur: number;
  openPositionSymbols?: string[]; // Symbols user has open positions in
  onDriftCalculated?: (driftEur: number) => void;
}

// Tokens we can query on-chain
const SUPPORTED_TOKENS = ['ETH', 'WETH', 'USDC', 'USDT'];

export function WalletRealityPanel({ 
  ledgerTotalEur, 
  openPositionSymbols = [],
  onDriftCalculated 
}: WalletRealityPanelProps) {
  const [walletData, setWalletData] = useState<WalletBalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  
  // Rate limiting
  const lastFetchRef = useRef<number>(0);
  const fetchingRef = useRef(false);
  const MIN_FETCH_INTERVAL_MS = 10000; // 10 seconds

  // Check if user has tokens we can't query
  const unsupportedTokens = openPositionSymbols.filter(
    sym => !SUPPORTED_TOKENS.includes(sym.toUpperCase())
  );
  const hasUnsupportedTokens = unsupportedTokens.length > 0;

  const fetchWalletBalance = useCallback(async (isManualRefresh = false) => {
    // Prevent concurrent fetches
    if (fetchingRef.current) return;
    
    // Rate limiting (skip for initial load)
    const now = Date.now();
    if (!isManualRefresh && lastFetchRef.current > 0 && now - lastFetchRef.current < MIN_FETCH_INTERVAL_MS) {
      return;
    }

    fetchingRef.current = true;
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Not authenticated');
        return;
      }

      const response = await supabase.functions.invoke('execution-wallet-balance', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to fetch wallet balance');
      }

      const data = response.data as WalletBalanceData;
      
      if (data.error) {
        // No wallet found is expected for some users
        if (data.error === 'No wallet found') {
          setWalletData(null);
          setError('No execution wallet');
        } else {
          throw new Error(data.error);
        }
      } else {
        setWalletData(data);
        lastFetchRef.current = Date.now();
        
        // Report drift to parent
        if (onDriftCalculated && data.total_value_eur !== undefined) {
          const drift = data.total_value_eur - ledgerTotalEur;
          onDriftCalculated(drift);
        }
      }
    } catch (err: any) {
      console.error('[WalletRealityPanel] Fetch error:', err);
      setError(err.message || 'Failed to fetch wallet data');
    } finally {
      fetchingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [ledgerTotalEur, onDriftCalculated]);

  // Initial fetch
  useEffect(() => {
    fetchWalletBalance();
  }, [fetchWalletBalance]);

  // Calculate drift
  const walletTotalEur = walletData?.total_value_eur ?? 0;
  const driftEur = walletTotalEur - ledgerTotalEur;
  const driftPct = ledgerTotalEur !== 0 ? (driftEur / Math.abs(ledgerTotalEur)) * 100 : 0;
  const isDriftPositive = driftEur > 0;
  const isDriftNegative = driftEur < 0;
  const hasMeaningfulDrift = Math.abs(driftEur) >= 0.01; // More than 1 cent

  // Format helpers
  const formatAmount = (amount: number, symbol: string) => {
    if (symbol === 'USDC' || symbol === 'USDT') {
      return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return amount.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  };

  // Loading state
  if (loading) {
    return (
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-6 w-20" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-8 w-32" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // No wallet state
  if (error === 'No execution wallet') {
    return (
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Wallet (On-Chain Reality)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">
            No execution wallet created yet. Create one to enable live trading.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="bg-slate-800/50 border-slate-700 border-red-500/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Wallet (On-Chain Reality)
            <Badge variant="destructive" className="text-xs">Error</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-400 mb-2">{error}</p>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => fetchWalletBalance(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Success state
  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Wallet (On-Chain Reality)
            {hasUnsupportedTokens && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-amber-400 border-amber-400/40 text-xs">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Partial View
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">
                      Cannot query on-chain balances for: {unsupportedTokens.join(', ')}. 
                      Only ETH, WETH, USDC, USDT are shown.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchWalletBalance(true)}
              disabled={refreshing}
              className="h-7 px-2"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
            {walletData?.address && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a 
                      href={`https://basescan.org/address/${walletData.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">View on BaseScan</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Total Value */}
        <div>
          <div className="text-2xl font-bold text-white">
            {formatEuro(walletTotalEur)}
          </div>
          <div className="text-xs text-slate-500">
            ≈ ${walletData?.total_value_usd?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '0.00'} USD
          </div>
        </div>

        {/* Token Breakdown */}
        <div className="grid grid-cols-2 gap-2">
          {walletData?.balances && Object.entries(walletData.balances).map(([symbol, token]) => {
            if (!token || token.amount === 0) return null;
            return (
              <div 
                key={symbol} 
                className="bg-slate-700/30 rounded-lg p-2 text-sm"
              >
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">{symbol}</span>
                  <span className="text-white">{formatEuro(token.value_eur)}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {formatAmount(token.amount, symbol)} {symbol}
                </div>
              </div>
            );
          })}
        </div>

        {/* Drift Indicator - MANDATORY */}
        <div className="border-t border-slate-700 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Execution Drift (Wallet vs Ledger)</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-slate-600 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">
                      Difference between on-chain wallet value and internal ledger.
                      Positive = wallet has more than ledger shows.
                      Negative = ledger shows more than wallet has.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className={`text-sm font-medium ${
              !hasMeaningfulDrift ? 'text-slate-500' :
              isDriftPositive ? 'text-emerald-400' : 
              isDriftNegative ? 'text-red-400' : 
              'text-slate-400'
            }`}>
              {hasMeaningfulDrift ? (
                <>
                  {isDriftPositive ? '+' : ''}{formatEuro(driftEur)}
                  <span className="text-xs ml-1 opacity-70">
                    ({isDriftPositive ? '+' : ''}{driftPct.toFixed(1)}%)
                  </span>
                </>
              ) : (
                <span className="text-slate-500">No drift</span>
              )}
            </div>
          </div>
        </div>

        {/* Metadata */}
        <div className="text-xs text-slate-600 flex items-center justify-between">
          <span>
            Chain: Base ({walletData?.chain_id})
          </span>
          <span>
            Updated: {walletData?.fetched_at ? new Date(walletData.fetched_at).toLocaleTimeString() : 'N/A'}
          </span>
        </div>

        {/* Disclaimer */}
        <div className="text-xs text-slate-600 bg-slate-900/50 rounded p-2 flex items-start gap-2">
          <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>
            Read-only view. Trading decisions use the Ledger, not this wallet view.
            {hasUnsupportedTokens && ' Some token balances may not be shown.'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
