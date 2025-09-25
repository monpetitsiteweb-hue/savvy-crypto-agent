import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

type CalibrationRow = {
  symbol: string;
  horizon: string;
  confidence_band: string;
  sample_count: number;
  win_rate_pct: number | null;
  mean_realized_pnl_pct: number | null;
  tp_hit_rate_pct: number | null;
  sl_hit_rate_pct: number | null;
  computed_at: string;
  strategy_id: string | null;
};

export default function Calibration() {
  const [rows, setRows] = useState<CalibrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [symbol, setSymbol] = useState("ALL");
  const [horizon, setHorizon] = useState("ALL");
  const [strategy, setStrategy] = useState("ALL");
  const [chartMetric, setChartMetric] = useState<"pnl" | "winrate">("pnl");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      try {
        const { data, error } = await (supabase as any)
          .from("calibration_metrics")
          .select("*")
          .eq("window_days", 30)
          .order("symbol", { ascending: true })
          .order("horizon", { ascending: true })
          .order("confidence_band", { ascending: true });

        if (error) {
          console.error("calibration_metrics error", error);
          setRows([]);
        } else {
          setRows((data || []) as CalibrationRow[]);
        }
      } catch (err) {
        console.error("Query error:", err);
        setRows([]);
      }
      
      setLoading(false);
    };

    fetchData();
  }, []);

  const symbols = useMemo(
    () => ["ALL", ...Array.from(new Set(rows.map(r => r.symbol)))],
    [rows]
  );
  const horizons = useMemo(
    () => ["ALL", ...Array.from(new Set(rows.map(r => r.horizon)))],
    [rows]
  );
  const strategies = useMemo(
    () => ["ALL", ...Array.from(new Set(rows.map(r => r.strategy_id || "Unassigned")))],
    [rows]
  );
  
  const lastComputed = useMemo(() => {
    return rows.length > 0 
      ? new Date(Math.max(...rows.map(r => new Date(r.computed_at).getTime()))) 
      : null;
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        r =>
          (symbol === "ALL" || r.symbol === symbol) &&
          (horizon === "ALL" || r.horizon === horizon) &&
          (strategy === "ALL" || (r.strategy_id || "Unassigned") === strategy)
      ),
    [rows, symbol, horizon, strategy]
  );

  // Summary cards computation
  const summaryMetrics = useMemo(() => {
    const validRows = filtered.filter(r => r.sample_count > 0);
    if (validRows.length === 0) {
      return { totalSamples: 0, winRate: null, meanPnl: null, tpHitRate: null, slHitRate: null };
    }
    
    const totalSamples = validRows.reduce((sum, r) => sum + r.sample_count, 0);
    
    const computeWeighted = (getValue: (r: CalibrationRow) => number | null) => {
      const validForMetric = validRows.filter(r => getValue(r) !== null);
      if (validForMetric.length === 0) return null;
      
      const weightedSum = validForMetric.reduce((sum, r) => {
        const value = getValue(r);
        return sum + (value! * r.sample_count);
      }, 0);
      const weightSum = validForMetric.reduce((sum, r) => sum + r.sample_count, 0);
      return weightSum > 0 ? weightedSum / weightSum : null;
    };
    
    return {
      totalSamples,
      winRate: computeWeighted(r => r.win_rate_pct),
      meanPnl: computeWeighted(r => r.mean_realized_pnl_pct),
      tpHitRate: computeWeighted(r => r.tp_hit_rate_pct),
      slHitRate: computeWeighted(r => r.sl_hit_rate_pct),
    };
  }, [filtered]);

  // Chart data (only when single symbol AND single horizon selected)
  const chartData = useMemo(() => {
    if (symbol === "ALL" || horizon === "ALL") return null;
    
    const chartRows = filtered
      .filter(r => r.symbol === symbol && r.horizon === horizon)
      .sort((a, b) => a.confidence_band.localeCompare(b.confidence_band));
    
    return chartRows.map(r => ({
      band: r.confidence_band,
      pnl: r.mean_realized_pnl_pct,
      winrate: r.win_rate_pct,
      samples: r.sample_count,
    }));
  }, [filtered, symbol, horizon]);

  // Hotspots computation
  const hotspots = useMemo(() => {
    const validRows = filtered.filter(r => r.sample_count >= 10);
    
    const getTop3Bottom3 = (getValue: (r: CalibrationRow) => number | null) => {
      const withValues = validRows
        .filter(r => getValue(r) !== null)
        .map(r => ({ ...r, value: getValue(r)! }))
        .sort((a, b) => b.value - a.value);
      
      return {
        top3: withValues.slice(0, 3),
        bottom3: withValues.slice(-3).reverse(),
      };
    };
    
    const pnlHotspots = getTop3Bottom3(r => r.mean_realized_pnl_pct);
    const winrateHotspots = getTop3Bottom3(r => r.win_rate_pct);
    
    return { pnlHotspots, winrateHotspots };
  }, [filtered]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Calibration (30d)</h1>
        {lastComputed && (
          <span className="text-xs text-slate-400">
            Last computed: {lastComputed.toLocaleString()}
          </span>
        )}
      </div>

      {/* Summary Cards */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
            <div className="text-xs text-slate-600 dark:text-slate-400">Total Samples</div>
            <div className="text-xl font-semibold">{summaryMetrics.totalSamples.toLocaleString()}</div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
            <div className="text-xs text-slate-600 dark:text-slate-400">Win Rate</div>
            <div className="text-xl font-semibold">
              {summaryMetrics.winRate !== null ? `${summaryMetrics.winRate.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
            <div className="text-xs text-slate-600 dark:text-slate-400">Mean P&L</div>
            <div className="text-xl font-semibold">
              {summaryMetrics.meanPnl !== null ? `${summaryMetrics.meanPnl.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
            <div className="text-xs text-slate-600 dark:text-slate-400">TP Hit Rate</div>
            <div className="text-xl font-semibold">
              {summaryMetrics.tpHitRate !== null ? `${summaryMetrics.tpHitRate.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
            <div className="text-xs text-slate-600 dark:text-slate-400">SL Hit Rate</div>
            <div className="text-xl font-semibold">
              {summaryMetrics.slHitRate !== null ? `${summaryMetrics.slHitRate.toFixed(1)}%` : "—"}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <select className="border rounded px-2 py-1" value={symbol} onChange={e => setSymbol(e.target.value)}>
          {symbols.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select className="border rounded px-2 py-1" value={horizon} onChange={e => setHorizon(e.target.value)}>
          {horizons.map(h => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>

        <select className="border rounded px-2 py-1" value={strategy} onChange={e => setStrategy(e.target.value)}>
          {strategies.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Chart Section */}
      {!loading && chartData && chartData.length > 0 && (
        <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium">Performance by Confidence Band ({symbol} • {horizon})</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setChartMetric("pnl")}
                className={`px-3 py-1 text-sm rounded ${
                  chartMetric === "pnl" ? "bg-blue-500 text-white" : "bg-slate-200 text-slate-700"
                }`}
              >
                P&L %
              </button>
              <button
                onClick={() => setChartMetric("winrate")}
                className={`px-3 py-1 text-sm rounded ${
                  chartMetric === "winrate" ? "bg-blue-500 text-white" : "bg-slate-200 text-slate-700"
                }`}
              >
                Win Rate %
              </button>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="band" />
                <YAxis />
                <Tooltip 
                  formatter={(value, name) => [
                    `${typeof value === 'number' ? value.toFixed(1) : value}%`, 
                    chartMetric === "pnl" ? "P&L %" : "Win Rate %"
                  ]}
                  labelFormatter={(band) => `Band: ${band}`}
                />
                <Bar 
                  dataKey={chartMetric} 
                  fill={chartMetric === "pnl" ? "#3b82f6" : "#10b981"}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Table */}
        <div className="lg:col-span-3">
          {loading ? (
            <div>Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Symbol</th>
                    <th className="py-2 pr-4">Horizon</th>
                    <th className="py-2 pr-4">Band</th>
                    <th className="py-2 pr-4">Samples</th>
                    <th className="py-2 pr-4">Win %</th>
                    <th className="py-2 pr-4">Mean P&L %</th>
                    <th className="py-2 pr-4">TP %</th>
                    <th className="py-2 pr-4">SL %</th>
                    <th className="py-2 pr-4">Computed</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={`${r.symbol}-${r.horizon}-${r.confidence_band}-${i}`} className="border-b">
                      <td className="py-1 pr-4">{r.symbol}</td>
                      <td className="py-1 pr-4">{r.horizon}</td>
                      <td className="py-1 pr-4">{r.confidence_band}</td>
                      <td className="py-1 pr-4">{r.sample_count}</td>
                      <td className="py-1 pr-4">{r.win_rate_pct ?? "—"}</td>
                      <td className="py-1 pr-4">{r.mean_realized_pnl_pct ?? "—"}</td>
                      <td className="py-1 pr-4">{r.tp_hit_rate_pct ?? "—"}</td>
                      <td className="py-1 pr-4">{r.sl_hit_rate_pct ?? "—"}</td>
                      <td className="py-1 pr-4">{new Date(r.computed_at).toLocaleString()}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td className="py-3" colSpan={9}>No rows for current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Hotspots Sidebar */}
        {!loading && (
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
              <h4 className="font-medium text-green-800 dark:text-green-400 mb-3">🔥 Hot Spots (Over-perform)</h4>
              <div className="space-y-2">
                <div className="text-xs font-medium text-green-700 dark:text-green-300">By P&L:</div>
                {hotspots.pnlHotspots.top3.map((item, i) => (
                  <div key={i} className="text-xs text-green-700 dark:text-green-300">
                    {item.symbol} • {item.horizon} • {item.confidence_band} • {item.value.toFixed(1)}% ({item.sample_count})
                  </div>
                ))}
                <div className="text-xs font-medium text-green-700 dark:text-green-300 mt-2">By Win Rate:</div>
                {hotspots.winrateHotspots.top3.map((item, i) => (
                  <div key={i} className="text-xs text-green-700 dark:text-green-300">
                    {item.symbol} • {item.horizon} • {item.confidence_band} • {item.value.toFixed(1)}% ({item.sample_count})
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-200 dark:border-red-800">
              <h4 className="font-medium text-red-800 dark:text-red-400 mb-3">🧊 Cold Spots (Under-perform)</h4>
              <div className="space-y-2">
                <div className="text-xs font-medium text-red-700 dark:text-red-300">By P&L:</div>
                {hotspots.pnlHotspots.bottom3.map((item, i) => (
                  <div key={i} className="text-xs text-red-700 dark:text-red-300">
                    {item.symbol} • {item.horizon} • {item.confidence_band} • {item.value.toFixed(1)}% ({item.sample_count})
                  </div>
                ))}
                <div className="text-xs font-medium text-red-700 dark:text-red-300 mt-2">By Win Rate:</div>
                {hotspots.winrateHotspots.bottom3.map((item, i) => (
                  <div key={i} className="text-xs text-red-700 dark:text-red-300">
                    {item.symbol} • {item.horizon} • {item.confidence_band} • {item.value.toFixed(1)}% ({item.sample_count})
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}