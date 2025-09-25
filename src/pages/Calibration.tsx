import { useEffect, useMemo, useState } from "react";

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
  strategy_id: string;
};

export default function Calibration() {
  const [rows, setRows] = useState<CalibrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [symbol, setSymbol] = useState("ALL");
  const [horizon, setHorizon] = useState("ALL");
  const [strategy, setStrategy] = useState("ALL");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      try {
        // Import supabase client dynamically to avoid type inference issues
        const { supabase } = await import("@/integrations/supabase/client");
        
        // Use fetch-like approach to bypass complex types
        const result: any = await (supabase as any)
          .from("calibration_metrics")
          .select("*")
          .eq("window_days", 30);

        const { data, error } = result;

        if (error) {
          console.error("calibration_metrics error", error);
          setRows([]);
        } else {
          // Sort manually to avoid complex query builder types
          const sortedData = (data || []).sort((a: any, b: any) => {
            if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
            if (a.horizon !== b.horizon) return a.horizon.localeCompare(b.horizon);
            return a.confidence_band.localeCompare(b.confidence_band);
          });
          setRows(sortedData as CalibrationRow[]);
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
    () => ["ALL", ...Array.from(new Set(rows.map(r => r.strategy_id)))],
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
          (strategy === "ALL" || r.strategy_id === strategy)
      ),
    [rows, symbol, horizon, strategy]
  );

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Calibration (30d)</h1>
        {lastComputed && (
          <span className="text-xs text-slate-400">
            Last computed: {lastComputed.toLocaleString()}
          </span>
        )}
      </div>

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
  );
}