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
  ArrowUpRight,
  Key,
  Bug
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import { WalletBalanceDisplay } from './WalletBalanceDisplay';
import { WalletCreationModal } from './WalletCreationModal';
import { TradingRulesDialog } from './TradingRulesDialog';
import { WithdrawDialog } from './WithdrawDialog';
import { ExternalFundingSection } from './ExternalFundingSection';

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

/**
 * NEW RPC CONTRACT (check_live_trading_prerequisites):
 * 
 * wallet_exists = EXTERNAL WALLET registered (user_external_addresses)
 * has_portfolio_capital = REAL portfolio capital > 0 (SOLE authority)
 * 
 * Returns:
 * {
 *   ok: boolean,           // Global readiness
 *   checks: {
 *     wallet_exists: boolean,        // External wallet registered
 *     has_portfolio_capital: boolean, // REAL cash > 0
 *     rules_accepted: boolean
 *   },
 *   panic_active: boolean,  // Top-level status flag
 *   meta: {
 *     external_wallet_address: string | null,
 *     portfolio_balance_eur: number
 *   }
 * }
 */
interface PrerequisiteChecks {
  wallet_exists: boolean;
  has_portfolio_capital: boolean;
  rules_accepted: boolean;
}

interface PrerequisiteMeta {
  external_wallet_address: string | null;
  portfolio_balance_eur: number;
}

interface PrerequisiteResult {
  ok: boolean;
  checks: PrerequisiteChecks;
  panic_active: boolean;
  meta: PrerequisiteMeta;
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

/**
 * Validates the RPC response shape matches the expected contract.
 * Returns an error message if invalid, null if valid.
 */
function validateRpcShape(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return 'RPC returned invalid data (not an object)';
  }
  
  const d = data as Record<string, unknown>;
  
  if (typeof d.ok !== 'boolean') {
    return 'RPC missing required field: ok (boolean)';
  }
  
  if (typeof d.panic_active !== 'boolean') {
    return 'RPC missing required field: panic_active (boolean)';
  }
  
  if (!d.checks || typeof d.checks !== 'object') {
    return 'RPC missing required field: checks (object)';
  }
  
  const checks = d.checks as Record<string, unknown>;
  // UPDATED: wallet_funded removed from contract - external wallet model
  const requiredChecks = ['wallet_exists', 'has_portfolio_capital', 'rules_accepted'];
  for (const field of requiredChecks) {
    if (typeof checks[field] !== 'boolean') {
      return `RPC checks missing required field: ${field} (boolean)`;
    }
  }
  
  if (!d.meta || typeof d.meta !== 'object') {
    return 'RPC missing required field: meta (object)';
  }
  
  return null;
}

export function ExecutionWalletPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Wallet state (local table data for UI operations)
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Modal states
  const [showCreationModal, setShowCreationModal] = useState(false);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  const [showClearPanicDialog, setShowClearPanicDialog] = useState(false);
  
  // Panic clear state
  const [isClearingPanic, setIsClearingPanic] = useState(false);
  
  // Prerequisites state - SINGLE SOURCE OF TRUTH from RPC
  const [prerequisites, setPrerequisites] = useState<PrerequisiteResult | null>(null);
  const [isCheckingPrereqs, setIsCheckingPrereqs] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  
  // Dev mode toggle
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [rawRpcPayload, setRawRpcPayload] = useState<unknown>(null);

  // Wallet balances for withdraw dialog
  const [walletBalances, setWalletBalances] = useState<WalletBalances>({
    ETH: { symbol: 'ETH', amount: 0 },
    WETH: { symbol: 'WETH', amount: 0 },
    USDC: { symbol: 'USDC', amount: 0 },
  });

  // Key decode state (for manual base64 -> hex conversion)
  const [base64KeyInput, setBase64KeyInput] = useState('');
  const [decodedHexKey, setDecodedHexKey] = useState<string | null>(null);
  const [hexDecodeError, setHexDecodeError] = useState<string | null>(null);
  const [hexKeyCopied, setHexKeyCopied] = useState(false);

  /**
   * Decodes a base64-encoded private key to 64-character lowercase hex.
   * Pure transformation - no side effects, no logging, no persistence.
   */
  const base64ToHex = (b64: string): string => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    if (bytes.length !== 32) {
      throw new Error(`Invalid private key length: ${bytes.length} bytes (expected 32)`);
    }
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleDecodeToHex = () => {
    const trimmed = base64KeyInput.trim();
    if (!trimmed) {
      setHexDecodeError('Please paste your base64 key first');
      return;
    }
    
    setHexDecodeError(null);
    setDecodedHexKey(null);
    setHexKeyCopied(false);
    
    try {
      const hex = base64ToHex(trimmed);
      setDecodedHexKey(hex);
    } catch (err) {
      setHexDecodeError(err instanceof Error ? err.message : 'Decode failed');
    }
  };

  const copyHexKey = () => {
    if (decodedHexKey) {
      navigator.clipboard.writeText(decodedHexKey);
      setHexKeyCopied(true);
      toast({
        title: "Hex Key Copied",
        description: "64-character hex key copied - import into MetaMask/Rabby",
      });
    }
  };

  const clearDecodeState = () => {
    setBase64KeyInput('');
    setDecodedHexKey(null);
    setHexDecodeError(null);
    setHexKeyCopied(false);
  };

  // Fetch wallet data (for local UI operations like address display, withdraw)
  const fetchWallet = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      const { data, error } = await (supabase
        .from('execution_wallets' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
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

  // Check prerequisites via RPC - SINGLE SOURCE OF TRUTH
  const checkPrerequisites = useCallback(async () => {
    if (!user?.id) return;
    
    setIsCheckingPrereqs(true);
    setRpcError(null);
    
    try {
      const { data, error } = await (supabase.rpc as any)('check_live_trading_prerequisites', {
        p_user_id: user.id
      });
      
      // Store raw payload for dev panel
      setRawRpcPayload(data);
      
      if (error) {
        logger.error('Prerequisites check error:', error);
        setRpcError(`RPC call failed: ${error.message}`);
        return;
      }
      
      // CRITICAL: Validate RPC shape - no silent fallbacks
      const validationError = validateRpcShape(data);
      if (validationError) {
        logger.error('RPC shape validation failed:', validationError, data);
        setRpcError(validationError);
        return;
      }
      
      setPrerequisites(data as PrerequisiteResult);
    } catch (err) {
      logger.error('Prerequisites check exception:', err);
      setRpcError('Unexpected error checking prerequisites');
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
      description: "Your execution wallet has been created. Fund it via external deposit to enable LIVE trading.",
    });
    await fetchWallet();
    await checkPrerequisites();
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
      description: "LIVE readiness status updated",
    });
  };

  // Handle balance update from WalletBalanceDisplay
  const handleBalanceUpdate = (isFunded: boolean, totalValue: number, balances?: WalletBalances) => {
    if (balances) {
      setWalletBalances(balances);
    }
    // Trigger re-check of prerequisites if funding state changed
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
      description: "Trading rules accepted. Complete remaining steps to enable LIVE trading.",
    });
  };

  // Handle clear panic state
  const handleClearPanic = async () => {
    if (!user?.id) return;
    
    setIsClearingPanic(true);
    try {
      const { data: strategyData } = await (supabase
        .from('trading_strategies' as any)
        .select('liquidation_batch_id')
        .eq('user_id', user.id)
        .eq('panic_active', true)
        .limit(1)
        .maybeSingle() as any);
      
      const batchId = strategyData?.liquidation_batch_id || `manual-clear-${Date.now()}`;
      
      const { error } = await (supabase.rpc as any)('clear_panic_state', {
        p_batch_id: batchId,
        p_user_id: user.id
      });
      
      if (error) throw error;
      
      toast({
        title: "Panic State Cleared",
        description: "Trading has been re-enabled. Strategies remain paused until manually resumed.",
      });
      
      setShowClearPanicDialog(false);
      await checkPrerequisites();
    } catch (err) {
      logger.error('Clear panic error:', err);
      toast({
        title: "Failed to Clear Panic",
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: "destructive",
      });
    } finally {
      setIsClearingPanic(false);
    }
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

  // Derive state machine step from RPC
  const getReadinessState = (): 'no_wallet' | 'no_capital' | 'ready' | 'error' => {
    if (rpcError) return 'error';
    if (!prerequisites) return 'error';
    
    if (!prerequisites.checks.wallet_exists) return 'no_wallet';
    if (!prerequisites.checks.has_portfolio_capital) return 'no_capital';
    if (!prerequisites.checks.rules_accepted) return 'no_capital'; // Still needs setup
    if (prerequisites.panic_active) return 'no_capital'; // Panic blocks LIVE
    if (prerequisites.ok) return 'ready';
    
    return 'no_capital';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const readinessState = getReadinessState();

  return (
    <div className="space-y-6">
      {/* RPC Error State - Explicit, never silent */}
      {rpcError && (
        <Card className="p-6 bg-destructive/10 border-destructive/50">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-destructive flex-shrink-0 mt-1" />
            <div className="flex-1">
              <h4 className="text-destructive font-semibold mb-2">LIVE Readiness Check Failed</h4>
              <p className="text-destructive/80 text-sm mb-4 font-mono">
                {rpcError}
              </p>
              <Button
                onClick={handleRefresh}
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/10"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* LIVE Readiness Panel - SOLE SOURCE OF TRUTH */}
      <Card className="p-6 bg-slate-900 border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" />
            LIVE Readiness
          </h3>
          <div className="flex items-center gap-2">
            {/* Dev panel toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDevPanel(!showDevPanel)}
              className="text-slate-500 hover:text-slate-300"
              title="Toggle dev panel"
            >
              <Bug className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isCheckingPrereqs}
              className="text-slate-400 hover:text-white"
            >
              {isCheckingPrereqs ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Dev Panel - Raw RPC Payload */}
        {showDevPanel && (
          <div className="mb-4 p-3 bg-slate-950 rounded-lg border border-slate-700">
            <div className="text-xs text-slate-500 mb-2 font-mono">
              [DEV] Raw RPC Payload (check_live_trading_prerequisites)
            </div>
            <pre className="text-xs text-green-400 font-mono overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(rawRpcPayload, null, 2)}
            </pre>
          </div>
        )}
        
        {/* Checklist - Driven STRICTLY by RPC checks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* External Wallet Connected - from checks.wallet_exists */}
          <div className={`flex items-center gap-3 p-3 rounded-lg ${
            prerequisites?.checks?.wallet_exists ? 'bg-green-500/10' : 'bg-slate-800/50'
          }`}>
            {prerequisites?.checks?.wallet_exists ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <XCircle className="w-5 h-5 text-slate-500" />
            )}
            <span className={prerequisites?.checks?.wallet_exists ? 'text-green-300' : 'text-slate-400'}>
              External Wallet Connected
            </span>
          </div>
          
          {/* Portfolio Capital - from checks.has_portfolio_capital (SOLE AUTHORITY) */}
          <div className={`flex items-center gap-3 p-3 rounded-lg ${
            prerequisites?.checks?.has_portfolio_capital ? 'bg-green-500/10' : 'bg-slate-800/50'
          }`}>
            {prerequisites?.checks?.has_portfolio_capital ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <XCircle className="w-5 h-5 text-slate-500" />
            )}
            <div className="flex flex-col">
              <span className={prerequisites?.checks?.has_portfolio_capital 
                ? 'text-green-300' : 'text-slate-400'}>
                Portfolio Capital
              </span>
              {prerequisites?.meta?.portfolio_balance_eur !== undefined && 
               prerequisites.meta.portfolio_balance_eur > 0 && (
                <span className="text-xs text-green-400">
                  €{prerequisites.meta.portfolio_balance_eur.toFixed(2)}
                </span>
              )}
            </div>
          </div>
          
          {/* Rules Accepted - from checks.rules_accepted (CLICKABLE) */}
          <button
            onClick={() => !prerequisites?.checks?.rules_accepted && setShowRulesDialog(true)}
            disabled={prerequisites?.checks?.rules_accepted}
            className={`flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
              prerequisites?.checks?.rules_accepted 
                ? 'bg-green-500/10 cursor-default' 
                : 'bg-slate-800/50 hover:bg-slate-700 cursor-pointer'
            }`}
          >
            {prerequisites?.checks?.rules_accepted ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <FileCheck className="w-5 h-5 text-amber-400" />
            )}
            <span className={prerequisites?.checks?.rules_accepted ? 'text-green-300' : 'text-amber-300'}>
              Trading Rules
            </span>
            {!prerequisites?.checks?.rules_accepted && (
              <span className="text-xs text-amber-400 ml-auto">Click to accept</span>
            )}
          </button>
        </div>

        {/* Panic Status - STATUS BADGE ONLY (not a checklist item) */}
        {prerequisites?.panic_active && (
          <div className="mt-3 flex items-center justify-between p-3 rounded-lg bg-red-500/10">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <span className="text-red-400 font-medium">Panic Mode Active</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowClearPanicDialog(true)}
              className="border-red-500/50 text-red-400 hover:bg-red-500/10"
            >
              Clear Panic
            </Button>
          </div>
        )}
        
        {/* Overall Status Banner */}
        <div className="mt-4 pt-4 border-t border-slate-700">
          {readinessState === 'ready' && (
            <div className="flex items-center gap-2 text-green-400">
              <Zap className="w-5 h-5" />
              <span className="font-medium">Ready for LIVE Trading</span>
            </div>
          )}
          {readinessState === 'no_wallet' && (
            <div className="flex items-center gap-2 text-amber-400">
              <Wallet className="w-5 h-5" />
              <span className="font-medium">Connect an external wallet to get started</span>
            </div>
          )}
          {readinessState === 'no_capital' && (
            <div className="flex items-center gap-2 text-amber-400">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">Complete the steps above to enable LIVE trading</span>
            </div>
          )}
          {readinessState === 'error' && !rpcError && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">Unable to determine readiness</span>
            </div>
          )}
        </div>
      </Card>

      {/* Wallet Creation / Status Section */}
      {readinessState === 'no_wallet' ? (
        // No external wallet - show connection UI
        <Card className="p-6 bg-slate-900 border-slate-700">
          <div className="text-center">
            <Wallet className="w-16 h-16 text-slate-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Connect External Wallet</h3>
            <p className="text-slate-400 mb-6 max-w-md mx-auto">
              Connect your external wallet to fund your portfolio. Deposits from this wallet
              will be credited to your REAL trading balance.
            </p>
            
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6 text-left max-w-md mx-auto">
              <div className="flex gap-3">
                <Shield className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-200">
                  <p className="font-medium mb-2">How it works:</p>
                  <ul className="list-disc pl-4 space-y-1 text-blue-200/80">
                    <li>Register your external wallet address</li>
                    <li>Send funds from that wallet to the system address</li>
                    <li>Deposits are automatically credited to your portfolio</li>
                    <li>Trade with real capital once funded</li>
                  </ul>
                </div>
              </div>
            </div>
            
            <Button 
              onClick={() => setShowCreationModal(true)}
              className="bg-primary hover:bg-primary/90"
            >
              <Wallet className="w-4 h-4 mr-2" />
              Connect External Wallet
            </Button>
          </div>
        </Card>
      ) : wallet ? (
        // Wallet exists - show status
        <div className="space-y-4">
          {/* External Wallet Status Header */}
          <Card className="p-6 bg-slate-900 border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">External Wallet</h3>
              <div className="flex items-center gap-2">
                {prerequisites?.checks?.has_portfolio_capital && (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Funded
                  </Badge>
                )}
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                  <Zap className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
              </div>
            </div>
            
            {/* Wallet Address */}
            <div className="bg-slate-800/50 rounded-lg p-4 mb-4">
              <div className="text-xs text-slate-400 mb-2">Wallet Address</div>
              <div className="flex items-center gap-2">
                <code className="text-green-400 font-mono text-sm break-all flex-1 bg-slate-950 p-3 rounded">
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
            
            {/* Network Info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-800/30 rounded-lg p-3">
                <div className="text-xs text-slate-400 mb-1">Network</div>
                <div className="text-white font-medium">{getNetworkName(wallet.chain_id)}</div>
              </div>
              <div className="bg-slate-800/30 rounded-lg p-3">
                <div className="text-xs text-slate-400 mb-1">Created</div>
                <div className="text-white font-medium">
                  {new Date(wallet.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-4 pt-4 border-t border-slate-700 flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => setShowWithdrawDialog(true)}
                className="flex-1 min-w-[140px] border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
              >
                <ArrowUpRight className="w-4 h-4 mr-2" />
                Send / Withdraw
              </Button>
            </div>
          </Card>

          {/* External Funding Section - PRIMARY PATH for REAL trading capital */}
          {!prerequisites?.checks?.has_portfolio_capital && (
            <ExternalFundingSection defaultExpanded={true} />
          )}

          {/* Wallet Balance Display */}
          <WalletBalanceDisplay 
            walletAddress={wallet.wallet_address}
            onBalanceUpdate={handleBalanceUpdate}
          />

          {/* Ready Banner */}
          {prerequisites?.ok && (
            <Card className="p-6 bg-primary/10 border-primary/30">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-primary" />
                <div>
                  <h4 className="text-foreground font-semibold">Ready for LIVE Trading</h4>
                  <p className="text-muted-foreground text-sm">
                    Your portfolio capital is available. You can now execute real trades.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Security Notice */}
          <Card className="p-4 bg-slate-800/30 border-slate-700">
            <div className="flex gap-3">
              <Shield className="w-5 h-5 text-white flex-shrink-0 mt-0.5" />
              <div className="text-sm text-white">
                <p className="font-medium text-white mb-1">Security Notice</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>This wallet cannot be changed or deleted</li>
                  <li>You can use the private key you saved to access funds externally</li>
                  <li>Automated strategies can trade from this wallet</li>
                </ul>
              </div>
            </div>
          </Card>

          {/* Private Key Decoder (base64 -> hex) */}
          <Card className="p-4 bg-slate-800/30 border-slate-700">
            <div className="flex items-center gap-2 mb-3">
              <Key className="w-5 h-5 text-slate-400" />
              <span className="text-sm font-medium text-white">Import Key to MetaMask / Rabby</span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              If you saved your private key during wallet creation, paste it below to convert to the format wallets expect.
            </p>
            
            <div className="space-y-3">
              <Input
                type="text"
                placeholder="Paste your base64 private key here..."
                value={base64KeyInput}
                onChange={(e) => setBase64KeyInput(e.target.value)}
                className="bg-slate-900 border-slate-600 text-white font-mono text-xs"
              />
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleDecodeToHex}
                disabled={!base64KeyInput.trim()}
                className="w-full border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-50"
              >
                <Key className="w-4 h-4 mr-2" />
                Decode to Private Key (hex)
              </Button>

              {hexDecodeError && (
                <div className="text-xs text-red-400 bg-red-500/10 p-3 rounded border border-red-500/30">
                  {hexDecodeError}
                </div>
              )}

              {decodedHexKey && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-400">
                    Ethereum Private Key (64-hex)
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={decodedHexKey}
                      className="flex-1 bg-slate-900 text-green-400 text-xs font-mono p-3 rounded border border-slate-600 outline-none"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyHexKey}
                      className={`flex-shrink-0 ${hexKeyCopied ? 'text-green-400' : 'text-slate-400 hover:text-white'}`}
                    >
                      {hexKeyCopied ? <CheckCircle className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                    </Button>
                  </div>
                  {hexKeyCopied && (
                    <div className="text-xs text-green-400 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Hex key copied - paste into MetaMask/Rabby
                    </div>
                  )}
                  <div className="bg-red-500/10 border border-red-500/30 rounded p-2 text-xs text-red-300">
                    ⚠️ Never share this key. Anyone with it can fully control your funds.
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearDecodeState}
                    className="text-slate-500 hover:text-white text-xs"
                  >
                    Clear
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      ) : null}

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
        walletId={wallet?.id || ''}
        walletAddress={wallet?.wallet_address || ''}
        balances={walletBalances}
        onWithdrawComplete={() => {
          fetchWallet();
          checkPrerequisites();
        }}
      />

      {/* Clear Panic Confirmation Dialog */}
      <Dialog open={showClearPanicDialog} onOpenChange={setShowClearPanicDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="h-5 w-5" />
              Clear Panic State
            </DialogTitle>
            <DialogDescription>
              This will clear the panic state and allow trading to resume.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 my-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200">
                  <p className="font-medium mb-2">Warning:</p>
                  <ul className="list-disc pl-4 space-y-1 text-amber-200/80">
                    <li>This re-enables the trading system</li>
                    <li>Strategies will remain paused until manually activated</li>
                    <li>Review why panic was triggered before clearing</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setShowClearPanicDialog(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleClearPanic}
              disabled={isClearingPanic}
              className="bg-amber-500 hover:bg-amber-600 text-black"
            >
              {isClearingPanic ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Clearing...
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 mr-2" />
                  Clear Panic State
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
