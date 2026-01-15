import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Wallet, 
  Copy, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  Shield, 
  AlertTriangle,
  RefreshCw,
  Zap,
  FileCheck,
  XCircle,
  ArrowUpRight
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import { WalletBalanceDisplay } from './WalletBalanceDisplay';
import { WalletCreationModal } from './WalletCreationModal';
import { TradingRulesDialog } from './TradingRulesDialog';
import { WithdrawDialog } from './WithdrawDialog';

interface WalletData {
  id: string;
  wallet_address: string;
  chain_id: number;
  is_active: boolean;
  is_funded: boolean;
  funded_at: string | null;
  funded_amount_wei: string | null;
  created_at: string;
}

interface PrerequisiteChecks {
  has_wallet: boolean;
  wallet_active: boolean;
  wallet_funded: boolean;
  rules_accepted: boolean;
  chain_consistent: boolean;
}

interface PrerequisiteResult {
  ok: boolean;
  checks: PrerequisiteChecks;
  panic_active: boolean;
}

interface ActivateWalletResponse {
  success: boolean;
  error?: string;
  wallet?: {
    id: string;
    wallet_address: string;
    chain_id: number;
    is_active: boolean;
    is_funded: boolean;
  };
}

interface WalletBalances {
  ETH: { symbol: string; amount: number };
  WETH: { symbol: string; amount: number };
  USDC: { symbol: string; amount: number };
}

export function ExecutionWalletPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Wallet state
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Modal states
  const [showCreationModal, setShowCreationModal] = useState(false);
  const [showActivationModal, setShowActivationModal] = useState(false);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  
  // Activation state
  const [isActivating, setIsActivating] = useState(false);
  const [acknowledgedActivation, setAcknowledgedActivation] = useState(false);
  
  // Prerequisites state
  const [prerequisites, setPrerequisites] = useState<PrerequisiteResult | null>(null);
  const [isCheckingPrereqs, setIsCheckingPrereqs] = useState(false);

  // Wallet balances for withdraw dialog
  const [walletBalances, setWalletBalances] = useState<WalletBalances>({
    ETH: { symbol: 'ETH', amount: 0 },
    WETH: { symbol: 'WETH', amount: 0 },
    USDC: { symbol: 'USDC', amount: 0 },
  });

  // Fetch wallet data
  const fetchWallet = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      const { data, error } = await (supabase
        .from('execution_wallets' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle() as any);
      
      if (error && error.code !== 'PGRST116') {
        logger.error('Wallet fetch error:', error);
      }
      
      setWallet(data || null);
    } catch (err) {
      logger.error('Wallet fetch exception:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  // Check prerequisites via RPC
  const checkPrerequisites = useCallback(async () => {
    if (!user?.id) return;
    
    setIsCheckingPrereqs(true);
    try {
      const { data, error } = await (supabase.rpc as any)('check_live_trading_prerequisites');
      
      if (error) {
        logger.error('Prerequisites check error:', error);
        return;
      }
      
      setPrerequisites(data as PrerequisiteResult);
    } catch (err) {
      logger.error('Prerequisites check exception:', err);
    } finally {
      setIsCheckingPrereqs(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchWallet();
    checkPrerequisites();
  }, [fetchWallet, checkPrerequisites]);

  // Handle wallet created from modal
  const handleWalletCreated = async (walletAddress: string) => {
    setShowCreationModal(false);
    toast({
      title: "Wallet Created",
      description: "Your execution wallet has been created. Activate it to enable live trading.",
    });
    await fetchWallet();
    await checkPrerequisites();
  };

  // Activate wallet via RPC
  const handleActivateWallet = async () => {
    if (!wallet || !user?.id || !acknowledgedActivation) return;
    
    setIsActivating(true);
    
    try {
      const { data, error } = await (supabase.rpc as any)('activate_execution_wallet', {
        p_wallet_id: wallet.id,
        p_user_id: user.id
      });
      
      if (error) {
        throw new Error(error.message || 'Failed to activate wallet');
      }
      
      const response = data as ActivateWalletResponse;
      
      if (!response.success) {
        const errorMessages: Record<string, string> = {
          unauthorized: 'You are not authorized to activate this wallet',
          wallet_not_found: 'Wallet not found',
          rules_not_accepted: 'You must accept the trading rules first'
        };
        throw new Error(errorMessages[response.error || ''] || response.error || 'Activation failed');
      }
      
      toast({
        title: "Wallet Activated",
        description: "Your execution wallet is now active. Fund it to enable live trading.",
      });
      
      setShowActivationModal(false);
      setAcknowledgedActivation(false);
      
      // Refresh data
      await fetchWallet();
      await checkPrerequisites();
    } catch (err) {
      logger.error('Wallet activation error:', err);
      toast({
        title: "Activation Failed",
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: "destructive",
      });
    } finally {
      setIsActivating(false);
    }
  };

  // Copy address
  const copyAddress = () => {
    if (wallet?.wallet_address) {
      navigator.clipboard.writeText(wallet.wallet_address);
      toast({
        title: "Copied",
        description: "Wallet address copied to clipboard",
      });
    }
  };

  // Refresh all data
  const handleRefresh = async () => {
    setIsLoading(true);
    await fetchWallet();
    await checkPrerequisites();
    setIsLoading(false);
    toast({
      title: "Refreshed",
      description: "Wallet status updated",
    });
  };

  // Handle balance update from WalletBalanceDisplay
  const handleBalanceUpdate = (isFunded: boolean, totalValue: number, balances?: WalletBalances) => {
    if (balances) {
      setWalletBalances(balances);
    }
    if (isFunded !== wallet?.is_funded) {
      fetchWallet();
      checkPrerequisites();
    }
  };

  // Handle rules accepted
  const handleRulesAccepted = async () => {
    await checkPrerequisites();
    toast({
      title: "Rules Accepted",
      description: "You can now activate your wallet for live trading.",
    });
  };

  const getNetworkName = (chainId: number): string => {
    switch (chainId) {
      case 1: return 'Ethereum Mainnet';
      case 8453: return 'Base';
      case 137: return 'Polygon';
      case 42161: return 'Arbitrum';
      default: return `Chain ${chainId}`;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Live Trading Readiness Panel */}
      <Card className="p-6 bg-card border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Live Trading Readiness
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isCheckingPrereqs}
            className="text-muted-foreground hover:text-foreground"
          >
            {isCheckingPrereqs ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Wallet Created */}
          <div className={`flex items-center gap-3 p-3 rounded-lg ${
            prerequisites?.checks.has_wallet ? 'bg-green-500/10' : 'bg-muted/50'
          }`}>
            {prerequisites?.checks.has_wallet ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <XCircle className="w-5 h-5 text-muted-foreground" />
            )}
            <span className={prerequisites?.checks.has_wallet ? 'text-green-300' : 'text-muted-foreground'}>
              Wallet Created
            </span>
          </div>
          
          {/* Wallet Active */}
          <div className={`flex items-center gap-3 p-3 rounded-lg ${
            prerequisites?.checks.wallet_active ? 'bg-green-500/10' : 'bg-muted/50'
          }`}>
            {prerequisites?.checks.wallet_active ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <XCircle className="w-5 h-5 text-muted-foreground" />
            )}
            <span className={prerequisites?.checks.wallet_active ? 'text-green-300' : 'text-muted-foreground'}>
              Wallet Activated
            </span>
          </div>
          
          {/* Wallet Funded */}
          <div className={`flex items-center gap-3 p-3 rounded-lg ${
            prerequisites?.checks.wallet_funded ? 'bg-green-500/10' : 'bg-muted/50'
          }`}>
            {prerequisites?.checks.wallet_funded ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <XCircle className="w-5 h-5 text-muted-foreground" />
            )}
            <span className={prerequisites?.checks.wallet_funded ? 'text-green-300' : 'text-muted-foreground'}>
              Wallet Funded
            </span>
          </div>
          
          {/* Rules Accepted - NOW CLICKABLE */}
          <button
            onClick={() => !prerequisites?.checks.rules_accepted && setShowRulesDialog(true)}
            disabled={prerequisites?.checks.rules_accepted}
            className={`flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
              prerequisites?.checks.rules_accepted 
                ? 'bg-green-500/10 cursor-default' 
                : 'bg-muted/50 hover:bg-muted cursor-pointer'
            }`}
          >
            {prerequisites?.checks.rules_accepted ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <FileCheck className="w-5 h-5 text-amber-400" />
            )}
            <span className={prerequisites?.checks.rules_accepted ? 'text-green-300' : 'text-amber-300'}>
              Trading Rules Accepted
            </span>
            {!prerequisites?.checks.rules_accepted && (
              <span className="text-xs text-amber-400 ml-auto">Click to accept</span>
            )}
          </button>
          
          {/* Panic Status */}
          <div className={`flex items-center gap-3 p-3 rounded-lg md:col-span-2 ${
            prerequisites?.panic_active === false ? 'bg-green-500/10' : 
            prerequisites?.panic_active === true ? 'bg-destructive/10' : 'bg-muted/50'
          }`}>
            {prerequisites?.panic_active === false ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : prerequisites?.panic_active === true ? (
              <AlertTriangle className="w-5 h-5 text-destructive" />
            ) : (
              <AlertCircle className="w-5 h-5 text-muted-foreground" />
            )}
            <span className={
              prerequisites?.panic_active === false ? 'text-green-300' : 
              prerequisites?.panic_active === true ? 'text-destructive' : 'text-muted-foreground'
            }>
              {prerequisites?.panic_active ? 'Panic Mode Active (Trading Halted)' : 'No Panic Active'}
            </span>
          </div>
        </div>
        
        {/* Overall Status */}
        <div className="mt-4 pt-4 border-t border-border">
          {prerequisites?.ok ? (
            <div className="flex items-center gap-2 text-green-400">
              <Zap className="w-5 h-5" />
              <span className="font-medium">Ready for Live Trading</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-400">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">Complete the steps above to enable live trading</span>
            </div>
          )}
        </div>
      </Card>

      {/* Wallet Creation / Status Section */}
      {!wallet ? (
        // No wallet - show creation UI
        <Card className="p-6 bg-card border-border">
          <div className="text-center">
            <Wallet className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-foreground mb-2">Create Execution Wallet</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Create a dedicated wallet for automated trading. This wallet will be used by 
              strategies to execute real trades on your behalf.
            </p>
            
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6 text-left max-w-md mx-auto">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200">
                  <p className="font-medium mb-2">Important:</p>
                  <ul className="list-disc pl-4 space-y-1 text-amber-200/80">
                    <li>You will receive your private key <strong>once only</strong></li>
                    <li>Save the key immediately - it cannot be recovered</li>
                    <li>This wallet is dedicated to automated trading</li>
                    <li>One wallet per account - cannot be changed</li>
                  </ul>
                </div>
              </div>
            </div>
            
            <Button 
              onClick={() => setShowCreationModal(true)}
              className="bg-primary hover:bg-primary/90"
            >
              <Wallet className="w-4 h-4 mr-2" />
              Create Execution Wallet
            </Button>
          </div>
        </Card>
      ) : (
        // Wallet exists - show status
        <div className="space-y-4">
          {/* Wallet Status Header */}
          <Card className="p-6 bg-card border-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Execution Wallet</h3>
              <div className="flex items-center gap-2">
                {wallet.is_funded && (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Funded
                  </Badge>
                )}
                {wallet.is_active ? (
                  <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                    <Zap className="w-3 h-3 mr-1" />
                    Active
                  </Badge>
                ) : (
                  <Badge className="bg-muted text-muted-foreground border-border">
                    Inactive
                  </Badge>
                )}
              </div>
            </div>
            
            {/* Wallet Address */}
            <div className="bg-muted/50 rounded-lg p-4 mb-4">
              <div className="text-xs text-muted-foreground mb-2">Wallet Address</div>
              <div className="flex items-center gap-2">
                <code className="text-green-400 font-mono text-sm break-all flex-1 bg-background p-3 rounded">
                  {wallet.wallet_address}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyAddress}
                  className="text-muted-foreground hover:text-foreground flex-shrink-0"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
            
            {/* Network Info + Actions */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Network</div>
                <div className="text-foreground font-medium">{getNetworkName(wallet.chain_id)}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Created</div>
                <div className="text-foreground font-medium">
                  {new Date(wallet.created_at).toLocaleDateString()}
                </div>
              </div>
              
              {/* Withdraw Button */}
              {wallet.is_active && wallet.is_funded && (
                <div className="md:col-span-2 flex items-center justify-end">
                  <Button
                    variant="outline"
                    onClick={() => setShowWithdrawDialog(true)}
                    className="w-full md:w-auto"
                  >
                    <ArrowUpRight className="w-4 h-4 mr-2" />
                    Withdraw
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Activation Step (if not active) */}
          {!wallet.is_active && (
            <Card className="p-6 bg-amber-500/10 border-amber-500/30">
              <div className="flex items-start gap-4">
                <AlertCircle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-1" />
                <div className="flex-1">
                  <h4 className="text-amber-300 font-semibold mb-2">Activation Required</h4>
                  <p className="text-amber-200/80 text-sm mb-4">
                    Your wallet has been created but is not yet active. Activate it to enable 
                    funding and live trading.
                  </p>
                  <Button
                    onClick={() => setShowActivationModal(true)}
                    className="bg-amber-500 hover:bg-amber-600 text-black"
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Activate Wallet
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Funding Step (if active but not funded) */}
          {wallet.is_active && !wallet.is_funded && (
            <Card className="p-6 bg-blue-500/10 border-blue-500/30">
              <div className="flex items-start gap-4">
                <Wallet className="w-6 h-6 text-blue-400 flex-shrink-0 mt-1" />
                <div className="flex-1">
                  <h4 className="text-blue-300 font-semibold mb-2">Fund Your Wallet</h4>
                  <p className="text-blue-200/80 text-sm mb-4">
                    Send ETH or USDC on the Base network to enable live trading.
                  </p>
                  <ol className="text-blue-200/70 text-sm space-y-2 list-decimal pl-4 mb-4">
                    <li>Copy the wallet address above</li>
                    <li>Send funds from your exchange or wallet</li>
                    <li>Wait for confirmation (usually 1-2 minutes)</li>
                  </ol>
                  <div className="bg-blue-500/20 rounded-lg p-3 text-blue-200 text-sm">
                    <strong>Minimum recommended:</strong> 0.01 ETH for gas + trading capital
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Wallet Balance Display - Show when wallet is active */}
          {wallet.is_active && (
            <WalletBalanceDisplay 
              walletAddress={wallet.wallet_address}
              onBalanceUpdate={handleBalanceUpdate}
            />
          )}

          {/* All Ready */}
          {wallet.is_active && wallet.is_funded && (
            <Card className="p-6 bg-green-500/10 border-green-500/30">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-green-400" />
                <div>
                  <h4 className="text-green-300 font-semibold">Wallet Ready for Trading</h4>
                  <p className="text-green-200/80 text-sm">
                    Your execution wallet is active and funded. You can now promote MOCK strategies to LIVE.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Permanent Warning */}
          <Card className="p-4 bg-muted/30 border-border">
            <div className="flex gap-3">
              <Shield className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground/80 mb-1">Security Notice</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>This wallet cannot be changed or deleted</li>
                  <li>You can use the private key you saved to access funds externally</li>
                  <li>Automated strategies can trade from this wallet</li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Wallet Creation Modal */}
      <WalletCreationModal
        open={showCreationModal}
        onOpenChange={setShowCreationModal}
        onWalletCreated={handleWalletCreated}
      />

      {/* Trading Rules Dialog */}
      <TradingRulesDialog
        open={showRulesDialog}
        onOpenChange={setShowRulesDialog}
        onAccepted={handleRulesAccepted}
      />

      {/* Withdraw Dialog */}
      <WithdrawDialog
        open={showWithdrawDialog}
        onOpenChange={setShowWithdrawDialog}
        walletAddress={wallet?.wallet_address || ''}
        balances={walletBalances}
        onWithdrawComplete={() => {
          fetchWallet();
          checkPrerequisites();
        }}
      />

      {/* Activation Confirmation Modal */}
      <Dialog open={showActivationModal} onOpenChange={setShowActivationModal}>
        <DialogContent className="sm:max-w-md bg-background border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Zap className="w-5 h-5 text-amber-400" />
              Activate Execution Wallet
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This action enables your wallet for live trading.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 my-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200">
                  <p className="font-medium mb-2">By activating this wallet:</p>
                  <ul className="list-disc pl-4 space-y-1 text-amber-200/80">
                    <li>You enable funding to this wallet</li>
                    <li>LIVE strategies can use funds in this wallet</li>
                    <li>Automated trades will use REAL money</li>
                  </ul>
                </div>
              </div>
            </div>
            
            <div className="border border-destructive/50 bg-destructive/5 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="acknowledge-activation"
                  checked={acknowledgedActivation}
                  onCheckedChange={(checked) => setAcknowledgedActivation(checked === true)}
                  className="mt-0.5"
                />
                <label 
                  htmlFor="acknowledge-activation" 
                  className="text-sm font-medium text-destructive cursor-pointer select-none"
                >
                  I understand this wallet will be used for REAL trading with REAL money
                </label>
              </div>
            </div>
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => {
                setShowActivationModal(false);
                setAcknowledgedActivation(false);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleActivateWallet}
              disabled={!acknowledgedActivation || isActivating}
              className="bg-amber-500 hover:bg-amber-600 text-black"
            >
              {isActivating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Activating...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Activate Wallet
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
