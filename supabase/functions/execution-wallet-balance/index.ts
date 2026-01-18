// supabase/functions/execution-wallet-balance/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

serve(async (req) => {
  try {
    const { user_id } = await req.json();
    if (!user_id) {
      return new Response("Missing user_id", { status: 400 });
    }

    // 1. Get execution wallet
    const { data: wallet, error: walletErr } = await supabase
      .from("execution_wallets")
      .select("wallet_address")
      .eq("user_id", user_id)
      .single();

    if (walletErr || !wallet) {
      return new Response("Wallet not found", { status: 404 });
    }

    // 2. Fetch on-chain balances (ETH + ERC20 already normalized elsewhere)
    const { data: balances, error: balErr } = await supabase
      .rpc("get_execution_wallet_balances", {
        p_wallet_address: wallet.wallet_address,
      });

    if (balErr) throw balErr;

    // balances: [{ symbol: "ETH", amount: number }]
    const symbols = balances.map((b: any) => `${b.symbol}-EUR`);

    // 3. Latest EUR prices from price_snapshots
    const { data: prices } = await supabase
      .from("price_snapshots")
      .select("symbol, price")
      .in("symbol", symbols)
      .order("ts", { ascending: false });

    const priceMap = new Map<string, number>();
    for (const p of prices ?? []) {
      if (!priceMap.has(p.symbol)) {
        priceMap.set(p.symbol, p.price);
      }
    }

    // 4. Compute total EUR value
    let totalValueEur = 0;
    const detailed = balances.map((b: any) => {
      const price = priceMap.get(`${b.symbol}-EUR`) ?? 0;
      const valueEur = b.amount * price;
      totalValueEur += valueEur;
      return { ...b, price_eur: price, value_eur: valueEur };
    });

    return new Response(
      JSON.stringify({
        total_value_eur: totalValueEur,
        balances: detailed,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[execution-wallet-balance]", err);
    return new Response("Internal error", { status: 500 });
  }
});
