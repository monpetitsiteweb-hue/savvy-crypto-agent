import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- base64 helpers ----
function bytesToBase64(u8) {
  // chunked to avoid call stack / arg limits
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return Buffer.from(s, 'binary').toString('base64');
}

// ---- Legacy decoder: turns your "Buffer(data:[...]) of ASCII JSON" into real bytes ----
function toU8(value, fieldName = 'field') {
  if (value == null) throw new Error(`Missing ${fieldName}`);

  // Already array of numbers
  if (Array.isArray(value) && value.every(n => typeof n === 'number')) {
    return new Uint8Array(value);
  }

  // Supabase might return { type:"Buffer", data:[...] }
  if (typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
    const bytes = new Uint8Array(value.data);

    // If these bytes decode to a JSON string, parse it
    const text = new TextDecoder().decode(bytes).trim();
    if ((text.startsWith('{') || text.startsWith('[')) && text.includes('"0"')) {
      const parsed = JSON.parse(text);
      return toU8(parsed, `${fieldName}(inner-json)`);
    }
    return bytes;
  }

  // Numeric-key object: { "0":185, "1":91, ... }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length && keys.every(k => /^\d+$/.test(k))) {
      keys.sort((a, b) => Number(a) - Number(b));
      const out = new Uint8Array(keys.length);
      for (let i = 0; i < keys.length; i++) out[i] = Number(value[keys[i]]);
      return out;
    }
  }

  // If it's a string that is JSON, parse it
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      return toU8(JSON.parse(s), `${fieldName}(json-string)`);
    }
    throw new Error(`Unexpected string in ${fieldName}: not JSON`);
  }

  throw new Error(`Unsupported legacy shape for ${fieldName}: ${typeof value}`);
}

function assertLen(name, u8, allowed) {
  if (!allowed.includes(u8.length)) {
    throw new Error(`${name} invalid length: ${u8.length} (expected ${allowed.join(' or ')})`);
  }
}

async function main() {
  const { data: rows, error } = await supabase
    .from('execution_wallet_secrets')
    .select('wallet_id, encrypted_dek, dek_iv, dek_auth_tag, encrypted_private_key, iv, auth_tag')
    .limit(10000);

  if (error) throw error;
  if (!rows?.length) {
    console.log('No rows');
    return;
  }

  let ok = 0, bad = 0;

  for (const r of rows) {
    try {
      const encrypted_dek = toU8(r.encrypted_dek, 'encrypted_dek');
      const dek_iv        = toU8(r.dek_iv, 'dek_iv');
      const dek_auth_tag  = toU8(r.dek_auth_tag, 'dek_auth_tag');

      const encrypted_pk  = toU8(r.encrypted_private_key, 'encrypted_private_key');
      const pk_iv         = toU8(r.iv, 'iv');
      const pk_auth_tag   = toU8(r.auth_tag, 'auth_tag');

      // IV can be 12 (standard) or 16 depending on your earlier code; auth tag must be 16.
      assertLen('dek_iv', dek_iv, [12, 16]);
      assertLen('dek_auth_tag', dek_auth_tag, [16]);
      assertLen('pk_iv', pk_iv, [12, 16]);
      assertLen('pk_auth_tag', pk_auth_tag, [16]);

      const payload = {
        encrypted_dek_b64: bytesToBase64(encrypted_dek),
        dek_iv_b64: bytesToBase64(dek_iv),
        dek_auth_tag_b64: bytesToBase64(dek_auth_tag),

        encrypted_private_key_b64: bytesToBase64(encrypted_pk),
        iv_b64: bytesToBase64(pk_iv),
        auth_tag_b64: bytesToBase64(pk_auth_tag),

        secrets_format: 'base64_v1',
      };

      const { error: upErr } = await supabase
        .from('execution_wallet_secrets')
        .update(payload)
        .eq('wallet_id', r.wallet_id);

      if (upErr) throw upErr;

      ok++;
      console.log(`OK ${r.wallet_id}`);
    } catch (e) {
      bad++;
      console.error(`FAIL ${r.wallet_id}:`, e?.message || e);
    }
  }

  console.log({ ok, bad, total: rows.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
