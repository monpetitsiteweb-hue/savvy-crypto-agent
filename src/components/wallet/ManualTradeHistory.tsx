/**
 * Manual Trade History List
 * Shows last N trades from mock_trades where execution_source = 'manual'
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, ExternalLink, History } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ManualTrade {
  id: string;
  trade_type: 'buy' | 'sell';
  cryptocurrency: string;
  amount: number;
  price: number;
  total_value: number;
  executed_at: string;
  tx_hash?: string;
  gas_used_wei?: number;
  gas_cost_eth?: number;
  realized_pnl?: number;
  strategy_trigger?: string;
}

interface ManualTradeHistoryProps {
  userId: string;
  refreshTrigger?: number;
}

export function ManualTradeHistory({ userId, refreshTrigger }: ManualTradeHistoryProps) {
  const [trades, setTrades] = useState<ManualTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Use type assertion to bypass generated types that may be out of sync
      const { data, error: queryError } = await (supabase as any)
        .from('mock_trades')
        .select('id, trade_type, cryptocurrency, amount, price, total_value, executed_at, tx_hash, gas_used_wei, gas_cost_eth, realized_pnl, strategy_trigger')
        .eq('user_id', userId)
        .eq('execution_source', 'manual')
        .eq('is_test_mode', false)
        .order('executed_at', { ascending: false })
        .limit(20);

      if (queryError) {
        throw queryError;
      }

      setTrades((data || []) as ManualTrade[]);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch trade history');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades, refreshTrigger]);

  const formatEur = (value: number) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="h-5 w-5" />
          Manual Trade History
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchTrades}
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
            {loading ? 'Loading trades...' : 'No manual trades found'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 text-left font-medium text-muted-foreground">Time</th>
                  <th className="py-2 text-left font-medium text-muted-foreground">Side</th>
                  <th className="py-2 text-left font-medium text-muted-foreground">Token</th>
                  <th className="py-2 text-right font-medium text-muted-foreground">Amount</th>
                  <th className="py-2 text-right font-medium text-muted-foreground">Price</th>
                  <th className="py-2 text-right font-medium text-muted-foreground">Value</th>
                  <th className="py-2 text-right font-medium text-muted-foreground">Gas (ETH)</th>
                  <th className="py-2 text-right font-medium text-muted-foreground">P&L</th>
                  <th className="py-2 text-center font-medium text-muted-foreground">Tx</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-2 text-xs">{formatTime(trade.executed_at)}</td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          trade.trade_type === 'buy'
                            ? 'bg-green-500/20 text-green-600'
                            : 'bg-red-500/20 text-red-600'
                        }`}
                      >
                        {trade.trade_type.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 font-medium">{trade.cryptocurrency}</td>
                    <td className="py-2 text-right font-mono">
                      {trade.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </td>
                    <td className="py-2 text-right">{formatEur(trade.price)}</td>
                    <td className="py-2 text-right">{formatEur(trade.total_value)}</td>
                    <td className="py-2 text-right font-mono text-xs">
                      {trade.gas_cost_eth ? trade.gas_cost_eth.toFixed(6) : '-'}
                    </td>
                    <td className="py-2 text-right">
                      {trade.realized_pnl !== null && trade.realized_pnl !== undefined ? (
                        <span className={trade.realized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {formatEur(trade.realized_pnl)}
                        </span>
                      ) : (
                        '-'
                      )}
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
