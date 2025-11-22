import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Shield, Settings, AlertCircle, RefreshCw, Clock, Info, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fromTable } from '@/utils/supa';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import type { Database } from '@/integrations/supabase/types';

// Use DB types directly
type StrategyParameter = Database['public']['Tables']['strategy_parameters']['Row'];
type CircuitBreaker = Database['public']['Tables']['execution_circuit_breakers']['Row'];
type ExecutionHold = Database['public']['Tables']['execution_holds']['Row'];

interface AdvancedSymbolOverridesPanelProps {
  strategyId: string | null;
  isTestStrategy?: boolean;
  isActive?: boolean;
  executionModeFromDb?: string;
  selectedCoins?: string[];
  defaultTpPct?: number;
  defaultSlPct?: number;
  defaultMinConfidence?: number;
}

// Editable row state
interface EditableRow {
  symbol: string;
  tp_pct: number;
  sl_pct: number;
  min_confidence: number;
  isOverride: boolean; // true if exists in DB, false if using defaults
  hasChanges: boolean; // true if user modified values
}

export const AdvancedSymbolOverridesPanel = ({ 
  strategyId, 
  isTestStrategy = true, 
  isActive = false, 
  executionModeFromDb,
  selectedCoins = [],
  defaultTpPct = 2.5,
  defaultSlPct = 3.0,
  defaultMinConfidence = 0.70
}: AdvancedSymbolOverridesPanelProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [editableRows, setEditableRows] = useState<EditableRow[]>([]);
  const [breakers, setBreakers] = useState<CircuitBreaker[]>([]);
  const [holds, setHolds] = useState<ExecutionHold[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
        .eq('user_id', user.id)
        .order('updated_at', { ascending: true });

      if (paramsError) throw paramsError;
      
      // Create a map of existing overrides
      const overridesMap = new Map<string, StrategyParameter>();
      ((paramsData as any) || []).forEach((param: StrategyParameter) => {
        overridesMap.set(param.symbol, param);
      });

      // Merge selectedCoins with existing overrides
      const allSymbols = new Set([...selectedCoins, ...overridesMap.keys()]);
      
      const rows: EditableRow[] = Array.from(allSymbols).map(symbol => {
        const override = overridesMap.get(symbol);
        return {
          symbol,
          tp_pct: override?.tp_pct ?? defaultTpPct,
          sl_pct: override?.sl_pct ?? defaultSlPct,
          min_confidence: override?.min_confidence ?? defaultMinConfidence,
          isOverride: !!override,
          hasChanges: false
        };
      });

      setEditableRows(rows);

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

  const handleRowChange = (symbol: string, field: 'tp_pct' | 'sl_pct' | 'min_confidence', value: number) => {
    setEditableRows(prev => prev.map(row => 
      row.symbol === symbol 
        ? { ...row, [field]: value, hasChanges: true }
        : row
    ));
  };

  const handleResetRow = (symbol: string) => {
    const original = editableRows.find(r => r.symbol === symbol);
    if (!original) return;
    
    // Reset to DB values or defaults
    setEditableRows(prev => prev.map(row => 
      row.symbol === symbol 
        ? {
            ...row,
            tp_pct: original.isOverride ? original.tp_pct : defaultTpPct,
            sl_pct: original.isOverride ? original.sl_pct : defaultSlPct,
            min_confidence: original.isOverride ? original.min_confidence : defaultMinConfidence,
            hasChanges: false
          }
        : row
    ));
  };

  const handleSaveAll = async () => {
    if (!strategyId || !user) return;

    const changedRows = editableRows.filter(row => row.hasChanges);
    if (changedRows.length === 0) {
      toast({
        title: 'No Changes',
        description: 'No parameters have been modified.'
      });
      return;
    }

    setSaving(true);
    try {
      // Prepare upsert data
      const upsertData = changedRows.map(row => ({
        user_id: user.id,
        strategy_id: strategyId,
        symbol: row.symbol,
        tp_pct: row.tp_pct,
        sl_pct: row.sl_pct,
        min_confidence: row.min_confidence,
        last_updated_by: 'ui'
      }));

      console.log('[AdvancedSymbolOverrides] Saving overrides', {
        strategyId,
        userId: user.id,
        upsertData,
      });

      const { data, error } = await (fromTable('strategy_parameters') as any)
        .upsert(upsertData, {
          onConflict: 'user_id,strategy_id,symbol',
          ignoreDuplicates: false,
        })
        .select('*');

      if (error) {
        console.error('[AdvancedSymbolOverrides] Upsert error', error);
        throw error;
      }

      console.log('[AdvancedSymbolOverrides] Upsert result', data);

      toast({
        title: 'Overrides Saved',
        description: `Updated parameters for ${changedRows.length} symbol(s)`
      });

      // Reload to reflect DB state
      await loadData();
    } catch (error: any) {
      console.error('Error saving overrides:', error);
      toast({
        title: 'Error Saving Overrides',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetBreaker = async (breaker: CircuitBreaker) => {
    if (!user || !strategyId) return;

    try {
      const nowIso = new Date().toISOString();

      const { error } = await fromTable('execution_circuit_breakers')
        .update({
          tripped: false,
          tripped_at: null,
          cleared_at: nowIso,
          last_reset_at: nowIso,
          last_reason: 'reset-from-ui'
        })
        .eq('id', breaker.id)
        .eq('user_id', user.id)
        .eq('strategy_id', strategyId);

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
        {/* Strategy Mode & Safety */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="h-4 w-4" />
              Strategy Mode & Safety
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <div>
                <Badge
                  variant={isTestStrategy ? 'secondary' : 'default'}
                  className="text-sm"
                >
                  {isTestStrategy ? '🧪 TEST STRATEGY' : '✅ LIVE-CAPABLE STRATEGY'}
                </Badge>
              </div>
              {executionModeFromDb && (
                <p className="text-xs text-muted-foreground">
                  Execution mode (from DB): <strong>{executionModeFromDb}</strong>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Global engine behavior (like <code className="px-1 py-0.5 bg-muted rounded text-xs">EXECUTION_DRY_RUN</code>) is controlled on the server.
                This UI only reflects strategy flags (<code className="px-1 py-0.5 bg-muted rounded text-xs">test_mode</code> / <code className="px-1 py-0.5 bg-muted rounded text-xs">is_active</code>) and stored execution_mode.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Per-Symbol Parameter Overrides */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Per-Symbol Parameter Overrides
              </CardTitle>
              <CardDescription>
                Override TP%, SL%, and Min Confidence for specific symbols. Changes are shown inline.
              </CardDescription>
            </div>
            <Button 
              onClick={handleSaveAll} 
              disabled={saving || !editableRows.some(r => r.hasChanges)}
              size="sm"
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save All'}
            </Button>
          </CardHeader>
          <CardContent>
            {editableRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No symbols configured. Add coins in "Coins and amounts" to see them here.
              </p>
            ) : (
              <div className="space-y-3">
                {editableRows.map((row) => (
                  <div 
                    key={row.symbol} 
                    className={`border rounded-lg p-4 space-y-3 ${row.hasChanges ? 'border-primary bg-primary/5' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{row.symbol}</h4>
                        <Badge 
                          variant={row.isOverride ? 'default' : 'outline'}
                          className="text-xs"
                        >
                          {row.isOverride ? 'Override' : 'Default'}
                        </Badge>
                        {row.hasChanges && (
                          <Badge variant="secondary" className="text-xs">
                            Modified
                          </Badge>
                        )}
                      </div>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => handleResetRow(row.symbol)}
                        disabled={!row.hasChanges}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Reset
                      </Button>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label 
                          htmlFor={`tp-${row.symbol}`}
                          className={!row.isOverride ? 'text-muted-foreground' : ''}
                        >
                          TP %
                        </Label>
                        <Input
                          id={`tp-${row.symbol}`}
                          type="number"
                          value={row.tp_pct}
                          onChange={(e) => handleRowChange(row.symbol, 'tp_pct', parseFloat(e.target.value) || 0)}
                          min={0}
                          max={100}
                          step={0.1}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label 
                          htmlFor={`sl-${row.symbol}`}
                          className={!row.isOverride ? 'text-muted-foreground' : ''}
                        >
                          SL %
                        </Label>
                        <Input
                          id={`sl-${row.symbol}`}
                          type="number"
                          value={row.sl_pct}
                          onChange={(e) => handleRowChange(row.symbol, 'sl_pct', parseFloat(e.target.value) || 0)}
                          min={0}
                          max={100}
                          step={0.1}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label 
                          htmlFor={`conf-${row.symbol}`}
                          className={!row.isOverride ? 'text-muted-foreground' : ''}
                        >
                          Min Confidence
                        </Label>
                        <Input
                          id={`conf-${row.symbol}`}
                          type="number"
                          value={row.min_confidence}
                          onChange={(e) => handleRowChange(row.symbol, 'min_confidence', parseFloat(e.target.value) || 0)}
                          min={0}
                          max={1}
                          step={0.01}
                        />
                      </div>
                    </div>
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
                        Current: {(breaker.current_value ?? 0).toFixed(2)} / Threshold: {(breaker.threshold_value ?? 0).toFixed(2)}
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
