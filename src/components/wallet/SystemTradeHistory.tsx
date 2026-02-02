/**
 * System Trading Wallet — On-Chain Trades
 * Shows trades from real_trades table exclusively
 * This represents actual on-chain executions from the system wallet
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, ExternalLink, Building2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface RealTrade {
  id: string;
  created_at: string;
  side: 'BUY' | 'SELL';
  cryptocurrency: string;
  amount: number;
  price: number;
  total_value: number;
  execution_status: 'SUBMITTED' | 'MINED' | 'CONFIRMED' | 'REVERTED' | 'DROPPED';
  tx_hash: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  SUBMITTED: { label: 'Pending', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  MINED: { label: 'Mined', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  CONFIRMED: { label: 'Success', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  REVERTED: { label: 'Failed', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  DROPPED: { label: 'Dropped', className: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
};

export function SystemTradeHistory() {
  const [trades, setTrades] = useState<RealTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTrades = useCallback(async () => {
    try {
      // Query real_trades exclusively
      const { data, error: queryError } = await (supabase as any)
        .from('real_trades')
        .select('id, created_at, side, cryptocurrency, amount, price, total_value, execution_status, tx_hash')
        .eq('execution_target', 'REAL')
        .order('created_at', { ascending: false })
        .limit(50);

      if (queryError) {
        throw queryError;
      }

      const rows = (data || []) as RealTrade[];
      console.log('[UI] loaded system real_trades', rows.length);
      setTrades(rows);
      setError(null);

      // Check if any trades are still pending (SUBMITTED or MINED)
      const hasPending = rows.some(t => t.execution_status === 'SUBMITTED' || t.execution_status === 'MINED');
      return hasPending;
    } catch (err: any) {
      console.error('[SystemTradeHistory] Fetch error:', err);
      setError(err.message || 'Failed to fetch trades');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and polling setup
  useEffect(() => {
    const startPolling = async () => {
      const hasPending = await fetchTrades();
      
      // Only poll if there are pending trades
      if (hasPending && !pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(async () => {
          const stillPending = await fetchTrades();
          if (!stillPending && pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }, 4000); // Poll every 4 seconds
      }
    };

    startPolling();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [fetchTrades]);

  const handleRefresh = async () => {
    setLoading(true);
    await fetchTrades();
  };

  const formatEur = (value: number) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.DROPPED;
    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          🏦 System Trading Wallet — On-Chain Trades
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
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

        {trades.length === 0 ? (
          <div className="text-muted-foreground text-sm text-center py-8">
            {loading ? 'Loading trades...' : 'No system trades found'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 text-left font-medium text-muted-foreground">Time</th>
                  <th className="py-2 text-left font-medium text-muted-foreground">Side</th>
                  <th className="py-2 text-left font-medium text-muted-foreground">Asset</th>
                  <th className="py-2 text-right font-medium text-muted-foreground">Amount</th>
                  <th className="py-2 text-right font-medium text-muted-foreground">Price</th>
                  <th className="py-2 text-right font-medium text-muted-foreground">Value</th>
                  <th className="py-2 text-center font-medium text-muted-foreground">Status</th>
                  <th className="py-2 text-center font-medium text-muted-foreground">Tx</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-2 text-xs">{formatTime(trade.created_at)}</td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          trade.side === 'BUY'
                            ? 'bg-green-500/20 text-green-600'
                            : 'bg-red-500/20 text-red-600'
                        }`}
                      >
                        {trade.side}
                      </span>
                    </td>
                    <td className="py-2 font-medium">{trade.cryptocurrency}</td>
                    <td className="py-2 text-right font-mono">
                      {trade.amount?.toLocaleString(undefined, { maximumFractionDigits: 6 }) || '-'}
                    </td>
                    <td className="py-2 text-right">{trade.price ? formatEur(trade.price) : '-'}</td>
                    <td className="py-2 text-right">{trade.total_value ? formatEur(trade.total_value) : '-'}</td>
                    <td className="py-2 text-center">
                      {getStatusBadge(trade.execution_status)}
                    </td>
                    <td className="py-2 text-center">
                      {trade.tx_hash ? (
                        <a
                          href={`https://basescan.org/tx/${trade.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:text-blue-400"
                          title={trade.tx_hash}
                        >
                          <ExternalLink className="h-4 w-4 inline" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
