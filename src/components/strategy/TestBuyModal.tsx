import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useRealTimeMarketData } from '@/hooks/useRealTimeMarketData';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface TestBuyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategyId: string | null;
  onSuccess?: () => void;
}

const SYMBOLS = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'ADA-EUR', 'SOL-EUR', 'AVAX-EUR', 'DOT-EUR'];

export function TestBuyModal({ open, onOpenChange, strategyId, onSuccess }: TestBuyModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { getCurrentData } = useRealTimeMarketData();
  const [loading, setLoading] = useState(false);
  const [symbol, setSymbol] = useState<string>('XRP-EUR');
  const [eurAmount, setEurAmount] = useState<string>('500');
  const [priceOverride, setPriceOverride] = useState<string>('');

  const handleConfirm = async () => {
    if (!user || !strategyId) {
      toast({
        title: 'Error',
        description: 'User or strategy not found',
        variant: 'destructive',
      });
      return;
    }

    const eurValue = parseFloat(eurAmount);
    if (!eurValue || eurValue <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'EUR amount must be greater than 0',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);

      // Get current price or use override
      let price: number;
      if (priceOverride && parseFloat(priceOverride) > 0) {
        price = parseFloat(priceOverride);
      } else {
        const priceData = await getCurrentData([symbol]);
        price = priceData[symbol]?.price;
        if (!price) {
          throw new Error(`Could not fetch price for ${symbol}`);
        }
      }

      const qtySuggested = eurValue / price;

      // Build entry_context for manual BUYs (never conflicts with automated contexts)
      const entryContext = {
        trigger_type: 'manual',
        timeframe: 'instant',
        anchor_price: price,
        anchor_ts: new Date().toISOString(),
        trend_regime: 'neutral',
        context_version: 1,
      };

      // Call coordinator with BUY intent
      const intent = {
        userId: user.id,
        strategyId: strategyId,
        symbol: symbol,
        side: 'BUY',
        source: 'manual',
        confidence: 1.0,
        qtySuggested: qtySuggested,
        metadata: {
          position_management: true,
          is_test_mode: true,
          ui_seed: true,
          eur_amount: eurValue,
          price_used: price,
          seed_reason: 'ui_test_buy',
          entry_context: entryContext, // NEW: Entry context for pyramiding
        },
        context: 'MANUAL',
      };

      const { data, error } = await supabase.functions.invoke('trading-decision-coordinator', {
        body: { intent },
      });

      if (error) {
        throw error;
      }

      if (data?.ok && (data?.decision?.action === 'EXECUTE' || data?.decision?.action === 'BUY')) {
        toast({
          title: '✅ Test BUY executed',
          description: `${qtySuggested.toFixed(4)} ${symbol.split('-')[0]} at €${price.toFixed(2)} (€${eurValue})`,
        });
        onOpenChange(false);
        onSuccess?.();
      } else if (data?.ok && (data?.decision?.action === 'BLOCK' || data?.decision?.action === 'DEFER')) {
        toast({
          title: '⚠️ BUY blocked',
          description: data?.decision?.reason || 'Decision was blocked or deferred',
          variant: 'destructive',
        });
      } else {
        throw new Error(data?.error || 'Unknown error occurred');
      }
    } catch (error: any) {
      console.error('[TestBuyModal] Error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create test BUY',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create test BUY (mock trade)</DialogTitle>
          <DialogDescription>
            Create a test BUY trade via the coordinator for position-managed testing
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="symbol">Symbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger id="symbol">
                <SelectValue placeholder="Select symbol" />
              </SelectTrigger>
              <SelectContent>
                {SYMBOLS.map((sym) => (
                  <SelectItem key={sym} value={sym}>
                    {sym}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="eurAmount">Amount in EUR</Label>
            <Input
              id="eurAmount"
              type="number"
              value={eurAmount}
              onChange={(e) => setEurAmount(e.target.value)}
              placeholder="500"
              min="0"
              step="1"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="priceOverride">
              Price override (optional)
              <span className="text-xs text-muted-foreground ml-2">Leave empty to use current price</span>
            </Label>
            <Input
              id="priceOverride"
              type="number"
              value={priceOverride}
              onChange={(e) => setPriceOverride(e.target.value)}
              placeholder="Current market price"
              min="0"
              step="0.01"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !strategyId}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm BUY
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
