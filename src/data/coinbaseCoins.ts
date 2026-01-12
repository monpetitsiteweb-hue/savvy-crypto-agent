// Coinbase available coins for strategy configuration
// This list is based on commonly available coins on Coinbase Pro/Advanced Trade

export interface CoinInfo {
  symbol: string;
  name: string;
  category: 'major' | 'altcoin' | 'stablecoin' | 'defi';
  tradingPair: string; // EUR trading pair
}

// Only coins with verified working EUR pairs on Coinbase Exchange API
// Removed: NEAR, IMX, OP, VET, SUI, ARB, FLOW, HBAR (404 - no EUR pair)
// Removed: EOS, MATIC (400 - delisted)
export const COINBASE_COINS: CoinInfo[] = [
  // Major Cryptocurrencies (PRIORITY - fetch first)
  { symbol: 'BTC', name: 'Bitcoin', category: 'major', tradingPair: 'BTC-EUR' },
  { symbol: 'ETH', name: 'Ethereum', category: 'major', tradingPair: 'ETH-EUR' },
  
  // Top Altcoins (commonly traded)
  { symbol: 'XRP', name: 'XRP', category: 'altcoin', tradingPair: 'XRP-EUR' },
  { symbol: 'ADA', name: 'Cardano', category: 'altcoin', tradingPair: 'ADA-EUR' },
  { symbol: 'SOL', name: 'Solana', category: 'altcoin', tradingPair: 'SOL-EUR' },
  { symbol: 'AVAX', name: 'Avalanche', category: 'altcoin', tradingPair: 'AVAX-EUR' },
  { symbol: 'DOT', name: 'Polkadot', category: 'altcoin', tradingPair: 'DOT-EUR' },
  { symbol: 'LINK', name: 'Chainlink', category: 'altcoin', tradingPair: 'LINK-EUR' },
  
  // DeFi Tokens
  { symbol: 'UNI', name: 'Uniswap', category: 'defi', tradingPair: 'UNI-EUR' },
  { symbol: 'AAVE', name: 'Aave', category: 'defi', tradingPair: 'AAVE-EUR' },
  { symbol: 'CRV', name: 'Curve DAO', category: 'defi', tradingPair: 'CRV-EUR' },
  { symbol: 'GRT', name: 'The Graph', category: 'defi', tradingPair: 'GRT-EUR' },
  
  // Stablecoins
  { symbol: 'USDC', name: 'USD Coin', category: 'stablecoin', tradingPair: 'USDC-EUR' },
  { symbol: 'USDT', name: 'Tether', category: 'stablecoin', tradingPair: 'USDT-EUR' },
  
  // Other Verified Coins
  { symbol: 'LTC', name: 'Litecoin', category: 'altcoin', tradingPair: 'LTC-EUR' },
  { symbol: 'BCH', name: 'Bitcoin Cash', category: 'altcoin', tradingPair: 'BCH-EUR' },
  { symbol: 'XLM', name: 'Stellar', category: 'altcoin', tradingPair: 'XLM-EUR' },
  { symbol: 'ALGO', name: 'Algorand', category: 'altcoin', tradingPair: 'ALGO-EUR' },
  { symbol: 'ATOM', name: 'Cosmos', category: 'altcoin', tradingPair: 'ATOM-EUR' },
  { symbol: 'ICP', name: 'Internet Computer', category: 'altcoin', tradingPair: 'ICP-EUR' },
  { symbol: 'FIL', name: 'Filecoin', category: 'altcoin', tradingPair: 'FIL-EUR' },
  { symbol: 'DOGE', name: 'Dogecoin', category: 'altcoin', tradingPair: 'DOGE-EUR' },
  { symbol: 'SHIB', name: 'Shiba Inu', category: 'altcoin', tradingPair: 'SHIB-EUR' },
  { symbol: 'XTZ', name: 'Tezos', category: 'altcoin', tradingPair: 'XTZ-EUR' },
];

export const getCoinsByCategory = (category: CoinInfo['category']) => {
  return COINBASE_COINS.filter(coin => coin.category === category);
};

export const getMajorCoins = () => getCoinsByCategory('major');
export const getAltcoins = () => getCoinsByCategory('altcoin');
export const getStablecoins = () => getCoinsByCategory('stablecoin');
export const getDeFiCoins = () => getCoinsByCategory('defi');

export const getCoinInfo = (symbol: string): CoinInfo | undefined => {
  return COINBASE_COINS.find(coin => coin.symbol === symbol.toUpperCase());
};

export const getAllSymbols = (): string[] => {
  return COINBASE_COINS.map(coin => coin.symbol);
};

export const getAllTradingPairs = (): string[] => {
  return COINBASE_COINS.map(coin => coin.tradingPair);
};
