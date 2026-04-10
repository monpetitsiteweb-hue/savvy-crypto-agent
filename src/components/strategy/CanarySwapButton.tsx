import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, ExternalLink, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTestMode } from '@/hooks/useTradeViewFilter';

const CANARY_PARAMS = {
  symbol: 'ETH',
  side: 'SELL' as const,
  amount: 0.002,
  slippageBps: 50,
  chainId: 8453,
  quote: 'USDC',
} as const;

type SwapStatus = 'idle' | 'confirming' | 'submitting' | 'submitted' | 'confirmed' | 'failed';

interface SwapResult {
  txHash?: string;
  error?: string;
  tradeId?: string;
  raw?: any;
}

export const CanarySwapButton: React.FC = () => {
  const { testMode } = useTestMode();
  const [status, setStatus] = useState<SwapStatus>('idle');
  const [result, setResult] = useState<SwapResult | null>(null);

  if (!testMode) return null;

  const executeCanarySwap = async () => {
    setStatus('submitting');
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('onchain-sign-and-send', {
        body: {
          symbol: CANARY_PARAMS.symbol,
          side: CANARY_PARAMS.side,
          amount: CANARY_PARAMS.amount,
          slippageBps: CANARY_PARAMS.slippageBps,
          system_operator_mode: true,
        },
      });

      if (error) {
        setStatus('failed');
        setResult({ error: error.message || JSON.stringify(error) });
        return;
      }

      if (!data?.ok) {
        setStatus('failed');
        const errMsg = typeof data?.error === 'string'
          ? data.error
          : data?.error?.message || JSON.stringify(data?.error) || 'Unknown error';
        setResult({ error: errMsg, raw: data });
        return;
      }

      setStatus('submitted');
      setResult({
        txHash: data.txHash,
        tradeId: data.tradeId,
        raw: data,
      });
    } catch (err: any) {
      setStatus('failed');
      setResult({ error: err.message || 'Network error' });
    }
  };

  const resetState = () => {
    setStatus('idle');
    setResult(null);
  };

  const basescanUrl = result?.txHash
    ? `https://basescan.org/tx/${result.txHash}`
    : null;

  return (
    <div className="space-y-4">
      {/* Trigger Button */}
      <Button
        variant="outline"
        onClick={() => setStatus('confirming')}
        disabled={status === 'submitting'}
        className="border-amber-500/50 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20"
      >
        🧪 Canary Swap
      </Button>

      {/* Confirmation Modal */}
      <AlertDialog open={status === 'confirming'} onOpenChange={(open) => !open && setStatus('idle')}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Canary Swap — Confirmation
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="text-muted-foreground">Action</div>
                  <div className="font-mono font-medium">SELL 0.002 ETH</div>
                  <div className="text-muted-foreground">Token reçu</div>
                  <div className="font-mono font-medium">USDC</div>
                  <div className="text-muted-foreground">Chain</div>
                  <div className="font-mono font-medium">Base (8453)</div>
                  <div className="text-muted-foreground">Slippage</div>
                  <div className="font-mono font-medium">50 bps (0.5%)</div>
                  <div className="text-muted-foreground">Wallet</div>
                  <div className="font-mono font-medium text-xs">BOT_ADDRESS (system)</div>
                </div>

                <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                  <strong>⚠️ Ceci est un vrai swap on-chain sur Base.</strong>
                  <br />
                  Des ETH réels seront vendus contre des USDC. Cette action est irréversible.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeCanarySwap}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Confirmer le swap
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Result Display */}
      {(status === 'submitting' || status === 'submitted' || status === 'failed') && (
        <Card className={
          status === 'failed'
            ? 'border-destructive/50'
            : status === 'submitted'
            ? 'border-green-500/50'
            : 'border-amber-500/50'
        }>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2">
              {status === 'submitting' && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  <span className="text-sm font-medium">Exécution en cours…</span>
                </>
              )}
              {status === 'submitted' && (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium text-green-600">Transaction soumise</span>
                  <Badge variant="outline" className="text-green-600 border-green-500/50">submitted</Badge>
                </>
              )}
              {status === 'failed' && (
                <>
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium text-destructive">Échec</span>
                  <Badge variant="destructive">failed</Badge>
                </>
              )}
            </div>

            {result?.txHash && (
              <div className="text-sm space-y-1">
                <div className="text-muted-foreground">TX Hash</div>
                <a
                  href={basescanUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 font-mono text-xs text-primary hover:underline break-all"
                >
                  {result.txHash}
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              </div>
            )}

            {result?.tradeId && (
              <div className="text-sm">
                <span className="text-muted-foreground">Trade ID: </span>
                <span className="font-mono text-xs">{result.tradeId}</span>
              </div>
            )}

            {result?.error && (
              <div className="text-sm">
                <div className="text-muted-foreground mb-1">Erreur complète :</div>
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
                  {result.error}
                </pre>
              </div>
            )}

            {result?.raw && status === 'failed' && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Réponse brute (debug)
                </summary>
                <pre className="mt-1 bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(result.raw, null, 2)}
                </pre>
              </details>
            )}

            {(status === 'submitted' || status === 'failed') && (
              <Button variant="ghost" size="sm" onClick={resetState}>
                Fermer
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
