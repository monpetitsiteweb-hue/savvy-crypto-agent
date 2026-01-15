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
  CircleDollarSign
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/**
 * FundingInstructions - Level A Funding Popup
 * 
 * CONSTRAINTS (DO NOT VIOLATE):
 * - NO OAuth
 * - NO wallet connect
 * - NO signing
 * - NO secrets
 * - NO custody
 * - UI guidance + polling ONLY
 * 
 * Network: Base (8453) ONLY
 * Assets: ETH + USDC ONLY
 */

interface FundingInstructionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletAddress: string;
  // NOTE: No isCoinbaseConnected - Level A always shows both options
  onFundingDetected: () => void;
}

interface WalletStatusResult {
  success?: boolean;
  has_wallet?: boolean;
  wallet?: {
    id?: string;
    address?: string; // API returns 'address' not 'wallet_address'
    wallet_address?: string; // Support both for safety
    chain_id: number;
    is_funded: boolean;
    is_active: boolean;
    funded_at?: string;
    funded_amount_wei?: string;
  };
  error?: string;
}

// Constants
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
  const { toast } = useToast();

  // Poll for funding status
  useEffect(() => {
    if (!open || !walletAddress) return;

    const checkFunding = async () => {
      try {
        setFundingStatus('checking');
        
        // EXPLICIT CONTRACT: Always pass wallet_address for future-proofing
        const { data, error } = await supabase.functions.invoke<WalletStatusResult>(
          'execution-wallet-status',
          { body: { wallet_address: walletAddress } }
        );

        if (error) {
          console.error('[FundingInstructions] Status check error:', error);
          setFundingStatus('waiting');
          return;
        }

        // Handle both 'address' and 'wallet_address' from API
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

    // Initial check
    checkFunding();

    // Poll every 15 seconds
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
      // EXPLICIT CONTRACT: Always pass wallet_address
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
    // Level A: Pure external handoff to Coinbase send page
    // No OAuth, no API, no prefill (Coinbase doesn't support URL params for address)
    window.open('https://www.coinbase.com/send', '_blank');
  };

  // ─────────────────────────────────────────────────────────────────
  // SUCCESS STATE
  // ─────────────────────────────────────────────────────────────────
  if (fundingStatus === 'funded') {
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

  // ─────────────────────────────────────────────────────────────────
  // MAIN FUNDING POPUP
  // ─────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-700 max-h-[90vh] overflow-y-auto">
        {/* ───────────────────────────────────────────────────────────
            1️⃣ HEADER
        ─────────────────────────────────────────────────────────── */}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Wallet className="w-5 h-5 text-amber-400" />
            Fund Your Trading Wallet
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Send funds to enable live trading
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-4">
          {/* ───────────────────────────────────────────────────────────
              🚨 CRITICAL LOSS WARNING (NON-DISMISSIBLE, ALWAYS VISIBLE)
          ─────────────────────────────────────────────────────────── */}
          <div className="bg-red-900/40 border-2 border-red-500 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <div>
                <p className="text-red-300 font-bold text-sm uppercase tracking-wide">
                  ⚠️ CRITICAL
                </p>
                <p className="text-red-200 text-sm mt-1 leading-relaxed">
                  Only send <strong>ETH</strong> or <strong>USDC</strong> on <strong>Base (Chain ID {BASE_CHAIN_ID})</strong>
                </p>
                <p className="text-red-300 text-sm mt-1 font-medium">
                  Sending any other asset or network will result in permanent loss.
                </p>
              </div>
            </div>
          </div>

          {/* ───────────────────────────────────────────────────────────
              2️⃣ WALLET ADDRESS BLOCK
          ─────────────────────────────────────────────────────────── */}
          <div className="bg-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 uppercase tracking-wider">
                Your Wallet Address
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                Base ({BASE_CHAIN_ID})
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <code className="text-green-400 text-sm font-mono break-all flex-1 bg-slate-900/50 p-3 rounded border border-slate-700">
                {walletAddress}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={copyAddress}
                className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white flex-shrink-0"
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* ───────────────────────────────────────────────────────────
              💰 MINIMUM FUNDING RECOMMENDATION
          ─────────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <CircleDollarSign className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <div className="text-amber-200 text-xs">
              <span className="font-medium">Recommended minimum:</span>
              <span className="ml-1">
                <strong>0.01 ETH</strong> (for gas) or <strong>25 USDC</strong>
              </span>
            </div>
          </div>

          {/* ───────────────────────────────────────────────────────────
              3️⃣ SECTION A — COINBASE TRANSFER (ALWAYS VISIBLE)
              Level A: Pure external handoff, no OAuth, no connection required
          ─────────────────────────────────────────────────────────── */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <h4 className="text-blue-300 font-medium mb-2 flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.8c3.976 0 7.2 3.224 7.2 7.2s-3.224 7.2-7.2 7.2-7.2-3.224-7.2-7.2S8.024 4.8 12 4.8zm-2.4 3.6v7.2h4.8v-1.8h-3v-5.4h-1.8z"/>
              </svg>
              Send from Coinbase
            </h4>
            <p className="text-blue-200/80 text-sm mb-3">
              Use Coinbase "Send" to transfer ETH or USDC on Base.
              Paste the destination address shown above.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="border-blue-500/50 text-blue-300 hover:bg-blue-500/20 w-full sm:w-auto"
              onClick={openCoinbase}
            >
              Open Coinbase
              <ExternalLink className="w-3 h-3 ml-2" />
            </Button>
          </div>

          {/* ───────────────────────────────────────────────────────────
              4️⃣ SECTION B — EXTERNAL WALLET (INSTRUCTIONAL ONLY)
              Level A: No wallet connect, no signing
          ─────────────────────────────────────────────────────────── */}
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
            <h4 className="text-purple-300 font-medium mb-2 flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              Send from External Wallet
            </h4>
            <p className="text-purple-200/80 text-sm mb-3">
              Use MetaMask, Rabby, or any Web3 wallet.
            </p>
            <ol className="text-purple-200/70 text-sm space-y-1.5 list-decimal pl-4 mb-3">
              <li>Open your wallet app</li>
              <li>Select <strong>Base</strong> network (Chain ID {BASE_CHAIN_ID})</li>
              <li>Send <strong>ETH</strong> or <strong>USDC</strong></li>
              <li>Paste the destination address above</li>
            </ol>
            <Button
              variant="outline"
              size="sm"
              className="border-purple-500/50 text-purple-300 hover:bg-purple-500/20 w-full sm:w-auto"
              onClick={copyAddress}
            >
              <Copy className="w-3 h-3 mr-2" />
              Copy Address
            </Button>
          </div>

          {/* ───────────────────────────────────────────────────────────
              5️⃣ FUNDING STATUS (LIVE POLLING)
          ─────────────────────────────────────────────────────────── */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {fundingStatus === 'checking' || isManualChecking ? (
                  <>
                    <div className="relative">
                      <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse" />
                      <div className="absolute inset-0 w-3 h-3 bg-blue-400 rounded-full animate-ping" />
                    </div>
                    <span className="text-blue-300 text-sm font-medium">
                      🔄 Checking balance...
                    </span>
                  </>
                ) : (
                  <>
                    <div className="w-3 h-3 bg-amber-400 rounded-full animate-pulse" />
                    <span className="text-amber-300 text-sm font-medium">
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
                className="text-slate-400 hover:text-white"
              >
                {isManualChecking ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span className="ml-1.5">Refresh</span>
              </Button>
            </div>
            <p className="text-slate-500 text-xs mt-2">
              Auto-checking every 15 seconds. May take a few minutes after transaction confirms.
            </p>
          </div>
        </div>

        {/* Footer Note */}
        <div className="text-xs text-slate-500 text-center border-t border-slate-800 pt-4">
          This wallet is dedicated to automated trading only.<br />
          Funds sent here are controlled exclusively by the trading engine.
        </div>
      </DialogContent>
    </Dialog>
  );
}
