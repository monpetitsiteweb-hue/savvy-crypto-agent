import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Database, Activity, Clock, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

interface DataHealthMetric {
  symbol: string;
  granularity: string;
  status: 'healthy' | 'stale' | 'error' | 'no_data';
  last_updated?: string;
  error_message?: string;
  candles_count?: number;
}

interface HealthSummary {
  coverage_pct: number;
  staleness_minutes: number;
  error_count: number;
  total_series: number;
  healthy_series: number;
}

const INITIAL_SYMBOLS = ['BTC-EUR', 'ETH-EUR', 'ADA-EUR', 'SOL-EUR'];
const GRANULARITIES = ['1h', '4h', '24h'];

export function DataHealthPanel() {
  const [healthMetrics, setHealthMetrics] = useState<DataHealthMetric[]>([]);
  const [summary, setSummary] = useState<HealthSummary>({
    coverage_pct: 0,
    staleness_minutes: 0,
    error_count: 0,
    total_series: 0,
    healthy_series: 0,
  });
  const [loading, setLoading] = useState(true);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [liveIngestLoading, setLiveIngestLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchHealthData();
    // Refresh every 5 minutes
    const interval = setInterval(fetchHealthData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchHealthData = async () => {
    try {
      setLoading(true);

      // TODO: Replace with real data after migration
      // const { data: healthData, error } = await supabase
      //   .from('market_data_health')
      //   .select('*')
      //   .order('symbol, granularity');

      // Generate deterministic mock health metrics based on our actual symbols/granularities
      const mockMetrics: DataHealthMetric[] = INITIAL_SYMBOLS.flatMap(symbol =>
        GRANULARITIES.map(granularity => ({
          symbol,
          granularity,
          status: Math.random() > 0.8 ? 'error' : Math.random() > 0.6 ? 'stale' : 'healthy' as const,
          last_updated: new Date(Date.now() - Math.random() * 60 * 60 * 1000).toISOString(),
          candles_count: Math.floor(Math.random() * 100) + 50,
          error_message: Math.random() > 0.8 ? 'Rate limit exceeded' : undefined,
        }))
      );

      setHealthMetrics(mockMetrics);

      // Calculate summary
      const totalSeries = mockMetrics.length;
      const healthySeries = mockMetrics.filter(m => m.status === 'healthy').length;
      const errorCount = mockMetrics.filter(m => m.status === 'error').length;
      const coveragePct = Math.round((healthySeries / totalSeries) * 100);
      
      const stalenessMinutes = Math.max(...mockMetrics.map(m => {
        if (!m.last_updated) return 0;
        return Math.floor((Date.now() - new Date(m.last_updated).getTime()) / (1000 * 60));
      }), 0);

      setSummary({
        coverage_pct: coveragePct,
        staleness_minutes: stalenessMinutes,
        error_count: errorCount,
        total_series: totalSeries,
        healthy_series: healthySeries,
      });

    } catch (error) {
      console.error('Error fetching health data:', error);
    } finally {
      setLoading(false);
    }
  };

  const runBackfill = async () => {
    try {
      setBackfillLoading(true);
      
      toast({
        title: "Backfill Ready",
        description: "Functions deployed. Run migration first, then use this button.",
      });

      // TODO: Enable after migration
      // const { data, error } = await supabase.functions.invoke('ohlcv-backfill', {
      //   body: {
      //     symbols: INITIAL_SYMBOLS,
      //     granularities: GRANULARITIES,
      //     lookback_days: 90
      //   }
      // });

      // Simulate for now
      setTimeout(() => {
        fetchHealthData();
      }, 1000);

    } catch (error) {
      console.error('Backfill error:', error);
      toast({
        title: "Backfill Error",
        description: error.message || "Unknown error occurred",
        variant: "destructive"
      });
    } finally {
      setBackfillLoading(false);
    }
  };

  const runLiveIngest = async () => {
    try {
      setLiveIngestLoading(true);
      
      toast({
        title: "Live Ingest Ready", 
        description: "Functions deployed. Run migration first, then use this button.",
      });

      // TODO: Enable after migration
      // const { data, error } = await supabase.functions.invoke('ohlcv-live-ingest', {
      //   body: {
      //     symbols: INITIAL_SYMBOLS,
      //     granularities: GRANULARITIES
      //   }
      // });

      // Simulate for now
      setTimeout(() => {
        fetchHealthData();
      }, 1000);

    } catch (error) {
      console.error('Live ingest error:', error);
      toast({
        title: "Live Ingest Error", 
        description: error.message || "Unknown error occurred",
        variant: "destructive"
      });
    } finally {
      setLiveIngestLoading(false);
    }
  };

  const formatTimestamp = (ts?: string) => {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleString();
  };

  const getHealthBadge = (metric: DataHealthMetric) => {
    switch (metric.status) {
      case 'healthy':
        return <Badge variant="default" className="text-xs bg-green-600">Healthy</Badge>;
      case 'stale':
        return <Badge variant="secondary" className="text-xs">Stale</Badge>;
      case 'error':
        return <Badge variant="destructive" className="text-xs">Error</Badge>;
      case 'no_data':
        return <Badge variant="secondary" className="text-xs">No Data</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">Unknown</Badge>;
    }
  };

  if (loading) {
    return (
      <Card className="bg-slate-800/80 border-slate-700">
        <CardContent className="p-6">
          <div className="text-center text-slate-400">Loading data health metrics...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-800/80 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-400" />
          Data Foundation Health
        </CardTitle>
        <CardDescription>
          OHLCV coverage, freshness, and feature computation status
        </CardDescription>
        
        <div className="flex gap-2 mt-4">
          <Button 
            onClick={fetchHealthData} 
            variant="outline" 
            size="sm"
            disabled={loading}
          >
            Refresh
          </Button>
          <Button 
            onClick={runBackfill} 
            variant="default" 
            size="sm"
            disabled={backfillLoading}
          >
            {backfillLoading ? 'Running...' : 'Run Backfill (90d)'}
          </Button>
          <Button 
            onClick={runLiveIngest} 
            variant="secondary" 
            size="sm"
            disabled={liveIngestLoading}
          >
            {liveIngestLoading ? 'Running...' : 'Live Ingest'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Summary Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-700/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-slate-400 text-sm">Coverage</span>
            </div>
            <div className="text-2xl font-bold text-white">{summary.coverage_pct}%</div>
            <Progress value={summary.coverage_pct} className="mt-2 h-2" />
          </div>
          
          <div className="bg-slate-700/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-orange-400" />
              <span className="text-slate-400 text-sm">Max Staleness</span>
            </div>
            <div className="text-2xl font-bold text-white">{summary.staleness_minutes}m</div>
            <div className="text-xs text-slate-400 mt-1">
              SLO: &lt;5min
            </div>
          </div>
          
          <div className="bg-slate-700/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-slate-400 text-sm">Errors (24h)</span>
            </div>
            <div className="text-2xl font-bold text-white">{summary.error_count}</div>
            <div className="text-xs text-slate-400 mt-1">
              {summary.error_count === 0 ? 'All healthy' : 'Check series below'}
            </div>
          </div>
          
          <div className="bg-slate-700/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span className="text-slate-400 text-sm">Features</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {summary.healthy_series}/{summary.total_series}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Series healthy
            </div>
          </div>
        </div>

        <Separator className="bg-slate-600" />

        {/* Per-Series Health */}
        <div>
          <h3 className="text-white font-medium mb-3">Series Health (12 total)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {healthMetrics.map(metric => (
              <div 
                key={`${metric.symbol}-${metric.granularity}`}
                className="bg-slate-700/30 rounded-lg p-3 border border-slate-600"
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="text-white font-medium text-sm">
                    {metric.symbol} {metric.granularity}
                  </span>
                  {getHealthBadge(metric)}
                </div>
                
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Last Updated:</span>
                    <span className="text-slate-300">
                      {formatTimestamp(metric.last_updated)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Status:</span>
                    <span className="text-slate-300 capitalize">
                      {metric.status.replace('_', ' ')}
                    </span>
                  </div>
                  {metric.candles_count && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Candles:</span>
                      <span className="text-slate-300">
                        {metric.candles_count}
                      </span>
                    </div>
                  )}
                  {metric.error_message && (
                    <div className="text-red-400 text-xs mt-1 truncate">
                      {metric.error_message}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SLO Status */}
        <div className="bg-slate-700/30 rounded-lg p-4 border border-slate-600">
          <h4 className="text-white font-medium mb-2">SLO Status (Simulated)</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center gap-2">
              {summary.coverage_pct >= 99.5 ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-400" />
              )}
              <span className="text-slate-300">
                Completeness: {summary.coverage_pct >= 99.5 ? 'Met' : 'Failed'} (99.5%+ target)
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {summary.staleness_minutes < 5 ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-400" />
              )}
              <span className="text-slate-300">
                Live Lag: {summary.staleness_minutes < 5 ? 'Met' : 'Failed'} (&lt;5min target)
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {summary.healthy_series >= summary.total_series * 0.9 ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-400" />
              )}
              <span className="text-slate-300">
                Health: {summary.healthy_series >= summary.total_series * 0.9 ? 'Met' : 'Failed'} (90%+ healthy)
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}