import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ArrowUp, ArrowDown, TrendingUp, TrendingDown, Target, AlertTriangle, Clock, CheckCircle, Loader2 } from "lucide-react";
import { DataHealthPanel } from "@/components/market/DataHealthPanel";
import { useToast } from "@/hooks/use-toast";
import { TestBuyModal } from "@/components/strategy/TestBuyModal";
import { useActiveStrategy } from "@/hooks/useActiveStrategy";
import { Plus } from "lucide-react";

interface DecisionEvent {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  side: string;
  source: string;
  confidence: number;
  reason?: string;
  expected_pnl_pct?: number;
  tp_pct?: number;
  sl_pct?: number;
  entry_price?: number;
  qty_suggested?: number;
  decision_ts: string;
  created_at: string;
  trade_id?: string;
}

interface DecisionOutcome {
  id: string;
  decision_id: string;
  user_id: string;
  symbol: string;
  horizon: string;
  mfe_pct?: number;
  mae_pct?: number;
  realized_pnl_pct?: number;
  hit_tp?: boolean;
  hit_sl?: boolean;
  missed_opportunity?: boolean;
  expectation_error_pct?: number;
  evaluated_at: string;
  created_at: string;
}

interface CalibrationMetric {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  horizon: string;
  time_window: string;
  confidence_band: string;
  sample_count: number;
  coverage_pct: number;
  win_rate_pct: number;
  median_realized_pnl_pct: number | null;
  mean_realized_pnl_pct: number | null;
  median_mfe_pct: number | null;
  median_mae_pct: number | null;
  tp_hit_rate_pct: number;
  sl_hit_rate_pct: number;
  missed_opportunity_pct: number;
  mean_expectation_error_pct: number | null;
  reliability_correlation: number | null;
  volatility_regime: string | null;
  window_start_ts: string;
  window_end_ts: string;
  window_days: number;
  computed_at: string;
  created_at: string;
  updated_at: string;
}

interface LearningStatus {
  decisions_7d: number;
  events_7d: number;
  outcomes_7d: number;
  metrics_7d: number;
  last_evaluator_run: string | null;
  last_aggregator_run: string | null;
  loop_active: boolean;
  timestamp: string;
}

interface StrategyParameter {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  tp_pct: number;
  sl_pct: number;
  min_confidence: number;
  last_updated_by: string | null;
  updated_at: string;
  created_at: string;
}

interface StrategyHealthRow {
  symbol: string;
  tp_pct: number | null;
  sl_pct: number | null;
  min_confidence: number | null;
  param_source: "override" | "default";
  sample_count: number | null;
  win_rate_pct: number | null;
  pnl_pct: number | null;
  tp_hit_rate_pct: number | null;
  sl_hit_rate_pct: number | null;
  params_updated_at: string | null;
  metrics_computed_at: string | null;
  last_updated_by: string | null;
}

interface CalibrationSuggestion {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  horizon: string;
  suggestion_type: string;
  current_value: number | null;
  suggested_value: number | null;
  expected_impact_pct: number | null;
  reason: string;
  confidence_score: number;
  sample_size: number;
  status: string;
  applied_by: string | null;
  applied_at: string | null;
  dismissed_by: string | null;
  dismissed_at: string | null;
  based_on_window: string;
  created_at: string;
  updated_at: string;
}

export function DevLearningPage() {
  const { user } = useAuth();
  const { role, loading: roleLoading } = useUserRole();
  const { toast } = useToast();
  const [decisionEvents, setDecisionEvents] = useState<DecisionEvent[]>([]);
  const [decisionOutcomes, setDecisionOutcomes] = useState<DecisionOutcome[]>([]);
  const [calibrationMetrics, setCalibrationMetrics] = useState<CalibrationMetric[]>([]);
  const [calibrationSuggestions, setCalibrationSuggestions] = useState<CalibrationSuggestion[]>([]);
  const [learningStatus, setLearningStatus] = useState<LearningStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [calibrationLoading, setCalibrationLoading] = useState(false);
  const [selectedHorizon, setSelectedHorizon] = useState<string>("1h");
  const [calibrationFilters, setCalibrationFilters] = useState({
    horizon: "1h",
    symbol: "",
    strategy: "",
  });
  const [strategyHealthData, setStrategyHealthData] = useState<StrategyHealthRow[]>([]);
  const [healthHorizon, setHealthHorizon] = useState<string>("4h");
  const [healthLoading, setHealthLoading] = useState(false);
  const [applyingIds, setApplyingIds] = useState<Set<string>>(new Set());
  const [testBuyModalOpen, setTestBuyModalOpen] = useState(false);
  const { activeStrategy } = useActiveStrategy();

  const isAdmin = role === "admin";

  const fetchLearningStatus = async () => {
    try {
      console.log("[DevLearningPage] Fetching learning status...");
      const { data, error } = await supabase.functions.invoke("learning-status");

      if (error) {
        console.error("[DevLearningPage] Error fetching learning status:", error);
        setLearningStatus(null);
      } else {
        console.log("[DevLearningPage] Learning status received:", data);
        setLearningStatus(data);
      }
    } catch (err) {
      console.error("[DevLearningPage] Failed to fetch learning status:", err);
      setLearningStatus(null);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch decision events
      const { data: events, error: eventsError } = await supabase
        .from("decision_events")
        .select("*")
        .eq("user_id", user!.id)
        .order("decision_ts", { ascending: false })
        .limit(50);

      if (eventsError) {
        console.error("Error fetching decision events:", eventsError);
      } else {
        setDecisionEvents(events || []);
      }

      // Fetch decision outcomes
      const { data: outcomes, error: outcomesError } = await supabase
        .from("decision_outcomes")
        .select("*")
        .eq("user_id", user!.id)
        .order("evaluated_at", { ascending: false })
        .limit(100);

      if (outcomesError) {
        console.error("Error fetching decision outcomes:", outcomesError);
      } else {
        setDecisionOutcomes(outcomes || []);
      }

      // Fetch calibration metrics - order by window_end_ts (period end) for timeline
      const { data: calibration, error: calibrationError } = await supabase
        .from("calibration_metrics")
        .select("*")
        .eq("user_id", user!.id)
        .order("window_end_ts", { ascending: false })
        .limit(200);

      if (calibrationError) {
        console.error("Error fetching calibration metrics:", calibrationError);
      } else {
        setCalibrationMetrics(calibration || []);
      }

      // Fetch calibration suggestions
      await fetchSuggestions();
    } catch (error) {
      console.error("Error fetching learning data:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSuggestions = async () => {
    if (!user) return;

    try {
      const { data: suggestions, error: suggestionsError } = await supabase
        .from("calibration_suggestions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (suggestionsError) {
        console.error("Error fetching calibration suggestions:", suggestionsError);
      } else {
        setCalibrationSuggestions(suggestions || []);
      }
    } catch (error) {
      console.error("Error fetching suggestions:", error);
    }
  };

  const handleApplyOrDismiss = async (suggestionId: string, action: "apply" | "dismiss") => {
    if (applyingIds.has(suggestionId)) return;

    try {
      setApplyingIds((prev) => new Set(prev).add(suggestionId));

      const { data, error } = await supabase.functions.invoke("strategy-optimizer-apply", {
        body: { suggestion_id: suggestionId, action },
      });

      if (error) {
        throw error;
      }

      if (!data || !data.ok) {
        throw new Error(data?.error || "Unknown error occurred");
      }

      // Update local state with the updated suggestion
      if (data.updated_suggestion) {
        setCalibrationSuggestions((prev) =>
          prev.map((s) => (s.id === suggestionId ? { ...s, ...data.updated_suggestion } : s))
        );
      }

      // Show success toast
      toast({
        title: action === "apply" ? "✅ Suggestion applied" : "✅ Suggestion dismissed",
        description:
          action === "apply"
            ? "Parameters updated successfully"
            : "Suggestion dismissed without changes",
      });

      // Optionally refresh suggestions to get latest state
      await fetchSuggestions();
    } catch (error: any) {
      console.error(`Error ${action}ing suggestion:`, error);
      toast({
        title: "Error",
        description: error.message || `Failed to ${action} suggestion`,
        variant: "destructive",
      });
    } finally {
      setApplyingIds((prev) => {
        const next = new Set(prev);
        next.delete(suggestionId);
        return next;
      });
    }
  };

  useEffect(() => {
    if (user && !roleLoading && isAdmin) {
      console.log("[DevLearningPage] User is admin, fetching data...");
      fetchData();
      fetchLearningStatus();
      fetchStrategyHealth();
    }
  }, [user, roleLoading, isAdmin]);

  useEffect(() => {
    if (user && isAdmin) {
      fetchStrategyHealth();
    }
  }, [healthHorizon, user, isAdmin]);

  const triggerEvaluator = async () => {
    try {
      setCalibrationLoading(true);
      const { data, error } = await supabase.functions.invoke("decision-evaluator");
      if (error) {
        console.error("Error triggering evaluator:", error);
      } else {
        console.log("✅ Evaluator response:", data);
        // Refresh data and status after a short delay
        setTimeout(() => {
          fetchData();
          fetchLearningStatus();
        }, 2000);
      }
    } catch (error) {
      console.error("Error triggering evaluator:", error);
    } finally {
      setCalibrationLoading(false);
    }
  };

  const triggerCalibrationAggregator = async () => {
    try {
      setCalibrationLoading(true);
      const { data, error } = await supabase.functions.invoke("calibration-aggregator");
      if (error) {
        console.error("Error triggering calibration aggregator:", error);
      } else {
        console.log("✅ Calibration aggregator response:", data);
        // Refresh data and status after a short delay
        setTimeout(() => {
          fetchData();
          fetchLearningStatus();
          fetchStrategyHealth();
        }, 2000);
      }
    } catch (error) {
      console.error("Error triggering calibration aggregator:", error);
    } finally {
      setCalibrationLoading(false);
    }
  };

  const fetchStrategyHealth = async () => {
    if (!user) return;

    try {
      setHealthLoading(true);
      console.log("[DevLearningPage] Fetching strategy health data...");

      // Get user's strategy with full configuration (include inactive for learning data)
      const { data: strategies, error: stratError } = await supabase
        .from("trading_strategies")
        .select("id, configuration")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (stratError) {
        console.error("Error fetching strategy:", stratError);
        return;
      }

      const strategy = strategies?.[0];
      if (!strategy) {
        console.log("[DevLearningPage] No strategy found");
        setStrategyHealthData([]);
        return;
      }

      const strategyId = strategy.id;
      const config = strategy.configuration as any;

      console.log(`[DevLearningPage] Using strategy: ${strategyId}, horizon: ${healthHorizon}`);

      // Fetch strategy parameters
      const { data: params, error: paramsError } = await (supabase as any)
        .from("strategy_parameters")
        .select("*")
        .eq("strategy_id", strategyId);

      if (paramsError) {
        console.error("Error fetching strategy parameters:", paramsError);
      }

      console.log(`[DevLearningPage] Fetched ${params?.length || 0} strategy parameters`);

      // Fetch calibration metrics (last 30 days, for selected horizon)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: metrics, error: metricsError } = await supabase
        .from("calibration_metrics")
        .select("*")
        .eq("strategy_id", strategyId)
        .eq("horizon", healthHorizon)
        .gte("computed_at", thirtyDaysAgo.toISOString())
        .order("computed_at", { ascending: false });

      if (metricsError) {
        console.error("Error fetching calibration metrics:", metricsError);
      }

      console.log(`[DevLearningPage] Fetched ${metrics?.length || 0} calibration metrics for horizon ${healthHorizon}`);

      // Get latest metric per symbol
      const latestMetricsBySymbol = new Map<string, any>();
      metrics?.forEach((metric: any) => {
        if (!latestMetricsBySymbol.has(metric.symbol)) {
          latestMetricsBySymbol.set(metric.symbol, metric);
        }
      });

      // Build params map by symbol
      const paramsBySymbol = new Map<string, any>();
      params?.forEach((param: any) => {
        paramsBySymbol.set(param.symbol, param);
      });

      // Get all unique symbols from both params and metrics
      const allSymbols = new Set([
        ...(params?.map((p: any) => p.symbol) || []),
        ...Array.from(latestMetricsBySymbol.keys()),
      ]);

      // Extract base strategy defaults (stored as percent points, convert to fractions)
      const baseTpPct = (config?.takeProfitPercentage ?? 0.5) / 100;
      const baseSlPct = (config?.stopLossPercentage ?? 0.8) / 100;
      const baseMinConf = (config?.aiIntelligenceConfig?.aiConfidenceThreshold ?? 60) / 100;

      console.log(`[DevLearningPage] Base strategy defaults: TP=${baseTpPct}, SL=${baseSlPct}, MinConf=${baseMinConf}`);

      // Build health rows with effective parameters
      const healthRows: StrategyHealthRow[] = Array.from(allSymbols).map((symbol) => {
        const param = paramsBySymbol.get(symbol);
        const metric = latestMetricsBySymbol.get(symbol);

        // Compute effective parameters (override or default)
        const hasOverride = param !== undefined && param !== null;
        // Override values are stored as percent points (e.g., 2.5 = 2.5%), convert to fractions
        const effectiveTpPct = hasOverride ? param.tp_pct / 100 : baseTpPct;
        const effectiveSlPct = hasOverride ? param.sl_pct / 100 : baseSlPct;
        // min_confidence is already stored as a fraction (e.g., 0.65 = 65%)
        const effectiveMinConf = hasOverride ? param.min_confidence : baseMinConf;

        return {
          symbol,
          tp_pct: effectiveTpPct,
          sl_pct: effectiveSlPct,
          min_confidence: effectiveMinConf,
          param_source: hasOverride ? "override" : "default",
          sample_count: metric?.sample_count ?? null,
          win_rate_pct: metric?.win_rate_pct ?? null,
          pnl_pct: metric?.median_realized_pnl_pct ?? metric?.mean_realized_pnl_pct ?? null,
          tp_hit_rate_pct: metric?.tp_hit_rate_pct ?? null,
          sl_hit_rate_pct: metric?.sl_hit_rate_pct ?? null,
          params_updated_at: param?.updated_at ?? null,
          metrics_computed_at: metric?.computed_at ?? null,
          last_updated_by: param?.last_updated_by ?? null,
        };
      });

      console.log("[DevLearningPage] Strategy Health Rows:", healthRows);
      setStrategyHealthData(healthRows);
    } catch (error) {
      console.error("Error fetching strategy health:", error);
      setStrategyHealthData([]);
    } finally {
      setHealthLoading(false);
    }
  };

  const filteredOutcomes = decisionOutcomes.filter((outcome) => outcome.horizon === selectedHorizon);

  const getSideIcon = (side: string) => {
    return side === "BUY" ? (
      <ArrowUp className="w-4 h-4 text-green-400" />
    ) : (
      <ArrowDown className="w-4 h-4 text-red-400" />
    );
  };

  const getSideBadge = (side: string) => {
    return (
      <Badge variant={side === "BUY" ? "default" : "destructive"} className="flex items-center gap-1">
        {getSideIcon(side)}
        {side}
      </Badge>
    );
  };

  const getOutcomeIcon = (outcome: DecisionOutcome) => {
    if (outcome.hit_tp) return <Target className="w-4 h-4 text-green-400" />;
    if (outcome.hit_sl) return <AlertTriangle className="w-4 h-4 text-red-400" />;
    if (outcome.missed_opportunity) return <TrendingDown className="w-4 h-4 text-orange-400" />;
    if (outcome.realized_pnl_pct && outcome.realized_pnl_pct > 0)
      return <TrendingUp className="w-4 h-4 text-green-400" />;
    return <Clock className="w-4 h-4 text-slate-400" />;
  };

  const formatPct = (pct?: number) => {
    if (pct == null) return "N/A";
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  };

  const formatPrice = (price?: number) => {
    if (price == null) return "N/A";
    return `€${price.toLocaleString()}`;
  };

  // Show loading while checking role
  if (roleLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white">Checking permissions...</div>
      </div>
    );
  }

  // Check admin access
  if (!isAdmin) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Access Restricted</h1>
          <p className="text-muted-foreground">
            This page is currently in development and restricted to administrators.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white">Loading learning data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="container mx-auto max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Learning Loop - Phase 1</h1>
          <p className="text-slate-400">Decision events, outcomes, and performance analysis</p>

          {/* Test Portfolio Tools */}
          <Card className="my-6 border-orange-500/20 bg-slate-800/50">
            <CardHeader>
              <CardTitle className="text-white">Test Portfolio Tools</CardTitle>
              <CardDescription className="text-slate-400">Create test trades for position-managed testing</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTestBuyModalOpen(true)}
                  disabled={!activeStrategy}
                  className="text-green-400 border-green-400/50 hover:bg-green-400/10"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create test BUY
                </Button>
                {!activeStrategy && (
                  <span className="text-xs text-slate-400 self-center">No active strategy</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Learning Loop Status Widget */}
          {learningStatus && (
            <Card className="my-6 border-primary/20 bg-slate-800/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-white">
                    {learningStatus.loop_active ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                    )}
                    Learning Loop Status
                  </CardTitle>
                  <Badge variant={learningStatus.loop_active ? "default" : "secondary"}>
                    {learningStatus.loop_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <CardDescription className="text-slate-400">Last 7 days • Test mode only</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-2xl font-bold text-white">{learningStatus.decisions_7d}</div>
                    <div className="text-sm text-slate-400">Decisions</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-white">{learningStatus.events_7d}</div>
                    <div className="text-sm text-slate-400">Events</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-white">{learningStatus.outcomes_7d}</div>
                    <div className="text-sm text-slate-400">Outcomes</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-white">{learningStatus.metrics_7d}</div>
                    <div className="text-sm text-slate-400">Metrics</div>
                  </div>
                </div>
                <Separator className="my-4 bg-slate-700" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-slate-400" />
                    <span className="text-slate-400">Last Evaluator:</span>
                    <span className="font-mono text-slate-300">
                      {learningStatus.last_evaluator_run
                        ? new Date(learningStatus.last_evaluator_run).toLocaleString()
                        : "Never"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-slate-400" />
                    <span className="text-slate-400">Last Aggregator:</span>
                    <span className="font-mono text-slate-300">
                      {learningStatus.last_aggregator_run
                        ? new Date(learningStatus.last_aggregator_run).toLocaleString()
                        : "Never"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-4 mt-4">
            <Button
              onClick={() => {
                fetchData();
                fetchLearningStatus();
              }}
              variant="outline"
            >
              Refresh Data
            </Button>
            <Button onClick={triggerEvaluator} variant="default" disabled={calibrationLoading}>
              {calibrationLoading ? "Running..." : "Trigger Evaluator"}
            </Button>
            <Button onClick={triggerCalibrationAggregator} variant="secondary" disabled={calibrationLoading}>
              {calibrationLoading ? "Running..." : "Run Calibration"}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="events" className="space-y-6">
          <TabsList className="bg-slate-800 border-slate-700">
            <TabsTrigger value="events">Decision Events ({decisionEvents.length})</TabsTrigger>
            <TabsTrigger value="outcomes">Outcomes ({decisionOutcomes.length})</TabsTrigger>
            <TabsTrigger value="calibration">Calibration</TabsTrigger>
            <TabsTrigger value="suggestions">Suggestions ({calibrationSuggestions.length})</TabsTrigger>
            <TabsTrigger value="strategy-health">Strategy Health</TabsTrigger>
            <TabsTrigger value="data-health">Data Health</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="space-y-4">
            <Card className="bg-slate-800/80 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  Recent Decision Events
                </CardTitle>
                <CardDescription>All trading decisions (manual + automated) with metadata</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {decisionEvents.length === 0 ? (
                    <p className="text-slate-400 text-center py-8">No decision events found</p>
                  ) : (
                    decisionEvents.map((event) => (
                      <div key={event.id} className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-3">
                            {getSideBadge(event.side)}
                            <span className="text-white font-medium">{event.symbol}</span>
                            <Badge variant="outline" className="text-xs">
                              {event.source}
                            </Badge>
                          </div>
                          <div className="text-xs text-slate-400">{new Date(event.decision_ts).toLocaleString()}</div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-slate-400">Entry Price:</span>
                            <div className="text-white">{formatPrice(event.entry_price)}</div>
                          </div>
                          <div>
                            <span className="text-slate-400">Confidence:</span>
                            <div className="text-white">{(event.confidence * 100).toFixed(1)}%</div>
                          </div>
                          <div>
                            <span className="text-slate-400">Expected P&L:</span>
                            <div className="text-white">{formatPct(event.expected_pnl_pct)}</div>
                          </div>
                          <div>
                            <span className="text-slate-400">Quantity:</span>
                            <div className="text-white">{event.qty_suggested?.toFixed(4) || "N/A"}</div>
                          </div>
                        </div>

                        {event.reason && (
                          <div className="mt-2 pt-2 border-t border-slate-600">
                            <span className="text-slate-400 text-xs">Reason: </span>
                            <span className="text-slate-300 text-xs">{event.reason}</span>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="outcomes" className="space-y-4">
            <Card className="bg-slate-800/80 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-400" />
                  Decision Outcomes
                </CardTitle>
                <CardDescription>Performance analysis across different time horizons</CardDescription>

                <div className="flex gap-2 mt-4">
                  {["15m", "1h", "4h", "24h"].map((horizon) => (
                    <Button
                      key={horizon}
                      size="sm"
                      variant={selectedHorizon === horizon ? "default" : "outline"}
                      onClick={() => setSelectedHorizon(horizon)}
                    >
                      {horizon}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {filteredOutcomes.length === 0 ? (
                    <p className="text-slate-400 text-center py-8">No outcomes found for {selectedHorizon} horizon</p>
                  ) : (
                    filteredOutcomes.map((outcome) => {
                      const event = decisionEvents.find((e) => e.id === outcome.decision_id);
                      return (
                        <div key={outcome.id} className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-3">
                              {getOutcomeIcon(outcome)}
                              <span className="text-white font-medium">{outcome.symbol}</span>
                              <Badge variant="outline" className="text-xs">
                                {outcome.horizon}
                              </Badge>
                              {event && getSideBadge(event.side)}
                            </div>
                            <div className="text-xs text-slate-400">
                              {new Date(outcome.evaluated_at).toLocaleString()}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                            <div>
                              <span className="text-slate-400">MFE:</span>
                              <div
                                className={`font-medium ${outcome.mfe_pct && outcome.mfe_pct > 0 ? "text-green-400" : "text-slate-300"}`}
                              >
                                {formatPct(outcome.mfe_pct)}
                              </div>
                            </div>
                            <div>
                              <span className="text-slate-400">MAE:</span>
                              <div
                                className={`font-medium ${outcome.mae_pct && outcome.mae_pct < 0 ? "text-red-400" : "text-slate-300"}`}
                              >
                                {formatPct(outcome.mae_pct)}
                              </div>
                            </div>
                            <div>
                              <span className="text-slate-400">Final P&L:</span>
                              <div
                                className={`font-medium ${outcome.realized_pnl_pct && outcome.realized_pnl_pct > 0 ? "text-green-400" : outcome.realized_pnl_pct && outcome.realized_pnl_pct < 0 ? "text-red-400" : "text-slate-300"}`}
                              >
                                {formatPct(outcome.realized_pnl_pct)}
                              </div>
                            </div>
                            <div>
                              <span className="text-slate-400">Expectation Error:</span>
                              <div className="text-white">{formatPct(outcome.expectation_error_pct)}</div>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              {outcome.hit_tp && <Badge className="bg-green-700 text-xs">TP Hit</Badge>}
                              {outcome.hit_sl && <Badge className="bg-red-700 text-xs">SL Hit</Badge>}
                              {outcome.missed_opportunity && (
                                <Badge className="bg-orange-700 text-xs">Missed Opp</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="calibration" className="space-y-4">
            <Card className="bg-slate-800/80 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-400" />
                  Calibration Metrics
                </CardTitle>
                <CardDescription>Performance metrics grouped by confidence bands and time horizons</CardDescription>

                <div className="flex gap-4 mt-4">
                  <div className="flex gap-2">
                    <label className="text-slate-400 text-sm">Horizon:</label>
                    <select
                      value={calibrationFilters.horizon}
                      onChange={(e) => setCalibrationFilters((prev) => ({ ...prev, horizon: e.target.value }))}
                      className="bg-slate-700 text-white text-sm rounded px-2 py-1 border border-slate-600"
                    >
                      <option value="">All</option>
                      <option value="15m">15m</option>
                      <option value="1h">1h</option>
                      <option value="4h">4h</option>
                      <option value="24h">24h</option>
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <label className="text-slate-400 text-sm">Symbol:</label>
                    <select
                      value={calibrationFilters.symbol}
                      onChange={(e) => setCalibrationFilters((prev) => ({ ...prev, symbol: e.target.value }))}
                      className="bg-slate-700 text-white text-sm rounded px-2 py-1 border border-slate-600"
                    >
                      <option value="">All</option>
                      {[...new Set(calibrationMetrics.map((m) => m.symbol))].sort().map((symbol) => (
                        <option key={symbol} value={symbol}>
                          {symbol}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <label className="text-slate-400 text-sm">Strategy:</label>
                    <select
                      value={calibrationFilters.strategy}
                      onChange={(e) => setCalibrationFilters((prev) => ({ ...prev, strategy: e.target.value }))}
                      className="bg-slate-700 text-white text-sm rounded px-2 py-1 border border-slate-600"
                    >
                      <option value="">All</option>
                      {[...new Set(calibrationMetrics.map((m) => m.strategy_id))].sort().map((strategyId) => (
                        <option key={strategyId} value={strategyId}>
                          {strategyId.slice(0, 8)}...
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-600">
                        <th className="text-left text-slate-400 pb-2">Symbol</th>
                        <th className="text-left text-slate-400 pb-2">Horizon</th>
                        <th className="text-left text-slate-400 pb-2">Confidence</th>
                        <th className="text-right text-slate-400 pb-2">Samples</th>
                        <th className="text-right text-slate-400 pb-2">Win Rate</th>
                        <th className="text-right text-slate-400 pb-2">Avg P&L</th>
                        <th className="text-right text-slate-400 pb-2">TP Rate</th>
                        <th className="text-right text-slate-400 pb-2">SL Rate</th>
                        <th className="text-left text-slate-400 pb-2">Last Computed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calibrationMetrics
                        .filter((metric) => {
                          if (calibrationFilters.horizon && metric.horizon !== calibrationFilters.horizon) return false;
                          if (calibrationFilters.symbol && metric.symbol !== calibrationFilters.symbol) return false;
                          if (calibrationFilters.strategy && metric.strategy_id !== calibrationFilters.strategy)
                            return false;
                          return true;
                        })
                        .sort((a, b) => {
                          // Sort by symbol, then horizon, then confidence band
                          if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
                          if (a.horizon !== b.horizon) return a.horizon.localeCompare(b.horizon);
                          return a.confidence_band.localeCompare(b.confidence_band);
                        })
                        .map((metric) => (
                          <tr key={metric.id} className="border-b border-slate-700/50">
                            <td className="py-2 text-white font-medium">{metric.symbol}</td>
                            <td className="py-2 text-slate-300">
                              <Badge variant="outline" className="text-xs">
                                {metric.horizon}
                              </Badge>
                            </td>
                            <td className="py-2 text-slate-300">
                              <Badge variant="secondary" className="text-xs bg-blue-900/20 text-blue-300">
                                {metric.confidence_band}
                              </Badge>
                            </td>
                            <td className="py-2 text-right text-white">{metric.sample_count}</td>
                            <td
                              className={`py-2 text-right font-medium ${
                                metric.win_rate_pct >= 60
                                  ? "text-green-400"
                                  : metric.win_rate_pct >= 40
                                    ? "text-yellow-400"
                                    : "text-red-400"
                              }`}
                            >
                              {metric.win_rate_pct.toFixed(1)}%
                            </td>
                            <td
                              className={`py-2 text-right font-medium ${
                                metric.mean_realized_pnl_pct >= 0 ? "text-green-400" : "text-red-400"
                              }`}
                            >
                              {formatPct(metric.mean_realized_pnl_pct)}
                            </td>
                            <td className="py-2 text-right text-slate-300">{metric.tp_hit_rate_pct.toFixed(1)}%</td>
                            <td className="py-2 text-right text-slate-300">{metric.sl_hit_rate_pct.toFixed(1)}%</td>
                            <td className="py-2 text-slate-400 text-xs">
                              <div className="flex flex-col">
                                <span className="text-slate-300">{new Date(metric.window_end_ts).toLocaleDateString()}</span>
                                <span className="text-xs text-slate-500">
                                  Computed: {new Date(metric.computed_at).toLocaleDateString()}
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>

                  {calibrationMetrics.length === 0 && (
                    <div className="text-center py-8 text-slate-400">
                      No calibration metrics found. Run calibration aggregator to generate metrics.
                    </div>
                  )}

                  {calibrationMetrics.filter((metric) => {
                    if (calibrationFilters.horizon && metric.horizon !== calibrationFilters.horizon) return false;
                    if (calibrationFilters.symbol && metric.symbol !== calibrationFilters.symbol) return false;
                    if (calibrationFilters.strategy && metric.strategy_id !== calibrationFilters.strategy) return false;
                    return true;
                  }).length === 0 &&
                    calibrationMetrics.length > 0 && (
                      <div className="text-center py-8 text-slate-400">No metrics match the current filters.</div>
                    )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="suggestions" className="space-y-4">
            <Card className="bg-slate-800/80 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Target className="w-5 h-5 text-purple-400" />
                  Calibration Suggestions
                </CardTitle>
                <CardDescription>AI-generated suggestions for parameter optimization</CardDescription>
              </CardHeader>
              <CardContent>
                {calibrationSuggestions.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <p className="mb-2">No suggestions found.</p>
                    <p className="text-sm">Run strategy-optimizer-agent to generate suggestions.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="text-left py-3 px-2 text-slate-300 font-medium">Symbol</th>
                          <th className="text-left py-3 px-2 text-slate-300 font-medium">Horizon</th>
                          <th className="text-left py-3 px-2 text-slate-300 font-medium">Type</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">Current</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">Suggested</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">Impact %</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">Confidence</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">Samples</th>
                          <th className="text-center py-3 px-2 text-slate-300 font-medium">Status</th>
                          <th className="text-center py-3 px-2 text-slate-300 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calibrationSuggestions.map((suggestion) => {
                          const isPending = suggestion.status === "pending";
                          const isApplying = applyingIds.has(suggestion.id);
                          const canApply = isPending && suggestion.suggestion_type === "confidence_threshold";

                          return (
                            <tr key={suggestion.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                              <td className="py-3 px-2 text-white font-medium">{suggestion.symbol}</td>
                              <td className="py-3 px-2">
                                <Badge variant="outline" className="text-xs">
                                  {suggestion.horizon}
                                </Badge>
                              </td>
                              <td className="py-3 px-2 text-slate-300 text-xs">
                                {suggestion.suggestion_type.replace(/_/g, " ")}
                              </td>
                              <td className="text-right py-3 px-2 text-slate-300">
                                {suggestion.current_value !== null
                                  ? (suggestion.current_value * 100).toFixed(2)
                                  : "–"}
                              </td>
                              <td className="text-right py-3 px-2 text-white font-medium">
                                {suggestion.suggested_value !== null
                                  ? (suggestion.suggested_value * 100).toFixed(2)
                                  : "–"}
                              </td>
                              <td className="text-right py-3 px-2">
                                <span
                                  className={
                                    suggestion.expected_impact_pct !== null && suggestion.expected_impact_pct > 0
                                      ? "text-green-400"
                                      : "text-slate-300"
                                  }
                                >
                                  {suggestion.expected_impact_pct !== null
                                    ? formatPct(suggestion.expected_impact_pct)
                                    : "–"}
                                </span>
                              </td>
                              <td className="text-right py-3 px-2 text-slate-300">
                                {(suggestion.confidence_score * 100).toFixed(0)}%
                              </td>
                              <td className="text-right py-3 px-2 text-slate-300">{suggestion.sample_size}</td>
                              <td className="text-center py-3 px-2">
                                <Badge
                                  variant={
                                    suggestion.status === "applied"
                                      ? "default"
                                      : suggestion.status === "dismissed"
                                        ? "secondary"
                                        : "outline"
                                  }
                                  className="text-xs"
                                >
                                  {suggestion.status}
                                </Badge>
                              </td>
                              <td className="text-center py-3 px-2">
                                {isPending ? (
                                  <div className="flex gap-2 justify-center">
                                    <Button
                                      size="sm"
                                      variant="default"
                                      onClick={() => handleApplyOrDismiss(suggestion.id, "apply")}
                                      disabled={!canApply || isApplying}
                                      title={
                                        !canApply
                                          ? "Apply not supported for this suggestion type yet"
                                          : undefined
                                      }
                                    >
                                      {isApplying ? (
                                        <>
                                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                          Applying...
                                        </>
                                      ) : (
                                        "Apply"
                                      )}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleApplyOrDismiss(suggestion.id, "dismiss")}
                                      disabled={isApplying}
                                    >
                                      {isApplying ? (
                                        <>
                                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                          Dismissing...
                                        </>
                                      ) : (
                                        "Dismiss"
                                      )}
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-500">
                                    {suggestion.status === "applied" ? "Applied" : "Dismissed"}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="strategy-health" className="space-y-4">
            <Card className="bg-slate-800/80 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-400" />
                  Strategy Health (per symbol)
                </CardTitle>
                <CardDescription>Current TP/SL/confidence vs recent performance metrics</CardDescription>

                <div className="flex gap-2 mt-4">
                  <span className="text-sm text-slate-400 flex items-center">Horizon:</span>
                  {["1h", "4h", "24h"].map((horizon) => (
                    <Button
                      key={horizon}
                      size="sm"
                      variant={healthHorizon === horizon ? "default" : "outline"}
                      onClick={() => setHealthHorizon(horizon)}
                    >
                      {horizon}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {healthLoading ? (
                  <div className="text-center py-8 text-slate-400">Loading strategy health data...</div>
                ) : strategyHealthData.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <p className="mb-2">No strategy health data yet.</p>
                    <p className="text-sm">Run evaluator + aggregator and open some trades in TEST mode first.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="text-left py-3 px-2 text-slate-300 font-medium">Symbol</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">TP %</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">SL %</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">Min Conf</th>
                          <th className="text-center py-3 px-2 text-slate-300 font-medium">Source</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">Samples</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">Win Rate %</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">PnL %</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">TP Hit %</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">SL Hit %</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">Params Updated</th>
                          <th className="text-right py-3 px-2 text-slate-300 font-medium">Metrics Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {strategyHealthData.map((row) => (
                          <tr key={row.symbol} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                            <td className="py-3 px-2 text-white font-medium">{row.symbol}</td>
                            <td className="text-right py-3 px-2 text-white">
                              {row.tp_pct !== null ? (row.tp_pct * 100).toFixed(2) : "–"}
                            </td>
                            <td className="text-right py-3 px-2 text-white">
                              {row.sl_pct !== null ? (row.sl_pct * 100).toFixed(2) : "–"}
                            </td>
                            <td className="text-right py-3 px-2 text-white">
                              {row.min_confidence !== null ? (row.min_confidence * 100).toFixed(0) : "–"}
                            </td>
                            <td className="text-center py-3 px-2">
                              <Badge
                                variant={row.param_source === "override" ? "default" : "outline"}
                                className="text-xs"
                              >
                                {row.param_source === "override" ? "Override" : "Default"}
                              </Badge>
                            </td>
                            <td className="text-right py-3 px-2 text-slate-300">
                              {row.sample_count !== null ? row.sample_count : "–"}
                            </td>
                            <td className="text-right py-3 px-2">
                              <span
                                className={
                                  row.win_rate_pct !== null && row.win_rate_pct >= 50
                                    ? "text-green-400"
                                    : "text-slate-300"
                                }
                              >
                                {row.win_rate_pct !== null ? row.win_rate_pct.toFixed(1) : "–"}
                              </span>
                            </td>
                            <td className="text-right py-3 px-2">
                              <span
                                className={
                                  row.pnl_pct !== null
                                    ? row.pnl_pct >= 0
                                      ? "text-green-400"
                                      : "text-red-400"
                                    : "text-slate-300"
                                }
                              >
                                {row.pnl_pct !== null ? formatPct(row.pnl_pct) : "–"}
                              </span>
                            </td>
                            <td className="text-right py-3 px-2 text-slate-300">
                              {row.tp_hit_rate_pct !== null ? row.tp_hit_rate_pct.toFixed(1) : "–"}
                            </td>
                            <td className="text-right py-3 px-2 text-slate-300">
                              {row.sl_hit_rate_pct !== null ? row.sl_hit_rate_pct.toFixed(1) : "–"}
                            </td>
                            <td className="text-right py-3 px-2 text-xs text-slate-400">
                              {row.params_updated_at ? new Date(row.params_updated_at).toLocaleDateString() : "–"}
                            </td>
                            <td className="text-right py-3 px-2 text-xs text-slate-400">
                              {row.metrics_computed_at ? new Date(row.metrics_computed_at).toLocaleDateString() : "–"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="data-health" className="space-y-4">
            <DataHealthPanel />
          </TabsContent>

          <TabsContent value="analysis" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="bg-slate-800/80 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white text-lg">Decision Stats</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Total Decisions:</span>
                      <span className="text-white font-medium">{decisionEvents.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">BUY Decisions:</span>
                      <span className="text-green-400 font-medium">
                        {decisionEvents.filter((e) => e.side === "BUY").length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">SELL Decisions:</span>
                      <span className="text-red-400 font-medium">
                        {decisionEvents.filter((e) => e.side === "SELL").length}
                      </span>
                    </div>
                    <Separator className="bg-slate-600" />
                    <div className="flex justify-between">
                      <span className="text-slate-400">Automated:</span>
                      <span className="text-white font-medium">
                        {decisionEvents.filter((e) => e.source === "automated").length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Manual:</span>
                      <span className="text-white font-medium">
                        {decisionEvents.filter((e) => e.source === "manual").length}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800/80 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white text-lg">Outcome Stats</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Total Outcomes:</span>
                      <span className="text-white font-medium">{decisionOutcomes.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">TP Hits:</span>
                      <span className="text-green-400 font-medium">
                        {decisionOutcomes.filter((o) => o.hit_tp).length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">SL Hits:</span>
                      <span className="text-red-400 font-medium">
                        {decisionOutcomes.filter((o) => o.hit_sl).length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Missed Opportunities:</span>
                      <span className="text-orange-400 font-medium">
                        {decisionOutcomes.filter((o) => o.missed_opportunity).length}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800/80 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white text-lg">Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {(() => {
                      const profitableOutcomes = filteredOutcomes.filter(
                        (o) => o.realized_pnl_pct && o.realized_pnl_pct > 0,
                      );
                      const avgPnl =
                        filteredOutcomes.length > 0
                          ? filteredOutcomes.reduce((sum, o) => sum + (o.realized_pnl_pct || 0), 0) /
                            filteredOutcomes.length
                          : 0;
                      const winRate =
                        filteredOutcomes.length > 0 ? (profitableOutcomes.length / filteredOutcomes.length) * 100 : 0;

                      return (
                        <>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Win Rate ({selectedHorizon}):</span>
                            <span className={`font-medium ${winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
                              {winRate.toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Avg P&L ({selectedHorizon}):</span>
                            <span className={`font-medium ${avgPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {formatPct(avgPnl)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Profitable:</span>
                            <span className="text-green-400 font-medium">{profitableOutcomes.length}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Unprofitable:</span>
                            <span className="text-red-400 font-medium">
                              {filteredOutcomes.filter((o) => o.realized_pnl_pct && o.realized_pnl_pct < 0).length}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Test BUY Modal */}
        <TestBuyModal
          open={testBuyModalOpen}
          onOpenChange={setTestBuyModalOpen}
          strategyId={activeStrategy?.id || null}
          onSuccess={() => {
            fetchData();
            fetchLearningStatus();
          }}
        />
      </div>
    </div>
  );
}
