/**
 * Envelope Encryption for Execution Wallet Private Keys
 * 
 * Architecture:
 * - DEK (Data Encryption Key): Random 32-byte key, unique per wallet
 * - KEK (Key Encryption Key): Master key from env var, versioned
 * - Private Key encrypted with DEK (AES-256-GCM)
 * - DEK encrypted with KEK (AES-256-GCM)
 * 
 * SECURITY: Never log any key material, ciphertext, or IVs
 */

// Convert base64 to Uint8Array
function base64ToBytes(base64: string): Uint8Array {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
}

// Convert Uint8Array to base64
function bytesToBase64(bytes: Uint8Array): string {
  const binString = String.fromCodePoint(...bytes);
  return btoa(binString);
}

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// Convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Get KEK from environment by version
function getKEK(version: number): Uint8Array {
  const kekEnvVar = `EXECUTION_WALLET_KEK_V${version}`;
  const kekBase64 = Deno.env.get(kekEnvVar);
  
  if (!kekBase64) {
    throw new Error(`KEK version ${version} not found in environment`);
  }
  
  const kek = base64ToBytes(kekBase64);
  
  if (kek.length !== 32) {
    throw new Error(`KEK must be 32 bytes, got ${kek.length}`);
  }
  
  return kek;
}

// Import key for AES-GCM
async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// Generate random bytes
function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export interface EncryptedWalletData {
  encrypted_private_key: Uint8Array;
  iv: Uint8Array;
  auth_tag: Uint8Array;
  encrypted_dek: Uint8Array;
  dek_iv: Uint8Array;
  dek_auth_tag: Uint8Array;
  kek_version: number;
}

export interface DecryptedWallet {
  privateKey: string; // hex with 0x prefix
  walletAddress: string;
}

/**
 * Encrypt a private key using envelope encryption
 * 
 * @param privateKeyHex - Private key as hex string (with or without 0x prefix)
 * @param kekVersion - KEK version to use (default: 1)
 * @returns Encrypted data ready for database storage
 */
export async function encryptPrivateKey(
  privateKeyHex: string,
  kekVersion: number = 1
): Promise<EncryptedWalletData> {
  // Normalize private key (remove 0x if present)
  const cleanHex = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanHex);
  
  if (privateKeyBytes.length !== 32) {
    throw new Error('Private key must be 32 bytes');
  }
  
  // Generate DEK (random 32 bytes)
  const dek = randomBytes(32);
  
  // Encrypt private key with DEK
  const iv = randomBytes(12); // 96-bit IV for AES-GCM
  const dekKey = await importKey(dek);
  
  const encryptedPrivateKeyWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    dekKey,
    privateKeyBytes
  );
  
  // AES-GCM appends 16-byte auth tag to ciphertext
  const encryptedPrivateKeyFull = new Uint8Array(encryptedPrivateKeyWithTag);
  const encrypted_private_key = encryptedPrivateKeyFull.slice(0, -16);
  const auth_tag = encryptedPrivateKeyFull.slice(-16);
  
  // Encrypt DEK with KEK
  const kek = getKEK(kekVersion);
  const dek_iv = randomBytes(12);
  const kekKey = await importKey(kek);
  
  const encryptedDekWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: dek_iv },
    kekKey,
    dek
  );
  
  const encryptedDekFull = new Uint8Array(encryptedDekWithTag);
  const encrypted_dek = encryptedDekFull.slice(0, -16);
  const dek_auth_tag = encryptedDekFull.slice(-16);
  
  // Zero out sensitive data
  dek.fill(0);
  privateKeyBytes.fill(0);
  
  return {
    encrypted_private_key,
    iv,
    auth_tag,
    encrypted_dek,
    dek_iv,
    dek_auth_tag,
    kek_version: kekVersion,
  };
}

/**
 * Decrypt a private key using envelope encryption
 * 
 * @param encryptedData - Encrypted data from database
 * @returns Decrypted private key as hex string with 0x prefix
 */
export async function decryptPrivateKey(
  encryptedData: {
    encrypted_private_key: Uint8Array;
    iv: Uint8Array;
    auth_tag: Uint8Array;
    encrypted_dek: Uint8Array;
    dek_iv: Uint8Array;
    dek_auth_tag: Uint8Array;
    kek_version: number;
  }
): Promise<string> {
  // Get KEK for this version
  const kek = getKEK(encryptedData.kek_version);
  const kekKey = await importKey(kek);
  
  // Decrypt DEK
  const encryptedDekWithTag = new Uint8Array([
    ...encryptedData.encrypted_dek,
    ...encryptedData.dek_auth_tag,
  ]);
  
  const dekBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encryptedData.dek_iv },
    kekKey,
    encryptedDekWithTag
  );
  
  const dek = new Uint8Array(dekBytes);
  const dekKey = await importKey(dek);
  
  // Decrypt private key
  const encryptedPrivateKeyWithTag = new Uint8Array([
    ...encryptedData.encrypted_private_key,
    ...encryptedData.auth_tag,
  ]);
  
  const privateKeyBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encryptedData.iv },
    dekKey,
    encryptedPrivateKeyWithTag
  );
  
  const privateKey = '0x' + bytesToHex(new Uint8Array(privateKeyBytes));
  
  // Zero out DEK
  dek.fill(0);
  
  return privateKey;
}

/**
 * Re-encrypt DEK with a new KEK version (for key rotation)
 * Does NOT require decrypting the private key itself
 */
export async function rotateDekEncryption(
  encryptedData: {
    encrypted_dek: Uint8Array;
    dek_iv: Uint8Array;
    dek_auth_tag: Uint8Array;
    kek_version: number;
  },
  newKekVersion: number
): Promise<{
  encrypted_dek: Uint8Array;
  dek_iv: Uint8Array;
  dek_auth_tag: Uint8Array;
  kek_version: number;
}> {
  // Get old KEK and decrypt DEK
  const oldKek = getKEK(encryptedData.kek_version);
  const oldKekKey = await importKey(oldKek);
  
  const encryptedDekWithTag = new Uint8Array([
    ...encryptedData.encrypted_dek,
    ...encryptedData.dek_auth_tag,
  ]);
  
  const dekBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encryptedData.dek_iv },
    oldKekKey,
    encryptedDekWithTag
  );
  
  const dek = new Uint8Array(dekBytes);
  
  // Encrypt DEK with new KEK
  const newKek = getKEK(newKekVersion);
  const newKekKey = await importKey(newKek);
  const newDekIv = randomBytes(12);
  
  const newEncryptedDekWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: newDekIv },
    newKekKey,
    dek
  );
  
  const newEncryptedDekFull = new Uint8Array(newEncryptedDekWithTag);
  
  // Zero out DEK
  dek.fill(0);
  
  return {
    encrypted_dek: newEncryptedDekFull.slice(0, -16),
    dek_iv: newDekIv,
    dek_auth_tag: newEncryptedDekFull.slice(-16),
    kek_version: newKekVersion,
  };
}
