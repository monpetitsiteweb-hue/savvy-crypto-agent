import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Wallet, 
  Copy, 
  ExternalLink, 
  RefreshCw, 
  CheckCircle, 
  Loader2,
  AlertTriangle,
  CircleDollarSign,
  ShieldAlert,
  Info
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useExternalAddresses } from '@/hooks/useExternalAddresses';
import { RealFundingWalletDialog } from './RealFundingWalletDialog';

/**
 * FundingInstructions - REAL Mode Funding Popup
 * 
 * CONSTRAINTS (DO NOT VIOLATE):
 * - NO OAuth
 * - NO wallet connect
 * - NO signing
 * - NO secrets
 * - NO custody
 * - UI guidance + polling ONLY
 * 
 * FUNDING GATE:
 * - User MUST have at least 1 registered external wallet
 * - No funding instructions shown until wallet is registered
 * - This is the ONLY path to REAL trading capital
 * 
 * Network: Base (8453) ONLY
 * Assets: ETH + USDC ONLY
 */

interface FundingInstructionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletAddress: string;
  onFundingDetected: () => void;
}

interface WalletStatusResult {
  success?: boolean;
  has_wallet?: boolean;
  wallet?: {
    id?: string;
    address?: string;
    wallet_address?: string;
    chain_id: number;
    is_funded: boolean;
    is_active: boolean;
    funded_at?: string;
    funded_amount_wei?: string;
  };
  error?: string;
}

const BASE_CHAIN_ID = 8453;
const POLL_INTERVAL_MS = 15000;

type FundingStatus = 'waiting' | 'checking' | 'funded';

export function FundingInstructions({ 
  open, 
  onOpenChange, 
  walletAddress,
  onFundingDetected 
}: FundingInstructionsProps) {
  const [fundingStatus, setFundingStatus] = useState<FundingStatus>('waiting');
  const [isManualChecking, setIsManualChecking] = useState(false);
  const [showWalletDialog, setShowWalletDialog] = useState(false);
  const { toast } = useToast();
  const { hasAddresses, count, refetch: refetchAddresses } = useExternalAddresses();

  // Poll for funding status
  useEffect(() => {
    if (!open || !walletAddress) return;

    const checkFunding = async () => {
      try {
        setFundingStatus('checking');
        
        const { data, error } = await supabase.functions.invoke<WalletStatusResult>(
          'execution-wallet-status',
          { body: { wallet_address: walletAddress } }
        );

        if (error) {
          console.error('[FundingInstructions] Status check error:', error);
          setFundingStatus('waiting');
          return;
        }

        const walletData = data?.wallet;
        console.log('[FundingInstructions] Wallet status response:', data);
        
        if (walletData?.is_funded) {
          setFundingStatus('funded');
          onFundingDetected();
          toast({
            title: "Wallet Funded!",
            description: "Your trading wallet is now funded and ready for live trading.",
          });
        } else {
          setFundingStatus('waiting');
        }
      } catch (err) {
        console.error('[FundingInstructions] Poll error:', err);
        setFundingStatus('waiting');
      }
    };

    checkFunding();
    const interval = setInterval(checkFunding, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
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
    setIsManualChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke<WalletStatusResult>(
        'execution-wallet-status',
        { body: { wallet_address: walletAddress } }
      );

      if (error) {
        toast({
          title: "Check Failed",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      const walletData = data?.wallet;
      if (walletData?.is_funded) {
        setFundingStatus('funded');
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
      toast({
        title: "Error",
        description: "Failed to check funding status",
        variant: "destructive",
      });
    } finally {
      setIsManualChecking(false);
    }
  };

  const openCoinbase = () => {
    window.open('https://www.coinbase.com/send', '_blank');
  };

  // SUCCESS STATE
  if (fundingStatus === 'funded') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md bg-background border-border">
          <div className="py-8 text-center">
            <CheckCircle className="w-16 h-16 text-primary mx-auto mb-4" />
            <h3 className="text-xl font-medium text-foreground mb-2">Wallet Funded!</h3>
            <p className="text-muted-foreground text-sm mb-6">
              Your trading wallet is now ready for live trading.
            </p>
            <Button
              onClick={() => onOpenChange(false)}
              className="bg-primary hover:bg-primary/90"
            >
              Get Started
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // BLOCKED STATE - No external wallets registered
  if (!hasAddresses) {
    return (
      <>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="sm:max-w-md bg-background border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <ShieldAlert className="w-5 h-5 text-destructive" />
                Funding Wallet Required
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                You must register a funding wallet before depositing
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-4">
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-foreground/80">
                    <p className="font-medium text-foreground mb-2">
                      No funding wallets registered
                    </p>
                    <p className="text-muted-foreground">
                      To fund your REAL trading portfolio, you must first register at least one 
                      external wallet address you own. Deposits can only be attributed from 
                      registered addresses.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
                <div className="flex gap-3">
                  <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-foreground/80 space-y-2">
                    <p className="font-medium text-foreground">How it works:</p>
                    <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
                      <li>Register your wallet address</li>
                      <li>Send ETH or USDC on Base from that wallet</li>
                      <li>System credits your portfolio automatically</li>
                    </ol>
                  </div>
                </div>
              </div>

              <Button
                onClick={() => setShowWalletDialog(true)}
                className="w-full"
              >
                <Wallet className="w-4 h-4 mr-2" />
                Register Funding Wallet
              </Button>
            </div>

            <div className="text-xs text-muted-foreground text-center border-t border-border pt-4">
              Only Base network (Chain ID 8453) deposits are supported.
            </div>
          </DialogContent>
        </Dialog>

        <RealFundingWalletDialog
          open={showWalletDialog}
          onOpenChange={setShowWalletDialog}
          onWalletAdded={() => {
            refetchAddresses();
            setShowWalletDialog(false);
          }}
        />
      </>
    );
  }

  // MAIN FUNDING POPUP - External wallet exists, can proceed
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-background border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Wallet className="w-5 h-5 text-primary" />
            Fund Your Trading Wallet
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Send funds from your registered wallet ({count} registered)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-4">
          {/* CRITICAL WARNING */}
          <div className="bg-destructive/20 border-2 border-destructive rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-destructive flex-shrink-0" />
              <div>
                <p className="text-destructive font-bold text-sm uppercase tracking-wide">
                  ⚠️ CRITICAL
                </p>
                <p className="text-foreground/80 text-sm mt-1 leading-relaxed">
                  Only send <strong>ETH</strong> or <strong>USDC</strong> on <strong>Base (Chain ID {BASE_CHAIN_ID})</strong>
                </p>
                <p className="text-destructive text-sm mt-1 font-medium">
                  Sending any other asset or network will result in permanent loss.
                </p>
              </div>
            </div>
          </div>

          {/* WALLET ADDRESS */}
          <div className="bg-muted rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                System Deposit Address
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/20 text-primary border border-primary/30">
                Base ({BASE_CHAIN_ID})
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <code className="text-primary text-sm font-mono break-all flex-1 bg-background p-3 rounded border border-border">
                {walletAddress}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={copyAddress}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground flex-shrink-0"
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* MINIMUM FUNDING */}
          <div className="flex items-center gap-2 bg-accent/50 border border-accent rounded-lg p-3">
            <CircleDollarSign className="w-4 h-4 text-accent-foreground flex-shrink-0" />
            <div className="text-accent-foreground text-xs">
              <span className="font-medium">Recommended minimum:</span>
              <span className="ml-1">
                <strong>0.01 ETH</strong> (for gas) or <strong>25 USDC</strong>
              </span>
            </div>
          </div>

          {/* IMPORTANT: Only from registered addresses */}
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
            <div className="flex gap-3">
              <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="text-sm text-foreground/80">
                <p className="font-medium text-foreground mb-1">
                  Send from your registered wallet only
                </p>
                <p className="text-muted-foreground text-xs">
                  Deposits are attributed via address matching. Only funds sent from your 
                  {count === 1 ? ' registered address' : ` ${count} registered addresses`} will 
                  be credited to your portfolio.
                </p>
              </div>
            </div>
          </div>

          {/* COINBASE OPTION */}
          <div className="bg-muted rounded-lg p-4">
            <h4 className="text-foreground font-medium mb-2 flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.8c3.976 0 7.2 3.224 7.2 7.2s-3.224 7.2-7.2 7.2-7.2-3.224-7.2-7.2S8.024 4.8 12 4.8zm-2.4 3.6v7.2h4.8v-1.8h-3v-5.4h-1.8z"/>
              </svg>
              Send from Coinbase
            </h4>
            <p className="text-muted-foreground text-sm mb-3">
              Use Coinbase "Send" to transfer ETH or USDC on Base.
              Paste the deposit address shown above.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="border-border text-muted-foreground hover:bg-muted w-full sm:w-auto"
              onClick={openCoinbase}
            >
              Open Coinbase
              <ExternalLink className="w-3 h-3 ml-2" />
            </Button>
          </div>

          {/* FUNDING STATUS */}
          <div className="bg-muted/50 border border-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {fundingStatus === 'checking' || isManualChecking ? (
                  <>
                    <div className="relative">
                      <div className="w-3 h-3 bg-primary rounded-full animate-pulse" />
                      <div className="absolute inset-0 w-3 h-3 bg-primary rounded-full animate-ping" />
                    </div>
                    <span className="text-primary text-sm font-medium">
                      🔄 Checking balance...
                    </span>
                  </>
                ) : (
                  <>
                    <div className="w-3 h-3 bg-accent rounded-full animate-pulse" />
                    <span className="text-accent-foreground text-sm font-medium">
                      ⏳ Waiting for funds...
                    </span>
                  </>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={manualRefresh}
                disabled={isManualChecking}
                className="text-muted-foreground hover:text-foreground"
              >
                {isManualChecking ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span className="ml-1.5">Refresh</span>
              </Button>
            </div>
            <p className="text-muted-foreground text-xs mt-2">
              Auto-checking every 15 seconds. May take a few minutes after transaction confirms.
            </p>
          </div>
        </div>

        <div className="text-xs text-muted-foreground text-center border-t border-border pt-4">
          This wallet is dedicated to automated trading only.<br />
          Funds sent here are controlled exclusively by the trading engine.
        </div>
      </DialogContent>
    </Dialog>
  );
}
