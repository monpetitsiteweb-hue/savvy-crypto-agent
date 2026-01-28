/**
 * execution-wallet-withdraw-old
 *
 * TEMPORARY RECOVERY FUNCTION for LEGACY wallets.
 * 
 * Identical to execution-wallet-withdraw EXCEPT:
 * - Reads from execution_wallets_old (not execution_wallets)
 * - Reads from execution_wallet_secrets_old (not execution_wallet_secrets)
 *
 * This function will be DELETED after the recovery drill.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import { decryptPrivateKey } from "../_shared/envelope-encryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const BASE_RPC = "https://mainnet.base.org";
const RATE_LIMIT_MS = 60_000;

const TOKENS: Record<string, { address: string; decimals: number }> = {
  ETH: { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
};

const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function logStep(step: string, data: Record<string, unknown> = {}) {
  try {
    console.log("[execution-wallet-withdraw-old]", JSON.stringify({ step, ...data }));
  } catch {
    console.log("[execution-wallet-withdraw-old]", step);
  }
}

function jsonError(status: number, message: string, meta: Record<string, unknown> = {}) {
  logStep("error", { status, message, ...meta });
  return new Response(JSON.stringify({ success: false, error: message, ...meta }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonSuccess(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ success: true, ...data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/**
 * Convert base64 string to Uint8Array (for DB → crypto boundary)
 */
function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(b64.length / 4) * 4, "=");
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    logStep("request_received");

    // 1) Validate auth header
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) return jsonError(401, "Missing authorization header");

    // 2) Parse + validate body
    let body: { wallet_id?: string; asset?: string; to_address?: string; amount?: number };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const { wallet_id, asset, to_address, amount } = body;
    logStep("request_payload", { wallet_id, asset, to_address, amount });

    if (!wallet_id || typeof wallet_id !== "string") return jsonError(400, "Missing or invalid wallet_id");
    if (!asset || typeof asset !== "string") return jsonError(400, "Missing or invalid asset");
    if (!["ETH", "WETH", "USDC"].includes(asset)) return jsonError(400, "Invalid asset. Must be ETH, WETH, or USDC");

    if (!to_address || typeof to_address !== "string") return jsonError(400, "Missing destination address");
    if (!/^0x[a-fA-F0-9]{40}$/.test(to_address)) return jsonError(400, "Invalid destination address format");

    if (amount === undefined || amount === null || typeof amount !== "number")
      return jsonError(400, "Missing or invalid amount");
    if (!Number.isFinite(amount) || amount <= 0) return jsonError(400, "Amount must be a finite number > 0");

    // 3) Clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return jsonError(500, "Server configuration error");

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();
    if (userError || !user) return jsonError(401, "Unauthorized");
    logStep("auth_ok", { user_id: user.id });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "public" },
    });

    // 4) Wallet lookup — CHANGED: execution_wallets_old
    logStep("wallet_lookup", { wallet_id, table: "execution_wallets_old" });

    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("execution_wallets_old")
      .select("id, user_id, wallet_address, is_active, chain_id")
      .eq("id", wallet_id)
      .maybeSingle();

    if (walletError) return jsonError(500, "Failed to fetch wallet from _old table", { step: "wallet_lookup" });
    if (!wallet || wallet.user_id !== user.id) return jsonError(404, "Wallet not found in _old table", { step: "wallet_lookup" });
    if (!wallet.is_active) return jsonError(409, "Wallet is not active", { step: "wallet_lookup" });
    if (wallet.chain_id !== 8453)
      return jsonError(400, "Invalid wallet chain (expected Base / 8453)", {
        step: "wallet_lookup",
        chain_id: wallet.chain_id,
      });

    if (to_address.toLowerCase() === wallet.wallet_address.toLowerCase()) {
      return jsonError(400, "Cannot send to the same wallet", { step: "wallet_lookup" });
    }

    // 5) Rate limit
    const { data: recentWithdrawals, error: rateLimitError } = await supabaseAdmin
      .from("withdrawal_audit_log")
      .select("created_at")
      .eq("user_id", user.id)
      .gte("created_at", new Date(Date.now() - RATE_LIMIT_MS).toISOString())
      .limit(1);

    if (!rateLimitError && recentWithdrawals && recentWithdrawals.length > 0) {
      return jsonError(429, "Rate limited. Please wait 1 minute between withdrawals.", { step: "rate_limit" });
    }

    // 6) Fetch wallet secrets — CHANGED: execution_wallet_secrets_old
    logStep("decrypt_key", { wallet_id, table: "execution_wallet_secrets_old" });

    const { data: secrets, error: secretsError } = await supabaseAdmin
      .from("execution_wallet_secrets_old")
      .select(
        "encrypted_dek_b64, dek_iv_b64, dek_auth_tag_b64, encrypted_private_key_b64, iv_b64, auth_tag_b64, kek_version",
      )
      .eq("wallet_id", wallet_id)
      .maybeSingle();

    if (secretsError) return jsonError(500, "Failed to fetch wallet secrets from _old table", { step: "decrypt_key" });
    if (!secrets) return jsonError(409, "Wallet has no secrets in _old table", { step: "decrypt_key" });

    // Validate all required fields are present
    const requiredFields = [
      "encrypted_dek_b64",
      "dek_iv_b64", 
      "dek_auth_tag_b64",
      "encrypted_private_key_b64",
      "iv_b64",
      "auth_tag_b64",
    ];
    
    for (const field of requiredFields) {
      if (!secrets[field as keyof typeof secrets]) {
        return jsonError(409, `Wallet secrets missing required field: ${field}`, { step: "decrypt_key" });
      }
    }

    // Convert base64 DB strings to Uint8Array for shared decrypt function
    let privateKey: string;
    try {
      const encryptedData = {
        encrypted_private_key: base64ToBytes(secrets.encrypted_private_key_b64),
        iv: base64ToBytes(secrets.iv_b64),
        auth_tag: base64ToBytes(secrets.auth_tag_b64),
        encrypted_dek: base64ToBytes(secrets.encrypted_dek_b64),
        dek_iv: base64ToBytes(secrets.dek_iv_b64),
        dek_auth_tag: base64ToBytes(secrets.dek_auth_tag_b64),
        kek_version: secrets.kek_version ?? 1,
      };

      // Use SHARED decryptPrivateKey - SINGLE SOURCE OF TRUTH
      privateKey = await decryptPrivateKey(encryptedData);
      
      // The shared function returns "0x" + hex, strip the prefix for signing
      if (privateKey.startsWith("0x")) {
        privateKey = privateKey.slice(2);
      }
      
      // Validate format
      if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) {
        return jsonError(500, "Decrypted private key is not valid 32-byte hex", { step: "decrypt_key" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wallet decryption failed";
      return jsonError(500, msg, { step: "decrypt_key" });
    }

    logStep("decrypt_ok");

    // 7) Load crypto libs for signing
    logStep("signer_init");

    let keccak_256: (data: Uint8Array) => Uint8Array;
    let secp256k1: { sign: (hash: Uint8Array, privKey: Uint8Array) => { r: bigint; s: bigint; recovery: number } };

    try {
      const sha3Module = await import("https://esm.sh/@noble/hashes@1.3.3/sha3");
      keccak_256 = sha3Module.keccak_256;

      const curvesModule = await import("https://esm.sh/@noble/curves@1.3.0/secp256k1");
      secp256k1 = curvesModule.secp256k1;
    } catch {
      return jsonError(500, "Failed to load crypto libraries", { step: "signer_init" });
    }

    // 8) Chain state
    logStep("tx_build", { asset });

    let nonce: bigint;
    let gasPrice: bigint;

    try {
      nonce = await getNonce(wallet.wallet_address);
      gasPrice = await getGasPrice();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch blockchain state";
      return jsonError(500, msg, { step: "tx_build" });
    }

    // 9) Balance checks
    const gasLimit = asset === "ETH" ? 21000n : 100000n;

    if (asset === "ETH") {
      const amountWei = BigInt(Math.floor(amount * 1e18));
      const balanceWei = await getEthBalance(wallet.wallet_address);
      const requiredWei = amountWei + gasLimit * gasPrice;

      if (balanceWei < requiredWei) {
        return jsonError(422, "Insufficient ETH for amount + gas", {
          step: "tx_build",
          balance_wei: balanceWei.toString(),
          required_wei: requiredWei.toString(),
        });
      }
    } else {
      const token = TOKENS[asset];
      const amountRaw = BigInt(Math.floor(amount * 10 ** token.decimals));

      const tokenBal = await getErc20Balance(token.address, wallet.wallet_address);
      if (tokenBal < amountRaw) {
        return jsonError(422, `Insufficient ${asset} balance`, {
          step: "tx_build",
          balance_raw: tokenBal.toString(),
          required_raw: amountRaw.toString(),
        });
      }

      const balanceWei = await getEthBalance(wallet.wallet_address);
      const gasWei = gasLimit * gasPrice;
      if (balanceWei < gasWei) {
        return jsonError(422, "Insufficient ETH to pay gas", {
          step: "tx_build",
          required_wei: gasWei.toString(),
        });
      }
    }

    // 10) Build + sign + send tx (SINGLE signing path)
    logStep("tx_send", { asset });

    let txHash: string;

    try {
      if (asset === "ETH") {
        const amountWei = BigInt(Math.floor(amount * 1e18));

        const tx = {
          nonce,
          gasPrice,
          gasLimit,
          to: to_address,
          value: amountWei,
          data: "0x",
          chainId: 8453n,
        };

        txHash = await signAndSendTransaction(tx, privateKey, keccak_256, secp256k1);
      } else {
        const token = TOKENS[asset];
        const amountRaw = BigInt(Math.floor(amount * 10 ** token.decimals));

        const paddedTo = to_address.slice(2).toLowerCase().padStart(64, "0");
        const paddedAmount = amountRaw.toString(16).padStart(64, "0");
        const data = ERC20_TRANSFER_SELECTOR + paddedTo + paddedAmount;

        const tx = {
          nonce,
          gasPrice,
          gasLimit,
          to: token.address,
          value: 0n,
          data,
          chainId: 8453n,
        };

        txHash = await signAndSendTransaction(tx, privateKey, keccak_256, secp256k1);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      return jsonError(500, msg, { step: "tx_send" });
    }

    logStep("tx_send_ok", { tx_hash: txHash });

    // 11) Audit log (best effort)
    try {
      await supabaseAdmin.from("withdrawal_audit_log").insert({
        user_id: user.id,
        wallet_id: wallet.id,
        asset,
        amount,
        to_address,
        tx_hash: txHash,
        status: "submitted",
      });
    } catch (e) {
      logStep("audit_log_failed", {
        message: e instanceof Error ? e.message : String(e),
      });
    }

    return jsonSuccess({ tx_hash: txHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[execution-wallet-withdraw-old] Unhandled error:", error);
    return jsonError(500, message);
  }
});

// ─────────────────────────────────────────────────────────────
// Blockchain RPC helpers
// ─────────────────────────────────────────────────────────────

async function getNonce(address: string): Promise<bigint> {
  const response = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionCount",
      params: [address, "latest"],
    }),
  });

  const data = await response.json();
  if (data?.error) throw new Error(data.error.message || "eth_getTransactionCount failed");
  return BigInt(data.result || "0x0");
}

async function getEthBalance(address: string): Promise<bigint> {
  const response = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });

  const data = await response.json();
  if (data?.error) throw new Error(data.error.message || "eth_getBalance failed");
  return BigInt(data.result || "0x0");
}

async function getGasPrice(): Promise<bigint> {
  const response = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_gasPrice",
      params: [],
    }),
  });

  const data = await response.json();
  if (data?.error) throw new Error(data.error.message || "eth_gasPrice failed");

  // Add 10% buffer
  const basePrice = BigInt(data.result || "0x1");
  return basePrice + basePrice / 10n;
}

async function getErc20Balance(tokenAddress: string, holder: string): Promise<bigint> {
  // balanceOf(address) selector 0x70a08231
  const selector = "70a08231";
  const paddedHolder = holder.slice(2).toLowerCase().padStart(64, "0");
  const dataField = "0x" + selector + paddedHolder;

  const response = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: tokenAddress, data: dataField }, "latest"],
    }),
  });

  const data = await response.json();
  if (data?.error) throw new Error(data.error.message || "eth_call balanceOf failed");

  return BigInt(data.result || "0x0");
}

// ─────────────────────────────────────────────────────────────
// Transaction signing (SINGLE signing path for execution wallets)
// ─────────────────────────────────────────────────────────────

async function signAndSendTransaction(
  tx: {
    nonce: bigint;
    gasPrice: bigint;
    gasLimit: bigint;
    to: string;
    value: bigint;
    data: string;
    chainId: bigint;
  },
  privateKey: string,
  keccak_256: (data: Uint8Array) => Uint8Array,
  secp256k1: {
    sign: (hash: Uint8Array, privKey: Uint8Array) => { r: bigint; s: bigint; recovery: number };
  },
): Promise<string> {
  // RLP encode for signing (legacy tx)
  const rlpForSigning = rlpEncode([tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data, tx.chainId, 0n, 0n]);

  // Hash
  const txHash = keccak_256(rlpForSigning);

  // Sign
  const pkBytes = hexToBytes(privateKey);
  const sig = secp256k1.sign(txHash, pkBytes);

  const r = sig.r;
  const s = sig.s;
  const v = tx.chainId * 2n + 35n + BigInt(sig.recovery);

  // RLP encode signed tx
  const signedRlp = rlpEncode([tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data, v, r, s]);

  const rawTx = "0x" + bytesToHex(signedRlp);

  const response = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendRawTransaction",
      params: [rawTx],
    }),
  });

  const result = await response.json();
  if (result?.error) {
    throw new Error(result.error.message || "eth_sendRawTransaction failed");
  }
  if (!result?.result) {
    throw new Error("No transaction hash returned");
  }

  return result.result as string;
}

// ─────────────────────────────────────────────────────────────
// RLP encoding helpers
// ─────────────────────────────────────────────────────────────

function rlpEncode(items: (bigint | string | number)[]): Uint8Array {
  const encodedItems = items.map(encodeRlpItem);
  const totalLen = encodedItems.reduce((acc, b) => acc + b.length, 0);
  return concatBytes([rlpLength(totalLen, 0xc0), ...encodedItems]);
}

function encodeRlpItem(item: bigint | string | number): Uint8Array {
  if (typeof item === "bigint") {
    if (item === 0n) return new Uint8Array([0x80]);
    let hex = item.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    const bytes = hexToBytes(hex);
    if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
    return concatBytes([rlpLength(bytes.length, 0x80), bytes]);
  }

  if (typeof item === "string") {
    if (item === "" || item === "0x") return new Uint8Array([0x80]);
    const clean = item.startsWith("0x") ? item.slice(2) : item;
    if (clean === "") return new Uint8Array([0x80]);
    const bytes = hexToBytes(clean);
    if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
    return concatBytes([rlpLength(bytes.length, 0x80), bytes]);
  }

  if (typeof item === "number") {
    return encodeRlpItem(BigInt(item));
  }

  return new Uint8Array([0x80]);
}

function rlpLength(len: number, offset: number): Uint8Array {
  if (len < 56) return new Uint8Array([offset + len]);
  let hex = len.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const lenBytes = hexToBytes(hex);
  return concatBytes([new Uint8Array([offset + 55 + lenBytes.length]), lenBytes]);
}
