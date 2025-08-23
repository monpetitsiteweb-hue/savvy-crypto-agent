import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, TrendingUp, TrendingDown, Pause } from 'lucide-react';

interface TradeDecision {
  created_at: string;
  symbol: string;
  intent_source: string;
  intent_side: string;
  decision_action: string;
  decision_reason: string;
  confidence: number;
}

interface DecisionsViewProps {
  strategyId: string;
}

export function DecisionsView({ strategyId }: DecisionsViewProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('all');
  
  const { data: decisions, isLoading } = useQuery({
    queryKey: ['trade-decisions', strategyId, selectedSymbol],
    queryFn: async () => {
      let query = supabase
        .from('trade_decisions_log')
        .select('*')
        .eq('strategy_id', strategyId)
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (selectedSymbol !== 'all') {
        query = query.eq('symbol', selectedSymbol);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as TradeDecision[];
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const symbols = React.useMemo(() => {
    if (!decisions) return [];
    const uniqueSymbols = [...new Set(decisions.map(d => d.symbol))];
    return uniqueSymbols.sort();
  }, [decisions]);

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'BUY':
        return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'SELL':
        return <TrendingDown className="w-4 h-4 text-red-600" />;
      case 'HOLD':
        return <Pause className="w-4 h-4 text-yellow-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-600" />;
    }
  };

  const getActionBadgeVariant = (action: string) => {
    switch (action) {
      case 'BUY':
        return 'default';
      case 'SELL':
        return 'destructive';
      case 'HOLD':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'manual':
        return 'text-purple-600';
      case 'pool':
        return 'text-blue-600';
      case 'automated':
        return 'text-orange-600';
      case 'intelligent':
        return 'text-green-600';
      default:
        return 'text-gray-600';
    }
  };

  const formatReason = (reason: string) => {
    // Format standardized reason codes for better display
    return reason
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .replace(/^\w/, c => c.toUpperCase())
      .replace('blocked by precedence', 'Blocked by precedence:')
      .replace('pool exit', 'Pool Exit')
      .replace('hard risk', 'Hard Risk');
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Trading Decisions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="text-sm text-muted-foreground">Loading decisions...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Trading Decisions ({decisions?.length || 0})
          </CardTitle>
          
          <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="All symbols" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Symbols</SelectItem>
              {symbols.map(symbol => (
                <SelectItem key={symbol} value={symbol}>
                  {symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      
      <CardContent>
        <ScrollArea className="h-96">
          {!decisions || decisions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No trading decisions found
            </div>
          ) : (
            <div className="space-y-2">
              {decisions.map((decision, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {getActionIcon(decision.decision_action)}
                    
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{decision.symbol}</span>
                        <Badge variant={getActionBadgeVariant(decision.decision_action)}>
                          {decision.decision_action}
                        </Badge>
                        <span className={`text-sm ${getSourceColor(decision.intent_source)}`}>
                          {decision.intent_source}
                        </span>
                      </div>
                      
                      <div className="text-xs text-muted-foreground">
                        {formatReason(decision.decision_reason)}
                        {decision.confidence && (
                          <span className="ml-2">• {Math.round(decision.confidence * 100)}% confidence</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-xs text-muted-foreground">
                    {new Date(decision.created_at).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}