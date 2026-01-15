/**
 * execution-wallet-withdraw
 * 
 * Withdraws ETH or ERC20 tokens from the user's execution wallet.
 * Uses server-side encrypted private key to sign and submit transaction.
 * 
 * CRITICAL: Uses service_role key for all DB operations that require elevated access.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Token addresses on Base
const TOKENS: Record<string, { address: string; decimals: number }> = {
  ETH: { address: '0x0000000000000000000000000000000000000000', decimals: 18 },
  WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
};

// Rate limit: 1 withdrawal per minute
const RATE_LIMIT_MS = 60000;

// ERC20 transfer function selector
const ERC20_TRANSFER_SELECTOR = '0xa9059cbb'; // transfer(address,uint256)

const BASE_RPC = 'https://mainnet.base.org';

// Helper: JSON error response
function jsonError(status: number, message: string) {
  console.error(`[execution-wallet-withdraw] Error ${status}: ${message}`);
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Helper: JSON success response
function jsonSuccess(data: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Helper: hex string to bytes
function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Helper: bytes to hex
function bytesToHexLocal(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper: base64 to bytes
function base64ToBytes(b64: string): Uint8Array {
  const binString = atob(b64);
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

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[execution-wallet-withdraw] Request received');

    // 1. Validate auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonError(401, 'Missing authorization header');
    }

    // 2. Parse and validate request body
    let body: { asset?: string; to_address?: string; amount?: number };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Invalid JSON body');
    }

    const { asset, to_address, amount } = body;

    console.log('[execution-wallet-withdraw] Payload:', { asset, to_address, amount });

    // Validate asset
    if (!asset || typeof asset !== 'string') {
      return jsonError(400, 'Missing or invalid asset');
    }
    if (!['ETH', 'WETH', 'USDC'].includes(asset)) {
      return jsonError(400, 'Invalid asset. Must be ETH, WETH, or USDC');
    }

    // Validate destination address
    if (!to_address || typeof to_address !== 'string') {
      return jsonError(400, 'Missing destination address');
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(to_address)) {
      return jsonError(400, 'Invalid destination address format');
    }

    // Validate amount
    if (amount === undefined || amount === null || typeof amount !== 'number') {
      return jsonError(400, 'Missing or invalid amount');
    }
    if (amount <= 0) {
      return jsonError(400, 'Amount must be greater than zero');
    }
    if (!Number.isFinite(amount)) {
      return jsonError(400, 'Amount must be a finite number');
    }

    // 3. Create anon client to verify user identity
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error('[execution-wallet-withdraw] Missing Supabase env vars');
      return jsonError(500, 'Server configuration error');
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error('[execution-wallet-withdraw] Auth failed:', userError?.message);
      return jsonError(401, 'Unauthorized');
    }

    console.log(`[execution-wallet-withdraw] User authenticated: ${user.id}`);

    // 4. Create service-role client for privileged operations
    // CRITICAL: This client bypasses RLS and has full access
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { 
        persistSession: false,
        autoRefreshToken: false,
      },
      db: {
        schema: 'public',
      },
    });

    // 5. Get user's active wallet
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from('execution_wallets')
      .select('id, wallet_address, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (walletError) {
      console.error('[execution-wallet-withdraw] Wallet query error:', walletError);
      return jsonError(500, 'Failed to fetch wallet');
    }

    if (!wallet) {
      return jsonError(404, 'No active wallet found');
    }

    console.log(`[execution-wallet-withdraw] Wallet found: ${wallet.wallet_address}`);

    // 6. Block self-transfers
    if (to_address.toLowerCase() === wallet.wallet_address.toLowerCase()) {
      return jsonError(400, 'Cannot send to the same wallet');
    }

    // 7. Rate limit check
    const { data: recentWithdrawals, error: rateLimitError } = await supabaseAdmin
      .from('withdrawal_audit_log')
      .select('created_at')
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - RATE_LIMIT_MS).toISOString())
      .limit(1);

    if (rateLimitError) {
      console.error('[execution-wallet-withdraw] Rate limit query error:', rateLimitError);
      // Don't block on rate limit query failure, just log it
    } else if (recentWithdrawals && recentWithdrawals.length > 0) {
      return jsonError(429, 'Rate limited. Please wait 1 minute between withdrawals.');
    }

    // 8. Get wallet secrets via RPC (service_role only)
    // The RPC function checks for service_role internally
    console.log('[execution-wallet-withdraw] Fetching wallet secrets via RPC...');
    
    const { data: walletSecrets, error: secretsError } = await supabaseAdmin
      .rpc('get_execution_wallet_for_trading', { p_user_id: user.id });

    if (secretsError) {
      console.error('[execution-wallet-withdraw] RPC error:', secretsError);
      return jsonError(500, `Failed to access wallet secrets: ${secretsError.message}`);
    }

    if (!walletSecrets) {
      console.error('[execution-wallet-withdraw] No wallet secrets returned');
      return jsonError(500, 'Wallet secrets not found');
    }

    console.log('[execution-wallet-withdraw] Wallet secrets retrieved, decrypting...');

    // 9. Decrypt private key
    let privateKey: string;
    try {
      const decrypted = await decryptPrivateKey(walletSecrets);
      if (!decrypted) {
        return jsonError(500, 'Failed to decrypt wallet');
      }
      privateKey = decrypted;
    } catch (decryptError) {
      console.error('[execution-wallet-withdraw] Decryption error:', decryptError);
      return jsonError(500, 'Wallet decryption failed');
    }

    console.log('[execution-wallet-withdraw] Private key decrypted, preparing transaction...');

    // 10. Import crypto libraries
    let keccak_256: (data: Uint8Array) => Uint8Array;
    let secp256k1: { sign: (hash: Uint8Array, privKey: Uint8Array) => { r: bigint; s: bigint; recovery: number } };

    try {
      const sha3Module = await import('https://esm.sh/@noble/hashes@1.3.3/sha3');
      keccak_256 = sha3Module.keccak_256;
      
      const curvesModule = await import('https://esm.sh/@noble/curves@1.3.0/secp256k1');
      secp256k1 = curvesModule.secp256k1;
    } catch (importError) {
      console.error('[execution-wallet-withdraw] Crypto import error:', importError);
      return jsonError(500, 'Failed to load crypto libraries');
    }

    // 11. Get nonce and gas price
    let nonce: bigint;
    let gasPrice: bigint;

    try {
      nonce = await getNonce(wallet.wallet_address);
      gasPrice = await getGasPrice();
      console.log(`[execution-wallet-withdraw] Nonce: ${nonce}, Gas price: ${gasPrice}`);
    } catch (rpcError) {
      console.error('[execution-wallet-withdraw] RPC error:', rpcError);
      return jsonError(500, 'Failed to fetch blockchain state');
    }

    // 12. Build and sign transaction
    let txHash: string;

    try {
      if (asset === 'ETH') {
        // Native ETH transfer
        const amountWei = BigInt(Math.floor(amount * 1e18));
        
        const tx = {
          nonce,
          gasPrice,
          gasLimit: 21000n,
          to: to_address,
          value: amountWei,
          data: '0x',
          chainId: 8453n,
        };

        txHash = await signAndSendTransaction(tx, privateKey, keccak_256, secp256k1);
      } else {
        // ERC20 transfer
        const token = TOKENS[asset];
        const amountRaw = BigInt(Math.floor(amount * (10 ** token.decimals)));
        
        // Encode transfer(to, amount)
        const paddedTo = to_address.slice(2).toLowerCase().padStart(64, '0');
        const paddedAmount = amountRaw.toString(16).padStart(64, '0');
        const data = ERC20_TRANSFER_SELECTOR + paddedTo + paddedAmount;

        const tx = {
          nonce,
          gasPrice,
          gasLimit: 100000n,
          to: token.address,
          value: 0n,
          data,
          chainId: 8453n,
        };

        txHash = await signAndSendTransaction(tx, privateKey, keccak_256, secp256k1);
      }
    } catch (txError) {
      console.error('[execution-wallet-withdraw] Transaction error:', txError);
      const errorMessage = txError instanceof Error ? txError.message : 'Transaction failed';
      return jsonError(500, `Transaction failed: ${errorMessage}`);
    }

    console.log(`[execution-wallet-withdraw] Transaction submitted: ${txHash}`);

    // 13. Log the withdrawal (don't fail if audit log fails)
    try {
      await supabaseAdmin
        .from('withdrawal_audit_log')
        .insert({
          user_id: user.id,
          wallet_id: wallet.id,
          asset,
          amount,
          to_address,
          tx_hash: txHash,
          status: 'submitted',
        });
      console.log('[execution-wallet-withdraw] Audit log created');
    } catch (auditError) {
      console.error('[execution-wallet-withdraw] Audit log failed:', auditError);
      // Don't fail the request if audit logging fails
    }

    // 14. Return success
    return jsonSuccess({
      tx_hash: txHash,
      asset,
      amount,
      to_address,
      from_address: wallet.wallet_address,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[execution-wallet-withdraw] Unhandled error:', error);
    return jsonError(500, message);
  }
});

// Decrypt private key from wallet secrets
async function decryptPrivateKey(secrets: Record<string, string>): Promise<string | null> {
  const kek = Deno.env.get('EXECUTION_WALLET_KEK_V1');
  if (!kek) {
    console.error('[decryptPrivateKey] KEK not configured');
    return null;
  }

  // Import KEK
  const kekBytes = hexToBytes(kek);
  const kekKey = await crypto.subtle.importKey(
    'raw',
    kekBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt DEK
  const encryptedDek = base64ToBytes(secrets.encrypted_dek);
  const dekIv = base64ToBytes(secrets.dek_iv);
  const dekAuthTag = base64ToBytes(secrets.dek_auth_tag);

  const dekWithTag = new Uint8Array(encryptedDek.length + dekAuthTag.length);
  dekWithTag.set(encryptedDek);
  dekWithTag.set(dekAuthTag, encryptedDek.length);

  const dekBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: dekIv },
    kekKey,
    dekWithTag
  );

  // Import DEK
  const dekKey = await crypto.subtle.importKey(
    'raw',
    dekBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt private key
  const encryptedKey = base64ToBytes(secrets.encrypted_private_key);
  const keyIv = base64ToBytes(secrets.iv);
  const keyAuthTag = base64ToBytes(secrets.auth_tag);

  const keyWithTag = new Uint8Array(encryptedKey.length + keyAuthTag.length);
  keyWithTag.set(encryptedKey);
  keyWithTag.set(keyAuthTag, encryptedKey.length);

  const privateKeyBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: keyIv },
    dekKey,
    keyWithTag
  );

  return new TextDecoder().decode(privateKeyBytes);
}

async function getNonce(address: string): Promise<bigint> {
  const response = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionCount',
      params: [address, 'latest'],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return BigInt(data.result || '0x0');
}

async function getGasPrice(): Promise<bigint> {
  const response = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_gasPrice',
      params: [],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  // Add 10% buffer
  const basePrice = BigInt(data.result || '0x1');
  return basePrice + (basePrice / 10n);
}

async function signAndSendTransaction(
  tx: { nonce: bigint; gasPrice: bigint; gasLimit: bigint; to: string; value: bigint; data: string; chainId: bigint },
  privateKey: string,
  keccak_256: (data: Uint8Array) => Uint8Array,
  secp256k1: { sign: (hash: Uint8Array, privKey: Uint8Array) => { r: bigint; s: bigint; recovery: number } }
): Promise<string> {
  // RLP encode for signing (legacy tx format)
  const rlpForSigning = rlpEncode([
    tx.nonce,
    tx.gasPrice,
    tx.gasLimit,
    tx.to,
    tx.value,
    tx.data,
    tx.chainId,
    0n,
    0n,
  ]);

  // Hash for signing
  const txHash = keccak_256(rlpForSigning);

  // Sign with private key
  const pkBytes = hexToBytes(privateKey.replace('0x', ''));
  const signature = secp256k1.sign(txHash, pkBytes);
  
  const r = signature.r;
  const s = signature.s;
  const v = tx.chainId * 2n + 35n + BigInt(signature.recovery);

  // RLP encode signed transaction
  const signedRlp = rlpEncode([
    tx.nonce,
    tx.gasPrice,
    tx.gasLimit,
    tx.to,
    tx.value,
    tx.data,
    v,
    r,
    s,
  ]);

  const rawTx = '0x' + bytesToHexLocal(signedRlp);

  // Send transaction
  const response = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendRawTransaction',
      params: [rawTx],
    }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(result.error.message || 'eth_sendRawTransaction failed');
  }

  if (!result.result) {
    throw new Error('No transaction hash returned');
  }

  return result.result;
}

// RLP encoding
function rlpEncode(items: (bigint | string | number)[]): Uint8Array {
  const encoded = items.map(item => encodeRlpItem(item));
  const totalLength = encoded.reduce((acc, e) => acc + e.length, 0);
  return concatBytes([rlpLength(totalLength, 0xc0), ...encoded]);
}

function encodeRlpItem(item: bigint | string | number): Uint8Array {
  if (typeof item === 'bigint') {
    if (item === 0n) return new Uint8Array([0x80]);
    let hex = item.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    const bytes = hexToBytes(hex);
    if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
    return concatBytes([rlpLength(bytes.length, 0x80), bytes]);
  }
  
  if (typeof item === 'string') {
    if (item === '0x' || item === '') return new Uint8Array([0x80]);
    const cleanHex = item.startsWith('0x') ? item.slice(2) : item;
    if (cleanHex === '') return new Uint8Array([0x80]);
    const bytes = hexToBytes(cleanHex);
    if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
    return concatBytes([rlpLength(bytes.length, 0x80), bytes]);
  }
  
  if (typeof item === 'number') {
    return encodeRlpItem(BigInt(item));
  }
  
  return new Uint8Array([0x80]);
}

function rlpLength(len: number, offset: number): Uint8Array {
  if (len < 56) return new Uint8Array([offset + len]);
  let hex = len.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const lenBytes = hexToBytes(hex);
  return concatBytes([new Uint8Array([offset + 55 + lenBytes.length]), lenBytes]);
}
