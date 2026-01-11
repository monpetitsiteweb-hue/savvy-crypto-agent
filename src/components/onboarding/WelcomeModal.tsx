import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PlayCircle, Link2 } from 'lucide-react';

interface WelcomeModalProps {
  open: boolean;
  onStartTestMode: () => void;
  onConnectCoinbase: () => void;
}

/**
 * Welcome modal shown on first login.
 * - Non-blocking: dismissing allows full app usage
 * - No side effects beyond updating user_onboarding_status
 * - Does NOT change execution_target or create wallets
 */
export function WelcomeModal({ open, onStartTestMode, onConnectCoinbase }: WelcomeModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onStartTestMode()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Welcome to ScalpSmart
          </DialogTitle>
          <DialogDescription className="text-muted-foreground pt-2">
            Your AI-powered crypto trading assistant
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Explanation */}
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-primary font-medium text-xs">1</span>
              </div>
              <div>
                <p className="font-medium">Start in Test Mode</p>
                <p className="text-muted-foreground">
                  Paper trading with simulated funds. No real money involved — perfect for learning.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-primary font-medium text-xs">2</span>
              </div>
              <div>
                <p className="font-medium">Coinbase is Optional</p>
                <p className="text-muted-foreground">
                  Connect later when you're ready. Test mode works without any exchange connection.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-primary font-medium text-xs">3</span>
              </div>
              <div>
                <p className="font-medium">Real Trading Requires Opt-in</p>
                <p className="text-muted-foreground">
                  You must explicitly enable live trading later. No surprises.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2">
          <Button 
            onClick={onStartTestMode} 
            className="w-full"
            size="lg"
          >
            <PlayCircle className="w-4 h-4 mr-2" />
            Start in Test Mode
          </Button>
          
          <Button 
            onClick={onConnectCoinbase} 
            variant="outline" 
            className="w-full"
            size="lg"
          >
            <Link2 className="w-4 h-4 mr-2" />
            Connect Coinbase (optional)
          </Button>
        </div>

        <p className="text-xs text-center text-muted-foreground pt-2">
          You can change these settings anytime from your profile.
        </p>
      </DialogContent>
    </Dialog>
  );
}
