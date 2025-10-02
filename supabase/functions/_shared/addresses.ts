/**
 * Centralized contract addresses and constants for onchain execution
 * 
 * Key distinction:
 * - PERMIT2: Uniswap's Permit2 contract for signature-based approvals (EIP-712)
 * - SPENDER: 0x Exchange Proxy that executes swaps and pulls tokens via Permit2
 * 
 * Ref: https://0x.org/docs/0x-swap-api/advanced-topics/permit2-erc20-approvals
 * Ref: https://docs.0x.org/0x-swap-api/api-references/get-swap-v1-quote
 * Base contracts: https://docs.base.org/docs/contracts
 */

export const BASE_CHAIN_ID = 8453;

// Token addresses on Base
export const BASE_TOKENS = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  // Native ETH sentinel for 0x /price endpoint
  ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
} as const;

// Token decimals on Base
export const BASE_DECIMALS = {
  WETH: 18,
  USDC: 6,
} as const;

/**
 * Safe formatter to convert wei/atomic BigInt to human-readable string
 * Avoids Number(BigInt) overflow by using string math
 */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  const str = amount.toString();
  if (str === '0') return '0.000000';
  
  const negative = str.startsWith('-');
  const absStr = negative ? str.slice(1) : str;
  
  if (absStr.length <= decimals) {
    // Less than 1 unit: pad with leading zeros
    const padded = absStr.padStart(decimals, '0');
    const result = `0.${padded}`;
    return (negative ? '-' : '') + result.slice(0, decimals + 8); // Max 6 decimal places shown
  }
  
  // >= 1 unit: insert decimal point
  const intPart = absStr.slice(0, -decimals);
  const fracPart = absStr.slice(-decimals).padEnd(6, '0').slice(0, 6);
  return (negative ? '-' : '') + `${intPart}.${fracPart}`;
}

// 0x v2 Permit2 integration addresses on Base
// Ref: https://docs.0x.org/0x-swap-api/advanced-topics/erc20-transformation#permit2
export const BASE_0X = {
  // 0x Exchange Proxy v4 (the router that executes swaps via Permit2)
  // This is the spender you grant allowance to via Permit2
  SPENDER: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF',
  // Uniswap Permit2 contract (handles signature validation & token transfers)
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
} as const;

// ============================================================================
// 0x v2 "Settler" Architecture & Security Model
// ============================================================================
//
// IMPORTANT: 0x v2 uses dynamic "Settler" contracts for routing instead of
// a fixed Exchange Proxy. Each quote may target a different Settler address
// deployed on-chain, returned in the quote's `transaction.to` field.
//
// For headless signing safety, /onchain-sign-and-send validates that:
// - tx_payload.to matches the original raw_quote.transaction.to (for provider='0x')
// - This prevents substitution attacks while supporting 0x v2's dynamic routing
//
// Reference: https://0x.org/docs/tx-relay-api/introduction
//
// The legacy 0x Exchange Proxy (0xDef1C0de...) below is kept for backwards
// compatibility with older quotes and as a fallback allowlist for non-0x providers.
// ============================================================================

// Allowed destination addresses for onchain execution (Base)
// Used by signer to validate transactions (fallback for non-0x providers)
export const ALLOWED_TO_ADDRESSES = [
  BASE_0X.SPENDER, // Legacy 0x Exchange Proxy v4 (fallback)
] as const;

// Permit2 domain for EIP-712
export const PERMIT2_DOMAIN = {
  name: 'Permit2',
  chainId: BASE_CHAIN_ID,
  verifyingContract: BASE_0X.PERMIT2,
} as const;

// Permit2 EIP-712 types for single token approval
export const PERMIT2_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
} as const;
