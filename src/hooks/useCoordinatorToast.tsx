import { useToast } from '@/hooks/use-toast';

export interface CoordinatorResponse {
  ok: boolean;
  decision: {
    approved: boolean;
    action: 'BUY' | 'SELL' | 'HOLD';
    reason: string;
    request_id?: string;
  };
}

export const useCoordinatorToast = () => {
  const { toast } = useToast();

  const handleCoordinatorResponse = (response: CoordinatorResponse, intent: { side: string; symbol: string }) => {
    if (!response?.decision) {
      // Network or parsing error
      toast({
        title: "Error",
        description: "Failed to process trading decision. Please try again.",
        variant: "destructive",
      });
      return;
    }

    const { decision } = response;
    const requestId = decision.request_id ? ` (ID: ${decision.request_id})` : '';

    switch (decision.action) {
      case 'BUY':
      case 'SELL':
        if (decision.approved) {
          toast({
            title: "Trade Executed",
            description: `${decision.action} ${intent.symbol} order processed successfully.${requestId}`,
            variant: "default",
          });
        } else {
          // Approved=false with BUY/SELL action means execution failed
          toast({
            title: "Trade Failed",
            description: `${decision.action} ${intent.symbol} failed: ${decision.reason}${requestId}`,
            variant: "destructive",
          });
        }
        break;

      case 'HOLD':
        // Map specific hold reasons to user-friendly messages
        let message = '';
        const symbol = intent.symbol;

        switch (decision.reason) {
          case 'blocked_by_lock':
            message = `Trade held – concurrent activity detected for ${symbol}. This prevents race conditions and ensures data integrity.`;
            break;
          case 'min_hold_period_not_met':
            message = `Trade held – minimum hold period not met for ${symbol}.`;
            break;
          case 'blocked_by_cooldown':
            message = `Trade held – cooldown period active for ${symbol}.`;
            break;
          case 'confidence_below_threshold':
            message = `Trade held – confidence below threshold for ${symbol}.`;
            break;
          case 'blocked_by_precedence:HARD_RISK':
            message = `Trade held – risk management override for ${symbol}.`;
            break;
          case 'blocked_by_precedence:POOL_EXIT':
            message = `Trade held – pool exit in progress for ${symbol}.`;
            break;
          default:
            message = `Trade held – ${decision.reason} for ${symbol}.`;
        }

        toast({
          title: "Trade Held",
          description: message + requestId,
          variant: "default", // Yellow/warning style
        });
        break;

      default:
        toast({
          title: "Unknown Response",
          description: `Received unknown coordinator action: ${decision.action}${requestId}`,
          variant: "destructive",
        });
    }
  };

  return { handleCoordinatorResponse };
};