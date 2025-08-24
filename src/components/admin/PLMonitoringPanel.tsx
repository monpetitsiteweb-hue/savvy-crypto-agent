import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle, XCircle, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface MonitoringStatus {
  coordinator_health: 'green' | 'yellow' | 'red';
  lock_contention_pct: number;
  recent_errors: number;
  corrupted_trades: number;
  last_check: string;
}

export const PLMonitoringPanel = () => {
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const checkSystemHealth = async () => {
    try {
      // Check coordinator health via recent decisions
      const { data: recentDecisions } = await supabase
        .from('trade_decisions_log')
        .select('*')
        .gte('created_at', new Date(Date.now() - 5 * 60000).toISOString())
        .order('created_at', { ascending: false });

      // Count blocked by lock in last 15 minutes
      const { data: lockBlocks } = await supabase
        .from('trade_decisions_log')
        .select('*')
        .eq('decision_reason', 'blocked_by_lock')
        .gte('created_at', new Date(Date.now() - 15 * 60000).toISOString());

      const { data: totalDecisions } = await supabase
        .from('trade_decisions_log')
        .select('*')
        .gte('created_at', new Date(Date.now() - 15 * 60000).toISOString());

      // Count corrupted trades
      const { data: corruptedCount } = await supabase
        .from('mock_trades')
        .select('id')
        .eq('is_corrupted', true);

      const lockContentionPct = totalDecisions?.length 
        ? (lockBlocks?.length || 0) / totalDecisions.length * 100
        : 0;

      const recentErrors = recentDecisions?.filter(d => 
        d.decision_reason?.includes('error') || d.decision_reason?.includes('failed')
      ).length || 0;

      let coordinatorHealth: 'green' | 'yellow' | 'red' = 'green';
      if (recentErrors > 0) coordinatorHealth = 'red';
      else if (lockContentionPct > 90) coordinatorHealth = 'yellow';

      setStatus({
        coordinator_health: coordinatorHealth,
        lock_contention_pct: lockContentionPct,
        recent_errors: recentErrors,
        corrupted_trades: corruptedCount?.length || 0,
        last_check: new Date().toISOString()
      });

      // Alert conditions
      if (lockContentionPct > 1) {
        toast({
          title: "Lock Contention Alert",
          description: `Lock contention at ${lockContentionPct.toFixed(1)}%`,
          variant: "destructive"
        });
      }

      if (recentErrors > 0) {
        toast({
          title: "Coordinator Errors Detected",
          description: `${recentErrors} errors in last 5 minutes`,
          variant: "destructive"
        });
      }

    } catch (error) {
      console.error('Health check failed:', error);
      toast({
        title: "Monitoring Error",
        description: "Failed to check system health",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const exportAuditData = async () => {
    try {
      const { data: auditData } = await supabase
        .from('mock_trades_fix_audit')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      const csv = [
        'trade_id,user_id,strategy_id,symbol,old_price,new_price,old_amount,new_amount,reason,source,created_at',
        ...(auditData?.map(row => 
          `${row.trade_id},${row.user_id || ''},${row.strategy_id || ''},${row.symbol || ''},${row.old_price || ''},${row.new_price || ''},${row.old_amount || ''},${row.new_amount || ''},${row.reason},${row.source},${row.created_at}`
        ) || [])
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pnl_fix_audit_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: "Audit Export Complete",
        description: "CSV downloaded successfully"
      });
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        title: "Export Failed",
        description: "Could not export audit data",
        variant: "destructive"
      });
    }
  };

  useEffect(() => {
    checkSystemHealth();
    const interval = setInterval(checkSystemHealth, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (health: string) => {
    switch (health) {
      case 'green': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'yellow': return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'red': return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getStatusVariant = (health: string) => {
    switch (health) {
      case 'green': return 'default';
      case 'yellow': return 'secondary';
      case 'red': return 'destructive';
      default: return 'outline';
    }
  };

  if (loading) {
    return <Card><CardContent className="p-6">Loading system status...</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          P&L System Monitoring
          <Button variant="outline" size="sm" onClick={exportAuditData}>
            <Download className="h-4 w-4 mr-2" />
            Export Audit
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Coordinator Status</span>
                  <Badge variant={getStatusVariant(status.coordinator_health)} className="flex items-center gap-1">
                    {getStatusIcon(status.coordinator_health)}
                    {status.coordinator_health.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Lock Contention</span>
                  <span className="text-sm font-mono">{status.lock_contention_pct.toFixed(1)}%</span>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Recent Errors (5min)</span>
                  <span className="text-sm font-mono">{status.recent_errors}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Corrupted Trades</span>
                  <span className="text-sm font-mono">{status.corrupted_trades}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Last Check</span>
                <span>{new Date(status.last_check).toLocaleTimeString()}</span>
              </div>
            </div>

            <Button variant="outline" size="sm" onClick={checkSystemHealth} className="w-full">
              Refresh Status
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};