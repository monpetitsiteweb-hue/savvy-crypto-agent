/**
 * approve-usdc-0x-router
 *
 * Direct USDC approval to 0x Exchange Proxy on Base.
 * This bypasses Permit2 entirely for BUY trades.
 * 
 * Alternative to Permit2 flow when per-trade signatures are not available.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import { decryptPrivateKey } from "../_shared/envelope-encryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE_RPC = "https://mainnet.base.org";
const CHAIN_ID = 8453n;

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OX_EXCHANGE_PROXY = "0xDef1C0ded9bec7F1a1670819833240f027b25EfF";
const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

const ERC20_APPROVE_SELECTOR = "0x095ea7b3";

function logStep(step: string, data: Record<string, unknown> = {}) {
  console.log("[approve-usdc-0x]", JSON.stringify({ step, ...data }));
}

function jsonError(status: number, message: string, meta: Record<string, unknown> = {}) {
  logStep("error", { status, message, ...meta });
  return new Response(JSON.stringify({ ok: false, error: message, ...meta }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonSuccess(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
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
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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

function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.trim().replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "=");
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getNonce(address: string): Promise<bigint> {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount", params: [address, "pending"] }),
  });
  const data = await res.json();
  return BigInt(data.result);
}

async function getGasPrice(): Promise<bigint> {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
  });
  const data = await res.json();
  return BigInt(data.result);
}

async function getEthBalance(address: string): Promise<bigint> {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
  });
  const data = await res.json();
  return BigInt(data.result);
}

async function getCurrentAllowance(tokenAddress: string, owner: string, spender: string): Promise<bigint> {
  const ownerPadded = owner.slice(2).toLowerCase().padStart(64, "0");
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, "0");
  const calldata = `0xdd62ed3e${ownerPadded}${spenderPadded}`;
  
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: tokenAddress, data: calldata }, "latest"] }),
  });
  const data = await res.json();
  return BigInt(data.result || "0x0");
}

function encodeApprove(spender: string, amount: bigint): string {
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, "0");
  const amountHex = amount.toString(16).padStart(64, "0");
  return `${ERC20_APPROVE_SELECTOR}${spenderPadded}${amountHex}`;
}

function bigintToRlpBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array(0);
  const hex = n.toString(16);
  const h = hex.length % 2 ? "0" + hex : hex;
  return hexToBytes(h);
}

function encodeBigInt(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array([0x80]);
  const hex = n.toString(16);
  const h = hex.length % 2 ? "0" + hex : hex;
  return hexToBytes(h);
}

function rlpEncode(items: (Uint8Array | string)[]): Uint8Array {
  const encoded: Uint8Array[] = [];
  for (const item of items) {
    let bytes: Uint8Array;
    if (typeof item === "string") {
      bytes = item.startsWith("0x") ? hexToBytes(item.slice(2)) : hexToBytes(item);
    } else {
      bytes = item;
    }

    if (bytes.length === 1 && bytes[0] < 0x80) {
      encoded.push(bytes);
    } else if (bytes.length <= 55) {
      encoded.push(new Uint8Array([0x80 + bytes.length]));
      encoded.push(bytes);
    } else {
      const lenBytes = encodeBigInt(BigInt(bytes.length));
      encoded.push(new Uint8Array([0xb7 + lenBytes.length]));
      encoded.push(lenBytes);
      encoded.push(bytes);
    }
  }

  const payload = concatBytes(encoded);
  if (payload.length <= 55) {
    return concatBytes([new Uint8Array([0xc0 + payload.length]), payload]);
  } else {
    const lenBytes = encodeBigInt(BigInt(payload.length));
    return concatBytes([new Uint8Array([0xf7 + lenBytes.length]), lenBytes, payload]);
  }
}

async function signAndSendTransaction(
  tx: { nonce: bigint; gasPrice: bigint; gasLimit: bigint; to: string; value: bigint; data: string; chainId: bigint },
  privateKeyHex: string,
  keccak_256: (d: Uint8Array) => Uint8Array,
  secp256k1: { sign: (h: Uint8Array, pk: Uint8Array) => { r: bigint; s: bigint; recovery: number } }
): Promise<string> {
  const toBytes = tx.to ? hexToBytes(tx.to.slice(2)) : new Uint8Array(0);
  const dataBytes = tx.data ? hexToBytes(tx.data.slice(2)) : new Uint8Array(0);

  const unsignedItems = [
    bigintToRlpBytes(tx.nonce),
    bigintToRlpBytes(tx.gasPrice),
    bigintToRlpBytes(tx.gasLimit),
    toBytes,
    bigintToRlpBytes(tx.value),
    dataBytes,
    bigintToRlpBytes(tx.chainId),
    new Uint8Array(0),
    new Uint8Array(0),
  ];

  const unsignedRlp = rlpEncode(unsignedItems);
  const txHash = keccak_256(unsignedRlp);
  const pkBytes = hexToBytes(privateKeyHex);
  const sig = secp256k1.sign(txHash, pkBytes);

  const v = tx.chainId * 2n + 35n + BigInt(sig.recovery);
  const secp256k1N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
  let s = sig.s;
  if (s > secp256k1N / 2n) s = secp256k1N - s;

  const signedItems = [
    bigintToRlpBytes(tx.nonce),
    bigintToRlpBytes(tx.gasPrice),
    bigintToRlpBytes(tx.gasLimit),
    toBytes,
    bigintToRlpBytes(tx.value),
    dataBytes,
    bigintToRlpBytes(v),
    bigintToRlpBytes(sig.r),
    bigintToRlpBytes(s),
  ];

  const signedRlp = rlpEncode(signedItems);
  const rawTx = "0x" + bytesToHex(signedRlp);

  const sendRes = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [rawTx] }),
  });

  const sendData = await sendRes.json();
  if (sendData.error) {
    throw new Error(`RPC error: ${sendData.error.message}`);
  }

  return sendData.result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    logStep("request_received");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonError(500, "Server configuration error");
    }

    let body: { user_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is OK
    }

    let userId: string;
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    
    if (body.user_id) {
      userId = body.user_id;
      logStep("operator_mode", { user_id: userId });
    } else if (authHeader) {
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (userError || !user) return jsonError(401, "Unauthorized");
      userId = user.id;
      logStep("user_auth_ok", { user_id: userId });
    } else {
      return jsonError(401, "Missing authorization or user_id");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "public" },
    });

    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("execution_wallets")
      .select("id, user_id, wallet_address, is_active, chain_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (walletError) return jsonError(500, "Failed to fetch wallet");
    if (!wallet) return jsonError(404, "No active wallet found");
    if (wallet.chain_id !== 8453) return jsonError(400, "Invalid wallet chain (expected Base / 8453)");

    logStep("wallet_found", { wallet_id: wallet.id, address: wallet.wallet_address });

    // Check current allowance to 0x router
    const currentAllowance = await getCurrentAllowance(USDC_BASE, wallet.wallet_address, OX_EXCHANGE_PROXY);
    logStep("current_allowance", { allowance: currentAllowance.toString(), spender: OX_EXCHANGE_PROXY });

    if (currentAllowance > BigInt("1000000000000")) {
      return jsonSuccess({
        status: "already_approved",
        allowance: currentAllowance.toString(),
        message: "USDC already approved to 0x router",
      });
    }

    // Fetch wallet secrets
    const { data: secrets, error: secretsError } = await supabaseAdmin
      .from("execution_wallet_secrets")
      .select("encrypted_dek_b64, dek_iv_b64, dek_auth_tag_b64, encrypted_private_key_b64, iv_b64, auth_tag_b64, kek_version")
      .eq("wallet_id", wallet.id)
      .maybeSingle();

    if (secretsError) return jsonError(500, "Failed to fetch wallet secrets");
    if (!secrets) return jsonError(409, "Wallet has no secrets");

    const requiredFields = ["encrypted_dek_b64", "dek_iv_b64", "dek_auth_tag_b64", "encrypted_private_key_b64", "iv_b64", "auth_tag_b64"];
    for (const field of requiredFields) {
      if (!secrets[field as keyof typeof secrets]) {
        return jsonError(409, `Wallet secrets missing required field: ${field}`);
      }
    }

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

      privateKey = await decryptPrivateKey(encryptedData);
      if (privateKey.startsWith("0x")) privateKey = privateKey.slice(2);
      
      if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) {
        return jsonError(500, "Decrypted private key is not valid 32-byte hex");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wallet decryption failed";
      return jsonError(500, msg);
    }

    logStep("decrypt_ok");

    let keccak_256: (data: Uint8Array) => Uint8Array;
    let secp256k1: { sign: (hash: Uint8Array, privKey: Uint8Array) => { r: bigint; s: bigint; recovery: number } };

    try {
      const sha3Module = await import("https://esm.sh/@noble/hashes@1.3.3/sha3");
      keccak_256 = sha3Module.keccak_256;
      const curvesModule = await import("https://esm.sh/@noble/curves@1.3.0/secp256k1");
      secp256k1 = curvesModule.secp256k1;
    } catch {
      return jsonError(500, "Failed to load crypto libraries");
    }

    const nonce = await getNonce(wallet.wallet_address);
    const gasPrice = await getGasPrice();
    const gasLimit = 100000n;

    const ethBalance = await getEthBalance(wallet.wallet_address);
    const gasCost = gasLimit * gasPrice;
    if (ethBalance < gasCost) {
      return jsonError(422, "Insufficient ETH to pay gas", {
        balance_wei: ethBalance.toString(),
        required_wei: gasCost.toString(),
      });
    }

    // Approve USDC directly to 0x Exchange Proxy (bypasses Permit2)
    const approveData = encodeApprove(OX_EXCHANGE_PROXY, MAX_UINT256);
    
    const tx = {
      nonce,
      gasPrice,
      gasLimit,
      to: USDC_BASE,
      value: 0n,
      data: approveData,
      chainId: CHAIN_ID,
    };

    logStep("tx_build", { to: USDC_BASE, spender: OX_EXCHANGE_PROXY });

    const txHash = await signAndSendTransaction(tx, privateKey, keccak_256, secp256k1);
    logStep("tx_sent", { tx_hash: txHash });

    return jsonSuccess({
      status: "approval_submitted",
      tx_hash: txHash,
      spender: OX_EXCHANGE_PROXY,
      token: USDC_BASE,
      message: "USDC approved directly to 0x router. BUY trades will now skip Permit2.",
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return jsonError(500, msg);
  }
});
