/**
 * execution-wallet-withdraw
 *
 * Withdraws ETH or ERC20 tokens from the user's execution wallet.
 * Uses server-side encrypted private key to sign and submit transaction.
 *
 * CRITICAL: Uses service_role key for all DB operations that require elevated access.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Token addresses on Base
const TOKENS: Record<string, { address: string; decimals: number }> = {
  ETH: { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
};

// Rate limit: 1 withdrawal per minute
const RATE_LIMIT_MS = 60000;

// ERC20 transfer function selector
const ERC20_TRANSFER_SELECTOR = "0xa9059cbb"; // transfer(address,uint256)

const BASE_RPC = "https://mainnet.base.org";

// Helper: structured log
function logStep(step: string, data: Record<string, unknown> = {}) {
  try {
    console.log("[execution-wallet-withdraw]", JSON.stringify({ step, ...data }));
  } catch {
    console.log("[execution-wallet-withdraw]", step);
  }
}

// Helper: JSON error response
function jsonError(status: number, message: string, meta: Record<string, unknown> = {}) {
  logStep("error", { status, message, ...meta });
  return new Response(JSON.stringify({ success: false, error: message, ...meta }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Helper: JSON success response
function jsonSuccess(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ success: true, ...data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Helper: hex string to bytes
function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Helper: bytes to hex
function bytesToHexLocal(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Helper: base64 to bytes
function base64ToBytes(input: string): Uint8Array {
  if (!input || typeof input !== "string") {
    throw new Error("Invalid base64 input");
  }

  // Normalize base64url → base64
  const normalized = input
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");

  let binString: string;
  try {
    binString = atob(normalized);
  } catch {
    throw new Error("Failed to decode base64");
  }

  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}

// Helper: concat byte arrays
function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

//Helper decodeBase64Field
function decodeBase64Field(name: string, value: string): Uint8Array {
  if (!value || typeof value !== "string") {
    throw new Error(`Missing base64 field: ${name}`);
  }

  const normalized = value
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  let bin: string;
  try {
    bin = atob(normalized);
  } catch {
    throw new Error(`Invalid base64 in field: ${name}`);
  }

  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

//decodeStoredBytes
function decodeStoredBytes(name: string, value: any): Uint8Array {
  // Case 1: Node Buffer JSON { type: "Buffer", data: [...] }
  if (typeof value === "object" && value !== null && value.type === "Buffer" && Array.isArray(value.data)) {
    return new Uint8Array(value.data);
  }

  // Case 2: base64 / base64url string
  if (typeof value === "string") {
    const normalized = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");

    try {
      const bin = atob(normalized);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      throw new Error(`Invalid base64 in field: ${name}`);
    }
  }

  throw new Error(`Unsupported encoding in field: ${name}`);
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    console.log("[execution-wallet-withdraw] Request received");

    // 1. Validate auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonError(401, "Missing authorization header");
    }

    // 2. Parse and validate request body (STRICT CONTRACT)
    let body: { wallet_id?: string; asset?: string; to_address?: string; amount?: number };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const { wallet_id, asset, to_address, amount } = body;

    logStep("request_payload", { wallet_id, asset, to_address, amount });

    // Validate wallet_id
    if (!wallet_id || typeof wallet_id !== "string") {
      return jsonError(400, "Missing or invalid wallet_id");
    }

    // Validate asset
    if (!asset || typeof asset !== "string") {
      return jsonError(400, "Missing or invalid asset");
    }
    if (!["ETH", "WETH", "USDC"].includes(asset)) {
      return jsonError(400, "Invalid asset. Must be ETH, WETH, or USDC");
    }

    // Validate destination address
    if (!to_address || typeof to_address !== "string") {
      return jsonError(400, "Missing destination address");
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(to_address)) {
      return jsonError(400, "Invalid destination address format");
    }

    // Validate amount
    if (amount === undefined || amount === null || typeof amount !== "number") {
      return jsonError(400, "Missing or invalid amount");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonError(400, "Amount must be a finite number > 0");
    }

    // 3. Create anon client to verify user identity
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonError(500, "Server configuration error");
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return jsonError(401, "Unauthorized");
    }

    logStep("auth_ok", { user_id: user.id });

    // 4. Create service-role client for privileged operations (NO ANON CLIENT FOR DB/KEY/AUDIT)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      db: { schema: "public" },
    });

    // 5. Wallet lookup (EXPLICIT wallet_id only)
    logStep("wallet_lookup", { wallet_id });

    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("execution_wallets")
      .select("id, user_id, wallet_address, is_active, chain_id")
      .eq("id", wallet_id)
      .maybeSingle();

    if (walletError) {
      return jsonError(500, "Failed to fetch wallet", { step: "wallet_lookup" });
    }

    if (!wallet || wallet.user_id !== user.id) {
      return jsonError(404, "Wallet not found", { step: "wallet_lookup" });
    }

    if (!wallet.is_active) {
      return jsonError(409, "Wallet is not active", { step: "wallet_lookup" });
    }

    // Chain validation (Base only)
    if (wallet.chain_id !== 8453) {
      return jsonError(400, "Invalid wallet chain (expected Base / 8453)", {
        step: "wallet_lookup",
        chain_id: wallet.chain_id,
      });
    }

    // Block self-transfers
    if (to_address.toLowerCase() === wallet.wallet_address.toLowerCase()) {
      return jsonError(400, "Cannot send to the same wallet", { step: "wallet_lookup" });
    }

    // 6. Rate limit check
    const { data: recentWithdrawals, error: rateLimitError } = await supabaseAdmin
      .from("withdrawal_audit_log")
      .select("created_at")
      .eq("user_id", user.id)
      .gte("created_at", new Date(Date.now() - RATE_LIMIT_MS).toISOString())
      .limit(1);

    if (!rateLimitError && recentWithdrawals && recentWithdrawals.length > 0) {
      return jsonError(429, "Rate limited. Please wait 1 minute between withdrawals.", { step: "rate_limit" });
    }

    // 7. Fetch wallet secrets (explicit)
    logStep("decrypt_key", { wallet_id });

    const { data: secrets, error: secretsError } = await supabaseAdmin
      .from("execution_wallet_secrets")
      .select("encrypted_dek, dek_iv, dek_auth_tag, encrypted_private_key, iv, auth_tag")
      .eq("wallet_id", wallet_id)
      .maybeSingle();

    if (secretsError) {
      return jsonError(500, "Failed to fetch wallet secrets", { step: "decrypt_key" });
    }

    if (!secrets) {
      return jsonError(409, "Wallet has no secrets", { step: "decrypt_key" });
    }

    let privateKey: string;
    try {
      const decrypted = await decryptPrivateKey(secrets as unknown as Record<string, any>);
      if (!decrypted) {
        return jsonError(500, "Failed to decrypt wallet", { step: "decrypt_key" });
      }
      privateKey = decrypted;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wallet decryption failed";
      return jsonError(500, msg, { step: "decrypt_key" });
    }

    // 8. Crypto + signer init
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

    // 9. Fetch on-chain state
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

    // 10. Balance checks (422 on insufficient funds)
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
      // Also ensure enough ETH to pay gas
      const balanceWei = await getEthBalance(wallet.wallet_address);
      const gasWei = gasLimit * gasPrice;
      if (balanceWei < gasWei) {
        return jsonError(422, "Insufficient ETH to pay gas", { step: "tx_build", required_wei: gasWei.toString() });
      }
    }

    // 11. Build + sign + send
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

    // 12. Audit log (service-role)
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
      // Don't fail withdrawal on audit logging failures
      logStep("audit_log_failed", { message: e instanceof Error ? e.message : String(e) });
    }

    return jsonSuccess({ tx_hash: txHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[execution-wallet-withdraw] Unhandled error:", error);
    return jsonError(500, message);
  }
});

// Decrypt private key from wallet secrets
// Decrypt private key from wallet secrets
async function decryptPrivateKey(secrets: Record<string, any>): Promise<string | null> {
  const kek = Deno.env.get("EXECUTION_WALLET_KEK_V1");
  if (!kek) {
    logStep("decrypt_key", { message: "KEK not configured" });
    return null;
  }

  const toArrayBuffer = (u8: Uint8Array): ArrayBuffer => {
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    return ab;
  };

  // ─────────────────────────────────────────────
  // 1) Decode KEK (env) — base64/base64url OR hex
  // ─────────────────────────────────────────────
  const raw = String(kek).trim();
  let kekBytes: Uint8Array;

  // Try base64/base64url first
  try {
    const normalized = raw
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(raw.length / 4) * 4, "=");

    kekBytes = base64ToBytes(normalized);
  } catch {
    // Fallback to hex
    kekBytes = hexToBytes(raw);
  }

  if (kekBytes.length !== 32) {
    throw new Error(`Invalid key length: KEK bytes=${kekBytes.length} (expected 32)`);
  }

  const kekKey = await crypto.subtle.importKey("raw", toArrayBuffer(kekBytes), { name: "AES-GCM" }, false, ["decrypt"]);

  // ─────────────────────────────────────────────
  // 2) Decrypt DEK  ✅ MUST be decodeStoredBytes
  // ─────────────────────────────────────────────
  const encryptedDek = decodeStoredBytes("encrypted_dek", secrets.encrypted_dek);
  const dekIv = decodeStoredBytes("dek_iv", secrets.dek_iv);
  const dekAuthTag = decodeStoredBytes("dek_auth_tag", secrets.dek_auth_tag);

  const dekWithTag = new Uint8Array(encryptedDek.length + dekAuthTag.length);
  dekWithTag.set(encryptedDek);
  dekWithTag.set(dekAuthTag, encryptedDek.length);

  const dekBytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: dekIv }, kekKey, toArrayBuffer(dekWithTag));

  const dekKey = await crypto.subtle.importKey("raw", dekBytes, { name: "AES-GCM" }, false, ["decrypt"]);

  // ─────────────────────────────────────────────
  // 3) Decrypt private key ✅ MUST be decodeStoredBytes
  // ─────────────────────────────────────────────
  const encryptedKey = decodeStoredBytes("encrypted_private_key", secrets.encrypted_private_key);
  const keyIv = decodeStoredBytes("iv", secrets.iv);
  const keyAuthTag = decodeStoredBytes("auth_tag", secrets.auth_tag);

  const keyWithTag = new Uint8Array(encryptedKey.length + keyAuthTag.length);
  keyWithTag.set(encryptedKey);
  keyWithTag.set(keyAuthTag, encryptedKey.length);

  const privateKeyBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: keyIv },
    dekKey,
    toArrayBuffer(keyWithTag),
  );

  return new TextDecoder().decode(privateKeyBytes);
}

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
  if (data.error) throw new Error(data.error.message);
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
  if (data.error) throw new Error(data.error.message);
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
  if (data.error) throw new Error(data.error.message);
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
  if (data.error) throw new Error(data.error.message);
  const hex = data.result || "0x0";
  return BigInt(hex);
}

async function signAndSendTransaction(
  tx: { nonce: bigint; gasPrice: bigint; gasLimit: bigint; to: string; value: bigint; data: string; chainId: bigint },
  privateKey: string,
  keccak_256: (data: Uint8Array) => Uint8Array,
  secp256k1: { sign: (hash: Uint8Array, privKey: Uint8Array) => { r: bigint; s: bigint; recovery: number } },
): Promise<string> {
  // RLP encode for signing (legacy tx format)
  const rlpForSigning = rlpEncode([tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data, tx.chainId, 0n, 0n]);

  // Hash for signing
  const txHash = keccak_256(rlpForSigning);

  // Sign with private key
  const pkBytes = hexToBytes(privateKey.replace("0x", ""));
  const signature = secp256k1.sign(txHash, pkBytes);

  const r = signature.r;
  const s = signature.s;
  const v = tx.chainId * 2n + 35n + BigInt(signature.recovery);

  // RLP encode signed transaction
  const signedRlp = rlpEncode([tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data, v, r, s]);

  const rawTx = "0x" + bytesToHexLocal(signedRlp);

  // Send transaction
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
  if (result.error) {
    throw new Error(result.error.message || "eth_sendRawTransaction failed");
  }

  if (!result.result) {
    throw new Error("No transaction hash returned");
  }

  return result.result;
}

// RLP encoding
function rlpEncode(items: (bigint | string | number)[]): Uint8Array {
  const encoded = items.map((item) => encodeRlpItem(item));
  const totalLength = encoded.reduce((acc, e) => acc + e.length, 0);
  return concatBytes([rlpLength(totalLength, 0xc0), ...encoded]);
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
    if (item === "0x" || item === "") return new Uint8Array([0x80]);
    const cleanHex = item.startsWith("0x") ? item.slice(2) : item;
    if (cleanHex === "") return new Uint8Array([0x80]);
    const bytes = hexToBytes(cleanHex);
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
