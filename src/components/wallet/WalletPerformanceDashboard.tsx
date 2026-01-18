import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Data = {
  walletTotalEur: number;
  initialValueEur: number;
  gasPaidEur: number;
  tradeCount: number;
};

export default function WalletPerformanceDashboard({ userId }: { userId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    const run = async () => {
      setLoading(true);

      // 1. First confirmed real trade → defines tracking start
      const firstTradeResult = await (supabase
        .from("mock_trades" as any)
        .select("executed_at")
        .eq("user_id", userId)
        .eq("is_test_mode", false)
        .eq("execution_confirmed", true)
        .order("executed_at", { ascending: true })
        .limit(1)
        .maybeSingle() as unknown as Promise<{ data: { executed_at: string } | null }>);

      const firstTrade = firstTradeResult?.data;

      if (!firstTrade) {
        setData(null);
        setLoading(false);
        return;
      }

      // 2. Current wallet value
      const walletRes = await supabase.functions.invoke(
        "execution-wallet-balance",
        { body: { user_id: userId } }
      );

      const walletTotalEur = walletRes.data?.total_value_eur ?? 0;

      // 3. Initial value = wallet balance at first trade time
      //    Use funded amount converted with ETH price at that moment
      const walletResult = await (supabase
        .from("execution_wallets" as any)
        .select("funded_amount_wei, funded_at")
        .eq("user_id", userId)
        .single() as unknown as Promise<{ data: { funded_amount_wei: string | null; funded_at: string | null } | null }>);

      const wallet = walletResult?.data;

      const { data: ethPrice } = await supabase
        .from("price_snapshots")
        .select("price")
        .eq("symbol", "ETH-EUR")
        .lte("ts", firstTrade.executed_at)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      const initialValueEur =
        (Number(wallet?.funded_amount_wei ?? 0) / 1e18) *
        (ethPrice?.price ?? 0);

      // 4. Gas + trade count (real only)
      const tradesResult = await (supabase
        .from("mock_trades" as any)
        .select("gas_cost_eur")
        .eq("user_id", userId)
        .eq("is_test_mode", false)
        .eq("execution_confirmed", true) as unknown as Promise<{ data: { gas_cost_eur: number | null }[] | null }>);

      const trades = tradesResult?.data ?? [];

      const gasPaidEur = trades.reduce((s, t) => s + (t.gas_cost_eur ?? 0), 0);

      setData({
        walletTotalEur,
        initialValueEur,
        gasPaidEur,
        tradeCount: trades.length,
      });

      setLoading(false);
    };

    run();
  }, [userId]);

  if (loading) return <p className="text-muted-foreground">Loading wallet performance…</p>;
  if (!data) return <p className="text-muted-foreground">No real trades yet.</p>;

  const netPnl = data.walletTotalEur - data.initialValueEur - data.gasPaidEur;
  const pct =
    data.initialValueEur > 0
      ? (netPnl / data.initialValueEur) * 100
      : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <h3 className="font-semibold text-card-foreground">Wallet Performance (Real)</h3>

      <p className="text-muted-foreground">Initial Value: €{data.initialValueEur.toFixed(2)}</p>
      <p className="text-muted-foreground">Current Wallet: €{data.walletTotalEur.toFixed(2)}</p>
      <p className="text-muted-foreground">Gas Paid: €{data.gasPaidEur.toFixed(2)}</p>
      <p className="text-muted-foreground">Trades Executed: {data.tradeCount}</p>

      <p className={netPnl >= 0 ? "text-green-400" : "text-red-400"}>
        Net P&L: €{netPnl.toFixed(2)} ({pct.toFixed(2)}%)
      </p>
    </div>
  );
}
