import { useToast } from '@/hooks/use-toast';

// STEP 1: Standardized response type guard
function isDecisionPayload(x: any): x is {
  ok: true;
  decision: { action: "BUY"|"SELL"|"HOLD"|"DEFER"; reason: string; request_id: string; retry_in_ms: number; }
} {
  return !!(x && x.ok === true && x.decision && typeof x.decision.action === "string" && typeof x.decision.retry_in_ms === "number");
}

export interface CoordinatorResponse {
  ok: boolean;
  decision: {
    action: 'BUY' | 'SELL' | 'HOLD' | 'DEFER';
    reason: string;
    request_id: string;
    retry_in_ms: number;
  };
}

export const useCoordinatorToast = () => {
  const { toast } = useToast();

  const handleCoordinatorResponse = (response: CoordinatorResponse, intent: { side: string; symbol: string }) => {
    // STEP 1: Use type guard for safety
    if (!isDecisionPayload(response)) {
      toast({
        title: "Error",
        description: "Invalid coordinator response format",
        variant: "destructive",
      });
      return;
    }

    const { decision } = response;
    const requestId = decision.request_id ? ` (ID: ${decision.request_id})` : '';

    switch (decision.action) {
      case 'BUY':
      case 'SELL':
        toast({
          title: "Trade Executed",
          description: `${decision.action} ${intent.symbol} order processed successfully.${requestId}`,
          variant: "default",
        });
        break;

      case 'HOLD':
        // Map specific hold reasons to user-friendly messages
        let message = '';
        const symbol = intent.symbol;

        switch (decision.reason) {
          case 'min_hold_period_not_met':
            message = `Trade held – minimum hold period not met for ${symbol}.`;
            break;
          case 'blocked_by_cooldown':
            message = `Trade held – cooldown period active for ${symbol}.`;
            break;
          case 'blocked_by_precedence:POOL_EXIT':
            message = `Trade held – pool exit in progress for ${symbol}.`;
            break;
          case 'direct_execution_failed':
            message = `Trade held – execution failed for ${symbol}.`;
            break;
          case 'internal_error':
            message = `Trade held – system error for ${symbol}.`;
            break;
          default:
            message = `Trade held – ${decision.reason.replace(/_/g, ' ')} for ${symbol}.`;
        }

        toast({
          title: "Trade Held",
          description: message + requestId,
          variant: "default", // Yellow/warning style
        });
        break;

      case 'DEFER':
        const retrySeconds = Math.round(decision.retry_in_ms / 1000);
        toast({
          title: "Trade Deferred",
          description: `${intent.symbol} trade deferred – retry in ${retrySeconds}s. Reason: ${decision.reason.replace(/_/g, ' ')}.${requestId}`,
          variant: "default",
        });
        break;

      default:
        // This should never happen with proper coordinator
        toast({
          title: "System Error",
          description: `Coordinator returned unexpected action. Please contact support.${requestId}`,
          variant: "destructive",
        });
    }
  };

  return { handleCoordinatorResponse };
};