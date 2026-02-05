/**
 * GUARDRAIL #2: Explicit error display for RPC failures
 * 
 * This component renders when the portfolio metrics RPC fails.
 * It NEVER shows fabricated zeros - it explicitly tells the user
 * that data could not be loaded.
 */

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface PortfolioMetricsErrorProps {
  mode: 'TEST' | 'REAL';
  error: string | null;
  onRetry: () => void;
  isRetrying?: boolean;
}

export function PortfolioMetricsError({ 
  mode, 
  error, 
  onRetry, 
  isRetrying = false 
}: PortfolioMetricsErrorProps) {
  return (
    <Alert variant="destructive" className="my-4">
      <AlertTriangle className="h-5 w-5" />
      <AlertTitle className="flex items-center gap-2">
        Unable to load portfolio metrics
        <Badge variant={mode === 'TEST' ? 'secondary' : 'default'}>
          {mode} Mode
        </Badge>
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-3">
        <p className="text-sm">
          The portfolio data could not be retrieved from the server. 
          Your actual balances are safe — this is a display issue only.
        </p>
        {error && (
          <p className="text-xs font-mono bg-destructive/10 p-2 rounded">
            Error: {error}
          </p>
        )}
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onRetry}
          disabled={isRetrying}
          className="mt-2"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRetrying ? 'animate-spin' : ''}`} />
          {isRetrying ? 'Retrying...' : 'Retry'}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
