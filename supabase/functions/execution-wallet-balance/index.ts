/**
 * execution-wallet-balance Edge Function
 * 
 * PART 1: LIVE ON-CHAIN BALANCE (NON-NEGOTIABLE)
 * 
 * This function queries LIVE blockchain state directly via RPC.
 * - NO snapshots
 * - NO cached values
 * - NO database balance
 * - NO fallback to wallet_balance_snapshots
 * 
 * Returns actual on-chain holdings for:
 * - ETH (native)
 * - WETH (ERC-20)
 * - USDC (ERC-20)
 * 
 * Prices are fetched from price_snapshots (READ-ONLY) for EUR conversion.
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// CONSTANTS
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Base chain RPC - use environment variable or fallback
const BASE_RPC_URL = Deno.env.get("RPC_URL_8453") || "https://base.llamarpc.com";
const BASE_CHAIN_ID = 8453;

// Token addresses on Base
const TOKENS = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

// Token decimals
const DECIMALS = {
  ETH: 18,
  WETH: 18,
  USDC: 6,
} as const;

// ERC-20 balanceOf selector
const BALANCE_OF_SELECTOR = "0x70a08231";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// ============================================================================
// RPC HELPERS
// ============================================================================

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: 1,
    }),
  });

  const json = await response.json();
  if (json.error) {
    throw new Error(`RPC error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
}

/**
 * Get native ETH balance for address
 */
async function getEthBalance(address: string): Promise<bigint> {
  const result = await rpcCall("eth_getBalance", [address, "latest"]);
  return BigInt(result as string);
}

/**
 * Get ERC-20 token balance for address
 */
async function getErc20Balance(tokenAddress: string, walletAddress: string): Promise<bigint> {
  // Encode balanceOf(address) call
  const paddedAddress = walletAddress.slice(2).padStart(64, "0");
  const data = BALANCE_OF_SELECTOR + paddedAddress;

  const result = await rpcCall("eth_call", [
    { to: tokenAddress, data },
    "latest",
  ]);

  // Handle empty response (contract doesn't exist or no balance)
  if (!result || result === "0x" || result === "0x0") {
    return 0n;
  }

  return BigInt(result as string);
}

/**
 * Convert wei/atomic units to human-readable number
 */
function atomicToNumber(atomic: bigint, decimals: number): number {
  const divisor = 10n ** BigInt(decimals);
  const intPart = atomic / divisor;
  const fracPart = atomic % divisor;
  
  // Convert to number with precision
  const fracStr = fracPart.toString().padStart(decimals, "0");
  return parseFloat(`${intPart}.${fracStr}`);
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  const startTime = Date.now();

  try {
    // ---- JWT AUTH ONLY ----
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supabase.auth.getUser(jwt);

    if (authErr || !userData?.user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;

    // ---- WALLET LOOKUP ----
    const { data: wallet, error: walletErr } = await supabase
      .from("execution_wallets")
      .select("wallet_address")
      .eq("user_id", userId)
      .single();

    if (walletErr || !wallet?.wallet_address) {
      console.log(`[execution-wallet-balance] No wallet for user ${userId}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "No wallet found",
          // Return valid empty structure so UI doesn't break
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
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const walletAddress = wallet.wallet_address;
    console.log(`[execution-wallet-balance] Fetching LIVE on-chain balances for ${walletAddress}`);

    // ---- FETCH LIVE ON-CHAIN BALANCES ----
    const [ethBalanceWei, wethBalanceWei, usdcBalanceRaw] = await Promise.all([
      getEthBalance(walletAddress),
      getErc20Balance(TOKENS.WETH, walletAddress),
      getErc20Balance(TOKENS.USDC, walletAddress),
    ]);

    const ethAmount = atomicToNumber(ethBalanceWei, DECIMALS.ETH);
    const wethAmount = atomicToNumber(wethBalanceWei, DECIMALS.WETH);
    const usdcAmount = atomicToNumber(usdcBalanceRaw, DECIMALS.USDC);

    console.log(`[execution-wallet-balance] Raw balances - ETH: ${ethAmount}, WETH: ${wethAmount}, USDC: ${usdcAmount}`);

    // ---- FETCH PRICES (READ-ONLY from price_snapshots) ----
    const { data: prices } = await supabase
      .from("price_snapshots")
      .select("symbol, price")
      .in("symbol", ["ETH-EUR", "ETH"])
      .order("ts", { ascending: false })
      .limit(2);

    // Get ETH price (try ETH-EUR first, then ETH)
    let ethPriceEur = 0;
    if (prices && prices.length > 0) {
      const ethEurPrice = prices.find((p) => p.symbol === "ETH-EUR");
      const ethPrice = prices.find((p) => p.symbol === "ETH");
      ethPriceEur = ethEurPrice?.price ?? ethPrice?.price ?? 0;
    }

    // Approximate USD price (EUR to USD ~1.08)
    const eurToUsd = 1.08;
    const ethPriceUsd = ethPriceEur * eurToUsd;
    const usdcPriceEur = 1 / eurToUsd; // ~0.926 EUR per USDC

    // ---- CALCULATE VALUES ----
    const ethValueEur = ethAmount * ethPriceEur;
    const ethValueUsd = ethAmount * ethPriceUsd;
    
    const wethValueEur = wethAmount * ethPriceEur;
    const wethValueUsd = wethAmount * ethPriceUsd;
    
    const usdcValueEur = usdcAmount * usdcPriceEur;
    const usdcValueUsd = usdcAmount; // USDC is 1:1 USD

    const totalValueEur = ethValueEur + wethValueEur + usdcValueEur;
    const totalValueUsd = ethValueUsd + wethValueUsd + usdcValueUsd;

    const isFunded = totalValueUsd > 0.01; // More than 1 cent

    const elapsed = Date.now() - startTime;
    console.log(`[execution-wallet-balance] Complete in ${elapsed}ms - Total: $${totalValueUsd.toFixed(2)}`);

    return new Response(
      JSON.stringify({
        success: true,
        address: walletAddress,
        chain_id: BASE_CHAIN_ID,
        balances: {
          ETH: {
            symbol: "ETH",
            amount: ethAmount,
            amount_wei: ethBalanceWei.toString(),
            value_usd: ethValueUsd,
            value_eur: ethValueEur,
            price_usd: ethPriceUsd,
          },
          WETH: {
            symbol: "WETH",
            amount: wethAmount,
            amount_wei: wethBalanceWei.toString(),
            value_usd: wethValueUsd,
            value_eur: wethValueEur,
            price_usd: ethPriceUsd,
          },
          USDC: {
            symbol: "USDC",
            amount: usdcAmount,
            amount_raw: usdcBalanceRaw.toString(),
            value_usd: usdcValueUsd,
            value_eur: usdcValueEur,
            price_usd: 1,
          },
        },
        total_value_usd: totalValueUsd,
        total_value_eur: totalValueEur,
        is_funded: isFunded,
        fetched_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[execution-wallet-balance] Error:", err);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: err instanceof Error ? err.message : "Internal error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
