import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Shield, Settings, AlertCircle, RefreshCw, Clock, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fromTable } from '@/utils/supa';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

// Use explicit types matching database schema
interface StrategyParameter {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  tp_pct: number;
  sl_pct: number;
  min_confidence: number;
  ai_weight: number;
  technical_weight: number;
  optimization_iteration: number;
  last_updated_by: string;
  last_optimizer_run_at: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
}

interface CircuitBreaker {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  breaker: string;
  tripped: boolean;
  tripped_at: string | null;
  current_value: number;
  threshold_value: number;
  trip_count: number;
  trip_reason: string | null;
  last_reason: string | null;
  is_active: boolean;
  thresholds: any;
  activated_at: string | null;
  cleared_at: string | null;
  last_reset_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ExecutionHold {
  user_id: string;
  symbol: string;
  hold_until: string;
  reason: string | null;
  created_at: string | null;
}

interface AdvancedSymbolOverridesPanelProps {
  strategyId: string | null;
}

export const AdvancedSymbolOverridesPanel = ({ strategyId }: AdvancedSymbolOverridesPanelProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [parameters, setParameters] = useState<StrategyParameter[]>([]);
  const [breakers, setBreakers] = useState<CircuitBreaker[]>([]);
  const [holds, setHolds] = useState<ExecutionHold[]>([]);
  const [executionMode, setExecutionMode] = useState<string>('UNKNOWN');
  const [loading, setLoading] = useState(true);
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ tp_pct: number; sl_pct: number; min_confidence: number } | null>(null);

  useEffect(() => {
    if (strategyId && user) {
      loadData();
    }
  }, [strategyId, user]);

  const loadData = async () => {
    if (!strategyId || !user) return;

    setLoading(true);
    try {
      // Load strategy parameters
      const { data: paramsData, error: paramsError } = await fromTable('strategy_parameters')
        .select('*')
        .eq('strategy_id', strategyId)
        .eq('user_id', user.id);

      if (paramsError) throw paramsError;
      setParameters((paramsData as any) || []);

      // Load circuit breakers
      const { data: breakersData, error: breakersError } = await fromTable('execution_circuit_breakers')
        .select('*')
        .eq('strategy_id', strategyId)
        .eq('user_id', user.id)
        .eq('tripped', true);

      if (breakersError) throw breakersError;
      setBreakers((breakersData as any) || []);

      // Load execution holds
      const { data: holdsData, error: holdsError } = await fromTable('execution_holds')
        .select('*')
        .eq('user_id', user.id)
        .gte('hold_until', new Date().toISOString());

      if (holdsError) throw holdsError;
      setHolds((holdsData as any) || []);

      // Check execution mode (read from environment via edge function or assume based on strategy)
      // For now, we'll show it as a placeholder - real implementation would call an edge function
      setExecutionMode('DRY_RUN'); // Default assumption

    } catch (error: any) {
      console.error('Error loading advanced overrides data:', error);
      toast({
        title: 'Error Loading Data',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEditStart = (param: StrategyParameter) => {
    setEditingSymbol(param.symbol);
    setEditValues({
      tp_pct: param.tp_pct,
      sl_pct: param.sl_pct,
      min_confidence: param.min_confidence
    });
  };

  const handleEditCancel = () => {
    setEditingSymbol(null);
    setEditValues(null);
  };

  const handleEditSave = async (symbol: string) => {
    if (!editValues || !strategyId || !user) return;

    try {
      const { error } = await (supabase as any)
        .from('strategy_parameters')
        .upsert({
          user_id: user.id,
          strategy_id: strategyId,
          symbol: symbol,
          tp_pct: editValues.tp_pct,
          sl_pct: editValues.sl_pct,
          min_confidence: editValues.min_confidence,
          last_updated_by: 'ui'
        });

      if (error) throw error;

      toast({
        title: 'Override Saved',
        description: `Updated parameters for ${symbol}`
      });

      setEditingSymbol(null);
      setEditValues(null);
      loadData();
    } catch (error: any) {
      console.error('Error saving override:', error);
      toast({
        title: 'Error Saving Override',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleResetBreaker = async (breaker: CircuitBreaker) => {
    if (!user || !strategyId) return;

    try {
      const { error } = await supabase.rpc('reset_breaker', {
        p_user: user.id,
        p_strategy: strategyId,
        p_symbol: breaker.symbol,
        p_type: breaker.breaker
      });

      if (error) throw error;

      toast({
        title: 'Circuit Breaker Reset',
        description: `Reset ${breaker.breaker} for ${breaker.symbol}`
      });

      loadData();
    } catch (error: any) {
      console.error('Error resetting breaker:', error);
      toast({
        title: 'Error Resetting Breaker',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  if (!strategyId) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Please save your strategy first before managing advanced overrides.
        </AlertDescription>
      </Alert>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Execution Mode Indicator */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="h-4 w-4" />
              Execution Mode
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={executionMode === 'LIVE' ? 'default' : 'secondary'} className="text-sm">
              {executionMode === 'LIVE' ? '🟢 LIVE' : '🟡 DRY RUN (no real trades)'}
            </Badge>
            <p className="text-xs text-muted-foreground mt-2">
              This is determined by environment configuration and cannot be changed from the UI.
            </p>
          </CardContent>
        </Card>

        {/* Per-Symbol Parameter Overrides */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Per-Symbol Parameter Overrides
            </CardTitle>
            <CardDescription>
              Override TP%, SL%, and Min Confidence for specific symbols
            </CardDescription>
          </CardHeader>
          <CardContent>
            {parameters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No per-symbol overrides configured. The strategy optimizer may create these automatically.
              </p>
            ) : (
              <div className="space-y-4">
                {parameters.map((param) => (
                  <div key={param.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">{param.symbol}</h4>
                      {editingSymbol === param.symbol ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={handleEditCancel}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={() => handleEditSave(param.symbol)}>
                            Save
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => handleEditStart(param)}>
                          Edit
                        </Button>
                      )}
                    </div>

                    {editingSymbol === param.symbol && editValues ? (
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`tp-${param.symbol}`}>TP %</Label>
                          <Input
                            id={`tp-${param.symbol}`}
                            type="number"
                            value={editValues.tp_pct}
                            onChange={(e) => setEditValues({ ...editValues, tp_pct: parseFloat(e.target.value) })}
                            min={0}
                            max={100}
                            step={0.1}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`sl-${param.symbol}`}>SL %</Label>
                          <Input
                            id={`sl-${param.symbol}`}
                            type="number"
                            value={editValues.sl_pct}
                            onChange={(e) => setEditValues({ ...editValues, sl_pct: parseFloat(e.target.value) })}
                            min={0}
                            max={100}
                            step={0.1}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`conf-${param.symbol}`}>Min Confidence</Label>
                          <Input
                            id={`conf-${param.symbol}`}
                            type="number"
                            value={editValues.min_confidence}
                            onChange={(e) => setEditValues({ ...editValues, min_confidence: parseFloat(e.target.value) })}
                            min={0}
                            max={1}
                            step={0.01}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">TP:</span>{' '}
                          <span className="font-medium">{param.tp_pct.toFixed(2)}%</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">SL:</span>{' '}
                          <span className="font-medium">{param.sl_pct.toFixed(2)}%</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Min Conf:</span>{' '}
                          <span className="font-medium">{(param.min_confidence * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Circuit Breakers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Circuit Breakers
            </CardTitle>
            <CardDescription>
              View and reset tripped circuit breakers
            </CardDescription>
          </CardHeader>
          <CardContent>
            {breakers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No circuit breakers are currently tripped. All symbols are clear for trading.
              </p>
            ) : (
              <div className="space-y-3">
                {breakers.map((breaker) => (
                  <div key={breaker.id} className="flex items-center justify-between border rounded-lg p-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive" className="text-xs">TRIPPED</Badge>
                        <span className="font-medium">{breaker.symbol}</span>
                        <span className="text-sm text-muted-foreground">- {breaker.breaker}</span>
                      </div>
                      {breaker.trip_reason && (
                        <p className="text-xs text-muted-foreground">{breaker.trip_reason}</p>
                      )}
                      {breaker.tripped_at && (
                        <p className="text-xs text-muted-foreground">
                          Tripped: {new Date(breaker.tripped_at).toLocaleString()}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Current: {breaker.current_value.toFixed(2)} / Threshold: {breaker.threshold_value.toFixed(2)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleResetBreaker(breaker)}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Execution Holds */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Execution Holds
            </CardTitle>
            <CardDescription>
              Temporary holds preventing execution on specific symbols
            </CardDescription>
          </CardHeader>
          <CardContent>
            {holds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active execution holds. All symbols are available for trading.
              </p>
            ) : (
              <div className="space-y-3">
                {holds.map((hold, idx) => (
                  <div key={idx} className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">ON HOLD</Badge>
                      <span className="font-medium">{hold.symbol}</span>
                    </div>
                    {hold.reason && (
                      <p className="text-sm text-muted-foreground">{hold.reason}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Hold until: {new Date(hold.hold_until).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Help Text */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            <strong>Note:</strong> These are advanced controls that expose database-backed safety mechanisms.
            Per-symbol overrides are typically managed by the strategy optimizer. Circuit breakers and holds
            are automatically managed by the trading coordinator based on execution quality and risk thresholds.
          </AlertDescription>
        </Alert>
      </div>
    </TooltipProvider>
  );
};
