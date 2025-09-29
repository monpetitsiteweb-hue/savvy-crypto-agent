export type Token = { address: string; decimals: number; symbol: string };

// Native "ETH" sentinel for 0x
export const NATIVE: Token = { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, symbol: 'ETH' };

// Token maps per chain with USDC, WETH, and ETH sentinel
export const TOKEN_MAP: Record<number, Record<string, Token>> = {
  1: {
    ETH: NATIVE,
    USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, symbol: 'USDC' },
    WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, symbol: 'WETH' }
  },
  8453: { // Base
    ETH: NATIVE,
    USDC: { address: '0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, symbol: 'USDC' },
    WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' }
  },
  42161: { // Arbitrum
    ETH: NATIVE,
    USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, symbol: 'USDC' },
    WETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, symbol: 'WETH' }
  }
};

// Legacy exports for backward compatibility
export const TOKENS: Record<number, Record<'ETH'|'USDC', Token>> = {
  1: {
    ETH: TOKEN_MAP[1].ETH,
    USDC: TOKEN_MAP[1].USDC
  },
  8453: {
    ETH: TOKEN_MAP[8453].ETH,
    USDC: TOKEN_MAP[8453].USDC
  },
  42161: {
    ETH: TOKEN_MAP[42161].ETH,
    USDC: TOKEN_MAP[42161].USDC
  }
};

export const WETH: Record<number, Token> = {
  1: TOKEN_MAP[1].WETH,
  8453: TOKEN_MAP[8453].WETH,
  42161: TOKEN_MAP[42161].WETH,
};

// Normalize token symbol or address to token info
export function normalizeToken(chainId: number, symbolOrAddr: string): Token {
  const chainTokens = TOKEN_MAP[chainId];
  if (!chainTokens) {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }

  // Check if it's a symbol (ETH, USDC, WETH)
  const upperSymbol = symbolOrAddr.toUpperCase();
  if (chainTokens[upperSymbol]) {
    return chainTokens[upperSymbol];
  }

  // Check if it's already a valid 0x... address
  if (symbolOrAddr.match(/^0x[a-fA-F0-9]{40}$/)) {
    // For addresses, we need to determine decimals - default to 18 for unknown tokens
    return { address: symbolOrAddr.toLowerCase(), decimals: 18, symbol: symbolOrAddr };
  }

  throw new Error(`Invalid token symbol or address: ${symbolOrAddr} for chainId ${chainId}`);
}

export const toAtomic = (v: number | string, d: number) => {
  const s = typeof v === 'number' ? v.toString() : v;
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(d)).slice(0, d);
  return BigInt(i + frac);
};