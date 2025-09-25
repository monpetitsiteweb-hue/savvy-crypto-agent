import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, TrendingUp, Clock, AlertTriangle, CheckCircle } from 'lucide-react';

interface ExecutionMetrics {
  avg_abs_slippage_bps: number;
  latency_p95_ms: number;
  partial_fill_rate_pct: number;
  trade_count: number;
}

interface ExecutionLog {
  id: string;
  symbol: string;
  side: string;
  executed_at: string;
  slippage_bps: number;
  execution_latency_ms: number;
  partial_fill: boolean;
}

interface CircuitBreaker {
  id: string;
  symbol: string;
  breaker_type: string;
  threshold_value: number;
  is_active: boolean;
  last_trip_at: string;
  trip_count: number;
  trip_reason: string;
}

export function DevExecutionPage() {
  const { user } = useAuth();
  const { activeStrategy } = useActiveStrategy();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<ExecutionMetrics | null>(null);
  const [recentLogs, setRecentLogs] = useState<ExecutionLog[]>([]);
  const [breakers, setBreakers] = useState<CircuitBreaker[]>([]);
  const [activeBreakersCount, setActiveBreakersCount] = useState(0);

  const loadData = async () => {
    if (!user || !activeStrategy) return;
    
    try {
      setLoading(true);

      // TODO: Load data after migration is approved and types are updated
      // This will be functional once the Phase 3.1 database migration is complete
      setMetrics({
        avg_abs_slippage_bps: 0,
        latency_p95_ms: 0,
        partial_fill_rate_pct: 0,
        trade_count: 0
      });
      
      setRecentLogs([]);
      setBreakers([]);
      setActiveBreakersCount(0);

    } catch (error) {
      console.error('Error loading execution data:', error);
      toast({
        title: "Error",
        description: "Failed to load execution quality data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const resetBreaker = async (symbol: string, breakerType: string) => {
    if (!user || !activeStrategy) return;

    try {
      const { error } = await supabase.rpc('reset_breaker', {
        p_user: user.id,
        p_strategy: activeStrategy.id,
        p_symbol: symbol,
        p_type: breakerType
      });

      if (error) throw error;

      toast({
        title: "Breaker Reset",
        description: `Reset ${breakerType} breaker for ${symbol}`,
      });

      // Reload data
      loadData();
    } catch (error) {
      console.error('Error resetting breaker:', error);
      toast({
        title: "Error",
        description: "Failed to reset circuit breaker",
        variant: "destructive"
      });
    }
  };

  useEffect(() => {
    loadData();
  }, [user, activeStrategy]);

  if (!user || !activeStrategy) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold mb-4">Execution Quality Monitor</h1>
          <p className="text-muted-foreground">Please select an active strategy to view execution metrics</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading execution quality data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Execution Quality Monitor</h1>
          <p className="text-muted-foreground">Strategy: {activeStrategy.name}</p>
        </div>
        <Button onClick={loadData} variant="outline">
          Refresh Data
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Slippage (24h)</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics?.avg_abs_slippage_bps ? `${metrics.avg_abs_slippage_bps.toFixed(1)}bps` : 'No data'}
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics?.trade_count || 0} trades analyzed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Latency P95 (24h)</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics?.latency_p95_ms ? `${metrics.latency_p95_ms}ms` : 'No data'}
            </div>
            <p className="text-xs text-muted-foreground">
              95th percentile
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Partial Fill Rate (24h)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics?.partial_fill_rate_pct ? `${metrics.partial_fill_rate_pct.toFixed(1)}%` : '0%'}
            </div>
            <p className="text-xs text-muted-foreground">
              Incomplete executions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Breakers</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {activeBreakersCount}
            </div>
            <p className="text-xs text-muted-foreground">
              Circuit breakers active
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Execution Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Executions (Last 20)</CardTitle>
        </CardHeader>
        <CardContent>
          {recentLogs.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No execution logs found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Executed At</TableHead>
                  <TableHead>Slippage (bps)</TableHead>
                  <TableHead>Latency (ms)</TableHead>
                  <TableHead>Partial Fill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-medium">{log.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={log.side === 'buy' ? 'default' : 'secondary'}>
                        {log.side.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(log.executed_at).toLocaleString()}
                    </TableCell>
                    <TableCell className={log.slippage_bps > 0 ? 'text-destructive' : 'text-green-600'}>
                      {log.slippage_bps > 0 ? '+' : ''}{log.slippage_bps.toFixed(2)}
                    </TableCell>
                    <TableCell>{log.execution_latency_ms}ms</TableCell>
                    <TableCell>
                      {log.partial_fill ? (
                        <Badge variant="destructive">Yes</Badge>
                      ) : (
                        <Badge variant="outline">No</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Circuit Breakers */}
      <Card>
        <CardHeader>
          <CardTitle>Circuit Breakers</CardTitle>
        </CardHeader>
        <CardContent>
          {breakers.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No circuit breakers configured</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Trip</TableHead>
                  <TableHead>Trip Count</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakers.map((breaker) => (
                  <TableRow key={breaker.id}>
                    <TableCell className="font-medium">{breaker.symbol}</TableCell>
                    <TableCell>{breaker.breaker_type.replace('_', ' ')}</TableCell>
                    <TableCell>
                      {breaker.breaker_type.includes('rate') 
                        ? `${(breaker.threshold_value * 100).toFixed(0)}%`
                        : `${breaker.threshold_value}`
                      }
                    </TableCell>
                    <TableCell>
                      <Badge variant={breaker.is_active ? 'destructive' : 'outline'}>
                        {breaker.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {breaker.last_trip_at 
                        ? new Date(breaker.last_trip_at).toLocaleString()
                        : 'Never'
                      }
                    </TableCell>
                    <TableCell>{breaker.trip_count || 0}</TableCell>
                    <TableCell>
                      {breaker.is_active && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resetBreaker(breaker.symbol, breaker.breaker_type)}
                        >
                          Reset
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}