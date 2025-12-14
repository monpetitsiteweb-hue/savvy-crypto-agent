import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, CheckCircle2, XCircle, Clock, Server, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface SignalSummary {
  symbol: string;
  signal_type: string;
  avg_strength: number;
  count: number;
  latest_timestamp: string;
}

interface LatestDecision {
  id: string;
  symbol: string;
  side: string;
  reason: string;
  confidence: number;
  decision_ts: string;
  source: string;
  metadata: {
    // Backend writes to metadata.signals (not signalScores)
    signals?: {
      trend?: number;
      momentum?: number;
      volatility?: number;
      sentiment?: number;
      whale?: number;
    };
    signalScores?: {
      trend?: number;
      momentum?: number;
      volatility?: number;
      sentiment?: number;
      whale?: number;
    };
    fusionScore?: number;
    enterThreshold?: number;
    isTrendPositive?: boolean;
    isMomentumPositive?: boolean;
    meetsThreshold?: boolean;
    action?: string;
    decision_action?: string;
    decision_reason?: string;
    origin?: string;
    engineMode?: string;
  } | null;
}

const SYMBOLS = ['BTC', 'ETH', 'XRP', 'SOL', 'ADA', 'AVAX', 'DOT'];

export function BackendDecisionPanel() {
  const { activeStrategy } = useActiveStrategy();

  // Fetch latest signals per symbol (last 4 hours)
  const { data: signalSummary, isLoading: signalsLoading } = useQuery({
    queryKey: ['backend-signals-summary'],
    queryFn: async () => {
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await supabase
        .from('live_signals')
        .select('symbol, signal_type, signal_strength, timestamp')
        .gte('timestamp', fourHoursAgo)
        .in('symbol', SYMBOLS)
        .order('timestamp', { ascending: false });

      if (error) throw error;

      // Aggregate by symbol
      const bySymbol: Record<string, { bullish: number; bearish: number; neutral: number; signals: string[] }> = {};
      
      (data || []).forEach((signal: any) => {
        if (!bySymbol[signal.symbol]) {
          bySymbol[signal.symbol] = { bullish: 0, bearish: 0, neutral: 0, signals: [] };
        }
        
        const strength = signal.signal_strength || 0;
        const type = signal.signal_type?.toLowerCase() || '';
        
        if (type.includes('bullish') || type.includes('oversold')) {
          bySymbol[signal.symbol].bullish += strength;
        } else if (type.includes('bearish') || type.includes('overbought')) {
          bySymbol[signal.symbol].bearish += strength;
        } else {
          bySymbol[signal.symbol].neutral += strength;
        }
        
        if (!bySymbol[signal.symbol].signals.includes(signal.signal_type)) {
          bySymbol[signal.symbol].signals.push(signal.signal_type);
        }
      });

      return bySymbol;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 15000,
  });

  // Fetch latest decisions from decision_events
  const { data: latestDecisions, isLoading: decisionsLoading } = useQuery({
    queryKey: ['backend-latest-decisions', activeStrategy?.id],
    queryFn: async () => {
      if (!activeStrategy?.id) return [];

      const { data, error } = await supabase
        .from('decision_events')
        .select('id, symbol, side, reason, confidence, decision_ts, source, metadata')
        .eq('strategy_id', activeStrategy.id)
        .order('decision_ts', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as LatestDecision[];
    },
    enabled: !!activeStrategy?.id,
    refetchInterval: 10000,
    staleTime: 5000,
  });

  // Get the most recent decision per symbol
  const latestBySymbol = latestDecisions?.reduce((acc, decision) => {
    const baseSymbol = decision.symbol.replace('-EUR', '').replace('-USD', '');
    if (!acc[baseSymbol]) {
      acc[baseSymbol] = decision;
    }
    return acc;
  }, {} as Record<string, LatestDecision>) || {};

  const getOverallSignal = (symbol: string) => {
    const signals = signalSummary?.[symbol];
    if (!signals) return { direction: 'unknown', score: 0 };
    
    const netScore = signals.bullish - signals.bearish;
    if (netScore > 50) return { direction: 'bullish', score: netScore };
    if (netScore < -50) return { direction: 'bearish', score: netScore };
    return { direction: 'neutral', score: netScore };
  };

  const getDecisionBadge = (decision: LatestDecision | undefined, signalInfo: { direction: string; score: number }) => {
    // Check if we have a recent decision with action info
    const action = decision?.metadata?.action || decision?.metadata?.decision_action || decision?.side;
    const reason = decision?.metadata?.decision_reason || decision?.reason || '';
    
    // Determine current state based on reason patterns
    if (reason?.includes('SKIP:') || reason?.includes('trend_negative') || reason?.includes('blocked')) {
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
          <AlertTriangle className="w-3 h-3 mr-1" />
          HOLD
        </Badge>
      );
    }
    
    if (action === 'BUY' || action === 'buy') {
      return (
        <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
          <TrendingUp className="w-3 h-3 mr-1" />
          BUY
        </Badge>
      );
    }
    
    if (action === 'SELL' || action === 'sell') {
      return (
        <Badge variant="destructive" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
          <TrendingDown className="w-3 h-3 mr-1" />
          SELL
        </Badge>
      );
    }

    // Default based on signal direction
    if (signalInfo.direction === 'bearish') {
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
          <AlertTriangle className="w-3 h-3 mr-1" />
          HOLD
        </Badge>
      );
    }
    
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Clock className="w-3 h-3 mr-1" />
        WAITING
      </Badge>
    );
  };

  const formatReason = (decision: LatestDecision | undefined) => {
    const reason = decision?.metadata?.decision_reason || decision?.reason || '';
    
    if (reason.includes('SKIP:trend_negative')) {
      const match = reason.match(/trend_negative_([-\d.]+)/);
      const trendScore = match ? parseFloat(match[1]) : null;
      return `Trend negative${trendScore !== null ? ` (${trendScore.toFixed(2)})` : ''}, no momentum boost`;
    }
    
    if (reason.includes('blocked_by_signal_alignment')) {
      return 'Signals not aligned for entry';
    }
    
    if (reason.includes('blocked_by_high_volatility')) {
      return 'High volatility - too risky';
    }
    
    if (reason.includes('blocked_by_stop_loss_cooldown')) {
      return 'Cooling down after stop loss';
    }
    
    return reason
      .replace(/SKIP:/g, '')
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .trim() || 'Evaluating...';
  };

  const isLoading = signalsLoading || decisionsLoading;

  if (!activeStrategy) {
    return (
      <Card className="border-2 border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-5 w-5 text-primary" />
            Backend Engine Status
            <Badge variant="outline" className="ml-auto text-xs">AUTHORITATIVE</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">No active strategy. Enable a strategy to see backend decisions.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="h-5 w-5 text-primary" />
          Backend Engine Status
          <Badge variant="outline" className="ml-auto text-xs bg-primary/10 text-primary">AUTHORITATIVE</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          This panel shows the actual backend decision state. Trading only executes when this says BUY/SELL.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
            Loading backend state...
          </div>
        ) : (
          <ScrollArea className="h-[280px]">
            <div className="space-y-2">
              {SYMBOLS.map(symbol => {
                const signalInfo = getOverallSignal(symbol);
                const decision = latestBySymbol[symbol];
                // Backend writes to metadata.signals (not signalScores)
                const scores = decision?.metadata?.signals || decision?.metadata?.signalScores;
                const meta = decision?.metadata;
                
                return (
                  <div 
                    key={symbol} 
                    className="flex items-center justify-between p-2.5 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm w-12">{symbol}</span>
                      {getDecisionBadge(decision, signalInfo)}
                    </div>
                    
                    <div className="flex flex-col items-end gap-1">
                      <div className="text-xs text-muted-foreground max-w-[200px] text-right truncate">
                        {formatReason(decision)}
                      </div>
                      
                      {scores && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-help">
                              <Activity className="w-3 h-3" />
                              <span className={scores.trend && scores.trend > 0 ? 'text-green-600' : 'text-red-600'}>
                                T:{(scores.trend ?? 0).toFixed(2)}
                              </span>
                              <span className={scores.momentum && scores.momentum > 0 ? 'text-green-600' : 'text-red-600'}>
                                M:{(scores.momentum ?? 0).toFixed(2)}
                              </span>
                              <span>V:{(scores.volatility ?? 0).toFixed(2)}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs space-y-1">
                              <div className={scores.trend && scores.trend > 0 ? 'text-green-400' : 'text-red-400'}>
                                Trend: {(scores.trend ?? 0).toFixed(3)} {meta?.isTrendPositive ? '✓' : '✗'}
                              </div>
                              <div className={scores.momentum && scores.momentum > 0 ? 'text-green-400' : 'text-red-400'}>
                                Momentum: {(scores.momentum ?? 0).toFixed(3)} {meta?.isMomentumPositive ? '✓' : '✗'}
                              </div>
                              <div>Volatility: {(scores.volatility ?? 0).toFixed(3)}</div>
                              <div>Sentiment: {(scores.sentiment ?? 0).toFixed(3)}</div>
                              <div>Whale: {(scores.whale ?? 0).toFixed(3)}</div>
                              <div className="border-t pt-1 mt-1">
                                <div>Confidence: {(decision?.confidence ?? 0).toFixed(3)}</div>
                                <div>Threshold: {meta?.enterThreshold ?? 0.15}</div>
                                <div className={meta?.meetsThreshold ? 'text-green-400 font-bold' : 'text-red-400'}>
                                  Meets threshold: {meta?.meetsThreshold ? 'YES' : 'NO'}
                                </div>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      
                      {signalSummary?.[symbol] && (
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-green-600">
                            ↑{signalSummary[symbol].bullish.toFixed(0)}
                          </span>
                          <span className="text-red-600">
                            ↓{signalSummary[symbol].bearish.toFixed(0)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <div className="pt-2 border-t">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="w-3 h-3 text-green-600" />
            <span>BUY signals only execute when trend is positive and fusion score ≥ 0.15</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}