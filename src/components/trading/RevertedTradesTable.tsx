/**
 * RevertedTradesTable — REAL BUY trades that REVERTED on-chain.
 * Header total: "X reverts — Total gas lost: Y €"
 */
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { formatEuro } from '@/utils/currencyFormatter';
import { useRevertedTrades } from '@/hooks/useRevertedTrades';

function getBaseScanUrl(txHash: string, chainId: number): string {
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${txHash}`;
  return `https://basescan.org/tx/${txHash}`;
}

export function RevertedTradesTable() {
  const { rows, isLoading, refresh, totalGasEur } = useRevertedTrades(50);

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading reverted trades...</span>
        </div>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <p>No reverted trades.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <h3 className="font-semibold">{rows.length} reverts</h3>
          <span className="text-sm text-muted-foreground">
            — Total gas lost: <span className="font-mono text-red-500">{formatEuro(totalGasEur)}</span>
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="divide-y max-h-[500px] overflow-y-auto">
        {rows.map((r) => (
          <div key={r.id} className="p-4 hover:bg-muted/50 transition-colors">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">{r.cryptocurrency}</span>
                  <Badge className="bg-emerald-500/20 text-emerald-400">{r.side}</Badge>
                  <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30">
                    REVERTED
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground space-y-0.5">
                  <p>Attempted Qty: {r.amount.toFixed(8)}</p>
                  <p>Attempted Price: {formatEuro(r.price)}</p>
                  <p>Reason: <span className="font-mono">{r.error_reason || '—'}</span></p>
                </div>
              </div>

              <div className="text-right text-xs text-muted-foreground space-y-1">
                <p>{new Date(r.created_at).toLocaleString()}</p>
                <p className="text-red-500">
                  Gas lost: {formatEuro(r.gasEur)}{' '}
                  <span className="text-muted-foreground">({r.gasEth.toFixed(8)} ETH)</span>
                </p>
                <a
                  href={getBaseScanUrl(r.tx_hash, r.chain_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 hover:underline"
                >
                  <span className="font-mono">{r.tx_hash.slice(0, 10)}...{r.tx_hash.slice(-6)}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
