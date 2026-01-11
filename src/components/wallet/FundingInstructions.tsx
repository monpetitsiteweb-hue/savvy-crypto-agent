import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Wallet, Copy, ExternalLink, RefreshCw, CheckCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface FundingInstructionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletAddress: string;
  isCoinbaseConnected: boolean;
  onFundingDetected: () => void;
}

interface WalletStatusResult {
  success: boolean;
  is_funded: boolean;
  wallet_address?: string;
  chain_id?: number;
  funded_amount_wei?: string;
  error?: string;
}

export function FundingInstructions({ 
  open, 
  onOpenChange, 
  walletAddress,
  isCoinbaseConnected,
  onFundingDetected 
}: FundingInstructionsProps) {
  const [isPolling, setIsPolling] = useState(false);
  const [isFunded, setIsFunded] = useState(false);
  const { toast } = useToast();

  // Poll for funding status
  useEffect(() => {
    if (!open || !walletAddress) return;

    const checkFunding = async () => {
      try {
        const { data, error } = await supabase.functions.invoke<WalletStatusResult>(
          'execution-wallet-status'
        );

        if (error) {
          console.error('[FundingInstructions] Status check error:', error);
          return;
        }

        if (data?.is_funded) {
          setIsFunded(true);
          setIsPolling(false);
          onFundingDetected();
          toast({
            title: "Wallet Funded!",
            description: "Your trading wallet is now funded and ready for live trading.",
          });
        }
      } catch (err) {
        console.error('[FundingInstructions] Poll error:', err);
      }
    };

    // Initial check
    checkFunding();

    // Poll every 15 seconds
    const interval = setInterval(checkFunding, 15000);
    setIsPolling(true);

    return () => {
      clearInterval(interval);
      setIsPolling(false);
    };
  }, [open, walletAddress, onFundingDetected, toast]);

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress);
    toast({
      title: "Copied",
      description: "Wallet address copied to clipboard",
    });
  };

  const manualRefresh = async () => {
    try {
      const { data, error } = await supabase.functions.invoke<WalletStatusResult>(
        'execution-wallet-status'
      );

      if (error) {
        toast({
          title: "Check Failed",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      if (data?.is_funded) {
        setIsFunded(true);
        onFundingDetected();
        toast({
          title: "Wallet Funded!",
          description: "Your trading wallet is now funded.",
        });
      } else {
        toast({
          title: "Not Yet Funded",
          description: "No funds detected yet. It may take a few minutes for transactions to confirm.",
        });
      }
    } catch (err) {
      console.error('[FundingInstructions] Manual refresh error:', err);
    }
  };

  if (isFunded) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-slate-700">
          <div className="py-8 text-center">
            <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-white mb-2">Wallet Funded!</h3>
            <p className="text-slate-400 text-sm mb-6">
              Your trading wallet is now ready for live trading.
            </p>
            <Button
              onClick={() => onOpenChange(false)}
              className="bg-green-500 hover:bg-green-600 text-white"
            >
              Get Started
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Wallet className="w-5 h-5 text-amber-400" />
            Fund Your Trading Wallet
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Send funds to your wallet to enable live trading.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-4">
          {/* Wallet Address */}
          <div className="bg-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-400 mb-2">Send ETH or USDC to this address</div>
            <div className="flex items-center gap-2">
              <code className="text-green-400 text-sm font-mono break-all flex-1 bg-slate-900/50 p-2 rounded">
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

          {/* Network Info */}
          <div className="bg-slate-800/50 rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Network</span>
              <span className="text-white font-medium">Base (Chain ID: 8453)</span>
            </div>
          </div>

          {/* Coinbase Transfer Option */}
          {isCoinbaseConnected && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <h4 className="text-blue-300 font-medium mb-2 flex items-center gap-2">
                <ExternalLink className="w-4 h-4" />
                Transfer from Coinbase
              </h4>
              <p className="text-blue-200/80 text-sm mb-3">
                You can send funds directly from your connected Coinbase account.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="border-blue-500/50 text-blue-300 hover:bg-blue-500/20"
                onClick={() => window.open('https://www.coinbase.com/wallet', '_blank')}
              >
                Open Coinbase <ExternalLink className="w-3 h-3 ml-2" />
              </Button>
            </div>
          )}

          {/* Manual Transfer Instructions */}
          {!isCoinbaseConnected && (
            <div className="bg-slate-800/50 rounded-lg p-4">
              <h4 className="text-white font-medium mb-2">Manual Transfer</h4>
              <ol className="text-slate-400 text-sm space-y-2 list-decimal pl-4">
                <li>Copy the wallet address above</li>
                <li>Open your crypto wallet or exchange</li>
                <li>Send ETH or USDC on the Base network</li>
                <li>Wait for the transaction to confirm</li>
              </ol>
            </div>
          )}

          {/* Polling Status */}
          <div className="flex items-center justify-between bg-slate-800/30 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm">
              {isPolling ? (
                <>
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                  <span className="text-slate-400">Checking for funds...</span>
                </>
              ) : (
                <span className="text-slate-500">Waiting for funds</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={manualRefresh}
              className="text-slate-400 hover:text-white"
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="text-xs text-slate-500 text-center">
          Funds will be detected automatically. This may take a few minutes after confirmation.
        </div>
      </DialogContent>
    </Dialog>
  );
}
