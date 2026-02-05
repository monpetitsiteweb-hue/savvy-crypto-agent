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

  // STATE A: No external funding wallet
  if (state === 'NO_WALLET') {
    return (
      <>
        <Card className="bg-muted/50 border-primary/30">
          <CardContent className="p-6">
            <div className="flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative">
                <Wallet className="h-12 w-12 text-primary" />
                <Shield className="h-5 w-5 text-primary/70 absolute -bottom-1 -right-1" />
              </div>
              
              <div>
                <h3 className="text-lg font-semibold text-foreground">Enable Real Trading</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  To start trading with real capital, you must first register a funding wallet you own.
                </p>
              </div>

              {/* How it works */}
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 text-left w-full max-w-md">
                <div className="flex gap-3">
                  <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-foreground/80 space-y-2">
                    <p className="font-medium text-foreground">How it works:</p>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>Register your external wallet address</li>
                      <li>Send funds from that address to the system wallet</li>
                      <li>System automatically credits your portfolio in EUR</li>
                      <li>Start trading with real capital</li>
                    </ol>
                  </div>
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                <Button 
                  onClick={() => setShowWalletDialog(true)}
                  className="bg-primary hover:bg-primary/90 flex-1"
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  Add Funding Wallet
                </Button>
                <Button 
                  variant="outline"
                  onClick={handleConnectCoinbase}
                  disabled={isConnectingCoinbase}
                  className="flex-1 border-accent text-accent-foreground hover:bg-accent/10"
                >
                  {isConnectingCoinbase ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Link className="h-4 w-4 mr-2" />
                  )}
                  Connect Coinbase
                </Button>
              </div>

              <p className="text-xs text-muted-foreground max-w-md text-center">
                <strong>Coinbase users:</strong> Connect your account to automatically import verified wallet addresses.
              </p>

              <p className="text-xs text-muted-foreground max-w-md">
                Only deposits from registered wallets on Base network (Chain ID 8453) are supported.
                ETH and USDC are accepted.
              </p>
            </div>
          </CardContent>
        </Card>

        <RealFundingWalletDialog
          open={showWalletDialog}
          onOpenChange={setShowWalletDialog}
          onWalletAdded={handleWalletAdded}
          systemWalletAddress={systemWalletAddress || undefined}
        />
      </>
    );
  }

  // STATE B: Wallet registered, waiting for funding
  if (state === 'WALLET_REGISTERED') {
    return (
      <>
        <Card className="bg-muted/50 border-border">
          <CardContent className="p-6 space-y-6">
            {/* Success banner if just added */}
            {justAddedWallet && (
              <div className="bg-primary/20 border border-primary/40 rounded-lg p-4 flex items-start gap-3">
                <CheckCircle className="w-6 h-6 text-primary flex-shrink-0" />
                <div>
                  <h4 className="font-medium text-foreground">Wallet Successfully Registered!</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your funding wallet is now active. Follow the steps below to fund your portfolio.
                  </p>
                </div>
              </div>
            )}

            {/* Header */}
            <div className="text-center">
              <Badge variant="outline" className="text-primary border-primary/30 mb-3">
                Step 2 of 3: Fund Your Portfolio
              </Badge>
              <h3 className="text-lg font-semibold text-foreground">
                Send Funds to Start Trading
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Transfer ETH or USDC on Base from your registered wallet
              </p>
            </div>

            {/* System Trading Wallet Address */}
            {systemWalletAddress ? (
              <div className="bg-muted rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                    System Trading Wallet
                  </span>
                  <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
                    Base (8453)
                  </Badge>
                </div>
                
                <div className="flex items-center gap-2">
                  <code className="text-primary text-sm font-mono break-all flex-1 bg-background p-3 rounded border border-border">
                    {systemWalletAddress}
                  </code>
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copySystemAddress}
                      className="border-border h-9 w-9 p-0"
                    >
                      {copiedAddress ? (
                        <CheckCircle className="w-4 h-4 text-primary" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowQRCode(!showQRCode)}
                      className="border-border h-9 w-9 p-0"
                    >
                      <QrCode className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* QR Code */}
                {showQRCode && (
                  <div className="flex justify-center p-4 bg-white rounded-lg">
                    <QRCodeSVG value={systemWalletAddress} size={150} />
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openBasescan}
                  className="w-full text-muted-foreground hover:text-foreground"
                >
                  View on Basescan
                  <ExternalLink className="w-3 h-3 ml-2" />
                </Button>
              </div>
            ) : (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">System wallet not available</p>
                    <p className="text-muted-foreground mt-1">
                      Please create an execution wallet first to receive funds.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Critical Warning */}
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-bold text-destructive">⚠️ IMPORTANT</p>
                  <p className="text-foreground/80 mt-1">
                    Funds <strong>must be sent from your registered funding wallet</strong>. 
                    Deposits from unregistered addresses cannot be attributed to your account.
                  </p>
                </div>
              </div>
            </div>

            {/* Registered Wallets */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-primary" />
                  Your Registered Funding Wallets ({externalWalletCount})
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowWalletDialog(true)}
                  className="text-primary hover:text-primary/80"
                >
                  + Add Another
                </Button>
              </div>
              <ExternalAddressList refreshTrigger={refreshTrigger} />
            </div>

            {/* Supported Assets */}
            <div className="bg-accent/30 border border-accent/50 rounded-lg p-3">
              <p className="text-xs text-accent-foreground text-center">
                <strong>Supported:</strong> ETH and USDC on Base (Chain ID 8453) • 
                <strong> Minimum:</strong> 0.01 ETH or 25 USDC recommended
              </p>
            </div>
          </CardContent>
        </Card>

        <RealFundingWalletDialog
          open={showWalletDialog}
          onOpenChange={setShowWalletDialog}
          onWalletAdded={handleWalletAdded}
          systemWalletAddress={systemWalletAddress || undefined}
        />
      </>
    );
  }

  // STATE C: Pending attribution
  if (state === 'PENDING_ATTRIBUTION') {
    const latestDeposit = pendingDeposits[0];
    
    return (
      <Card className="bg-muted/50 border-accent/50">
        <CardContent className="p-6 space-y-6">
          <div className="text-center">
            <div className="relative inline-block">
              <Clock className="h-12 w-12 text-accent animate-pulse" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mt-4">
              Processing Your Deposit
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              We detected a recent deposit and are crediting your portfolio
            </p>
          </div>

          {latestDeposit && (
            <div className="bg-muted rounded-lg p-4 space-y-2">
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
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  {latestDeposit.tx_hash.slice(0, 10)}...
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Auto-refreshing every 30 seconds
          </div>
        </CardContent>
      </Card>
    );
  }

  // STATE D: Portfolio funded
  if (state === 'PORTFOLIO_FUNDED') {
    return (
      <Card className="bg-primary/5 border-primary/30">
        <CardContent className="p-6 space-y-6">
          <div className="text-center">
            <div className="relative inline-block">
              <CheckCircle className="h-12 w-12 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mt-4">
              Portfolio Funded
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Your REAL trading portfolio is ready
            </p>
          </div>

          {/* Portfolio Balance */}
          <div className="bg-muted rounded-lg p-6 text-center">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              Available Capital
            </div>
            <div className="text-3xl font-bold text-primary">
              {portfolioCapital !== null ? formatEuro(portfolioCapital) : '—'}
            </div>
          </div>

          {/* CTA */}
          <div className="text-center">
            <Button className="bg-primary hover:bg-primary/90">
              <TrendingUp className="w-4 h-4 mr-2" />
              Start Trading
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>

          {/* Recent Deposits */}
          {pendingDeposits.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">Recent Deposits</h4>
              <div className="space-y-1">
                {pendingDeposits.slice(0, 3).map((deposit, idx) => (
                  <div key={idx} className="flex justify-between text-xs text-muted-foreground bg-muted/50 rounded p-2">
                    <span>{deposit.amount} {deposit.asset}</span>
                    <a
                      href={`https://basescan.org/tx/${deposit.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      View tx
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
