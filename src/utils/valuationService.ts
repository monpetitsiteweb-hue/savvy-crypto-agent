// Single source of truth for all P&L calculations
export interface ValuationInputs {
  symbol: string;
  amount: number;
  entry_price: number;
  purchase_value: number;
}

export interface ValuationOutputs {
  current_value: number;
  pnl_eur: number;
  pnl_pct: number;
  current_price: number;
}

export interface IntegrityCheck {
  is_valid: boolean;
  errors: string[];
}

// Current price cache to avoid repeated API calls
const priceCache = new Map<string, { price: number; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

async function getCurrentPrice(symbol: string): Promise<number> {
  const normalizedSymbol = symbol.replace('-EUR', '');
  const cacheKey = normalizedSymbol;
  const cached = priceCache.get(cacheKey);
  
  // Use cache if recent
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price;
  }
  
  try {
    const coinbaseSymbol = `${normalizedSymbol}-EUR`;
    const response = await fetch(`https://api.exchange.coinbase.com/products/${coinbaseSymbol}/ticker`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch price for ${coinbaseSymbol}: ${response.status}`);
    }
    
    const data = await response.json();
    const price = parseFloat(data.price);
    
    // Cache the result
    priceCache.set(cacheKey, { price, timestamp: Date.now() });
    
    return price;
  } catch (error) {
    console.error(`❌ VALUATION: Failed to get current price for ${symbol}:`, error);
    // Fallback to entry price if current price unavailable
    return 0;
  }
}

export async function calculateValuation(
  inputs: ValuationInputs,
  currentPriceOverride?: number
): Promise<ValuationOutputs> {
  const current_price = currentPriceOverride ?? await getCurrentPrice(inputs.symbol);
  
  // Core valuation calculations (single source of truth)
  const current_value = inputs.amount * current_price;
  const pnl_eur = current_value - inputs.purchase_value;
  const pnl_pct = inputs.entry_price > 0 
    ? ((current_price / inputs.entry_price) - 1) * 100 
    : 0;
  
  return {
    current_value: Math.round(current_value * 100) / 100, // Round to cents
    pnl_eur: Math.round(pnl_eur * 100) / 100,
    pnl_pct: Math.round(pnl_pct * 100) / 100,
    current_price: Math.round(current_price * 100) / 100
  };
}

export function checkIntegrity(inputs: ValuationInputs): IntegrityCheck {
  const errors: string[] = [];
  const epsilon = 0.01; // 1 cent tolerance
  
  // Check: purchase_value should equal amount * entry_price
  const expected_purchase_value = inputs.amount * inputs.entry_price;
  if (Math.abs(inputs.purchase_value - expected_purchase_value) > epsilon) {
    errors.push(`Purchase value mismatch: ${inputs.purchase_value} ≠ ${inputs.amount} × ${inputs.entry_price} = ${expected_purchase_value}`);
  }
  
  // Check for suspicious values
  if (inputs.entry_price === 100 && inputs.amount >= 10) {
    errors.push('Suspicious entry price of €100 with high amount (possible placeholder corruption)');
  }
  
  if (inputs.amount <= 0 || inputs.entry_price <= 0 || inputs.purchase_value <= 0) {
    errors.push('Invalid negative or zero values detected');
  }
  
  return {
    is_valid: errors.length === 0,
    errors
  };
}

export function calculatePortfolioMetrics(positions: ValuationInputs[], currentPrices: Record<string, number>) {
  let totalUnrealizedPnL = 0;
  let totalCurrentValue = 0;
  let totalPurchaseValue = 0;
  
  for (const position of positions) {
    const currentPrice = currentPrices[position.symbol] || 0;
    const currentValue = position.amount * currentPrice;
    const pnlEur = currentValue - position.purchase_value;
    
    totalUnrealizedPnL += pnlEur;
    totalCurrentValue += currentValue;
    totalPurchaseValue += position.purchase_value;
  }
  
  return {
    unrealized_pnl: Math.round(totalUnrealizedPnL * 100) / 100,
    total_current_value: Math.round(totalCurrentValue * 100) / 100,
    total_purchase_value: Math.round(totalPurchaseValue * 100) / 100,
    total_pnl_pct: totalPurchaseValue > 0 
      ? Math.round(((totalUnrealizedPnL / totalPurchaseValue) * 100) * 100) / 100
      : 0
  };
}