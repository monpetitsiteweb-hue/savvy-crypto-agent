import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Wallet, Loader2, CheckCircle, Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface WalletCreationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWalletCreated: (walletAddress: string) => void;
}

interface WalletCreationResult {
  success: boolean;
  wallet_address?: string;
  chain_id?: number;
  error?: string;
}

export function WalletCreationModal({ open, onOpenChange, onWalletCreated }: WalletCreationModalProps) {
  const [step, setStep] = useState<'confirm' | 'creating' | 'success'>('confirm');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleConfirmCreate = async () => {
    setStep('creating');
    setError(null);

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        throw new Error('User not authenticated');
      }
      
      const { data, error: fnError } = await supabase.functions.invoke<WalletCreationResult>(
        'execution-wallet-create',
        { body: { user_id: user.id } }
      );

      if (fnError) {
        throw new Error(fnError.message || 'Failed to create wallet');
      }

      if (!data?.success || !data?.wallet_address) {
        throw new Error(data?.error || 'Wallet creation failed');
      }

      setWalletAddress(data.wallet_address);
      setChainId(data.chain_id || 8453); // Default to Base
      setStep('success');
      
      toast({
        title: "Wallet Created",
        description: "Your trading wallet has been created successfully.",
      });

      onWalletCreated(data.wallet_address);
    } catch (err) {
      console.error('[WalletCreationModal] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStep('confirm');
      
      toast({
        title: "Wallet Creation Failed",
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: "destructive",
      });
    }
  };

  const copyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      toast({
        title: "Copied",
        description: "Wallet address copied to clipboard",
      });
    }
  };

  const getNetworkName = (id: number | null): string => {
    switch (id) {
      case 1: return 'Ethereum Mainnet';
      case 8453: return 'Base';
      case 137: return 'Polygon';
      case 42161: return 'Arbitrum';
      default: return 'Base';
    }
  };

  const handleClose = () => {
    if (step !== 'creating') {
      onOpenChange(false);
      // Reset state after close
      setTimeout(() => {
        setStep('confirm');
        setWalletAddress(null);
        setError(null);
      }, 200);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-slate-900 border-slate-700">
        {step === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <Wallet className="w-5 h-5 text-blue-400" />
                Create Trading Wallet
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                You're about to create a dedicated trading wallet.
              </DialogDescription>
            </DialogHeader>
            
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 my-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200">
                  <p className="font-medium mb-2">Important:</p>
                  <ul className="list-disc pl-4 space-y-1 text-amber-200/80">
                    <li>This creates a dedicated wallet for automated trading</li>
                    <li>Funds sent here will be used by the trading bot</li>
                    <li>This action cannot be undone</li>
                    <li>You control when and how much to fund</li>
                  </ul>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="ghost"
                onClick={handleClose}
                className="text-slate-400 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmCreate}
                className="bg-blue-500 hover:bg-blue-600 text-white"
              >
                <Wallet className="w-4 h-4 mr-2" />
                Create Wallet
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'creating' && (
          <div className="py-8 text-center">
            <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">Creating Your Wallet</h3>
            <p className="text-slate-400 text-sm">
              Please wait while we generate your secure trading wallet...
            </p>
          </div>
        )}

        {step === 'success' && walletAddress && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <CheckCircle className="w-5 h-5 text-green-400" />
                Wallet Created Successfully
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Your trading wallet is ready. Fund it to enable live trading.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-4">
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="text-xs text-slate-400 mb-1">Network</div>
                <div className="text-white font-medium">{getNetworkName(chainId)}</div>
              </div>
              
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="text-xs text-slate-400 mb-1">Wallet Address</div>
                <div className="flex items-center gap-2">
                  <code className="text-green-400 text-sm font-mono break-all flex-1">
                    {walletAddress}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyAddress}
                    className="text-slate-400 hover:text-white flex-shrink-0"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-blue-200 text-sm">
                Send ETH or USDC to this address to fund your trading wallet.
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={handleClose}
                className="w-full bg-green-500 hover:bg-green-600 text-white"
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
