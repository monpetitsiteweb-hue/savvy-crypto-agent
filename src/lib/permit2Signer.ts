// src/lib/permit2Signer.ts
// Client-side helper for calling the permit2 signer service
// Note: This file is for reference - actual signing happens in edge functions using Deno

import { recoverTypedDataAddress } from "viem";

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
 * This is a client-side reference - edge functions use the Deno version
 */
export async function signPermit2Single(payload: Permit2SinglePayload, config?: {
  signerUrl?: string;
  signerHmac?: string;
}) {
  const SIGNER_URL = config?.signerUrl || process.env.PERMIT_SIGNER_URL;
  const SIGNER_HMAC = config?.signerHmac || process.env.PERMIT_SIGNER_HMAC;

  if (!SIGNER_URL || !SIGNER_HMAC) {
    throw new Error("Missing PERMIT_SIGNER_URL or PERMIT_SIGNER_HMAC env");
  }
  
  if (payload.domain.chainId !== ALLOW_CHAIN) {
    throw new Error(`Chain not allowed: ${payload.domain.chainId}`);
  }

  const bodyStr = JSON.stringify(payload);
  
  // For browser/Node.js - in edge functions, use Deno's crypto API
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

  const r = await fetch(`${SIGNER_URL}/sign/permit2-single`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hmac": hmac },
    body: bodyStr
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`permit-signer error ${r.status}: ${text}`);
  }

  const reply = await r.json() as {
    ok: true;
    signer: Address;
    signature: `0x${string}`;
  };

  // Safety belt: verify the signature matches the payload
  const recovered = await recoverTypedDataAddress({
    domain: payload.domain as any,
    types: payload.types as any,
    primaryType: payload.primaryType,
    message: payload.message as any,
    signature: reply.signature,
  });

  if (recovered.toLowerCase() !== reply.signer.toLowerCase()) {
    throw new Error(`Signature mismatch: recovered=${recovered} signer=${reply.signer}`);
  }

  return reply; // { signer, signature }
}
