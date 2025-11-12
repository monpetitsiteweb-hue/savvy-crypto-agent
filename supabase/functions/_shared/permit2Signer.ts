// supabase/functions/_shared/permit2Signer.ts
// Deno-compatible Permit2 signer client for edge functions

type Address = `0x${string}`;

export type Permit2SinglePayload = {
  domain: { name: "Permit2"; version: "1"; chainId: number; verifyingContract: Address };
  types: {
    PermitSingle: { name: string; type: string }[];
    PermitDetails: { name: string; type: string }[];
  };
  primaryType: "PermitSingle";
  message: {
    details: { token: Address; amount: string; expiration: string; nonce: string };
    spender: Address;
    sigDeadline: string;
  };
};

const ALLOW_CHAIN = 8453; // Base

/**
 * Sign a Permit2 payload using the remote signer service
 * Deno-compatible version for edge functions
 */
export async function signPermit2Single(payload: Permit2SinglePayload) {
  const SIGNER_URL = Deno.env.get('SIGNER_WEBHOOK_URL');
  const SIGNER_HMAC = Deno.env.get('SIGNER_WEBHOOK_AUTH');

  if (!SIGNER_URL || !SIGNER_HMAC) {
    throw new Error("Missing SIGNER_WEBHOOK_URL or SIGNER_WEBHOOK_AUTH env");
  }
  
  if (payload.domain.chainId !== ALLOW_CHAIN) {
    throw new Error(`Chain not allowed: ${payload.domain.chainId}`);
  }

  const bodyStr = JSON.stringify(payload);
  
  // Deno Web Crypto API
  const encoder = new TextEncoder();
  const bodyBuf = encoder.encode(bodyStr);
  const keyBuf = encoder.encode(SIGNER_HMAC);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signatureBuf = await crypto.subtle.sign("HMAC", cryptoKey, bodyBuf);
  const hmac = Array.from(new Uint8Array(signatureBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  console.log('permit2.sign.request', { sigDeadline: payload.message.sigDeadline });

  const r = await fetch(`${SIGNER_URL}/sign/permit2-single`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hmac": hmac },
    body: bodyStr
  });

  if (!r.ok) {
    const text = await r.text();
    console.error('permit2.sign.error', { status: r.status, error: text });
    throw new Error(`permit-signer error ${r.status}: ${text}`);
  }

  const reply = await r.json() as {
    ok: true;
    signer: Address;
    signature: `0x${string}`;
  };

  console.log('permit2.sign.success', { signer: reply.signer });

  // Note: Signature verification can be added here using viem if needed
  // For now, trust the signer service since it's HMAC-authenticated

  return reply; // { signer, signature }
}
