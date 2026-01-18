import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

serve(async (req) => {
  const { user_id } = await req.json();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  /**
   * 1. Fetch wallet address
   */
  const { data: wallet } = await supabase
    .from("execution_wallets")
    .select("wallet_address")
    .eq("user_id", user_id)
    .maybeSingle();

  if (!wallet?.wallet_address) {
    return new Response(JSON.stringify({ total_value_eur: 0 }), { status: 200 });
  }

  /**
   * 2. On-chain balances (ETH only for v1)
   */
  const ethBalanceWei = await fetch(
    `${Deno.env.get("BASE_RPC_URL")}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getBalance",
        params: [wallet.wallet_address, "latest"],
        id: 1
      })
    }
  ).then((r) => r.json());

  const ethBalance =
    parseInt(ethBalanceWei.result, 16) / 1e18;

  /**
   * 3. ETH/EUR price from price_snapshots ONLY
   */
  const { data: ethPrice } = await supabase
    .from("price_snapshots")
    .select("price")
    .eq("symbol", "ETH-EUR")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  const totalValueEur = ethBalance * (ethPrice?.price ?? 0);

  return new Response(
    JSON.stringify({
      eth_balance: ethBalance,
      total_value_eur: totalValueEur
    }),
    { status: 200 }
  );
});
