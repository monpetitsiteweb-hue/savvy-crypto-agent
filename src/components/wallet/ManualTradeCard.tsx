/**
 * Manual Trade Card - BUY or SELL with confirmation modal
 * Routes through trading-decision-coordinator
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { ArrowUpCircle, ArrowDownCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { SUPABASE_URL, MANUAL_STRATEGY_ID, TRADEABLE_TOKENS, SLIPPAGE_OPTIONS } from './ManualTradeConstants';

interface ExecutionResult {
  success: boolean;
  tradeId?: string;
  executed_at?: string;
  executed_price?: number;
  qty?: number;
  tx_hash?: string;
  gas_used_wei?: string;
  gas_cost_eth?: number;
  gas_cost_eur?: number;
  error?: string;
  reason?: string;
}

interface ManualTradeCardProps {
  side: 'BUY' | 'SELL';
  userId: string;
  onTradeComplete?: () => void;
}

export function ManualTradeCard({ side, userId, onTradeComplete }: ManualTradeCardProps) {
  const [token, setToken] = useState<string>('ETH');
  const [amount, setAmount] = useState<string>('');
  const [slippage, setSlippage] = useState<string>('1.0');
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);

  const isBuy = side === 'BUY';
  const Icon = isBuy ? ArrowUpCircle : ArrowDownCircle;

  const handleSubmit = () => {
    const parsedAmount = parseFloat(amount.replace(',', '.'));
    if (!parsedAmount || parsedAmount <= 0) {
      setResult({ success: false, error: 'Invalid amount' });
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    setShowConfirm(false);
    setLoading(true);
    setResult(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      const parsedAmount = parseFloat(amount.replace(',', '.'));

      // Call trading-decision-coordinator with source='manual'
      const response = await fetch(`${SUPABASE_URL}/functions/v1/trading-decision-coordinator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          intent: {
            userId,
            strategyId: MANUAL_STRATEGY_ID,
            symbol: token,
            side,
            source: 'manual',
            confidence: 1.0,
            qtySuggested: parsedAmount,
            reason: `Manual ${side} from operator panel`,
            metadata: {
              context: 'MANUAL',
              slippage_bps: parseFloat(slippage) * 100,
              bypass_volatility_gate: true,
              force: true, // Allow manual override of gates
            },
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      setResult({
        success: data.success === true,
        tradeId: data.tradeId,
        executed_at: data.executed_at,
        executed_price: data.executed_price,
        qty: data.qty,
        tx_hash: data.tx_hash,
        gas_used_wei: data.gas_used_wei,
        gas_cost_eth: data.gas_cost_eth,
        gas_cost_eur: data.gas_cost_eur,
        error: data.error,
        reason: data.reason,
      });

      if (data.success) {
        setAmount('');
        onTradeComplete?.();
      }
    } catch (err: any) {
      setResult({
        success: false,
        error: err.message || 'Trade execution failed',
      });
    } finally {
      setLoading(false);
    }
  };

  const formatEur = (value: number) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className={`text-lg flex items-center gap-2 ${isBuy ? 'text-green-500' : 'text-red-500'}`}>
            <Icon className="h-5 w-5" />
            Manual {side}
          </CardTitle>
          <CardDescription>
            {isBuy ? 'Buy tokens using execution wallet funds' : 'Sell tokens from execution wallet'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Token selection */}
          <div className="space-y-2">
            <Label>Token</Label>
            <Select value={token} onValueChange={setToken}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRADEABLE_TOKENS.map((t) => (
                  <SelectItem key={t.symbol} value={t.symbol}>
                    {t.symbol} - {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount input */}
          <div className="space-y-2">
            <Label>Amount</Label>
            <Input
              type="text"
              placeholder={isBuy ? 'Amount in EUR' : 'Token amount to sell'}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {isBuy ? 'EUR amount to spend' : 'Partial sells allowed'}
            </p>
          </div>

          {/* Slippage selection */}
          <div className="space-y-2">
            <Label>Slippage Tolerance</Label>
            <Select value={slippage} onValueChange={setSlippage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLIPPAGE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s.toString()}>
                    {s}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Submit button */}
          <Button
            onClick={handleSubmit}
            disabled={loading || !amount}
            className="w-full"
            variant={isBuy ? 'default' : 'destructive'}
          >
            {loading ? 'Processing...' : `${side} ${token}`}
          </Button>

          {/* Execution result inline display */}
          {result && (
            <div
              className={`p-3 rounded text-sm ${
                result.success
                  ? 'bg-green-500/10 border border-green-500/20 text-green-600'
                  : 'bg-destructive/10 border border-destructive/20 text-destructive'
              }`}
            >
              {result.success ? (
                <div className="space-y-1">
                  <div className="font-semibold">✓ Trade Executed</div>
                  {result.executed_price && (
                    <div>Price: {formatEur(result.executed_price)}</div>
                  )}
                  {result.qty && (
                    <div>Quantity: {result.qty}</div>
                  )}
                  {result.gas_cost_eth !== undefined && (
                    <div>Gas: {result.gas_cost_eth.toFixed(6)} ETH</div>
                  )}
                  {result.gas_cost_eur !== undefined && (
                    <div>Gas: {formatEur(result.gas_cost_eur)}</div>
                  )}
                  {result.tx_hash && (
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-xs truncate max-w-[200px]">
                        {result.tx_hash}
                      </span>
                      <a
                        href={`https://basescan.org/tx/${result.tx_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-400"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                  {result.tradeId && (
                    <div className="text-xs text-muted-foreground">
                      Trade ID: {result.tradeId.substring(0, 8)}...
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <span className="font-semibold">✗ Failed:</span> {result.error || result.reason}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Confirm Manual {side}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>You are about to execute a manual {side.toLowerCase()} trade:</p>
              <ul className="list-disc list-inside text-sm">
                <li>Token: <strong>{token}</strong></li>
                <li>Amount: <strong>{amount}</strong></li>
                <li>Slippage: <strong>{slippage}%</strong></li>
              </ul>
              <p className="text-yellow-600 font-medium">
                This will use real funds from the execution wallet on Base mainnet.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className={isBuy ? '' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}
            >
              Confirm {side}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
