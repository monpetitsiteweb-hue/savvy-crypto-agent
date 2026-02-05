import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, Check, X, Loader2, Rocket, Shield, Wallet, FileCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';

/**
 * NEW RPC CONTRACT (check_live_trading_prerequisites):
 * 
 * wallet_exists = EXTERNAL WALLET registered (user_external_addresses)
 * has_portfolio_capital = REAL portfolio capital > 0 (SOLE authority)
 * 
 * checks: {
 *   wallet_exists: boolean,           // External wallet registered
 *   has_portfolio_capital: boolean,   // REAL cash > 0
 *   rules_accepted: boolean
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

interface PushToLiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategy: {
    id: string;
    strategy_name: string;
  } | null;
  onSuccess: (newStrategyId: string) => void;
}

type ModalStep = 'checking' | 'blocked' | 'confirm' | 'promoting' | 'success' | 'error';

export const PushToLiveModal: React.FC<PushToLiveModalProps> = ({
  open,
  onOpenChange,
  strategy,
  onSuccess,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<ModalStep>('checking');
  const [checks, setChecks] = useState<PrerequisiteChecks | null>(null);
  const [panicActive, setPanicActive] = useState(false);
  const [canTradeLive, setCanTradeLive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [newStrategyId, setNewStrategyId] = useState<string | null>(null);
  const [acknowledgedRealTrading, setAcknowledgedRealTrading] = useState(false);

  // Run pre-flight checks when modal opens
  useEffect(() => {
    if (open && strategy && user) {
      runPreflightChecks();
    }
  }, [open, strategy, user]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setStep('checking');
      setChecks(null);
      setPanicActive(false);
      setCanTradeLive(false);
      setErrorMessage('');
      setNewStrategyId(null);
      setAcknowledgedRealTrading(false);
    }
  }, [open]);

  const runPreflightChecks = async () => {
    if (!user) return;

    setStep('checking');
    setErrorMessage('');

    try {
      const { data, error } = await (supabase as any).rpc('check_live_trading_prerequisites', {
        p_user_id: user.id,
      });

      if (error) {
        logger.error('Pre-flight check error:', error);
        setErrorMessage(error.message);
        setStep('error');
        return;
      }

      const result = data as { ok: boolean; checks: PrerequisiteChecks; panic_active: boolean; meta: PrerequisiteMeta };
      setChecks(result.checks);
      setPanicActive(result.panic_active === true);
      setCanTradeLive(result.ok === true);

      if (result.ok === true) {
        setStep('confirm');
      } else {
        setStep('blocked');
      }
    } catch (err) {
      logger.error('Pre-flight check exception:', err);
      setErrorMessage('Failed to check prerequisites. Please try again.');
      setStep('error');
    }
  };

  const handlePromote = async () => {
    // HARD BLOCK: Cannot promote without prerequisites AND acknowledgment
    if (!user || !strategy || !canTradeLive || !acknowledgedRealTrading) {
      logger.warn('Promotion blocked: prerequisites not met or not acknowledged');
      return;
    }

    setStep('promoting');

    try {
      const { data, error } = await (supabase as any).rpc('promote_strategy_to_live', {
        p_strategy_id: strategy.id,
        p_user_id: user.id,
      });

      if (error) {
        logger.error('Promotion error:', error);
        setErrorMessage(error.message);
        setStep('error');
        return;
      }

      // RPC returns { success: boolean, new_strategy_id?: string, error?: string }
      const result = data as { success: boolean; new_strategy_id?: string; error?: string };

      if (result.success && result.new_strategy_id) {
        setNewStrategyId(result.new_strategy_id);
        setStep('success');
        toast({
          title: 'Strategy Promoted to LIVE',
          description: 'Your strategy has been created in LIVE mode (PAUSED). Activate it manually when ready.',
        });
      } else {
        setErrorMessage(result.error || 'Promotion failed unexpectedly.');
        setStep('error');
      }
    } catch (err) {
      logger.error('Promotion exception:', err);
      setErrorMessage('Failed to promote strategy. Please try again.');
      setStep('error');
    }
  };

  const handleClose = () => {
    if (step === 'success' && newStrategyId) {
      onSuccess(newStrategyId);
    }
    onOpenChange(false);
  };

  const renderCheckRow = (
    label: string,
    passed: boolean,
    icon: React.ReactNode,
    ctaLabel?: string,
    ctaAction?: () => void
  ) => (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {passed ? (
          <Badge variant="default" className="bg-green-600">
            <Check className="h-3 w-3 mr-1" />
            Ready
          </Badge>
        ) : (
          <>
            <Badge variant="destructive">
              <X className="h-3 w-3 mr-1" />
              Required
            </Badge>
            {ctaLabel && ctaAction && (
              <Button size="sm" variant="outline" onClick={ctaAction}>
                {ctaLabel}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );

  const navigateToProfile = (tab?: string) => {
    // Navigate to profile page with appropriate tab
    window.location.href = tab ? `/profile?tab=${tab}` : '/profile';
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        {/* STEP: Checking */}
        {step === 'checking' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Checking LIVE Readiness
              </DialogTitle>
              <DialogDescription>
                Verifying prerequisites for "{strategy?.strategy_name}"...
              </DialogDescription>
            </DialogHeader>
            <div className="py-8 flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          </>
        )}

        {/* STEP: Blocked */}
        {step === 'blocked' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-orange-500">
                <AlertTriangle className="h-5 w-5" />
                Cannot Push to LIVE
              </DialogTitle>
              <DialogDescription>
                {checks 
                  ? 'Complete the following requirements before promoting this strategy.'
                  : 'Live trading prerequisites are not met. Please complete the required setup steps.'}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-1">
              {checks ? (
                <>
                  {renderCheckRow(
                    'External Wallet Connected',
                    checks.wallet_exists,
                    <Wallet className="h-4 w-4 text-muted-foreground" />,
                    'Connect Wallet',
                    () => navigateToProfile('wallet')
                  )}
                  {renderCheckRow(
                    'Portfolio Capital',
                    checks.has_portfolio_capital,
                    <Wallet className="h-4 w-4 text-muted-foreground" />,
                    'Fund Portfolio',
                    () => navigateToProfile('wallet')
                  )}
                  {renderCheckRow(
                    'Trading Rules Accepted',
                    checks.rules_accepted,
                    <FileCheck className="h-4 w-4 text-muted-foreground" />,
                    'Accept Rules',
                    () => navigateToProfile('rules')
                  )}
                </>
              ) : (
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>To trade LIVE, you need to:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Connect an external wallet</li>
                    <li>Fund portfolio capital</li>
                    <li>Accept the trading rules</li>
                  </ul>
                </div>
              )}
              
              {/* Panic Status - Informational badge when active */}
              {panicActive && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 mt-3">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-red-400 text-sm font-medium">
                    Panic Mode Active — Trading is blocked. Clear panic state first.
                  </span>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={runPreflightChecks}>
                Retry Checks
              </Button>
            </DialogFooter>
          </>
        )}

        {/* STEP: Confirm */}
        {step === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-primary">
                <Rocket className="h-5 w-5" />
                Push to LIVE
              </DialogTitle>
              <DialogDescription className="text-base">
                You are about to create a LIVE trading strategy from "{strategy?.strategy_name}".
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm space-y-2">
                    <p className="font-semibold text-amber-800 dark:text-amber-200">
                      Important: Read before confirming
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-amber-700 dark:text-amber-300">
                      <li>The new strategy will be <strong>PAUSED</strong> by default</li>
                      <li>No trades will execute until you manually activate it</li>
                      <li><strong>Real money</strong> will be used once activated</li>
                    </ul>
                  </div>
                </div>
              </div>
              
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-green-800 dark:text-green-200">
                      All prerequisites passed
                    </p>
                    <p className="text-green-700 dark:text-green-300">
                      Wallet funded, rules accepted, no panic active.
                    </p>
                  </div>
                </div>
              </div>
              
              {/* MANDATORY ACKNOWLEDGMENT CHECKBOX */}
              <div className="border border-destructive/50 bg-destructive/5 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="acknowledge-real-trading"
                    checked={acknowledgedRealTrading}
                    onCheckedChange={(checked) => setAcknowledgedRealTrading(checked === true)}
                    className="mt-0.5"
                  />
                  <label 
                    htmlFor="acknowledge-real-trading" 
                    className="text-sm font-medium text-destructive cursor-pointer select-none"
                  >
                    I understand this strategy will trade REAL money once activated
                  </label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                onClick={handlePromote}
                disabled={!canTradeLive || !acknowledgedRealTrading}
                className="bg-primary hover:bg-primary/90"
              >
                <Rocket className="h-4 w-4 mr-2" />
                Confirm Push to LIVE
              </Button>
            </DialogFooter>
          </>
        )}

        {/* STEP: Promoting */}
        {step === 'promoting' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Creating LIVE Strategy
              </DialogTitle>
              <DialogDescription>
                Please wait while we set up your LIVE strategy...
              </DialogDescription>
            </DialogHeader>
            <div className="py-8 flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          </>
        )}

        {/* STEP: Success */}
        {step === 'success' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-600">
                <Check className="h-5 w-5" />
                Strategy Promoted Successfully
              </DialogTitle>
              <DialogDescription>
                Your LIVE strategy has been created and is ready to be activated.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm space-y-2">
                    <p className="font-semibold text-green-800 dark:text-green-200">
                      ✅ Strategy successfully promoted to LIVE
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-green-700 dark:text-green-300">
                      <li>Status: <strong>PAUSED</strong></li>
                      <li>Activate manually when you're ready</li>
                      <li>Switch to LIVE view to see your new strategy</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}

        {/* STEP: Error */}
        {step === 'error' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <X className="h-5 w-5" />
                Promotion Failed
              </DialogTitle>
              <DialogDescription>
                An error occurred while promoting your strategy.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
                <p className="text-sm text-destructive font-medium">
                  {errorMessage || 'Unknown error occurred.'}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={runPreflightChecks}>
                Retry
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
