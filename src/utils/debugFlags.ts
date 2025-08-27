// utils/debugFlags.ts
export function getDebugFlags(search: string) {
  try {
    const p = new URLSearchParams(search || "");
    const on  = (k: string) => ["1","true","yes","on"].includes((p.get(k)||"").toLowerCase());
    const num = (k: string, def: number) => {
      const v = parseInt(p.get(k) ?? "", 10);
      return Number.isFinite(v) && v >= 0 ? v : def;
    };
    const flags = {
      debugHistory: on("debug") && (p.get("debug")||"") === "history",
      mutePriceLogs: on("mutePriceLogs"),
      disableRowPriceLookups: on("disableRowPriceLookups"),
      limitRows: num("limitRows", 0), // 0 = no limit
      // global kill switch
      safe: on("safe"),
    };
    return flags;
  } catch (e) {
    console.warn("[HistoryBlink] flag-parse error:", e);
    return { debugHistory:false, mutePriceLogs:false, disableRowPriceLookups:false, limitRows:0, safe:true };
  }
}