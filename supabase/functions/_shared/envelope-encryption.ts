/**
 * Envelope Encryption for Execution Wallet Private Keys
 *
 * SYSTEM-CUSTODIED MODEL - Keys never leave the server.
 *
 * Architecture:
 * - DEK (Data Encryption Key): Random 32-byte key, unique per wallet
 * - KEK (Key Encryption Key): Master key from env var, HEX ONLY, versioned
 * - Private Key encrypted with DEK (AES-256-GCM)
 * - DEK encrypted with KEK (AES-256-GCM)
 *
 * INVARIANTS:
 * - KEK format: HEX ONLY, exactly 32 bytes (64 hex chars)
 * - No base64 support, no fallback, no format detection
 * - One encryption path, one decryption path
 * - No export functionality
 *
 * SECURITY: Never log any key material, ciphertext, or IVs
 */

// ─────────────────────────────────────────────────────────────
// Encoding helpers
// ─────────────────────────────────────────────────────────────

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Invalid hex string");
  }
  if (hex.length % 2 !== 0) {
    throw new Error("Hex string must have even length");
  }

  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─────────────────────────────────────────────────────────────
// KEK handling — HEX ONLY (LOCKED)
// ─────────────────────────────────────────────────────────────

function getKEK(version: number): Uint8Array {
  const envVar = `EXECUTION_WALLET_KEK_V${version}`;
  const raw = Deno.env.get(envVar);

  if (!raw) {
    throw new Error(`Missing KEK version ${version}`);
  }

  const trimmed = raw.trim();

  // EXACTLY 64 hex chars → 32 bytes
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("KEK must be exactly 64 hex characters (32 bytes)");
  }

  const kek = hexToBytes(trimmed);

  if (kek.length !== 32) {
    throw new Error(`KEK must be exactly 32 bytes, got ${kek.length}`);
  }

  return kek;
}

// ─────────────────────────────────────────────────────────────
// Crypto helpers
// ─────────────────────────────────────────────────────────────

// Import key for AES-GCM
async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// Generate random bytes
function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface EncryptedWalletData {
  encrypted_private_key: Uint8Array;
  iv: Uint8Array;
  auth_tag: Uint8Array;
  encrypted_dek: Uint8Array;
  dek_iv: Uint8Array;
  dek_auth_tag: Uint8Array;
  kek_version: number;
}

// ─────────────────────────────────────────────────────────────
// Encryption
// ─────────────────────────────────────────────────────────────

export async function encryptPrivateKey(privateKeyHex: string, kekVersion: number = 1): Promise<EncryptedWalletData> {
  // Normalize private key
  const cleanHex = privateKeyHex.startsWith("0x") ? privateKeyHex.slice(2) : privateKeyHex;

  const privateKeyBytes = hexToBytes(cleanHex);

  if (privateKeyBytes.length !== 32) {
    throw new Error("Private key must be exactly 32 bytes");
  }

  // Generate DEK
  const dek = randomBytes(32);

  // Encrypt private key with DEK
  const iv = randomBytes(12);
  const dekKey = await importKey(dek);

  const encryptedPrivateKeyWithTag = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dekKey, privateKeyBytes);

  const encryptedPrivateKeyFull = new Uint8Array(encryptedPrivateKeyWithTag);
  const encrypted_private_key = encryptedPrivateKeyFull.slice(0, -16);
  const auth_tag = encryptedPrivateKeyFull.slice(-16);

  // Encrypt DEK with KEK
  const kek = getKEK(kekVersion);
  const dek_iv = randomBytes(12);
  const kekKey = await importKey(kek);

  const encryptedDekWithTag = await crypto.subtle.encrypt({ name: "AES-GCM", iv: dek_iv }, kekKey, dek);

  const encryptedDekFull = new Uint8Array(encryptedDekWithTag);
  const encrypted_dek = encryptedDekFull.slice(0, -16);
  const dek_auth_tag = encryptedDekFull.slice(-16);

  // Zero sensitive material
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

// ─────────────────────────────────────────────────────────────
// Decryption
// ─────────────────────────────────────────────────────────────

export async function decryptPrivateKey(encryptedData: {
  encrypted_private_key: Uint8Array;
  iv: Uint8Array;
  auth_tag: Uint8Array;
  encrypted_dek: Uint8Array;
  dek_iv: Uint8Array;
  dek_auth_tag: Uint8Array;
  kek_version: number;
}): Promise<string> {
  // Load KEK
  const kek = getKEK(encryptedData.kek_version);
  const kekKey = await importKey(kek);

  // Decrypt DEK
  const encryptedDekWithTag = new Uint8Array([...encryptedData.encrypted_dek, ...encryptedData.dek_auth_tag]);

  const dekBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: encryptedData.dek_iv },
    kekKey,
    encryptedDekWithTag,
  );

  const dek = new Uint8Array(dekBytes);
  const dekKey = await importKey(dek);

  // Decrypt private key
  const encryptedPrivateKeyWithTag = new Uint8Array([
    ...encryptedData.encrypted_private_key,
    ...encryptedData.auth_tag,
  ]);

  const privateKeyBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: encryptedData.iv },
    dekKey,
    encryptedPrivateKeyWithTag,
  );

  const privateKey = "0x" + bytesToHex(new Uint8Array(privateKeyBytes));

  // Zero DEK
  dek.fill(0);

  return privateKey;
}

// NOTE:
// - KEK rotation is intentionally NOT implemented for MVP.
// - Changing KEK requires deleting all wallets first.
// - This invariant is ENFORCED by design.
