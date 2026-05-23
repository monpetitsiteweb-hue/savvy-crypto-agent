/**
 * RealPositionsTable - REAL on-chain open positions, ONE ROW PER TRADE.
 *
 * Behavioral parity with TEST mode (TradingHistory → OpenTradeCard):
 *  - Source: useOpenTrades() (mock_trades BUY where execution_confirmed=true,
 *    minus BUYs whose id is referenced by a confirmed SELL via original_trade_id).
 *  - Rendering: one <OpenTradeCard> per individual BUY trade. NO aggregation.
 *  - Live price: useHoldingsPrices (price-proxy), same as TEST mode.
 *
 * Manual SELL LIVE (custodial REAL):
 *  - Click SELL on a card → opens confirmation Dialog (state-only, no backend).
 *  - User must click "Confirm Sell" → calls trading-decision-coordinator with
 *    mode='real', source='manual', force=false, execution_wallet_id, originalTradeId.
 *  - Coordinator REAL manual fast-path (L3615+) routes to onchain-sign-and-send.
 *  - detectConflicts bypass via manual_override_precedence — never blocked by
 *    cooldown/minHoldPeriod for manual exits.
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useOpenTrades, type OpenTrade } from '@/hooks/useOpenTrades';
import { useHoldingsPrices } from '@/hooks/useHoldingsPrices';
import { useTradesGas } from '@/hooks/useTradesGas';
import { OpenTradeCard } from '@/components/trading/OpenTradeCard';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import type { RealPositionRow } from '@/types/trading';

interface RealPositionsTableProps {
  positions?: RealPositionRow[]; // unused (kept for compat)
  isLoading?: boolean;           // unused (kept for compat)
  onRefresh?: () => void;
}

interface ExecutionWalletRow {
  id: string;
  wallet_address: string;
}

export function RealPositionsTable({ onRefresh }: RealPositionsTableProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { openTrades, isLoading, refresh } = useOpenTrades();
  const { holdingsPrices, isLoadingPrices } = useHoldingsPrices(openTrades);
  const { gasByTradeId } = useTradesGas(openTrades.map(t => t.id));

  const [executionWallet, setExecutionWallet] = useState<ExecutionWalletRow | null>(null);
  const [sellConfirmation, setSellConfirmation] = useState<OpenTrade | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Fetch active execution wallet (mirrors ManualTradeCard pattern)
  useEffect(() => {
    if (!user) {
      setExecutionWallet(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase
        .from('execution_wallets' as any)
        .select('id, wallet_address')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle() as any);
      if (cancelled) return;
      if (error) {
        console.error('[RealPositionsTable] execution_wallets lookup error:', error);
        setExecutionWallet(null);
        return;
      }
      setExecutionWallet(data ? { id: data.id, wallet_address: data.wallet_address } : null);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const resolvePrice = (symbol: string): number | null => {
    const base = toBaseSymbol(symbol);
    const pair = toPairSymbol(base);
    const p = holdingsPrices[pair]?.price ?? holdingsPrices[base]?.price;
    return typeof p === 'number' && p > 0 ? p : null;
  };

  const handleRefresh = () => {
    refresh();
    onRefresh?.();
  };

  const handleDirectSell = async () => {
    if (!sellConfirmation || !user) return;

    if (!executionWallet) {
      toast({
        title: 'No active execution wallet',
        description: 'A funded execution wallet is required to submit a REAL SELL.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const trade = sellConfirmation;
      const base = toBaseSymbol(trade.cryptocurrency);

      const payload = {
        intent: {
          source: 'manual',
          side: 'SELL',
          symbol: base,
          qtySuggested: trade.amount,
          mode: 'real',
          force: false,
          metadata: {
            originalTradeId: trade.id,
            execution_wallet_id: executionWallet.id,
            wallet_address: executionWallet.wallet_address,
            slippage_bps: 100,
          },
        },
      };

      const { data, error } = await supabase.functions.invoke(
        'trading-decision-coordinator',
        { body: payload }
      );

      if (error) throw error;

      toast({
        title: 'SELL submitted',
        description: `Manual SELL for ${base} sent to coordinator. Tx will appear in SELL Trades shortly.`,
      });
      setSellConfirmation(null);
      refresh();
      onRefresh?.();
    } catch (err: any) {
      console.error('[RealPositionsTable] handleDirectSell error:', err);
      toast({
        title: 'SELL failed',
        description: err?.message || 'Coordinator rejected the manual SELL.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading positions...</span>
        </div>
      </Card>
    );
  }

  if (openTrades.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <p>No open positions.</p>
          <p className="text-sm mt-1">Execute a real BUY trade to see positions here.</p>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Open Positions</h3>
            <Badge variant="outline" className="text-xs">REAL</Badge>
            <span className="text-xs text-muted-foreground">
              {openTrades.length} trade{openTrades.length > 1 ? 's' : ''}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {openTrades.map((trade) => (
            <OpenTradeCard
              key={trade.id}
              trade={trade}
              livePrice={resolvePrice(trade.cryptocurrency)}
              gasOverride={gasByTradeId[trade.id] ?? { gasEth: 0, gasEur: 0 }}
              onRequestSell={(t) => setSellConfirmation(t)}
            />
          ))}
        </div>

        {isLoadingPrices && (
          <div className="px-4 pb-3 text-xs text-muted-foreground">
            Loading live prices…
          </div>
        )}
      </Card>

      <Dialog
        open={!!sellConfirmation}
        onOpenChange={(open) => { if (!open && !submitting) setSellConfirmation(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm SELL (LIVE / on-chain)</DialogTitle>
            <DialogDescription>
              This will submit a real on-chain SELL via the custodial bot. The trade
              cannot be cancelled once broadcast.
            </DialogDescription>
          </DialogHeader>

          {sellConfirmation && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Asset</span>
                <span className="font-medium">{toBaseSymbol(sellConfirmation.cryptocurrency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-medium">{sellConfirmation.amount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Entry price</span>
                <span className="font-medium">€{sellConfirmation.price}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Slippage</span>
                <span className="font-medium">1.00%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Execution wallet</span>
                <span className="font-mono text-xs">
                  {executionWallet
                    ? `${executionWallet.wallet_address.slice(0, 6)}…${executionWallet.wallet_address.slice(-4)}`
                    : '— none —'}
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSellConfirmation(null)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDirectSell}
              disabled={submitting || !executionWallet}
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Submitting…</>
              ) : (
                'Confirm Sell'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
