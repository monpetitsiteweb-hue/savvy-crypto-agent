// Market Availability Registry for EUR pairs
// Maintains definitive list of tradable BASE-EUR markets on Coinbase

export const SUPPORTED_EUR_PAIRS = [
  'BTC-EUR',
  'ETH-EUR', 
  'XRP-EUR',
  'ADA-EUR',
  'SOL-EUR',
  'DOT-EUR',
  'MATIC-EUR',
  'AVAX-EUR',
  'LINK-EUR',
  'UNI-EUR',
  'AAVE-EUR',
  'CRV-EUR',
  'USDC-EUR',
  'USDT-EUR',
  'LTC-EUR',
  'BCH-EUR',
  'XLM-EUR',
  'ALGO-EUR',
  'ATOM-EUR',
  'ICP-EUR',
  'FIL-EUR'
];

export const UNSUPPORTED_EUR_PAIRS = [
  'DAI-EUR',    // 404 - Delisted
  'COMP-EUR',   // 404 - Delisted  
  'SUSHI-EUR'   // 400 - Not available
];

export interface MarketAvailabilityCheck {
  symbol: string;
  isSupported: boolean;
  reason?: string;
}

/**
 * Check if a symbol has a supported EUR trading pair
 * @param symbol - Base symbol (e.g., 'BTC') or pair symbol (e.g., 'BTC-EUR')
 * @returns MarketAvailabilityCheck result
 */
export const checkMarketAvailability = (symbol: string): MarketAvailabilityCheck => {
  // Normalize to pair format
  const pairSymbol = symbol.includes('-') ? symbol : `${symbol}-EUR`;
  
  if (SUPPORTED_EUR_PAIRS.includes(pairSymbol)) {
    return {
      symbol: pairSymbol,
      isSupported: true
    };
  }
  
  if (UNSUPPORTED_EUR_PAIRS.includes(pairSymbol)) {
    return {
      symbol: pairSymbol,
      isSupported: false,
      reason: 'market_unavailable'
    };
  }
  
  // Unknown symbol - assume unsupported
  return {
    symbol: pairSymbol,
    isSupported: false,
    reason: 'market_unavailable'
  };
};

/**
 * Filter symbols to only supported EUR pairs for safe API calls
 * @param symbols - Array of base symbols or pair symbols
 * @returns Array of supported pair symbols only
 */
export const filterSupportedSymbols = (symbols: string[]): string[] => {
  return symbols
    .map(symbol => symbol.includes('-') ? symbol : `${symbol}-EUR`)
    .filter(pairSymbol => SUPPORTED_EUR_PAIRS.includes(pairSymbol));
};

/**
 * Get unsupported symbols from a list for UI warnings
 * @param symbols - Array of base symbols or pair symbols  
 * @returns Array of MarketAvailabilityCheck results for unsupported symbols
 */
export const getUnsupportedSymbols = (symbols: string[]): MarketAvailabilityCheck[] => {
  return symbols
    .map(checkMarketAvailability)
    .filter(check => !check.isSupported);
};