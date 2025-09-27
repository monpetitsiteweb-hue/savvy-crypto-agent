import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
import { supabase } from '@/integrations/supabase/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Eye, Zap } from 'lucide-react';
import { logger } from '@/utils/logger';
import { normalizeStrategy, StrategyData } from '@/types/strategy';

interface DebugInfo {
  timestamp: string;
  user: any;
  testMode: boolean;
  activeStrategy: any;
  allStrategies: any[];
  lastAIResponse: any;
  systemStatus: any;
}

interface DecisionSnapshot {
  id: string;
  symbol: string;
  intent_side: string;
  decision_action: string;
  decision_reason: string;
  confidence: number;
  metadata: any; // Changed from specific type to any to handle Supabase Json type
  created_at: string;
}

export const DebugPanel = () => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { activeStrategy, hasActiveStrategy, loading } = useActiveStrategy();
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [decisionSnapshots, setDecisionSnapshots] = useState<DecisionSnapshot[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [strategies, setStrategies] = useState<StrategyData[]>([]);

  const fetchDecisionSnapshots = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('trade_decisions_log')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (data) {
        // Type assertion to handle Supabase Json type
        setDecisionSnapshots(data as DecisionSnapshot[]);
      }
    } catch (error) {
      console.error('Error fetching decision snapshots:', error);
    }
  };

  const refreshDebugInfo = async () => {
    if (!user) return;

    try {
      // Fetch all strategies
      const { data: allStrategies, error: strategiesError } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id);

      if (allStrategies) {
        setStrategies((allStrategies || []).map(normalizeStrategy));
      }

      // Test AI assistant connection
      const { data: aiTest, error: aiError } = await supabase.functions.invoke('ai-trading-assistant', {
        body: {
          userId: user.id,
          message: "system health check",
          strategyId: activeStrategy?.id || null,
          testMode,
          debug: true
        }
      });

      const normalizedStrategies = (allStrategies || []).map(normalizeStrategy);

      const info: DebugInfo = {
        timestamp: new Date().toISOString(),
        user: {
          id: user.id,
          email: user.email,
          authenticated: !!user
        },
        testMode,
        activeStrategy: activeStrategy ? {
          id: activeStrategy.id,
          name: activeStrategy.strategy_name,
          is_active_test: activeStrategy.is_active_test,
          is_active_live: activeStrategy.is_active_live,
          test_mode: activeStrategy.test_mode,
          configuration: activeStrategy.configuration
        } : null,
        allStrategies: normalizedStrategies.map(s => ({
          id: s.id,
          name: s.strategy_name,
          is_active_test: s.is_active_test,
          is_active_live: s.is_active_live,
          test_mode: s.test_mode,
          created_at: s.created_at
        })),
        lastAIResponse: aiTest ? {
          success: true,
          response: aiTest
        } : {
          success: false,
          error: aiError
        },
        systemStatus: {
          strategiesError,
          aiError,
          hasActiveStrategy,
          loading
        }
      };

      setDebugInfo(info);
      setLastUpdate(new Date());
    } catch (error) {
      logger.error('Debug info refresh error:', error);
    }
  };

  useEffect(() => {
    refreshDebugInfo();
    fetchDecisionSnapshots();
  }, [user, testMode, activeStrategy]);

  const testAICommand = async (command: string) => {
    if (!user || !activeStrategy) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('ai-trading-assistant', {
        body: {
          userId: user.id,
          message: command,
          strategyId: activeStrategy.id,
          testMode,
          currentConfig: activeStrategy.configuration || {}
        }
      });

      
      
      // Update debug info with the result
      await refreshDebugInfo();
    } catch (error) {
      logger.error('🧪 AI Test Command Error:', error);
    }
  };


  if (!user) {
    return (
      <Card className="border-yellow-500">
        <CardHeader>
          <CardTitle className="text-yellow-600">⚠️ Debug Panel - Not Authenticated</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Please log in to use debug features.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-500">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer">
            <CardTitle className="flex items-center gap-2">
              🔧 Debug Panel 
              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              <Badge variant={debugInfo?.systemStatus?.hasActiveStrategy ? "default" : "destructive"}>
                {debugInfo?.systemStatus?.hasActiveStrategy ? "Strategy Active" : "No Active Strategy"}
              </Badge>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <Button onClick={refreshDebugInfo} size="sm">Refresh Debug Info</Button>
              <Button onClick={fetchDecisionSnapshots} size="sm" variant="outline">
                <Eye className="w-3 h-3 mr-1" />
                Refresh Decisions
              </Button>
              <Button 
                onClick={() => setShowSnapshots(!showSnapshots)} 
                size="sm" 
                variant="outline"
                className={showSnapshots ? "bg-primary text-primary-foreground" : ""}
              >
                <Zap className="w-3 h-3 mr-1" />
                {showSnapshots ? 'Hide' : 'Show'} ScalpSmart Decisions ({decisionSnapshots.length})
              </Button>
              <Button onClick={() => testAICommand("is ai enabled?")} size="sm" variant="outline">
                Test: Is AI Enabled?
              </Button>
            </div>

            {debugInfo && (
              <div className="space-y-4 text-sm">
                <div>
                  <h4 className="font-semibold">Last Updated: {lastUpdate.toLocaleTimeString()}</h4>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="font-semibold text-blue-600">User Status</h4>
                    <pre className="bg-slate-100 p-2 rounded text-xs overflow-auto">
{JSON.stringify(debugInfo.user, null, 2)}
                    </pre>
                  </div>

                  <div>
                    <h4 className="font-semibold text-green-600">Mode & Strategy</h4>
                    <div className="bg-slate-100 p-2 rounded text-xs">
                      <p><strong>Test Mode:</strong> {debugInfo.testMode ? '✅' : '❌'}</p>
                      <p><strong>Active Strategy:</strong> {debugInfo.activeStrategy?.name || '❌ None'}</p>
                      <p><strong>Strategy ID:</strong> {debugInfo.activeStrategy?.id || 'N/A'}</p>
                      <p><strong>Test Active:</strong> {debugInfo.activeStrategy?.is_active_test ? '✅' : '❌'}</p>
                      <p><strong>Live Active:</strong> {debugInfo.activeStrategy?.is_active_live ? '✅' : '❌'}</p>
                      <p><strong>Test Mode:</strong> {debugInfo.activeStrategy?.test_mode ? 'ON' : 'OFF'}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-purple-600">All Strategies ({debugInfo.allStrategies.length})</h4>
                  <div className="bg-slate-100 p-2 rounded text-xs max-h-32 overflow-auto">
                    {debugInfo.allStrategies.length === 0 ? (
                      <p>No strategies found</p>
                    ) : (
                      debugInfo.allStrategies.map((strategy, i) => (
                        <div key={i} className="border-b border-slate-200 pb-1 mb-1">
                          <p><strong>{strategy.name}</strong></p>
                          <p>Test: {strategy.is_active_test ? '✅' : '❌'} | Live: {strategy.is_active_live ? '✅' : '❌'}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-orange-600">AI System Status</h4>
                  <div className="bg-slate-100 p-2 rounded text-xs">
                    <p><strong>AI Response Success:</strong> {debugInfo.lastAIResponse.success ? '✅' : '❌'}</p>
                    {debugInfo.lastAIResponse.error && (
                      <p><strong>AI Error:</strong> {JSON.stringify(debugInfo.lastAIResponse.error)}</p>
                    )}
                    {debugInfo.lastAIResponse.response && (
                      <div className="mt-2">
                        <p><strong>Last AI Response:</strong></p>
                        <pre className="bg-white p-1 rounded text-xs max-h-20 overflow-auto">
{JSON.stringify(debugInfo.lastAIResponse.response, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-red-600">Current Configuration</h4>
                  <pre className="bg-slate-100 p-2 rounded text-xs max-h-40 overflow-auto">
{JSON.stringify(debugInfo.activeStrategy?.configuration || {}, null, 2)}
                  </pre>
                </div>

                {showSnapshots && (
                  <div>
                    <h4 className="font-semibold text-indigo-600">ScalpSmart Decision Snapshots (Latest {decisionSnapshots.length})</h4>
                    <div className="space-y-2 max-h-80 overflow-auto">
                      {decisionSnapshots.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No decision snapshots found. Generate some trades to see data.</p>
                      ) : (
                        decisionSnapshots.map((snapshot, i) => (
                          <div key={i} className="bg-slate-50 border-l-4 border-indigo-400 p-3 rounded text-xs">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p><strong>Symbol:</strong> {snapshot.symbol}</p>
                                <p><strong>Side:</strong> {snapshot.intent_side}</p>
                                <p><strong>Action:</strong> <Badge variant={snapshot.decision_action === 'ENTER' ? 'default' : snapshot.decision_action === 'DEFER' ? 'secondary' : 'destructive'}>{snapshot.decision_action}</Badge></p>
                                <p><strong>Reason:</strong> {snapshot.decision_reason}</p>
                                <p><strong>S_Total:</strong> {snapshot.metadata?.s_total?.toFixed(3) || 'N/A'}</p>
                              </div>
                              <div>
                                <p><strong>Spread (bps):</strong> {snapshot.metadata?.spread_bps?.toFixed(1) || 'N/A'}</p>
                                <p><strong>Depth Ratio:</strong> {snapshot.metadata?.depth_ratio?.toFixed(3) || 'N/A'}</p>
                                <p><strong>ATR Entry:</strong> {snapshot.metadata?.atr_entry?.toFixed(4) || 'N/A'}</p>
                                <p><strong>Fusion Enabled:</strong> {snapshot.metadata?.fusion_enabled ? '✅' : '❌'}</p>
                                <p><strong>Time:</strong> {new Date(snapshot.created_at).toLocaleTimeString()}</p>
                              </div>
                            </div>
                            
                            {snapshot.metadata?.brackets && (
                              <div className="mt-2 pt-2 border-t">
                                <p><strong>Brackets:</strong> TP: {snapshot.metadata.brackets.takeProfitPct?.toFixed(2)}%, SL: {snapshot.metadata.brackets.stopLossPct?.toFixed(2)}%, Trail: {snapshot.metadata.brackets.trailBufferPct?.toFixed(2)}%</p>
                              </div>
                            )}
                            
                            {snapshot.metadata?.gate_blocks && snapshot.metadata.gate_blocks.length > 0 && (
                              <div className="mt-1">
                                <p><strong>Gate Blocks:</strong> {snapshot.metadata.gate_blocks.join(', ')}</p>
                              </div>
                            )}

                            {snapshot.metadata?.bucket_scores && (
                              <div className="mt-1">
                                <p><strong>Bucket Scores:</strong> T:{snapshot.metadata.bucket_scores.trend?.toFixed(2)} V:{snapshot.metadata.bucket_scores.volatility?.toFixed(2)} M:{snapshot.metadata.bucket_scores.momentum?.toFixed(2)} W:{snapshot.metadata.bucket_scores.whale?.toFixed(2)} S:{snapshot.metadata.bucket_scores.sentiment?.toFixed(2)}</p>
                              </div>
                            )}

                            {(snapshot.metadata?.allocationUnit || snapshot.metadata?.perTradeAllocation) && (
                              <div className="mt-1">
                                <p><strong>Allocation:</strong> {snapshot.metadata.perTradeAllocation} {snapshot.metadata.allocationUnit}</p>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};