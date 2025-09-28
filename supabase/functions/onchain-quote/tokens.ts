export type Token = { address: string; decimals: number; symbol: string };

// Native "ETH" sentinel for 0x
export const NATIVE: Token = { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, symbol: 'ETH' };

export const TOKENS: Record<number, Record<'ETH'|'USDC', Token>> = {
  1: {
    ETH: NATIVE,
    USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, symbol: 'USDC' }
  },
  8453: { // Base
    ETH: NATIVE,
    USDC: { address: '0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, symbol: 'USDC' }
  },
  42161: { // Arbitrum
    ETH: NATIVE,
    USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, symbol: 'USDC' }
  }
};

export const toAtomic = (v: number | string, d: number) => {
  const s = typeof v === 'number' ? v.toString() : v;
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(d)).slice(0, d);
  return BigInt(i + frac);
};