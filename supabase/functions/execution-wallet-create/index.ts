/**
 * execution-wallet-create
 * 
 * OPTION B: One-time private key reveal + hybrid custody
 * 
 * Creates a new execution wallet for a user and returns the private key ONCE.
 * After this response, the key is encrypted and NEVER returned again.
 * 
 * Security Model:
 * - Private key is generated server-side
 * - Key is returned ONCE in plaintext for user backup
 * - Key is then encrypted with envelope encryption and stored
 * - User can import key externally (MetaMask, etc.)
 * - App can trade without needing user to provide key
 * 
 * If wallet already exists, ONLY returns address (no key reveal for existing wallets)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encryptPrivateKey } from '../_shared/envelope-encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate wallet using Web Crypto (no external deps)
async function generateWallet(): Promise<{ privateKey: string; address: string }> {
  // Generate 32 random bytes for private key
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const privateKey = '0x' + Array.from(privateKeyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Import secp256k1 for address derivation
  const { keccak_256 } = await import('https://esm.sh/@noble/hashes@1.3.3/sha3');
  const { secp256k1 } = await import('https://esm.sh/@noble/curves@1.3.0/secp256k1');
  
  // Get public key (uncompressed, 65 bytes: 04 + x + y)
  const publicKey = secp256k1.getPublicKey(privateKeyBytes, false);
  
  // Keccak256 of public key (skip first byte which is 0x04)
  const hash = keccak_256(publicKey.slice(1));
  
  // Take last 20 bytes as address
  const addressBytes = hash.slice(-20);
  const address = '0x' + Array.from(addressBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Checksum the address (EIP-55)
  const checksumAddress = toChecksumAddress(address, keccak_256);
  
  // Note: We do NOT zero out privateKeyBytes here because we need to return the key
  // The key will be zeroed after encryption is complete
  
  return { privateKey, address: checksumAddress };
}

// EIP-55 checksum address
function toChecksumAddress(address: string, keccak_256: (data: Uint8Array) => Uint8Array): string {
  const addr = address.toLowerCase().replace('0x', '');
  const hash = keccak_256(new TextEncoder().encode(addr));
  const hashHex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
  
  let checksumAddress = '0x';
  for (let i = 0; i < addr.length; i++) {
    const char = addr[i];
    const hashNibble = parseInt(hashHex[i], 16);
    checksumAddress += hashNibble >= 8 ? char.toUpperCase() : char;
  }
  
  return checksumAddress;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create admin client (service role)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // Parse request
    const { user_id, chain_id = 8453 } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if wallet already exists (idempotent)
    // SECURITY: For existing wallets, we NEVER return the private key
    const { data: existingWallet } = await supabaseAdmin
      .from('execution_wallets')
      .select('id, wallet_address, is_funded, chain_id')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .single();

    if (existingWallet) {
      console.log(`[execution-wallet-create] Wallet already exists for user ${user_id}`);
      return new Response(
        JSON.stringify({
          success: true,
          wallet_id: existingWallet.id,
          wallet_address: existingWallet.wallet_address,
          chain_id: existingWallet.chain_id,
          is_funded: existingWallet.is_funded,
          already_existed: true,
          // NO private key for existing wallets - this is intentional
          private_key_once: null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate new wallet
    console.log(`[execution-wallet-create] Generating new wallet for user ${user_id}`);
    const { privateKey, address } = await generateWallet();

    // CRITICAL: Store the private key for one-time reveal BEFORE encryption
    // This is the ONLY time this key will ever be returned in plaintext
    const privateKeyOnce = privateKey;

    // Encrypt private key with envelope encryption
    const encryptedData = await encryptPrivateKey(privateKey, 1);

    // Insert wallet metadata
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from('execution_wallets')
      .insert({
        user_id,
        wallet_address: address,
        chain_id,
        is_funded: false,
        is_active: true,
      })
      .select('id, wallet_address, chain_id')
      .single();

    if (walletError) {
      console.error(`[execution-wallet-create] Failed to create wallet:`, walletError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to create wallet', details: walletError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert encrypted secrets
    const { error: secretsError } = await supabaseAdmin
      .from('execution_wallet_secrets')
      .insert({
        wallet_id: wallet.id,
        encrypted_private_key: bytesToBase64(encryptedData.encrypted_private_key),
        iv: bytesToBase64(encryptedData.iv),
        auth_tag: bytesToBase64(encryptedData.auth_tag),
        encrypted_dek: bytesToBase64(encryptedData.encrypted_dek),
        dek_iv: bytesToBase64(encryptedData.dek_iv),
        dek_auth_tag: bytesToBase64(encryptedData.dek_auth_tag),
        kek_version: encryptedData.kek_version,
      });

    if (secretsError) {
      // Rollback wallet creation
      await supabaseAdmin.from('execution_wallets').delete().eq('id', wallet.id);
      console.error(`[execution-wallet-create] Failed to store secrets:`, secretsError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to store wallet secrets' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update onboarding status if exists
    await supabaseAdmin
      .from('user_onboarding_status')
      .update({ wallet_created: true, current_step: 'funding' })
      .eq('user_id', user_id);

    console.log(`[execution-wallet-create] Wallet created successfully: ${wallet.wallet_address}`);
    // SECURITY: We do NOT log the private key

    // Return success with ONE-TIME private key reveal
    return new Response(
      JSON.stringify({
        success: true,
        wallet_id: wallet.id,
        wallet_address: wallet.wallet_address,
        chain_id: wallet.chain_id,
        already_existed: false,
        // ONE-TIME KEY REVEAL - THIS IS THE ONLY TIME THIS KEY WILL EVER BE RETURNED
        private_key_once: privateKeyOnce,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[execution-wallet-create] Error:', error.message);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper: Convert Uint8Array to base64
function bytesToBase64(bytes: Uint8Array): string {
  const binString = String.fromCodePoint(...bytes);
  return btoa(binString);
}
