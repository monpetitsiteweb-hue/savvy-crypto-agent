/**
 * wallet-approve-permit2
 * 
 * One-time server-side ERC20 approval to Permit2 for system-custodied wallets.
 * This unblocks Permit2-based swaps without exposing private keys.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import { corsHeaders } from "../_shared/cors.ts";
import { getSigner, TxPayload } from "../_shared/signer.ts";
import { logger } from "../_shared/logger.ts";

const CHAIN_ID = 8453; // Base
const BASE_RPC = Deno.env.get("RPC_URL_8453") || "https://mainnet.base.org";

// Hard-coded contract addresses (Base chain) - NO arbitrary tokens allowed
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";

const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
const HALF_MAX = MAX_UINT256 / 2n;

// ERC20 approve(address,uint256) selector
const APPROVE_SELECTOR = "0x095ea7b3";
// ERC20 allowance(address,address) selector  
const ALLOWANCE_SELECTOR = "0xdd62ed3e";

const ALLOWED_TOKENS: Record<string, string> = {
  "USDC": USDC_BASE,
  "WETH": WETH_BASE,
};

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(status: number, message: string) {
  logger.error("wallet-approve-permit2.error", { status, message });
  return jsonResponse({ ok: false, error: message }, status);
}

async function getCurrentAllowance(token: string, owner: string, spender: string): Promise<bigint> {
  const ownerPadded = owner.slice(2).toLowerCase().padStart(64, "0");
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, "0");
  const calldata = `${ALLOWANCE_SELECTOR}${ownerPadded}${spenderPadded}`;

  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: token, data: calldata }, "latest"],
    }),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`RPC error checking allowance: ${data.error.message}`);
  }
  return BigInt(data.result || "0x0");
}

function encodeApprove(spender: string, amount: bigint): string {
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, "0");
  const amountHex = amount.toString(16).padStart(64, "0");
  return `${APPROVE_SELECTOR}${spenderPadded}${amountHex}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonError(405, "Method not allowed");
  }

  try {
    logger.info("wallet-approve-permit2.start", {});

    // Parse and validate input
    const body = await req.json();
    const { wallet_id, token } = body;

    if (!wallet_id || typeof wallet_id !== "string") {
      return jsonError(400, "wallet_id is required");
    }

    if (!token || typeof token !== "string") {
      return jsonError(400, "token is required (USDC or WETH)");
    }

    const tokenUpper = token.toUpperCase();
    const tokenAddress = ALLOWED_TOKENS[tokenUpper];
    if (!tokenAddress) {
      return jsonError(400, "Invalid token. Only USDC or WETH allowed.");
    }

    logger.info("wallet-approve-permit2.params", { wallet_id, token: tokenUpper });

    // Initialize Supabase admin client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Fetch wallet
    const { data: wallet, error: walletError } = await supabase
      .from("execution_wallets")
      .select("id, wallet_address, is_active, chain_id")
      .eq("id", wallet_id)
      .maybeSingle();

    if (walletError) {
      logger.error("wallet-approve-permit2.wallet_fetch_error", { error: walletError.message });
      return jsonError(500, "Failed to fetch wallet");
    }

    if (!wallet) {
      return jsonError(404, "Wallet not found");
    }

    if (!wallet.is_active) {
      return jsonError(400, "Wallet is not active");
    }

    if (wallet.chain_id !== CHAIN_ID) {
      return jsonError(400, `Wallet chain_id mismatch. Expected ${CHAIN_ID}, got ${wallet.chain_id}`);
    }

    const walletAddress = wallet.wallet_address;
    logger.info("wallet-approve-permit2.wallet_found", { wallet_address: walletAddress });

    // Check existing allowance
    const currentAllowance = await getCurrentAllowance(tokenAddress, walletAddress, PERMIT2);
    logger.info("wallet-approve-permit2.current_allowance", {
      token: tokenUpper,
      allowance: currentAllowance.toString(),
      threshold: HALF_MAX.toString(),
    });

    if (currentAllowance >= HALF_MAX) {
      logger.info("wallet-approve-permit2.already_approved", { token: tokenUpper });
      return jsonResponse({
        ok: true,
        status: "already_approved",
        token: tokenUpper,
        allowance: currentAllowance.toString(),
        message: `${tokenUpper} already approved to Permit2`,
      });
    }

    // Build approve transaction
    const approveData = encodeApprove(PERMIT2, MAX_UINT256);

    const txPayload: TxPayload = {
      to: tokenAddress,
      data: approveData,
      value: "0",
      gas: "100000", // ERC20 approve typically uses ~50k gas
      from: walletAddress,
    };

    logger.info("wallet-approve-permit2.building_tx", {
      to: tokenAddress,
      spender: PERMIT2,
      token: tokenUpper,
    });

    // Get signer and sign transaction
    const signer = getSigner();
    logger.info("wallet-approve-permit2.signer_type", { type: signer.type });

    const signedTx = await signer.sign(txPayload, CHAIN_ID);
    logger.info("wallet-approve-permit2.tx_signed", {});

    // Broadcast transaction
    const sendRes = await fetch(BASE_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [signedTx],
      }),
    });

    const sendData = await sendRes.json();
    if (sendData.error) {
      logger.error("wallet-approve-permit2.broadcast_error", { error: sendData.error });
      return jsonError(500, `Broadcast failed: ${sendData.error.message}`);
    }

    const txHash = sendData.result;
    logger.info("wallet-approve-permit2.success", {
      tx_hash: txHash,
      token: tokenUpper,
      spender: PERMIT2,
    });

    return jsonResponse({
      ok: true,
      status: "approved",
      tx_hash: txHash,
      token: tokenUpper,
      spender: PERMIT2,
      message: `${tokenUpper} approved to Permit2. BUY trades will now skip Permit2 signing.`,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("wallet-approve-permit2.unexpected_error", { error: message });
    return jsonError(500, message);
  }
});
