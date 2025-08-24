// Regression guards to prevent P&L corruption from recurring

export interface TradeValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface PortfolioConsistencyResult {
  isConsistent: boolean;
  expectedTotal: number;
  actualTotal: number;
  variance: number;
}

/**
 * GUARD 1: Price corruption prevention
 * Prevents trades with suspicious placeholder prices (€100 exactly)
 */
export function validateTradePrice(price: number, symbol: string): TradeValidationResult {
  const errors: string[] = [];
  
  // Block €100 exactly (known corruption pattern)
  if (price === 100) {
    errors.push(`BLOCKED: Price €${price} matches corruption pattern for ${symbol}`);
  }
  
  // Block unrealistic prices for major cryptos
  const priceRanges: Record<string, [number, number]> = {
    'BTC': [20000, 200000],
    'ETH': [1000, 10000], 
    'XRP': [0.1, 10],
    'ADA': [0.1, 5]
  };
  
  const normalizedSymbol = symbol.replace('-EUR', '');
  const range = priceRanges[normalizedSymbol];
  
  if (range && (price < range[0] || price > range[1])) {
    errors.push(`BLOCKED: Price €${price} outside realistic range €${range[0]}-€${range[1]} for ${symbol}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * GUARD 2: Purchase value consistency
 * Validates purchase_value = amount * price within tolerance
 */
export function validatePurchaseValue(amount: number, price: number, purchaseValue: number): TradeValidationResult {
  const errors: string[] = [];
  const epsilon = 0.01; // 1 cent tolerance
  
  const expectedValue = amount * price;
  const variance = Math.abs(purchaseValue - expectedValue);
  
  if (variance > epsilon) {
    errors.push(`BLOCKED: Purchase value €${purchaseValue} ≠ amount ${amount} × price €${price} = €${expectedValue} (variance: €${variance})`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * GUARD 3: Coordinator response validation
 * Ensures all coordinator responses are HTTP 200 with proper structure
 */
export function validateCoordinatorResponse(response: any, httpStatus: number): TradeValidationResult {
  const errors: string[] = [];
  
  // Must be HTTP 200
  if (httpStatus !== 200) {
    errors.push(`BLOCKED: Coordinator returned HTTP ${httpStatus} (expected 200)`);
  }
  
  // Must have decision object
  if (!response?.decision) {
    errors.push(`BLOCKED: Missing decision object in coordinator response`);
  }
  
  // Must have action and request_id
  const decision = response?.decision;
  if (decision && (!decision.action || !decision.request_id)) {
    errors.push(`BLOCKED: Missing action or request_id in decision: ${JSON.stringify(decision)}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * GUARD 4: Portfolio KPI consistency
 * Validates UI totals match sum of individual position P&Ls
 */
export function validatePortfolioConsistency(
  positions: Array<{ pnl_eur: number; is_corrupted?: boolean }>,
  displayedTotal: number
): PortfolioConsistencyResult {
  const epsilon = 0.01; // 1 cent tolerance
  
  // Sum only non-corrupted positions
  const expectedTotal = positions
    .filter(pos => !pos.is_corrupted)
    .reduce((sum, pos) => sum + pos.pnl_eur, 0);
  
  const variance = Math.abs(displayedTotal - expectedTotal);
  
  return {
    isConsistent: variance <= epsilon,
    expectedTotal,
    actualTotal: displayedTotal,
    variance
  };
}

/**
 * GUARD 5: Comprehensive trade validation
 * Runs all guards before allowing trade creation/update
 */
export function validateTradeComprehensive(tradeData: {
  amount: number;
  price: number;
  total_value: number;
  cryptocurrency: string;
}): TradeValidationResult {
  const allErrors: string[] = [];
  
  // Run price validation
  const priceCheck = validateTradePrice(tradeData.price, tradeData.cryptocurrency);
  allErrors.push(...priceCheck.errors);
  
  // Run purchase value validation
  const valueCheck = validatePurchaseValue(tradeData.amount, tradeData.price, tradeData.total_value);
  allErrors.push(...valueCheck.errors);
  
  return {
    isValid: allErrors.length === 0,
    errors: allErrors
  };
}

/**
 * Log validation failure for monitoring
 */
export function logValidationFailure(guard: string, errors: string[], metadata?: any) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    guard,
    errors,
    metadata,
    severity: 'CRITICAL'
  };
  
  console.error(`🛡️ REGRESSION GUARD TRIGGERED: ${guard}`, logEntry);
  
  // In production, this would send to monitoring system
  // For now, console logging is sufficient for detection
}