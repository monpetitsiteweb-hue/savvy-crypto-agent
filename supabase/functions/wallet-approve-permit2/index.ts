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
// 0x Exchange Proxy (spender that needs Permit2 internal allowance)
const OX_PROXY = "0xDef1C0ded9bec7F1a1670819833240f027b25EfF";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";

const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
const HALF_MAX = MAX_UINT256 / 2n;

// Permit2 internal allowance is uint160
const MAX_UINT160 = BigInt("0xffffffffffffffffffffffffffffffffffffffff");
const HALF_MAX_UINT160 = MAX_UINT160 / 2n;
// Permit2 internal expiration is uint48
const MAX_UINT48 = BigInt("0xffffffffffff");

// ERC20 approve(address,uint256) selector
const APPROVE_SELECTOR = "0x095ea7b3";
// ERC20 allowance(address,address) selector  
const ALLOWANCE_SELECTOR = "0xdd62ed3e";

// Permit2.allowance(address owner, address token, address spender)
// returns (uint160 amount, uint48 expiration, uint48 nonce)
const PERMIT2_ALLOWANCE_SELECTOR = "0x927da105";
// Permit2.approve(address token, address spender, uint160 amount, uint48 expiration)
const PERMIT2_APPROVE_SELECTOR = "0x87517c45";

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

async function getPermit2InternalAllowance(owner: string, token: string, spender: string): Promise<bigint> {
  const ownerPadded = owner.slice(2).toLowerCase().padStart(64, "0");
  const tokenPadded = token.slice(2).toLowerCase().padStart(64, "0");
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, "0");
  const calldata = `${PERMIT2_ALLOWANCE_SELECTOR}${ownerPadded}${tokenPadded}${spenderPadded}`;

  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: PERMIT2, data: calldata }, "latest"],
    }),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`RPC error checking Permit2 internal allowance: ${data.error.message}`);
  }

  // If the call returns nothing, treat as 0
  const result: string | undefined = data.result;
  if (!result || typeof result !== "string" || result === "0x") return 0n;

  // First 32 bytes contain amount (uint160 right-padded in ABI word)
  // result is hex string with 0x prefix
  const word0 = result.slice(2, 66);
  if (!word0 || word0.length !== 64) return 0n;
  return BigInt(`0x${word0}`);
}

function encodeApprove(spender: string, amount: bigint): string {
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, "0");
  const amountHex = amount.toString(16).padStart(64, "0");
  return `${APPROVE_SELECTOR}${spenderPadded}${amountHex}`;
}

function encodePermit2Approve(token: string, spender: string, amount: bigint, expiration: bigint): string {
  const tokenPadded = token.slice(2).toLowerCase().padStart(64, "0");
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, "0");
  const amountHex = amount.toString(16).padStart(64, "0");
  const expirationHex = expiration.toString(16).padStart(64, "0");
  return `${PERMIT2_APPROVE_SELECTOR}${tokenPadded}${spenderPadded}${amountHex}${expirationHex}`;
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

    // Get signer once (used for any tx we end up sending)
    const signer = getSigner();
    const signerAddress = signer.getAddress();
    console.log("SIGNER_DERIVED_ADDRESS", signerAddress);
    logger.info("wallet-approve-permit2.signer_type", { type: signer.type, signerAddress });

    // =====================================================================
    // STEP 1: ERC20 approval (token -> Permit2)
    // =====================================================================
    const currentAllowance = await getCurrentAllowance(tokenAddress, walletAddress, PERMIT2);
    logger.info("wallet-approve-permit2.current_allowance", {
      token: tokenUpper,
      allowance: currentAllowance.toString(),
      threshold: HALF_MAX.toString(),
    });

    let erc20TxHash: string | null = null;
    const erc20AlreadyApproved = currentAllowance >= HALF_MAX;

    if (!erc20AlreadyApproved) {
      // Build approve transaction
      const approveData = encodeApprove(PERMIT2, MAX_UINT256);

      const txPayload: TxPayload = {
        to: tokenAddress,
        data: approveData,
        value: "0",
        gas: "100000", // ERC20 approve typically uses ~50k gas
        from: walletAddress,
      };

      logger.info("wallet-approve-permit2.building_erc20_tx", {
        to: tokenAddress,
        spender: PERMIT2,
        token: tokenUpper,
      });

      const signedTx = await signer.sign(txPayload, CHAIN_ID);
      logger.info("wallet-approve-permit2.erc20_tx_signed", {});

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
        logger.error("wallet-approve-permit2.erc20_broadcast_error", { error: sendData.error });
        return jsonError(500, `ERC20 approval broadcast failed: ${sendData.error.message}`);
      }

      erc20TxHash = sendData.result;
      logger.info("wallet-approve-permit2.erc20_approved", {
        tx_hash: erc20TxHash,
        token: tokenUpper,
        spender: PERMIT2,
      });
    } else {
      logger.info("wallet-approve-permit2.erc20_already_approved", { token: tokenUpper });
    }

    // =====================================================================
    // STEP 2: Permit2 internal allowance (Permit2 -> 0x Exchange Proxy)
    // =====================================================================
    logger.info("wallet-approve-permit2.checking_permit2_internal", {
      token: tokenUpper,
      spender: OX_PROXY,
    });

    const permit2InternalAllowance = await getPermit2InternalAllowance(walletAddress, tokenAddress, OX_PROXY);
    logger.info("wallet-approve-permit2.permit2_internal_allowance", {
      token: tokenUpper,
      allowance: permit2InternalAllowance.toString(),
      threshold: HALF_MAX_UINT160.toString(),
    });

    let permit2TxHash: string | null = null;
    const permit2AlreadyApproved = permit2InternalAllowance >= HALF_MAX_UINT160;

    if (!permit2AlreadyApproved) {
      logger.info("wallet-approve-permit2.building_permit2_internal_tx", {
        token: tokenUpper,
        spender: OX_PROXY,
      });

      const permit2ApproveData = encodePermit2Approve(tokenAddress, OX_PROXY, MAX_UINT160, MAX_UINT48);

      const permit2TxPayload: TxPayload = {
        to: PERMIT2,
        data: permit2ApproveData,
        value: "0",
        gas: "80000",
        from: walletAddress,
      };

      const signedPermit2Tx = await signer.sign(permit2TxPayload, CHAIN_ID);
      logger.info("wallet-approve-permit2.permit2_internal_tx_signed", {});

      const sendRes = await fetch(BASE_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_sendRawTransaction",
          params: [signedPermit2Tx],
        }),
      });

      const sendData = await sendRes.json();
      if (sendData.error) {
        logger.error("wallet-approve-permit2.permit2_internal_broadcast_error", { error: sendData.error });
        return jsonError(500, `Permit2 internal approval broadcast failed: ${sendData.error.message}`);
      }

      permit2TxHash = sendData.result;
      logger.info("wallet-approve-permit2.permit2_internal_approved", {
        tx_hash: permit2TxHash,
        token: tokenUpper,
        spender: OX_PROXY,
      });
    } else {
      logger.info("wallet-approve-permit2.permit2_internal_already_approved", { token: tokenUpper });
    }

    const fullyApproved = erc20AlreadyApproved && permit2AlreadyApproved;

    return jsonResponse({
      ok: true,
      status: fullyApproved ? "already_approved" : "approved",
      token: tokenUpper,
      permit2_contract: PERMIT2,
      spender: OX_PROXY,
      erc20_tx_hash: erc20TxHash,
      permit2_tx_hash: permit2TxHash,
      message: fullyApproved
        ? `${tokenUpper} already fully approved (ERC20->Permit2 and Permit2->0x).`
        : `${tokenUpper} fully approved: ERC20->Permit2 and Permit2->0x.`,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("wallet-approve-permit2.unexpected_error", { error: message });
    return jsonError(500, message);
  }
});
