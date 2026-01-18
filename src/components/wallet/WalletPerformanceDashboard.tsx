import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type WalletPerformance = {
  walletTotalEur: number;
  initialFundedEur: number;
  gasPaidEur: number;
  tradeCount: number;
};

export default function WalletPerformanceDashboard({ userId }: { userId: string }) {
  const [data, setData] = useState<WalletPerformance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    const load = async () => {
      setLoading(true);

      try {
        /**
         * 1. Get first confirmed real trade
         */
        // @ts-expect-error - Type instantiation too deep in Supabase types
        const firstTradeResult = await supabase
          .from("mock_trades")
          .select("executed_at")
          .eq("user_id", userId)
          .eq("is_test_mode", false)
          .eq("execution_confirmed", true)
          .order("executed_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        const firstTrade = firstTradeResult?.data as { executed_at: string } | null;

        if (!firstTrade) {
          setData(null);
          setLoading(false);
          return;
        }

        /**
         * 2. Wallet value NOW (EUR)
         */
        const walletRes = await supabase.functions.invoke("execution-wallet-balance", {
          body: { user_id: userId }
        });

        const walletTotalEur = walletRes.data?.total_value_eur ?? 0;

        /**
         * 3. ETH price at first trade time
         */
        const ethPriceAtStartResult = await supabase
          .from("price_snapshots")
          .select("price")
          .eq("symbol", "ETH-EUR")
          .lte("ts", firstTrade.executed_at)
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle();

        const ethPriceAtStart = ethPriceAtStartResult.data as { price: number } | null;

        /**
         * 4. Wallet balance at start (ETH-based)
         *    We approximate by reversing from current balance minus net trade flows
         *    (acceptable for v1; exact historical balance comes later)
         */
        const initialFundedEur =
          (walletRes.data?.eth_balance ?? 0) * (ethPriceAtStart?.price ?? 0);

        /**
         * 5. Gas paid - query gas_cost_eur directly
         */
        const gasRowsResult = await supabase
          .from("mock_trades")
          .select("gas_cost_eur")
          .eq("user_id", userId)
          .eq("is_test_mode", false)
          .eq("execution_confirmed", true);

        const gasRows = (gasRowsResult?.data ?? []) as unknown as Array<{ gas_cost_eur: number | null }>;

        const gasPaidEur = gasRows.reduce((sum, r) => sum + (r.gas_cost_eur ?? 0), 0);

        /**
         * 6. Trade count
         */
        const tradeCount = gasRows.length;

        setData({
          walletTotalEur,
          initialFundedEur,
          gasPaidEur,
          tradeCount
        });
      } catch (err) {
        console.error("[WalletPerformanceDashboard] Error:", err);
        setData(null);
      }

      setLoading(false);
    };

    load();
  }, [userId]);

  if (loading) return <p>Loading wallet performance…</p>;
  if (!data) return <p>No real trades yet.</p>;

  const netPnl = data.walletTotalEur - data.initialFundedEur - data.gasPaidEur;
  const perfPct =
    data.initialFundedEur > 0
      ? (netPnl / data.initialFundedEur) * 100
      : 0;

  return (
    <div className="p-4 border rounded-lg bg-card">
      <h3 className="font-semibold mb-2">Wallet Performance (Real)</h3>

      <p>Initial Value: €{data.initialFundedEur.toFixed(2)}</p>
      <p>Current Wallet: €{data.walletTotalEur.toFixed(2)}</p>
      <p>Gas Paid: €{data.gasPaidEur.toFixed(2)}</p>
      <p>Trades Executed: {data.tradeCount}</p>

      <p className={netPnl >= 0 ? "text-green-600" : "text-red-600"}>
        Net P&L: €{netPnl.toFixed(2)} ({perfPct.toFixed(2)}%)
      </p>
    </div>
  );
}
