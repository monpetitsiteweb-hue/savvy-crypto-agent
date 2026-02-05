/**
 * RealFundingFlowManager
 * 
 * REAL MODE ONLY - State-driven component that manages the entire REAL funding flow.
 * 
 * States:
 * A - NO_WALLET: Show "Add Funding Wallet" CTA (+ Coinbase option)
 * B - WALLET_REGISTERED: Show success confirmation, system wallet address, funding instructions
 * C - PENDING_ATTRIBUTION: Show pending status with recent deposit info
 * D - PORTFOLIO_FUNDED: Show portfolio balance + activate trading CTA
 * 
 * This component replaces the previous fragmented UX with a clear, guided flow.
 */
import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Wallet, 
  ArrowRight, 
  Shield, 
  Info,
  CheckCircle,
  Copy,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Clock,
  TrendingUp,
  QrCode,
  Link
} from 'lucide-react';
import { useRealFundingState } from '@/hooks/useRealFundingState';
import { useExternalAddresses } from '@/hooks/useExternalAddresses';
import { RealFundingWalletDialog } from './RealFundingWalletDialog';
import { ExternalAddressList } from './ExternalAddressList';
import { useToast } from '@/hooks/use-toast';
import { formatEuro } from '@/utils/currencyFormatter';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '@/integrations/supabase/client';

interface RealFundingFlowManagerProps {
  onPortfolioFunded?: () => void;
}

export function RealFundingFlowManager({ onPortfolioFunded }: RealFundingFlowManagerProps) {
  const { toast } = useToast();
  const {
    state,
    isLoading,
    hasExternalWallet,
    systemWalletAddress,
    portfolioCapital,
    pendingDeposits,
    externalWalletCount,
    refresh
  } = useRealFundingState();
  
  const [showWalletDialog, setShowWalletDialog] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [justAddedWallet, setJustAddedWallet] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isConnectingCoinbase, setIsConnectingCoinbase] = useState(false);

  // Notify parent when portfolio is funded
  useEffect(() => {
    if (state === 'PORTFOLIO_FUNDED' && onPortfolioFunded) {
      onPortfolioFunded();
    }
  }, [state, onPortfolioFunded]);

  const handleWalletAdded = async () => {
    setShowWalletDialog(false);
    setJustAddedWallet(true);
    setRefreshTrigger(prev => prev + 1);
    
    toast({
      title: "✅ Funding Wallet Added",
      description: "Your wallet has been registered. You can now send funds to start trading.",
    });
    
    await refresh();
    
    // Clear the "just added" state after 10 seconds
    setTimeout(() => setJustAddedWallet(false), 10000);
  };

  const copySystemAddress = () => {
    if (systemWalletAddress) {
      navigator.clipboard.writeText(systemWalletAddress);
      setCopiedAddress(true);
      toast({
        title: "Copied",
        description: "System wallet address copied to clipboard",
      });
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const openBasescan = () => {
    if (systemWalletAddress) {
      window.open(`https://basescan.org/address/${systemWalletAddress}`, '_blank');
    }
  };

  // Connect Coinbase to discover wallets
  const handleConnectCoinbase = async () => {
    setIsConnectingCoinbase(true);
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session?.access_token) {
        toast({
          title: "Authentication Required",
          description: "Please log in to connect Coinbase.",
          variant: "destructive",
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke('coinbase-oauth', {
        headers: {
          Authorization: `Bearer ${session.data.session.access_token}`,
        },
      });

      if (error) throw error;

      if (data?.success && data?.oauth_url) {
        // Redirect to Coinbase OAuth
        window.location.href = data.oauth_url;
      } else {
        throw new Error('Failed to generate OAuth URL');
      }
    } catch (error) {
      console.error('[RealFundingFlowManager] Coinbase OAuth error:', error);
      toast({
        title: "Connection Failed",
        description: "Could not connect to Coinbase. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsConnectingCoinbase(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-muted/50 border-border">
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // STATE A: No external funding wallet registered
  if (state === 'NO_WALLET') {
    return (
      <>
        <Card className="bg-background border-2 border-primary/50 shadow-lg">
          <CardContent className="p-6">
            <div className="flex flex-col items-center justify-center text-center space-y-5">
              <div className="relative">
                <Wallet className="h-14 w-14 text-primary" />
                <Shield className="h-6 w-6 text-primary/70 absolute -bottom-1 -right-1" />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-2xl font-bold text-foreground">Register a Funding Wallet</h3>
                <p className="text-foreground/70 max-w-md">
                  To fund your portfolio, first register a wallet address you control.
                </p>
              </div>

              {/* How funding works - explicit */}
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 text-left w-full max-w-md">
                <div className="flex gap-3">
                  <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-foreground/80 space-y-2">
                    <p className="font-semibold text-foreground">How REAL funding works:</p>
                    <ol className="list-decimal pl-4 space-y-1.5">
                      <li><strong>Register</strong> your wallet address below</li>
                      <li><strong>Send funds</strong> using MetaMask, Rabby, or Coinbase</li>
                      <li><strong>Receive credit</strong> — your portfolio is credited in EUR</li>
                      <li><strong>Trade</strong> with real capital</li>
                    </ol>
                    <p className="text-foreground/60 mt-2 text-xs">
                      This app cannot move funds on your behalf — you control your wallet.
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Primary CTAs */}
              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                <Button 
                  onClick={() => setShowWalletDialog(true)}
                  className="bg-primary hover:bg-primary/90 flex-1 font-semibold"
                  size="lg"
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  Add Funding Wallet
                </Button>
                <Button 
                  variant="outline"
                  onClick={handleConnectCoinbase}
                  disabled={isConnectingCoinbase}
                  className="flex-1 border-primary/50 text-foreground hover:bg-primary/10 font-medium"
                  size="lg"
                >
                  {isConnectingCoinbase ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Link className="h-4 w-4 mr-2" />
                  )}
                  Connect Coinbase
                </Button>
              </div>

              {/* Coinbase explanation */}
              <p className="text-xs text-foreground/60 max-w-md text-center">
                <strong>Coinbase users:</strong> Connect your account to auto-import wallet addresses. 
                Coinbase wallets work the same as manually added wallets.
              </p>

              {/* Important notice - amber for non-destructive warning */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 w-full max-w-md">
                <p className="text-xs text-foreground/80 text-center">
                  <strong className="text-amber-700 dark:text-amber-400">Note:</strong> You cannot see the system deposit address until you register at least one funding wallet.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <RealFundingWalletDialog
          open={showWalletDialog}
          onOpenChange={setShowWalletDialog}
          onWalletAdded={handleWalletAdded}
        />
      </>
    );
  }

  // STATE B: Wallet registered, portfolio not yet funded
  if (state === 'WALLET_REGISTERED') {
    return (
      <>
        <Card className="bg-background border-2 border-primary/50 shadow-lg">
          <CardContent className="p-6 space-y-6">
            {/* Success banner - high visibility */}
            <div className="bg-primary/20 border-2 border-primary/50 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle className="w-6 h-6 text-primary flex-shrink-0" />
              <div>
                <h4 className="font-semibold text-foreground text-lg">
                  {justAddedWallet ? '✓ Funding Wallet Registered!' : '✓ You Have a Registered Funding Wallet'}
                </h4>
                <p className="text-sm text-foreground/80 mt-1">
                  {externalWalletCount} wallet{externalWalletCount > 1 ? 's' : ''} registered for deposit attribution.
                </p>
              </div>
            </div>

            {/* Header with clear messaging */}
            <div className="text-center space-y-2">
              <Badge variant="outline" className="text-primary border-primary/40 font-medium">
                Step 2 of 3: Send Funds Externally
              </Badge>
              <h3 className="text-2xl font-bold text-foreground">
                Send Funds Using Your Wallet App
              </h3>
              <p className="text-foreground/70 max-w-lg mx-auto">
                Open <strong>MetaMask</strong>, <strong>Rabby</strong>, or <strong>Coinbase Wallet</strong> and send funds to the address below.
              </p>
            </div>

            {/* SYSTEM WALLET ADDRESS - PRIMARY FOCUS */}
            {systemWalletAddress ? (
              <div className="bg-foreground/5 border-2 border-foreground/20 rounded-xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-base font-semibold text-foreground">
                    System Deposit Address
                  </span>
                  <Badge className="bg-primary text-primary-foreground font-medium">
                    Base Network (8453)
                  </Badge>
                </div>
                
                {/* Large, high-contrast address display */}
                <div className="bg-background border-2 border-primary/40 rounded-lg p-4">
                  <code className="text-primary text-base font-mono break-all block text-center leading-relaxed">
                    {systemWalletAddress}
                  </code>
                </div>

                {/* PRIMARY CTA - Copy Address */}
                <Button
                  onClick={copySystemAddress}
                  size="lg"
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base py-6"
                >
                  {copiedAddress ? (
                    <>
                      <CheckCircle className="w-5 h-5 mr-2" />
                      Address Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-5 h-5 mr-2" />
                      Copy System Wallet Address
                    </>
                  )}
                </Button>

                {/* Secondary actions row */}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowQRCode(!showQRCode)}
                    className="flex-1 border-foreground/20 hover:bg-foreground/5"
                  >
                    <QrCode className="w-4 h-4 mr-2" />
                    {showQRCode ? 'Hide QR Code' : 'Show QR Code'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={openBasescan}
                    className="flex-1 border-foreground/20 hover:bg-foreground/5"
                  >
                    View on Basescan
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </Button>
                </div>

                {/* QR Code - prominent when shown */}
                {showQRCode && (
                  <div className="flex justify-center p-6 bg-white rounded-lg border border-foreground/10">
                    <QRCodeSVG value={systemWalletAddress} size={200} />
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">System wallet not available</p>
                    <p className="text-muted-foreground mt-1">
                      Please contact support to set up your trading wallet.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Clear explanation of the model */}
            <div className="bg-amber-500/10 border-2 border-amber-500/30 rounded-lg p-4">
              <div className="flex gap-3">
                <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm space-y-2">
                  <p className="font-semibold text-foreground">Why you must use your wallet app:</p>
                  <ul className="space-y-1.5 text-foreground/80">
                    <li>• Your external wallet is <strong>user-custodied</strong> — only you control it</li>
                    <li>• This app <strong>cannot move funds on your behalf</strong></li>
                    <li>• You must initiate the transfer from MetaMask, Rabby, or Coinbase</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Warning - visible but not destructive styling */}
            <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-amber-700 dark:text-amber-400">Important</p>
                  <p className="text-foreground/80 mt-1">
                    Send funds <strong>only from your registered wallet</strong>.
                    Transfers from unregistered addresses cannot be attributed to your account.
                  </p>
                </div>
              </div>
            </div>

            {/* What happens after sending */}
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <h4 className="font-medium text-foreground text-sm mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                What happens after you send funds:
              </h4>
              <ol className="list-decimal pl-5 text-sm text-foreground/80 space-y-1">
                <li>Transaction confirms on Base network (~2-5 minutes)</li>
                <li>System detects the deposit from your registered wallet</li>
                <li>Your portfolio is credited with the EUR equivalent</li>
                <li>You can start real trading immediately</li>
              </ol>
            </div>

            {/* Registered Wallets - collapsible section */}
            <div className="space-y-3 pt-2 border-t border-foreground/10">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-primary" />
                  Your Registered Funding Wallets ({externalWalletCount})
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowWalletDialog(true)}
                  className="text-primary hover:text-primary/80 text-xs"
                >
                  + Add Another
                </Button>
              </div>
              <ExternalAddressList refreshTrigger={refreshTrigger} />
            </div>

            {/* Supported Assets - subtle footer */}
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground text-center">
                <strong>Accepted:</strong> ETH & USDC on Base (Chain ID 8453) • 
                <strong> Recommended minimum:</strong> 0.01 ETH or 25 USDC
              </p>
            </div>
          </CardContent>
        </Card>

        <RealFundingWalletDialog
          open={showWalletDialog}
          onOpenChange={setShowWalletDialog}
          onWalletAdded={handleWalletAdded}
        />
      </>
    );
  }

  // STATE C: Pending attribution - deposit detected, awaiting credit
  if (state === 'PENDING_ATTRIBUTION') {
    const latestDeposit = pendingDeposits[0];
    
    return (
      <Card className="bg-accent/10 border-accent/50">
        <CardContent className="p-6 space-y-6">
          <div className="text-center">
            <div className="relative inline-block">
              <Loader2 className="h-14 w-14 text-accent animate-spin" />
            </div>
            <Badge variant="outline" className="text-accent border-accent/30 mt-4 mb-2">
              Step 3 of 3: Confirmation
            </Badge>
            <h3 className="text-xl font-semibold text-foreground">
              Deposit Detected
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Waiting for confirmation and portfolio credit...
            </p>
          </div>

          {latestDeposit && (
            <div className="bg-muted rounded-lg p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="text-foreground font-medium">
                  {latestDeposit.amount} {latestDeposit.asset}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Transaction</span>
                <a
                  href={`https://basescan.org/tx/${latestDeposit.tx_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1 font-mono text-xs"
                >
                  {latestDeposit.tx_hash.slice(0, 16)}...
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className="text-accent font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Processing
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Auto-refreshing every 30 seconds
          </div>
          
          <p className="text-xs text-muted-foreground text-center">
            Your portfolio will be credited automatically once confirmation is complete.
          </p>
        </CardContent>
      </Card>
    );
  }

  // STATE D: Portfolio funded - ready to trade
  if (state === 'PORTFOLIO_FUNDED') {
    return (
      <Card className="bg-primary/10 border-primary/50">
        <CardContent className="p-6 space-y-6">
          <div className="text-center">
            <div className="relative inline-block">
              <CheckCircle className="h-14 w-14 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mt-4">
              Your Portfolio is Funded and Ready
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              You can now trade with real capital
            </p>
          </div>

          {/* Portfolio Balance */}
          <div className="bg-primary/20 border border-primary/40 rounded-lg p-6 text-center">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Available Capital
            </div>
            <div className="text-4xl font-bold text-primary">
              {portfolioCapital !== null ? formatEuro(portfolioCapital) : '—'}
            </div>
          </div>

          {/* Primary CTA */}
          <div className="text-center">
            <Button className="bg-primary hover:bg-primary/90" size="lg">
              <TrendingUp className="w-5 h-5 mr-2" />
              Start Real Trading
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>

          {/* Recent Deposits */}
          {pendingDeposits.length > 0 && (
            <div className="space-y-2 pt-4 border-t border-border">
              <h4 className="text-sm font-medium text-foreground">Deposit History</h4>
              <div className="space-y-1">
                {pendingDeposits.slice(0, 3).map((deposit, idx) => (
                  <div key={idx} className="flex justify-between text-xs text-muted-foreground bg-muted/50 rounded p-2">
                    <span className="font-medium">{deposit.amount} {deposit.asset}</span>
                    <a
                      href={`https://basescan.org/tx/${deposit.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1"
                    >
                      View tx
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Fallback (should not reach)
  return null;
}
