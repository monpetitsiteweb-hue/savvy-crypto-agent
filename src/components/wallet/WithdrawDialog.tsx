import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  ArrowUpRight, 
  Loader2, 
  AlertTriangle, 
  CheckCircle, 
  ExternalLink,
  Copy
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface TokenBalance {
  symbol: string;
  amount: number;
}

interface WithdrawDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletAddress: string;
  balances: {
    ETH: TokenBalance;
    WETH: TokenBalance;
    USDC: TokenBalance;
  };
  onWithdrawComplete: () => void;
}

type WithdrawStep = 'form' | 'confirm' | 'submitting' | 'success' | 'error';

export function WithdrawDialog({ 
  open, 
  onOpenChange, 
  walletAddress,
  balances,
  onWithdrawComplete 
}: WithdrawDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<WithdrawStep>('form');
  const [asset, setAsset] = useState<'ETH' | 'WETH' | 'USDC'>('ETH');
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setStep('form');
      setAsset('ETH');
      setToAddress('');
      setAmount('');
      setTxHash(null);
      setError(null);
    }
  }, [open]);

  const selectedBalance = balances[asset]?.amount || 0;

  const validateAddress = (addr: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(addr);
  };

  const validateAmount = (): boolean => {
    const numAmount = parseFloat(amount);
    return !isNaN(numAmount) && numAmount > 0 && numAmount <= selectedBalance;
  };

  const handleSetMax = () => {
    // For ETH, leave some for gas (0.001 ETH)
    if (asset === 'ETH') {
      const maxAmount = Math.max(0, selectedBalance - 0.001);
      setAmount(maxAmount.toString());
    } else {
      setAmount(selectedBalance.toString());
    }
  };

  const handleReview = () => {
    if (!validateAddress(toAddress)) {
      toast({
        title: "Invalid Address",
        description: "Please enter a valid Ethereum address",
        variant: "destructive",
      });
      return;
    }

    if (!validateAmount()) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount within your balance",
        variant: "destructive",
      });
      return;
    }

    if (toAddress.toLowerCase() === walletAddress.toLowerCase()) {
      toast({
        title: "Invalid Address",
        description: "Cannot send to the same wallet address",
        variant: "destructive",
      });
      return;
    }

    setStep('confirm');
  };

  const handleWithdraw = async () => {
    setStep('submitting');
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('execution-wallet-withdraw', {
        body: {
          asset,
          to_address: toAddress,
          amount: parseFloat(amount),
        }
      });

      if (fnError) {
        throw new Error(fnError.message || 'Withdrawal failed');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Withdrawal failed');
      }

      setTxHash(data.tx_hash);
      setStep('success');
      
      toast({
        title: "Withdrawal Submitted",
        description: "Your transaction has been submitted to the network",
      });

      onWithdrawComplete();
    } catch (err) {
      console.error('[WithdrawDialog] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStep('error');
    }
  };

  const handleClose = () => {
    if (step !== 'submitting') {
      onOpenChange(false);
    }
  };

  const copyTxHash = () => {
    if (txHash) {
      navigator.clipboard.writeText(txHash);
      toast({
        title: "Copied",
        description: "Transaction hash copied to clipboard",
      });
    }
  };

  const getExplorerUrl = (hash: string) => {
    return `https://basescan.org/tx/${hash}`;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-background border-border">
        {/* Form Step */}
        {step === 'form' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <ArrowUpRight className="w-5 h-5 text-primary" />
                Withdraw Funds
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Transfer assets from your trading wallet to another address.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-4">
              {/* Asset Selection */}
              <div className="space-y-2">
                <Label htmlFor="asset">Asset</Label>
                <Select value={asset} onValueChange={(v) => setAsset(v as typeof asset)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ETH">
                      ETH ({balances.ETH?.amount.toFixed(6) || '0'})
                    </SelectItem>
                    <SelectItem value="WETH">
                      WETH ({balances.WETH?.amount.toFixed(6) || '0'})
                    </SelectItem>
                    <SelectItem value="USDC">
                      USDC ({balances.USDC?.amount.toFixed(2) || '0'})
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Destination Address */}
              <div className="space-y-2">
                <Label htmlFor="to-address">Destination Address</Label>
                <Input
                  id="to-address"
                  placeholder="0x..."
                  value={toAddress}
                  onChange={(e) => setToAddress(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="amount">Amount</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSetMax}
                    className="text-xs text-primary hover:text-primary/80 h-auto p-0"
                  >
                    Max: {selectedBalance.toFixed(asset === 'USDC' ? 2 : 6)}
                  </Button>
                </div>
                <Input
                  id="amount"
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              {/* Network Info */}
              <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
                <strong>Network:</strong> Base (Chain ID 8453)
              </div>

              {/* Warning */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <div className="flex gap-2 text-sm text-amber-200">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    Ensure the destination address is correct and supports Base network. 
                    Transactions cannot be reversed.
                  </span>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleReview} disabled={!toAddress || !amount}>
                Review Withdrawal
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Confirm Step */}
        {step === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                Confirm Withdrawal
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 my-4">
              <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Asset</span>
                  <span className="font-medium text-foreground">{asset}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium text-foreground">{amount} {asset}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">From</span>
                  <span className="font-mono text-sm text-foreground truncate max-w-[200px]">
                    {walletAddress}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">To</span>
                  <span className="font-mono text-sm text-foreground truncate max-w-[200px]">
                    {toAddress}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Network</span>
                  <span className="font-medium text-foreground">Base</span>
                </div>
              </div>

              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                <div className="flex gap-2 text-sm text-destructive">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    This action cannot be undone. Please verify all details are correct.
                  </span>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setStep('form')}>
                Back
              </Button>
              <Button 
                onClick={handleWithdraw}
                className="bg-destructive hover:bg-destructive/90"
              >
                Confirm Withdrawal
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Submitting Step */}
        {step === 'submitting' && (
          <div className="py-8 text-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Processing Withdrawal</h3>
            <p className="text-muted-foreground text-sm">
              Please wait while your transaction is being submitted...
            </p>
          </div>
        )}

        {/* Success Step */}
        {step === 'success' && txHash && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <CheckCircle className="w-5 h-5 text-green-400" />
                Withdrawal Submitted
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 my-4">
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <p className="text-green-200 text-sm mb-3">
                  Your withdrawal has been submitted to the Base network.
                </p>
                
                <div className="bg-background/50 rounded p-3">
                  <div className="text-xs text-muted-foreground mb-1">Transaction Hash</div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-foreground truncate flex-1">
                      {txHash}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyTxHash}
                      className="h-6 w-6 p-0"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(getExplorerUrl(txHash), '_blank')}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View on BaseScan
              </Button>
            </div>

            <DialogFooter>
              <Button onClick={handleClose} className="w-full">
                Done
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Error Step */}
        {step === 'error' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                Withdrawal Failed
              </DialogTitle>
            </DialogHeader>

            <div className="my-4">
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
                <p className="text-destructive text-sm">
                  {error || 'An unknown error occurred'}
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={() => setStep('form')}>
                Try Again
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
