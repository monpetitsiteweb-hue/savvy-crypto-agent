// supabase/functions/_shared/permit2Payload.ts
// Helper to build the exact Permit2 EIP-712 payload for Base chain
// Deno-compatible version for edge functions

type Address = `0x${string}`;

export interface Permit2PayloadParams {
  token: Address;          // WETH on Base
  amountWei: string;       // e.g. "100000000000000" (0.0001)
  spender: Address;        // 0x Proxy on Base
  sigDeadlineSec: number;  // e.g. Math.floor(Date.now()/1000) + 1800
  nonce?: string;          // Optional nonce, defaults to "0"
  expiration?: string;     // Optional expiration, defaults to "0" (no expiration)
}

/**
 * Creates a properly formatted Permit2 EIP-712 payload for Base chain (8453)
 * 
 * @param params - Configuration for the Permit2 approval
 * @returns Complete EIP-712 typed data structure ready for signing
 */
export function makePermit2Payload(params: Permit2PayloadParams) {
  return {
    domain: {
      name: "Permit2",
      version: "1",
      chainId: 8453,
      verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
    },
    types: {
      PermitSingle: [
        { name: "details",     type: "PermitDetails" },
        { name: "spender",     type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
      PermitDetails: [
        { name: "token",      type: "address" },
        { name: "amount",     type: "uint160" },
        { name: "expiration", type: "uint48"  },
        { name: "nonce",      type: "uint48"  },
      ],
    },
    primaryType: "PermitSingle" as const,
    message: {
      details: {
        token: params.token,
        amount: params.amountWei,
        expiration: params.expiration || "0",
        nonce: params.nonce || "0",
      },
      spender: params.spender,
      sigDeadline: String(params.sigDeadlineSec),
    },
  };
}
