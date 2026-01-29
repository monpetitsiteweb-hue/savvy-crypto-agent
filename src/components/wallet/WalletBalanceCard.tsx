/**
 * Wallet Balance Card for operator wallet drill
 * Fetches live balances from execution-wallet-balance edge function
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { SUPABASE_URL } from './ManualTradeConstants';

interface TokenBalance {
  symbol: string;
  amount: number;
  amount_wei?: string;
  amount_raw?: string;
  value_usd: number;
  value_eur: number;
  price_usd: number;
}

interface WalletBalances {
  ETH: TokenBalance;
  WETH: TokenBalance;
  USDC: TokenBalance;
}

interface BalanceResponse {
  success: boolean;
  address: string | null;
  chain_id: number;
  balances: WalletBalances;
  total_value_usd: number;
  total_value_eur: number;
  is_funded: boolean;
  fetched_at: string;
  error?: string;
}

interface WalletBalanceCardProps {
  onBalanceFetched?: (balances: WalletBalances | null, address: string | null) => void;
}

export function WalletBalanceCard({ onBalanceFetched }: WalletBalanceCardProps) {
  const [balances, setBalances] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/execution-wallet-balance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const result: BalanceResponse = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      setBalances(result);
      onBalanceFetched?.(result.balances, result.address);
    } catch (err: any) {
      const msg = err.message || 'Failed to fetch balances';
      setError(msg);
      onBalanceFetched?.(null, null);
    } finally {
      setLoading(false);
    }
  }, [onBalanceFetched]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const formatBalance = (amount: number, decimals: number = 6) => {
    if (amount === 0) return '0';
    if (amount < 0.000001) return '< 0.000001';
    return amount.toLocaleString(undefined, { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: decimals 
    });
  };

  const formatEur = (value: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(value);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Wallet Balances
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchBalances}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive mb-4">
            {error}
          </div>
        )}

        {balances?.address ? (
          <div className="space-y-4">
            {/* Address display */}
            <div className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded">
              {balances.address}
            </div>

            {/* Token balances grid */}
            <div className="grid grid-cols-3 gap-4">
              {/* ETH */}
              <div className="p-3 bg-muted/50 rounded">
                <div className="text-sm font-medium text-muted-foreground">ETH</div>
                <div className="text-lg font-semibold">{formatBalance(balances.balances.ETH.amount, 6)}</div>
                <div className="text-xs text-muted-foreground">{formatEur(balances.balances.ETH.value_eur)}</div>
              </div>

              {/* WETH */}
              <div className="p-3 bg-muted/50 rounded">
                <div className="text-sm font-medium text-muted-foreground">WETH</div>
                <div className="text-lg font-semibold">{formatBalance(balances.balances.WETH.amount, 6)}</div>
                <div className="text-xs text-muted-foreground">{formatEur(balances.balances.WETH.value_eur)}</div>
              </div>

              {/* USDC */}
              <div className="p-3 bg-muted/50 rounded">
                <div className="text-sm font-medium text-muted-foreground">USDC</div>
                <div className="text-lg font-semibold">{formatBalance(balances.balances.USDC.amount, 2)}</div>
                <div className="text-xs text-muted-foreground">{formatEur(balances.balances.USDC.value_eur)}</div>
              </div>
            </div>

            {/* Total value */}
            <div className="pt-2 border-t border-border flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total Value</span>
              <span className="font-semibold">{formatEur(balances.total_value_eur)}</span>
            </div>

            <div className="text-xs text-muted-foreground text-right">
              Last updated: {new Date(balances.fetched_at).toLocaleTimeString()}
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground text-sm">
            {loading ? 'Loading balances...' : 'No wallet found. Create one first.'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
