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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileCheck, Shield, AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface TradingRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted: () => void;
}

const TRADING_RULES = [
  {
    title: "Market Risk",
    content: "Cryptocurrency markets are highly volatile. The value of your holdings can decrease significantly in a short period. You may lose some or all of your investment."
  },
  {
    title: "Automated Trading",
    content: "Strategies execute automatically without manual confirmation. Once enabled, trades will occur based on algorithmic signals and configured parameters."
  },
  {
    title: "No Guarantees",
    content: "Past performance does not guarantee future results. Backtested or simulated returns may not reflect actual trading outcomes."
  },
  {
    title: "Execution Risks",
    content: "Orders may experience slippage, partial fills, or execution delays due to market conditions, network congestion, or technical issues."
  },
  {
    title: "Gas Fees",
    content: "On-chain transactions require gas fees paid in ETH. These fees are non-refundable and vary based on network conditions."
  },
  {
    title: "Your Responsibility",
    content: "You are solely responsible for monitoring your positions, understanding the strategies you enable, and ensuring adequate funding for trades and gas."
  },
  {
    title: "Platform Limitations",
    content: "The platform may experience downtime, bugs, or limitations that affect trading. We are not liable for losses due to technical issues."
  },
  {
    title: "Regulatory Compliance",
    content: "You are responsible for understanding and complying with all applicable laws and regulations in your jurisdiction regarding cryptocurrency trading."
  }
];

export function TradingRulesDialog({ open, onOpenChange, onAccepted }: TradingRulesDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [acknowledgedRules, setAcknowledgedRules] = useState(false);
  const [acknowledgedRisk, setAcknowledgedRisk] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAcceptRules = async () => {
    if (!user?.id || !acknowledgedRules || !acknowledgedRisk) return;

    setIsSubmitting(true);

    try {
      // Update user_onboarding_status to mark rules as accepted
      const { error } = await (supabase
        .from('user_onboarding_status' as any)
        .upsert({
          user_id: user.id,
          rules_accepted: true,
          rules_accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        }) as any);

      if (error) {
        throw new Error(error.message || 'Failed to save acceptance');
      }

      toast({
        title: "Rules Accepted",
        description: "You have accepted the trading rules. Live trading is now enabled.",
      });

      onAccepted();
      onOpenChange(false);
    } catch (err) {
      console.error('[TradingRulesDialog] Error:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : 'Failed to accept rules',
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setAcknowledgedRules(false);
      setAcknowledgedRisk(false);
      onOpenChange(false);
    }
  };

  const canAccept = acknowledgedRules && acknowledgedRisk;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl bg-background border-border max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <FileCheck className="w-5 h-5 text-primary" />
            Trading Rules & Risk Disclosure
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Please read and accept the following terms before enabling live trading.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {TRADING_RULES.map((rule, index) => (
              <div key={index} className="bg-muted/30 rounded-lg p-4 border border-border">
                <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  {rule.title}
                </h4>
                <p className="text-sm text-muted-foreground">{rule.content}</p>
              </div>
            ))}

            {/* Critical Warning */}
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 mt-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-6 h-6 text-destructive flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-destructive mb-2">Risk Warning</h4>
                  <p className="text-sm text-destructive/90">
                    Trading cryptocurrencies involves substantial risk of loss. Only trade with funds you can afford to lose. 
                    This platform does not provide financial advice. You should consult with a financial advisor before making any investment decisions.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* Acknowledgment Checkboxes */}
        <div className="space-y-3 pt-4 border-t border-border">
          <div className={`border rounded-lg p-4 ${acknowledgedRules ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
            <div className="flex items-start gap-3">
              <Checkbox
                id="acknowledge-rules"
                checked={acknowledgedRules}
                onCheckedChange={(checked) => setAcknowledgedRules(checked === true)}
                className="mt-0.5"
              />
              <label 
                htmlFor="acknowledge-rules" 
                className="text-sm font-medium text-foreground cursor-pointer select-none"
              >
                I have read and understand all the trading rules and platform limitations described above.
              </label>
            </div>
          </div>

          <div className={`border rounded-lg p-4 ${acknowledgedRisk ? 'border-green-500/50 bg-green-500/5' : 'border-destructive/50 bg-destructive/5'}`}>
            <div className="flex items-start gap-3">
              <Checkbox
                id="acknowledge-risk"
                checked={acknowledgedRisk}
                onCheckedChange={(checked) => setAcknowledgedRisk(checked === true)}
                className="mt-0.5"
              />
              <label 
                htmlFor="acknowledge-risk" 
                className="text-sm font-medium text-foreground cursor-pointer select-none"
              >
                I understand that I may lose money and accept full responsibility for my trading decisions.
              </label>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={isSubmitting}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAcceptRules}
            disabled={!canAccept || isSubmitting}
            className="bg-green-500 hover:bg-green-600 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Accepting...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Accept & Enable Live Trading
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
