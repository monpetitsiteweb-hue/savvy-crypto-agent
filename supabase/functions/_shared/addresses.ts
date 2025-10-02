/**
 * Centralized contract addresses and constants for onchain execution
 * Ref: https://0x.org/docs/api-references/swap-api/guides/use-0x-api-liquidity-in-your-smart-contracts
 */

export const BASE_CHAIN_ID = 8453;

// Token addresses on Base
export const BASE_TOKENS = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  // Native ETH sentinel for 0x /price endpoint
  ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
} as const;

// 0x v2 Permit2 integration addresses
// Ref: https://docs.0x.org/0x-swap-api/advanced-topics/erc20-transformation#permit2
export const BASE_0X = {
  // 0x Permit2 Swap Router (spender for allowances)
  SPENDER: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  // Uniswap Permit2 contract
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
} as const;

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
