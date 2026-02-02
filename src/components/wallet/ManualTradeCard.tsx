/**
 * Manual Trade Card - BUY or SELL with confirmation modal
 * Routes through trading-decision-coordinator
 * 
 * CUSTODIAL MODEL:
 * - ALL real trades execute from SYSTEM wallet (BOT_ADDRESS)
 * - User wallet existence triggers REAL mode (for authorization)
 * - User wallet is NOT the trading wallet - it's for deposit/audit only
 * - If no user wallet → MOCK trade (paper trading)
 */

import { useState, useEffect } from 'react';
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
import { ArrowUpCircle, ArrowDownCircle, AlertTriangle, ExternalLink, Zap, FlaskConical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { SUPABASE_URL, MANUAL_STRATEGY_ID, TRADEABLE_TOKENS, SLIPPAGE_OPTIONS } from './ManualTradeConstants';

type ExecutionStatus = 'failed' | 'pending' | 'confirmed' | 'reverted';

interface ExecutionResult {
  status: ExecutionStatus;
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
  message?: string;
}

const statusStyles: Record<ExecutionStatus, { bg: string; icon: string; title: string }> = {
  failed: { 
    bg: 'bg-destructive/10 border-destructive/20 text-destructive', 
    icon: '✗', 
    title: 'Failed' 
  },
  pending: { 
    bg: 'bg-orange-500/10 border-orange-500/20 text-orange-600', 
    icon: '⏳', 
    title: 'Pending Confirmation...' 
  },
  confirmed: { 
    bg: 'bg-green-500/10 border-green-500/20 text-green-600', 
    icon: '✓', 
    title: 'Trade Confirmed' 
  },
  reverted: { 
    bg: 'bg-destructive/10 border-destructive/20 text-destructive', 
    icon: '⚠️', 
    title: 'Reverted On-Chain' 
  },
};

interface ExecutionWallet {
  id: string;
  wallet_address: string;
  is_active: boolean;
}

interface ManualTradeCardProps {
  side: 'BUY' | 'SELL';
  userId: string;
  onTradeComplete?: () => void;
  /** 
   * SYSTEM OPERATOR MODE: When true, trades execute via the system wallet (BOT_ADDRESS)
   * This bypasses user-specific execution wallet requirements and all coverage checks.
   * Should only be true on the admin WalletDrillPage.
   */
  isSystemOperator?: boolean;
}

export function ManualTradeCard({ side, userId, onTradeComplete, isSystemOperator = false }: ManualTradeCardProps) {
  const [token, setToken] = useState<string>('ETH');
  const [amount, setAmount] = useState<string>('');
  const [slippage, setSlippage] = useState<string>('1.0');
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  
  // Execution wallet state - used for user-specific trades (non-system-operator mode)
  const [executionWallet, setExecutionWallet] = useState<ExecutionWallet | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);

  const isBuy = side === 'BUY';
  const Icon = isBuy ? ArrowUpCircle : ArrowDownCircle;
  
  // Derived: Is this a REAL trade?
  // System operator mode ALWAYS means real trade (uses system wallet)
  // Otherwise, require user-specific execution wallet
  const isRealTrade = isSystemOperator || (!!executionWallet?.id && executionWallet.is_active);

  // Fetch execution wallet on mount
  useEffect(() => {
    const fetchWallet = async () => {
      setWalletLoading(true);
      try {
        const { data, error } = await supabase
          .from('execution_wallets' as any)
          .select('id, wallet_address, is_active')
          .eq('user_id', userId)
          .eq('is_active', true)
          .maybeSingle();

        if (error) {
          console.error('Failed to fetch execution wallet:', error);
        } else {
          setExecutionWallet(data as unknown as ExecutionWallet | null);
        }
      } catch (err) {
        console.error('Error fetching wallet:', err);
      } finally {
        setWalletLoading(false);
      }
    };

    if (userId) {
      fetchWallet();
    }
  }, [userId]);

  // Poll for confirmation status after broadcast
  const pollForConfirmation = (tradeId: string, txHash?: string) => {
    let attempts = 0;
    const maxAttempts = 40; // 2 minutes at 3s intervals
    
    const interval = setInterval(async () => {
      attempts++;
      
      try {
        const { data, error } = await supabase
          .from('real_trades' as any)
          .select('execution_status, tx_hash, gas_used_wei, amount, price')
          .eq('mock_trade_id', tradeId)
          .maybeSingle();
        
        if (error) {
          console.warn('Poll error:', error);
          return;
        }
        
        // Cast to expected shape
        const trade = data as unknown as { 
          execution_status: string; 
          tx_hash?: string; 
          amount?: number; 
          price?: number; 
          gas_used_wei?: string; 
        } | null;
        
        if (trade?.execution_status === 'CONFIRMED') {
          clearInterval(interval);
          setResult({
            status: 'confirmed',
            tradeId,
            tx_hash: trade.tx_hash || txHash,
            qty: trade.amount,
            executed_price: trade.price,
            gas_used_wei: trade.gas_used_wei,
            message: 'Transaction confirmed on-chain'
          });
          onTradeComplete?.();
        } else if (trade?.execution_status === 'REVERTED') {
          clearInterval(interval);
          setResult({
            status: 'reverted',
            tradeId,
            tx_hash: trade.tx_hash || txHash,
            message: 'Transaction reverted on-chain'
          });
        }
      } catch (err) {
        console.warn('Poll exception:', err);
      }
      
      // Timeout after max attempts
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        // Keep pending state but add timeout message
        setResult(prev => prev ? {
          ...prev,
          message: 'Confirmation timeout - check BaseScan for status'
        } : null);
      }
    }, 3000);
    
    return interval;
  };

  const handleSubmit = () => {
    const parsedAmount = parseFloat(amount.replace(',', '.'));
    if (!parsedAmount || parsedAmount <= 0) {
      setResult({ status: 'failed', error: 'Invalid amount' });
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

      // For SELL: fetch current price from Coinbase (required by coordinator for mock sells)
      let currentPrice: number | undefined;
      if (!isBuy) {
        try {
          const pair = `${token}-EUR`;
          const priceRes = await fetch(`https://api.exchange.coinbase.com/products/${pair}/ticker`);
          if (priceRes.ok) {
            const priceData = await priceRes.json();
            currentPrice = parseFloat(priceData.price);
          }
        } catch (priceErr) {
          console.warn('Failed to fetch current price:', priceErr);
        }
      }

      // Build metadata
      // NOTE: force is ONLY for mock/debug trades, NOT for system operator real trades
      const metadata: Record<string, any> = {
        context: 'MANUAL',
        slippage_bps: parseFloat(slippage) * 100,
        bypass_volatility_gate: true,
        // force: true ONLY for non-system-operator trades (mock debugging)
        force: !isSystemOperator,
        // For BUY: amount is in EUR, coordinator should convert to qty
        eurAmount: isBuy ? parsedAmount : undefined,
        // For SELL: include currentPrice for mock sell valuation
        currentPrice: !isBuy ? currentPrice : undefined,
      };

      // SYSTEM OPERATOR MODE: Use prop directly (admin page), don't require user wallet
      // For non-system-operator mode, fall back to user-specific execution wallet
      if (isSystemOperator) {
        // System operator uses BOT_ADDRESS - no execution_wallet_id needed
        // The coordinator will use the system wallet directly
        metadata.system_operator_mode = true;
      } else if (executionWallet?.id) {
        // Regular user with their own execution wallet
        metadata.execution_wallet_id = executionWallet.id;
        metadata.wallet_address = executionWallet.wallet_address;
      }

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
              // Always use 'manual' source - it's in the allowed list
              source: 'manual',
              confidence: 1.0,
              // For SELL: qtySuggested is token amount
              // For BUY: qtySuggested should be computed by coordinator from eurAmount
              qtySuggested: isBuy ? undefined : parsedAmount,
              reason: isSystemOperator 
                ? `System operator ${side} from WalletDrillPage` 
                : `Manual ${side} from operator panel (TEST)`,
              // Metadata already contains system_operator_mode if isSystemOperator prop is true
              metadata,
            },
          }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const tradeId = data.tradeId || data.decision?.trade_id;
      const txHash = data.tx_hash;

      // For REAL trades with tx_hash, show pending and start polling
      if (isRealTrade && txHash && tradeId) {
        setResult({
          status: 'pending',
          tradeId,
          tx_hash: txHash,
          message: 'Transaction submitted - awaiting chain confirmation'
        });
        setAmount('');
        // Start polling for confirmation
        pollForConfirmation(tradeId, txHash);
      } 
      // For MOCK trades or immediate success without tx
      else if (data.success === true || data.decision?.action === side) {
        setResult({
          status: 'confirmed',
          tradeId,
          executed_at: data.executed_at,
          executed_price: data.executed_price,
          qty: data.qty || data.decision?.qty,
          tx_hash: txHash,
          gas_used_wei: data.gas_used_wei,
          gas_cost_eth: data.gas_cost_eth,
          gas_cost_eur: data.gas_cost_eur,
          reason: data.reason || data.decision?.reason,
        });
        setAmount('');
        onTradeComplete?.();
      } else {
        // Unexpected response - treat as failure
        setResult({
          status: 'failed',
          error: data.error || data.reason || 'Unexpected response',
        });
      }
    } catch (err: any) {
      setResult({
        status: 'failed',
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
            {/* Mode indicator */}
            {!walletLoading && (
              <span className={`ml-auto text-xs px-2 py-1 rounded flex items-center gap-1 ${
                isRealTrade 
                  ? 'bg-yellow-500/20 text-yellow-600 border border-yellow-500/30' 
                  : 'bg-blue-500/20 text-blue-600 border border-blue-500/30'
              }`}>
                {isRealTrade ? <Zap className="h-3 w-3" /> : <FlaskConical className="h-3 w-3" />}
                {isRealTrade ? 'REAL' : 'TEST'}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            {isRealTrade 
              ? (isBuy ? 'Buy tokens via SYSTEM wallet (custodial on-chain)' : 'Sell tokens via SYSTEM wallet (custodial on-chain)')
              : (isBuy ? 'Paper trade - no real funds used' : 'Paper trade - simulated sell')
            }
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
                {Array.isArray(TRADEABLE_TOKENS) && TRADEABLE_TOKENS.map((t) => (
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
            <Label>Slippage Tolerance (max 0.5%)</Label>
            <Select value={slippage} onValueChange={setSlippage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.isArray(SLIPPAGE_OPTIONS) && SLIPPAGE_OPTIONS.map((s) => (
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
            disabled={loading || !amount || walletLoading}
            className="w-full"
            variant={isBuy ? 'default' : 'destructive'}
          >
            {loading ? 'Processing...' : `${side} ${token}${isRealTrade ? ' (REAL)' : ' (TEST)'}`}
          </Button>

          {/* Execution result inline display */}
          {result && (
            <div
              className={`p-3 rounded border text-sm ${statusStyles[result.status].bg}`}
            >
              <div className="space-y-1">
                <div className="font-semibold flex items-center gap-2">
                  {result.status === 'pending' ? (
                    <span className="inline-block animate-pulse">{statusStyles[result.status].icon}</span>
                  ) : (
                    <span>{statusStyles[result.status].icon}</span>
                  )}
                  {statusStyles[result.status].title}
                </div>
                
                {/* Show message if present */}
                {result.message && (
                  <div className="text-xs opacity-80">{result.message}</div>
                )}
                
                {/* Show error for failed/reverted */}
                {(result.status === 'failed' || result.status === 'reverted') && result.error && (
                  <div>{result.error}</div>
                )}
                
                {/* Show details for confirmed */}
                {result.status === 'confirmed' && (
                  <>
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
                  </>
                )}
                
                {/* Always show tx_hash with link if present */}
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
                
                {/* Show trade ID */}
                {result.tradeId && (
                  <div className="text-xs opacity-60">
                    Trade ID: {result.tradeId.substring(0, 8)}...
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className={`h-5 w-5 ${isRealTrade ? 'text-yellow-500' : 'text-blue-500'}`} />
              Confirm Manual {side} {isRealTrade ? '(REAL)' : '(TEST)'}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>You are about to execute a {isRealTrade ? 'REAL' : 'TEST'} {side.toLowerCase()} trade:</p>
              <ul className="list-disc list-inside text-sm">
                <li>Token: <strong>{token}</strong></li>
                <li>Amount: <strong>{amount}</strong> {isBuy ? 'EUR' : token}</li>
                <li>Slippage: <strong>{slippage}%</strong></li>
                <li>Mode: <strong className={isRealTrade ? 'text-yellow-600' : 'text-blue-600'}>
                  {isRealTrade ? 'REAL (On-Chain)' : 'TEST (Paper Trading)'}
                </strong></li>
              </ul>
              {isRealTrade ? (
                <p className="text-yellow-600 font-medium">
                  ⚠️ This will use REAL funds from the SYSTEM wallet (BOT_ADDRESS) on Base mainnet.
                </p>
              ) : (
                <p className="text-blue-600 font-medium">
                  🧪 This is a TEST trade. No real funds will be used.
                </p>
              )}
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