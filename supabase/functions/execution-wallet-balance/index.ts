// supabase/functions/execution-wallet-balance/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7?target=deno";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!; // MUST be set in function env

// Base chain RPC
const BASE_RPC_URL = Deno.env.get("RPC_URL_8453") || "https://base.llamarpc.com";
const BASE_CHAIN_ID = 8453;

// Token addresses on Base
const TOKENS = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

const DECIMALS = {
  ETH: 18,
  WETH: 18,
  USDC: 6,
} as const;

// ERC-20 balanceOf(address)
const BALANCE_OF_SELECTOR = "0x70a08231";

// Keep permissive CORS to avoid preflight headaches
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });

  // If RPC is down or returns non-JSON, surface a clear error
  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`RPC non-JSON response (${response.status}): ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  if (json?.error) {
    throw new Error(`RPC error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
}

async function getEthBalance(address: string): Promise<bigint> {
  const result = await rpcCall("eth_getBalance", [address, "latest"]);
  return BigInt(result as string);
}

async function getErc20Balance(tokenAddress: string, walletAddress: string): Promise<bigint> {
  const paddedAddress = walletAddress.slice(2).padStart(64, "0");
  const data = BALANCE_OF_SELECTOR + paddedAddress;

  const result = await rpcCall("eth_call", [{ to: tokenAddress, data }, "latest"]);

  if (!result || result === "0x" || result === "0x0") return 0n;
  return BigInt(result as string);
}

// Keep compatibility with current UI numbers.
// This is not perfect for huge values, but OK for wallet balances.
function atomicToNumber(atomic: bigint, decimals: number): number {
  const divisor = 10n ** BigInt(decimals);
  const intPart = atomic / divisor;
  const fracPart = atomic % divisor;
  const fracStr = fracPart.toString().padStart(decimals, "0");
  return Number(`${intPart}.${fracStr}`);
}

serve(async (req) => {
  const t0 = Date.now();

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      return jsonResponse(
        { success: false, error: "Missing Supabase env (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY)" },
        500,
      );
    }

    // ---- JWT AUTH ONLY (NO req.json()) ----
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      // Keep behavior predictable: return 401
      return jsonResponse({ success: false, error: "Missing Authorization header" }, 401);
    }
    const jwt = authHeader.slice("Bearer ".length);

    // Use anon client ONLY for auth verification
    const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { data: userData, error: authErr } = await supabaseAnon.auth.getUser(jwt);
    if (authErr || !userData?.user) {
      return jsonResponse({ success: false, error: "Invalid token" }, 401);
    }
    const userId = userData.user.id;

    // Use admin client ONLY for DB reads
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ---- WALLET LOOKUP ----
    const { data: wallet, error: walletErr } = await supabaseAdmin
      .from("execution_wallets")
      .select("wallet_address, funded_at")
      .eq("user_id", userId)
      .single();

    if (walletErr || !wallet?.wallet_address) {
      // Must not break UI: return same empty structure as before
      const elapsedMs = Date.now() - t0;
      console.log("[execution-wallet-balance]", {
        userId,
        walletAddress: null,
        elapsedMs,
        rpcHost: new URL(BASE_RPC_URL).host,
        note: "no_wallet",
      });

      return jsonResponse({
        success: true,
        address: null,
        chain_id: BASE_CHAIN_ID,
        balances: {
          ETH: { symbol: "ETH", amount: 0, amount_wei: "0", value_usd: 0, value_eur: 0, price_usd: 0 },
          WETH: { symbol: "WETH", amount: 0, amount_wei: "0", value_usd: 0, value_eur: 0, price_usd: 0 },
          USDC: { symbol: "USDC", amount: 0, amount_raw: "0", value_usd: 0, value_eur: 0, price_usd: 1 },
        },
        total_value_usd: 0,
        total_value_eur: 0,
        is_funded: false,
        fetched_at: new Date().toISOString(),
      });
    }

    const walletAddress = wallet.wallet_address;

    // ---- LIVE ON-CHAIN BALANCES ----
    const [ethWei, wethWei, usdcRaw] = await Promise.all([
      getEthBalance(walletAddress),
      getErc20Balance(TOKENS.WETH, walletAddress),
      getErc20Balance(TOKENS.USDC, walletAddress),
    ]);

    // ---- SYNC is_funded FROM LIVE BALANCE (fixes direct deposit case) ----
    // Threshold: 0.001 ETH = 1e15 wei (enough for gas)
    const MIN_GAS_THRESHOLD = BigInt("1000000000000000");
    const liveIsFunded = ethWei >= MIN_GAS_THRESHOLD;

    // Update execution_wallets.is_funded to match live state
    const { error: syncError } = await supabaseAdmin
      .from("execution_wallets")
      .update({
        is_funded: liveIsFunded,
        ...(liveIsFunded && !wallet.funded_at ? { funded_at: new Date().toISOString() } : {}),
        ...(liveIsFunded ? { funded_amount_wei: ethWei.toString() } : {}),
      })
      .eq("user_id", userId);

    if (syncError) {
      console.warn("[execution-wallet-balance] Failed to sync is_funded:", syncError.message);
    } else {
      console.log("[execution-wallet-balance] Synced is_funded:", { liveIsFunded, ethWei: ethWei.toString() });
    }

    const ethAmount = atomicToNumber(ethWei, DECIMALS.ETH);
    const wethAmount = atomicToNumber(wethWei, DECIMALS.WETH);
    const usdcAmount = atomicToNumber(usdcRaw, DECIMALS.USDC);

    // ---- PRICES (same behavior as before to avoid breaking UI) ----
    const { data: prices } = await supabaseAdmin
      .from("price_snapshots")
      .select("symbol, price")
      .in("symbol", ["ETH-EUR", "ETH"])
      .order("ts", { ascending: false })
      .limit(5);

    let ethPriceEur = 0;
    if (prices?.length) {
      const ethEur = prices.find((p) => p.symbol === "ETH-EUR");
      const eth = prices.find((p) => p.symbol === "ETH");
      ethPriceEur = (ethEur?.price ?? eth?.price ?? 0) as number;
    }

    // Keep existing USD approximation to avoid changing current UI behavior.
    const eurToUsd = 1.08;
    const ethPriceUsd = ethPriceEur * eurToUsd;
    const usdcPriceEur = 1 / eurToUsd;

    const ethValueEur = ethAmount * ethPriceEur;
    const ethValueUsd = ethAmount * ethPriceUsd;

    const wethValueEur = wethAmount * ethPriceEur;
    const wethValueUsd = wethAmount * ethPriceUsd;

    const usdcValueEur = usdcAmount * usdcPriceEur;
    const usdcValueUsd = usdcAmount;

    const totalValueEur = ethValueEur + wethValueEur + usdcValueEur;
    const totalValueUsd = ethValueUsd + wethValueUsd + usdcValueUsd;

    const isFunded = totalValueUsd > 0.01;

    const elapsedMs = Date.now() - t0;
    console.log("[execution-wallet-balance]", {
      userId,
      walletAddress,
      elapsedMs,
      rpcHost: new URL(BASE_RPC_URL).host,
      ethWei: ethWei.toString(),
      wethWei: wethWei.toString(),
      usdcRaw: usdcRaw.toString(),
      total_value_eur: totalValueEur,
    });

    return jsonResponse({
      success: true,
      address: walletAddress,
      chain_id: BASE_CHAIN_ID,
      balances: {
        ETH: {
          symbol: "ETH",
          amount: ethAmount,
          amount_wei: ethWei.toString(),
          value_usd: ethValueUsd,
          value_eur: ethValueEur,
          price_usd: ethPriceUsd,
        },
        WETH: {
          symbol: "WETH",
          amount: wethAmount,
          amount_wei: wethWei.toString(),
          value_usd: wethValueUsd,
          value_eur: wethValueEur,
          price_usd: ethPriceUsd,
        },
        USDC: {
          symbol: "USDC",
          amount: usdcAmount,
          amount_raw: usdcRaw.toString(),
          value_usd: usdcValueUsd,
          value_eur: usdcValueEur,
          price_usd: 1,
        },
      },
      total_value_usd: totalValueUsd,
      total_value_eur: totalValueEur,
      is_funded: isFunded,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[execution-wallet-balance] Error:", err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
