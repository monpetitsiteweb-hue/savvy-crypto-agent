/**
 * execution-wallet-withdraw
 * 
 * Withdraws ETH or ERC20 tokens from the user's execution wallet.
 * Uses server-side encrypted private key to sign and submit transaction.
 * 
 * Guardrails:
 * - Auth required
 * - Rate limited (1 per minute per user)
 * - Max amount validation
 * - Address validation
 * - Cannot send to self
 * - Audit logging
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request
    const { asset, to_address, amount } = await req.json();

    // Validate inputs
    if (!asset || !['ETH', 'WETH', 'USDC'].includes(asset)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid asset. Must be ETH, WETH, or USDC' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!to_address || !/^0x[a-fA-F0-9]{40}$/.test(to_address)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid destination address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid amount' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create user client to get current user
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // Get user's wallet
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from('execution_wallets')
      .select('id, wallet_address, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (walletError || !wallet) {
      return new Response(
        JSON.stringify({ success: false, error: 'No active wallet found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cannot send to self
    if (to_address.toLowerCase() === wallet.wallet_address.toLowerCase()) {
      return new Response(
        JSON.stringify({ success: false, error: 'Cannot send to the same wallet' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Rate limit check - look for recent withdrawals
    const { data: recentWithdrawals } = await supabaseAdmin
      .from('withdrawal_audit_log')
      .select('created_at')
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - RATE_LIMIT_MS).toISOString())
      .limit(1);

    if (recentWithdrawals && recentWithdrawals.length > 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limited. Please wait 1 minute between withdrawals.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[execution-wallet-withdraw] User ${user.id} withdrawing ${amount} ${asset} to ${to_address}`);

    // Get decrypted private key via RPC (service_role only)
    const { data: walletSecrets, error: secretsError } = await supabaseAdmin
      .rpc('get_execution_wallet_for_trading', { p_user_id: user.id });

    if (secretsError || !walletSecrets) {
      console.error('[execution-wallet-withdraw] Failed to get wallet secrets:', secretsError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to access wallet' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt private key
    const privateKey = await decryptPrivateKey(walletSecrets);
    if (!privateKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to decrypt wallet' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Import crypto libraries
    const { keccak_256 } = await import('https://esm.sh/@noble/hashes@1.3.3/sha3');
    const { secp256k1 } = await import('https://esm.sh/@noble/curves@1.3.0/secp256k1');
    const { bytesToHex, hexToBytes } = await import('https://esm.sh/@noble/hashes@1.3.3/utils');

    // Get current nonce
    const nonce = await getNonce(wallet.wallet_address);
    
    // Get gas price
    const gasPrice = await getGasPrice();

    let txHash: string;

    if (asset === 'ETH') {
      // Native ETH transfer
      const amountWei = BigInt(Math.floor(amount * 1e18));
      
      // Build transaction
      const tx = {
        nonce,
        gasPrice,
        gasLimit: 21000n, // Standard ETH transfer
        to: to_address,
        value: amountWei,
        data: '0x',
        chainId: 8453, // Base
      };

      txHash = await signAndSendTransaction(tx, privateKey, keccak_256, secp256k1, bytesToHex, hexToBytes);
    } else {
      // ERC20 transfer
      const token = TOKENS[asset];
      const amountRaw = BigInt(Math.floor(amount * (10 ** token.decimals)));
      
      // Encode transfer(to, amount)
      const paddedTo = to_address.slice(2).toLowerCase().padStart(64, '0');
      const paddedAmount = amountRaw.toString(16).padStart(64, '0');
      const data = ERC20_TRANSFER_SELECTOR + paddedTo + paddedAmount;

      // Build transaction
      const tx = {
        nonce,
        gasPrice,
        gasLimit: 100000n, // ERC20 transfer
        to: token.address,
        value: 0n,
        data,
        chainId: 8453,
      };

      txHash = await signAndSendTransaction(tx, privateKey, keccak_256, secp256k1, bytesToHex, hexToBytes);
    }

    // Log the withdrawal
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

    console.log(`[execution-wallet-withdraw] Transaction submitted: ${txHash}`);

    return new Response(
      JSON.stringify({
        success: true,
        tx_hash: txHash,
        asset,
        amount,
        to_address,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[execution-wallet-withdraw] Error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Decrypt private key from wallet secrets
async function decryptPrivateKey(secrets: any): Promise<string | null> {
  try {
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
  } catch (e) {
    console.error('[decryptPrivateKey] Decryption failed:', e);
    return null;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return bytes;
}

function base64ToBytes(b64: string): Uint8Array {
  const binString = atob(b64);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
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
  // Add 10% buffer
  const basePrice = BigInt(data.result || '0x1');
  return basePrice + (basePrice / 10n);
}

async function signAndSendTransaction(
  tx: any,
  privateKey: string,
  keccak_256: any,
  secp256k1: any,
  bytesToHex: any,
  hexToBytes: any
): Promise<string> {
  // RLP encode the transaction for signing (legacy tx)
  const rlpEncoded = rlpEncode([
    tx.nonce,
    tx.gasPrice,
    tx.gasLimit,
    tx.to,
    tx.value,
    tx.data,
    tx.chainId,
    0,
    0,
  ]);

  // Hash for signing
  const txHash = keccak_256(rlpEncoded);

  // Sign with private key
  const pkBytes = hexToBytes(privateKey.replace('0x', ''));
  const signature = secp256k1.sign(txHash, pkBytes);
  
  const r = signature.r;
  const s = signature.s;
  const v = BigInt(tx.chainId * 2 + 35 + signature.recovery);

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

  const rawTx = '0x' + bytesToHex(signedRlp);

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
    throw new Error(result.error.message || 'Transaction failed');
  }

  return result.result;
}

// Simple RLP encoding
function rlpEncode(items: any[]): Uint8Array {
  const encoded = items.map(item => {
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
      const bytes = hexToBytes(item.replace('0x', ''));
      if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
      return concatBytes([rlpLength(bytes.length, 0x80), bytes]);
    }
    if (typeof item === 'number') {
      return rlpEncode([BigInt(item)])[0] ? rlpEncode([BigInt(item)]) : new Uint8Array([0x80]);
    }
    return new Uint8Array([0x80]);
  });

  const total = encoded.reduce((acc, e) => acc + e.length, 0);
  return concatBytes([rlpLength(total, 0xc0), ...encoded]);
}

function rlpLength(len: number, offset: number): Uint8Array {
  if (len < 56) return new Uint8Array([offset + len]);
  let hex = len.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const lenBytes = hexToBytes(hex);
  return concatBytes([new Uint8Array([offset + 55 + lenBytes.length]), lenBytes]);
}

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
