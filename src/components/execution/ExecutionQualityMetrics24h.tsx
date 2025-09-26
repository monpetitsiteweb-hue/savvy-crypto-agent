import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, TrendingUp } from 'lucide-react';
import { getQualityMetrics24h, type MetricsRow } from '@/lib/db/execution';

interface ExecutionQualityMetrics24hProps {
  userId: string;
  strategyId?: string;
}

export function ExecutionQualityMetrics24h({ userId, strategyId }: ExecutionQualityMetrics24hProps) {
  const [metrics, setMetrics] = useState<MetricsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadMetrics = async () => {
    try {
      setLoading(true);
      const data = await getQualityMetrics24h(userId, strategyId);
      setMetrics(data);
    } catch (error) {
      console.error('Failed to load execution metrics:', error);
      toast({
        title: "Error",
        description: "Failed to load execution quality metrics",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, [userId, strategyId]);

  const formatNumber = (value: number | null | undefined, decimals = 2) => {
    if (value === null || value === undefined) return '-';
    return Number(value).toFixed(decimals);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Execution Quality (24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Execution Quality (24h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {metrics.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">No execution data available for the last 24 hours</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Trade Count</TableHead>
                  <TableHead>Avg Slippage (bps)</TableHead>
                  <TableHead>Latency P95 (ms)</TableHead>
                  <TableHead>Partial Fill Rate (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.map((metric, index) => (
                  <TableRow key={`${metric.strategy_id}-${index}`}>
                    <TableCell className="font-medium">All Symbols</TableCell>
                    <TableCell>{metric.trade_count}</TableCell>
                    <TableCell>{formatNumber(metric.avg_abs_slippage_bps)}</TableCell>
                    <TableCell>{metric.latency_p95_ms}</TableCell>
                    <TableCell>{formatNumber(metric.partial_fill_rate_pct)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}