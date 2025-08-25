import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// Step 5: Boundary reset tracer (prod-safe, default OFF)
const RUNTIME_DEBUG =
  (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('debug') === 'history' || u.hash.includes('debug=history') || sessionStorage.getItem('DEBUG_HISTORY_BLINK') === 'true';
    } catch { return false; }
  })();

const DEBUG_HISTORY_BLINK =
  (import.meta.env.DEV && (import.meta.env.VITE_DEBUG_HISTORY_BLINK === 'true')) || RUNTIME_DEBUG;

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    // Step 5: Boundary reset tracer
    if (DEBUG_HISTORY_BLINK) {
      console.info('[HistoryBlink] ErrorBoundary caught -> resetting subtree');
    }
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('🚨 ErrorBoundary caught an error:', error, errorInfo);
    if (DEBUG_HISTORY_BLINK) {
      console.info('[HistoryBlink] ErrorBoundary componentDidCatch -> subtree reset');
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    // Step 5: Log ErrorBoundary mount
    if (DEBUG_HISTORY_BLINK) {
      console.info('[HistoryBlink] ErrorBoundary mounted');
    }
    
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Card className="p-6 bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            <div>
              <h3 className="text-lg font-semibold text-red-800 dark:text-red-200">
                Something went wrong
              </h3>
              <p className="text-sm text-red-600 dark:text-red-400">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
            </div>
          </div>
          
          <div className="space-y-3">
            <p className="text-sm text-red-700 dark:text-red-300">
              This might be due to:
            </p>
            <ul className="list-disc list-inside text-sm text-red-600 dark:text-red-400 space-y-1">
              <li>Expired authentication tokens</li>
              <li>Network connectivity issues</li>
              <li>API service interruption</li>
            </ul>
            
            <div className="flex gap-3 pt-2">
              <Button 
                onClick={this.handleRetry}
                variant="outline"
                size="sm"
                className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-600 dark:text-red-300 dark:hover:bg-red-900/30"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
              <Button 
                onClick={() => window.location.reload()}
                size="sm"
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Reload Page
              </Button>
            </div>
          </div>
        </Card>
      );
    }

    return this.props.children;
  }
}