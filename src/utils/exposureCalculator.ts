// Exposure Calculator - Centralized exposure logic for risk management
// Used by Intelligent Engine and Coordinator for pooling/DCA decisions

export interface ExposureParams {
  positions: Array<{
    cryptocurrency: string;
    remaining_amount: number;
    average_price: number;
    total_value: number;
  }>;
  marketData: Record<string, { price: number }>;
  config: {
    maxWalletExposure?: number;           // Max % of wallet in positions (e.g., 80)
    riskManagement?: {
      maxWalletExposure?: number;         // Nested version
    };
    maxActiveCoins?: number;              // Max unique coins with exposure
    perTradeAllocation?: number;          // EUR per trade
    selectedCoins?: string[];             // Configured coins for the strategy
    walletValueEUR?: number;              // Total wallet value in EUR
  };
}

export interface ExposureResult {
  // Per-symbol exposure
  symbolExposures: Record<string, {
    currentExposureEUR: number;
    maxExposureEUR: number;
    remainingCapacityEUR: number;
    canAddTrade: boolean;
  }>;
  
  // Global stats
  totalExposureEUR: number;
  maxWalletExposureEUR: number;
  remainingWalletCapacityEUR: number;
  
  // Coin counts
  uniqueCoinsWithExposure: number;
  maxActiveCoins: number;
  canAddNewCoin: boolean;
  
  // Derived limits
  perTradeAllocation: number;
  maxExposurePerCoinEUR: number;
}

/**
 * Calculate exposure metrics for the intelligent engine
 * Uses existing config params - NO new knobs
 * 
 * Derivation:
 *   maxWalletExposurePct = min(maxWalletExposure, riskManagement.maxWalletExposure) in %
 *   maxCoins = maxActiveCoins OR selectedCoins.length
 *   maxExposurePerCoinEUR = walletValueEUR * (maxWalletExposurePct / 100) / maxCoins
 */
export function calculateExposure(params: ExposureParams): ExposureResult {
  const { positions, marketData, config } = params;
  
  // Get wallet value (default to 30000 EUR for test mode)
  const walletValueEUR = config.walletValueEUR || 30000;
  
  // Get max wallet exposure % (take minimum of both sources if both exist)
  const maxWalletExposurePct1 = config.maxWalletExposure ?? 80;
  const maxWalletExposurePct2 = config.riskManagement?.maxWalletExposure ?? 80;
  const maxWalletExposurePct = Math.min(maxWalletExposurePct1, maxWalletExposurePct2);
  
  // Get max active coins (use selectedCoins length as fallback)
  const selectedCoinsCount = (config.selectedCoins || []).length || 5;
  const maxActiveCoins = config.maxActiveCoins || selectedCoinsCount;
  
  // Per-trade allocation in EUR
  const perTradeAllocation = config.perTradeAllocation || 50;
  
  // Calculate derived max exposure per coin
  const maxWalletExposureEUR = walletValueEUR * (maxWalletExposurePct / 100);
  const maxExposurePerCoinEUR = maxWalletExposureEUR / maxActiveCoins;
  
  // Calculate per-symbol exposures
  const symbolExposures: ExposureResult['symbolExposures'] = {};
  let totalExposureEUR = 0;
  const coinsWithExposure = new Set<string>();
  
  for (const position of positions) {
    const baseSymbol = position.cryptocurrency.replace('-EUR', '');
    const pairSymbol = `${baseSymbol}-EUR`;
    
    // Get current price (prefer market data, fall back to position avg price)
    const currentPrice = marketData[pairSymbol]?.price || 
                        marketData[baseSymbol]?.price || 
                        position.average_price;
    
    // Calculate current exposure for this symbol
    const currentExposureEUR = position.remaining_amount * currentPrice;
    
    if (currentExposureEUR > 0.01) { // Ignore dust
      coinsWithExposure.add(baseSymbol);
      totalExposureEUR += currentExposureEUR;
      
      // Accumulate if multiple positions for same symbol
      if (!symbolExposures[baseSymbol]) {
        symbolExposures[baseSymbol] = {
          currentExposureEUR: 0,
          maxExposureEUR: maxExposurePerCoinEUR,
          remainingCapacityEUR: maxExposurePerCoinEUR,
          canAddTrade: true,
        };
      }
      
      symbolExposures[baseSymbol].currentExposureEUR += currentExposureEUR;
      symbolExposures[baseSymbol].remainingCapacityEUR = 
        Math.max(0, maxExposurePerCoinEUR - symbolExposures[baseSymbol].currentExposureEUR);
      symbolExposures[baseSymbol].canAddTrade = 
        symbolExposures[baseSymbol].remainingCapacityEUR >= perTradeAllocation;
    }
  }
  
  const uniqueCoinsWithExposure = coinsWithExposure.size;
  const canAddNewCoin = uniqueCoinsWithExposure < maxActiveCoins;
  const remainingWalletCapacityEUR = Math.max(0, maxWalletExposureEUR - totalExposureEUR);
  
  return {
    symbolExposures,
    totalExposureEUR,
    maxWalletExposureEUR,
    remainingWalletCapacityEUR,
    uniqueCoinsWithExposure,
    maxActiveCoins,
    canAddNewCoin,
    perTradeAllocation,
    maxExposurePerCoinEUR,
  };
}

/**
 * Check if a new BUY can be made for a specific symbol
 * Returns { allowed: boolean, reason: string, details: object }
 */
export function canBuySymbol(
  symbol: string,
  exposure: ExposureResult,
  perTradeAllocation?: number
): { allowed: boolean; reason: string; details: Record<string, any> } {
  const baseSymbol = symbol.replace('-EUR', '');
  const tradeAmount = perTradeAllocation || exposure.perTradeAllocation;
  
  // Check 1: Global wallet exposure limit
  if (exposure.remainingWalletCapacityEUR < tradeAmount) {
    return {
      allowed: false,
      reason: 'max_wallet_exposure_reached',
      details: {
        totalExposureEUR: exposure.totalExposureEUR,
        maxWalletExposureEUR: exposure.maxWalletExposureEUR,
        remainingCapacityEUR: exposure.remainingWalletCapacityEUR,
        tradeAmount,
      },
    };
  }
  
  // Check 2: Max active coins (unique coins) limit
  const existingExposure = exposure.symbolExposures[baseSymbol];
  const isNewCoin = !existingExposure || existingExposure.currentExposureEUR < 0.01;
  
  if (isNewCoin && !exposure.canAddNewCoin) {
    return {
      allowed: false,
      reason: 'max_active_coins_reached',
      details: {
        uniqueCoinsWithExposure: exposure.uniqueCoinsWithExposure,
        maxActiveCoins: exposure.maxActiveCoins,
        symbol: baseSymbol,
      },
    };
  }
  
  // Check 3: Per-symbol exposure limit
  if (existingExposure && !existingExposure.canAddTrade) {
    return {
      allowed: false,
      reason: 'max_exposure_per_coin_reached',
      details: {
        symbol: baseSymbol,
        currentExposureEUR: existingExposure.currentExposureEUR,
        maxExposureEUR: existingExposure.maxExposureEUR,
        remainingCapacityEUR: existingExposure.remainingCapacityEUR,
        tradeAmount,
      },
    };
  }
  
  // All checks passed
  return {
    allowed: true,
    reason: 'exposure_within_limits',
    details: {
      symbol: baseSymbol,
      currentSymbolExposure: existingExposure?.currentExposureEUR || 0,
      maxSymbolExposure: exposure.maxExposurePerCoinEUR,
      totalExposureEUR: exposure.totalExposureEUR,
      tradeAmount,
    },
  };
}

/**
 * Find the best symbol to trade from a list of candidates
 * Prefers symbols with lowest exposure that still allow a trade
 */
export function findBestSymbolForTrade(
  candidateSymbols: string[],
  exposure: ExposureResult
): { symbol: string | null; reason: string } {
  // Filter to symbols that can accept a trade
  const tradeable = candidateSymbols
    .map(symbol => {
      const check = canBuySymbol(symbol, exposure);
      return { symbol, ...check };
    })
    .filter(c => c.allowed);
  
  if (tradeable.length === 0) {
    return { symbol: null, reason: 'no_symbols_within_exposure_limits' };
  }
  
  // Sort by current exposure (prefer lower exposure)
  tradeable.sort((a, b) => {
    const expA = exposure.symbolExposures[a.symbol.replace('-EUR', '')]?.currentExposureEUR || 0;
    const expB = exposure.symbolExposures[b.symbol.replace('-EUR', '')]?.currentExposureEUR || 0;
    return expA - expB;
  });
  
  return { symbol: tradeable[0].symbol, reason: 'exposure_optimized_selection' };
}
