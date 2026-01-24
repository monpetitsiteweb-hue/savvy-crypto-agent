/**
 * execution-wallet-withdraw
 *
 * Withdraw ETH or ERC20 tokens from an execution wallet (Base).
 * Uses server-side encrypted private key (KEK → DEK → PK).
 * All privileged DB access uses service_role.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
// Small helpers
// ─────────────────────────────────────────────────────────────

function bytesToHexLocal(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHexLocal(new Uint8Array(digest));
}

function logStep(step: string, data: Record<string, unknown> = {}) {
  try {
    console.log("[execution-wallet-withdraw]", JSON.stringify({ step, ...data }));
  } catch {
    console.log("[execution-wallet-withdraw]", step);
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

function base64ToBytesStrict(name: string, input: string): Uint8Array {
  if (!input || typeof input !== "string") throw new Error(`Missing base64 field: ${name}`);

  const normalized = input
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");

  let bin: string;
  try {
    bin = atob(normalized);
  } catch {
    throw new Error(`Invalid base64 in field: ${name}`);
  }

  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function looksLikeBase64AsciiBytes(u8: Uint8Array): boolean {
  for (const b of u8) {
    if (b < 0x20 || b > 0x7e) return false; // printable ASCII only
  }
  const s = new TextDecoder().decode(u8).trim();
  if (s.length < 8) return false;
  if (s.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(s);
}

function base64ToBytesMaybeDouble(name: string, input: string): Uint8Array {
  const once = base64ToBytesStrict(name, input);

  if (!looksLikeBase64AsciiBytes(once)) {
    return once;
  }

  const inner = new TextDecoder().decode(once).trim();

  try {
    const twice = base64ToBytesStrict(`${name}(double)`, inner);
    logStep("b64_double_decode", {
      field: name,
      outer_len: once.length,
      inner_len: inner.length,
      final_len: twice.length,
    });
    return twice;
  } catch {
    return once;
  }
}

/**
 * decodeStoredBytes:
 * Accepts many shapes (bytea "\\x..", hex "0x..", base64, arrays, numeric-key objects,
 * Buffer-like {type:"Buffer",data:[...]}, and nested wrappers {data: ...}.
 * Also handles "double-encoded" cases where bytes are ASCII JSON that itself describes bytes.
 */
function decodeStoredBytes(name: string, value: any): Uint8Array {
  if (value === null || value === undefined) throw new Error(`Missing field: ${name}`);

  // 0) Direct Uint8Array
  if (value instanceof Uint8Array) return value;

  // 1) Wrapper { data: ... }
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "data" in value) {
    return decodeStoredBytes(name, (value as any).data);
  }

  // 2) Buffer-like { type:"Buffer", data:[...] }
  if (
    typeof value === "object" &&
    value !== null &&
    (value as any).type === "Buffer" &&
    Array.isArray((value as any).data)
  ) {
    const bytes = new Uint8Array((value as any).data);
    const txt = new TextDecoder().decode(bytes).trim();
    if (txt.startsWith("{") || txt.startsWith("[")) {
      try {
        const parsed = JSON.parse(txt);
        return decodeStoredBytes(name, parsed);
      } catch {
        // fallthrough
      }
    }
    return bytes;
  }

  const isNumericKeyObject = (obj: any) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    const keys = Object.keys(obj);
    if (keys.length === 0) return false;
    return (
      keys.every((k) => /^\d+$/.test(k)) &&
      keys.every((k) => {
        const v = obj[k];
        return typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v));
      })
    );
  };

  const fromNumericKeyObject = (obj: Record<string, any>) => {
    const keys = Object.keys(obj).sort((a, b) => Number(a) - Number(b));
    const out = new Uint8Array(keys.length);
    for (let i = 0; i < keys.length; i++) out[i] = Number(obj[keys[i]]);
    return out;
  };

  // 3) Numeric-key object directly
  if (isNumericKeyObject(value)) return fromNumericKeyObject(value as Record<string, any>);

  // 4) Array of numbers (or numeric strings)
  if (Array.isArray(value) && value.every((v) => typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v)))) {
    return new Uint8Array(value.map((v: any) => Number(v)));
  }

  // 5) String cases
  if (typeof value === "string") {
    const raw = value.trim();

    // JSON string that describes bytes
    if (raw.startsWith("{") || raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        return decodeStoredBytes(name, parsed);
      } catch {
        // fallthrough
      }
    }

    // Postgres bytea: "\\x...."
    if (raw.startsWith("\\x")) return hexToBytes(raw.slice(2));

    // Hex: "0x...."
    if (raw.startsWith("0x")) return hexToBytes(raw);

    // Base64/base64url
    try {
      return base64ToBytesStrict(name, raw);
    } catch {
      // fallthrough
    }

    // Naked hex
    if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) return hexToBytes(raw);

    throw new Error(`Unsupported string encoding in field: ${name}`);
  }

  // Unknown
  const shape = (() => {
    try {
      return typeof value === "object" ? { keys: Object.keys(value).slice(0, 20) } : { type: typeof value };
    } catch {
      return { type: typeof value };
    }
  })();

  throw new Error(`Unsupported encoding in field: ${name} (${JSON.stringify(shape)})`);
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    console.log("[execution-wallet-withdraw] Request received");

    // 1) Validate auth header
    const authHeader = req.headers.get("Authorization");
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

    // 4) Wallet lookup
    logStep("wallet_lookup", { wallet_id });

    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("execution_wallets")
      .select("id, user_id, wallet_address, is_active, chain_id")
      .eq("id", wallet_id)
      .maybeSingle();

    if (walletError) return jsonError(500, "Failed to fetch wallet", { step: "wallet_lookup" });
    if (!wallet || wallet.user_id !== user.id) return jsonError(404, "Wallet not found", { step: "wallet_lookup" });
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

    // 6) Fetch wallet secrets (b64 columns)
    logStep("decrypt_key", { wallet_id });

    const { data: secrets, error: secretsError } = await supabaseAdmin
      .from("execution_wallet_secrets")
      .select(
        "encrypted_dek_b64, dek_iv_b64, dek_auth_tag_b64, encrypted_private_key_b64, iv_b64, auth_tag_b64, secrets_format",
      )
      .eq("wallet_id", wallet_id)
      .maybeSingle();

    if (secretsError) return jsonError(500, "Failed to fetch wallet secrets", { step: "decrypt_key" });
    if (!secrets) return jsonError(409, "Wallet has no secrets", { step: "decrypt_key" });

    logStep("secrets_format", {
      secrets_format: (secrets as any).secrets_format,
      has_b64: Boolean((secrets as any).encrypted_dek_b64 && (secrets as any).dek_iv_b64),
    });

    let privateKey: string;
    try {
      const decrypted = await decryptPrivateKey(secrets as unknown as Record<string, any>);
      if (!decrypted) return jsonError(500, "Failed to decrypt wallet", { step: "decrypt_key" });
      privateKey = decrypted;
      if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) {
        return jsonError(500, "Decrypted private key is not 32-byte hex", { step: "decrypt_key" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wallet decryption failed";
      return jsonError(500, msg, { step: "decrypt_key" });
    }

    // 7) Load crypto libs
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

    // 10) Build + sign + send tx
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
    console.error("[execution-wallet-withdraw] Unhandled error:", error);
    return jsonError(500, message);
  }
});
// ─────────────────────────────────────────────────────────────
// Decrypt private key from wallet secrets (STRICT b64 pipeline)
// ─────────────────────────────────────────────────────────────
async function decryptPrivateKey(secrets: Record<string, any>): Promise<string> {
  const kekEnv = Deno.env.get("EXECUTION_WALLET_KEK_V1");
  if (!kekEnv) throw new Error("KEK not configured");

  const toAB = (u8: Uint8Array): ArrayBuffer => {
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    return ab;
  };

  // 1) KEK decode — FORCE HEX (your KEK is 64 hex chars = 32 bytes)

  // 1) KEK: prove what we’re using + decode (accept HEX or BASE64)
  const raw = String(kekEnv); // DO NOT trim first for the digest proof
  const digestHex = await sha256Hex(raw);
  logStep("kek_digest_sha256", { digestHex }); // compare with Supabase “DIGEST (SHA-256)”

  const cleaned = raw.trim(); // NOW trim for decoding

  let kekBytes: Uint8Array | null = null;

  // a) 64-hex chars -> 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    kekBytes = hexToBytes(cleaned);
    logStep("kek_decode", { format: "hex", bytes: kekBytes.length });
  } else {
    // b) base64/base64url -> must decode to 32 bytes
    try {
      kekBytes = base64ToBytesStrict("EXECUTION_WALLET_KEK_V1", cleaned);
      logStep("kek_decode", { format: "base64", bytes: kekBytes.length });
    } catch (e) {
      logStep("kek_decode_failed", { message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!kekBytes || kekBytes.length !== 32) {
    throw new Error(`KEK must decode to 32 bytes. Got ${kekBytes ? kekBytes.length : "null"}.`);
  }

  const kekKey = await crypto.subtle.importKey("raw", toAB(kekBytes), { name: "AES-GCM" }, false, ["decrypt"]);

  // 2) Decrypt DEK (ALL *_b64 — NO GUESSING)
  const encryptedDek = base64ToBytesMaybeDouble("encrypted_dek_b64", secrets.encrypted_dek_b64);
  const dekIv = base64ToBytesMaybeDouble("dek_iv_b64", secrets.dek_iv_b64);
  const dekAuthTag = base64ToBytesMaybeDouble("dek_auth_tag_b64", secrets.dek_auth_tag_b64);

  if (dekIv.length !== 12 && dekIv.length !== 16) {
    throw new Error(`DEK IV invalid length=${dekIv.length}`);
  }
  if (dekAuthTag.length !== 16) {
    throw new Error(`DEK auth tag invalid length=${dekAuthTag.length}`);
  }

  logStep("dek_parts_len", {
    encrypted_dek_len: encryptedDek.length,
    dek_iv_len: dekIv.length,
    dek_auth_tag_len: dekAuthTag.length,
  });

  const dekWithTag = new Uint8Array(encryptedDek.length + dekAuthTag.length);
  dekWithTag.set(encryptedDek);
  dekWithTag.set(dekAuthTag, encryptedDek.length);

  const dekBytes = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: dekIv }, kekKey, toAB(dekWithTag)),
  );

  const dekKey = await crypto.subtle.importKey("raw", toAB(dekBytes), { name: "AES-GCM" }, false, ["decrypt"]);

  // 3) Decrypt private key (ALL *_b64 — NO GUESSING)
  const encryptedKey = base64ToBytesMaybeDouble("encrypted_private_key_b64", secrets.encrypted_private_key_b64);
  const keyIv = base64ToBytesMaybeDouble("iv_b64", secrets.iv_b64);
  const keyAuthTag = base64ToBytesMaybeDouble("auth_tag_b64", secrets.auth_tag_b64);

  if (keyIv.length !== 12 && keyIv.length !== 16) {
    throw new Error(`PK IV invalid length=${keyIv.length}`);
  }
  if (keyAuthTag.length !== 16) {
    throw new Error(`PK auth tag invalid length=${keyAuthTag.length}`);
  }

  const keyWithTag = new Uint8Array(encryptedKey.length + keyAuthTag.length);
  keyWithTag.set(encryptedKey);
  keyWithTag.set(keyAuthTag, encryptedKey.length);

  const pkBytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: keyIv }, dekKey, toAB(keyWithTag)));

  // ✅ KEY FIX: if stored as raw 32 bytes, convert to 64-hex and return
  if (pkBytes.length === 32) {
    return bytesToHexLocal(pkBytes); // or bytesToHex(pkBytes) — both exist in your file
  }

  // Otherwise, attempt text formats (legacy / json / hex string)
  const decoded = new TextDecoder().decode(pkBytes).trim();

  // Case 1: JSON wrapper
  if (decoded.startsWith("{")) {
    const obj = JSON.parse(decoded);
    if (typeof obj.privateKey === "string") {
      return obj.privateKey.replace(/^0x/, "");
    }
    throw new Error("Decrypted PK is JSON but missing privateKey field");
  }

  // Case 2: quoted string
  if ((decoded.startsWith('"') && decoded.endsWith('"')) || (decoded.startsWith("'") && decoded.endsWith("'"))) {
    return decoded.slice(1, -1).replace(/^0x/, "");
  }

  // Case 3: raw hex
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(decoded)) {
    return decoded.replace(/^0x/, "");
  }

  throw new Error(`Decrypted private key has invalid format: len=${pkBytes.length} head=${decoded.slice(0, 40)}`);
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
  const pkBytes = hexToBytes(privateKey.replace(/^0x/, ""));
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

// ─────────────────────────────────────────────
// RLP encoding helpers
// ─────────────────────────────────────────────

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
