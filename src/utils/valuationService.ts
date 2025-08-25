// Single source of truth for all P&L calculations - Step 5 compliant
export interface OpenPositionInputs {
  symbol: string;
  amount: number;
  purchaseValue: number;
  entryPrice: number;
}

export interface PastPositionFields {
  amount: number | null;
  purchaseValue: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  exitValue: number | null;
  realizedPnL: number | null;
  realizedPnLPct: number | null;
}

export interface OpenPositionResult {
  currentPrice: number | null;
  currentValue: number | null;
  pnlEur: number | null;
  pnlPct: number | null;
}

export interface IntegrityCheck {
  is_valid: boolean;
  errors: string[];
}

// Step 5: Open Position calculation (aggregated FIFO)
export function calculateOpenPosition(
  inputs: OpenPositionInputs,
  currentPrice: number | null
): OpenPositionResult {
  // If no current price available, return nulls (display as "—")
  if (currentPrice === null || currentPrice === undefined || currentPrice <= 0) {
    return {
      currentPrice: null,
      currentValue: null,
      pnlEur: null,
      pnlPct: null
    };
  }
  
  // Calculate current value and P&L
  const currentValue = inputs.amount * currentPrice;
  const pnlEur = currentValue - inputs.purchaseValue;
  const pnlPct = inputs.purchaseValue > 0 
    ? (pnlEur / inputs.purchaseValue) * 100 
    : 0;
  
  return {
    currentPrice: Math.round(currentPrice * 100) / 100,
    currentValue: Math.round(currentValue * 100) / 100,
    pnlEur: Math.round(pnlEur * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100
  };
}

// Step 5: Past Position display (snapshot fields only)
export function processPastPosition(snapshot: {
  original_purchase_amount?: number | null;
  original_purchase_value?: number | null;
  original_purchase_price?: number | null;
  price?: number | null;
  exit_value?: number | null;
  realized_pnl?: number | null;
  realized_pnl_pct?: number | null;
}): PastPositionFields {
  return {
    amount: snapshot.original_purchase_amount || null,
    purchaseValue: snapshot.original_purchase_value || null,
    entryPrice: snapshot.original_purchase_price || null,
    exitPrice: snapshot.price || null,
    exitValue: snapshot.exit_value || null,
    realizedPnL: snapshot.realized_pnl || null,
    realizedPnLPct: snapshot.realized_pnl_pct || null
  };
}

// Legacy function for backwards compatibility
export async function calculateValuation(
  inputs: OpenPositionInputs,
  currentPriceOverride?: number
): Promise<{current_value: number; pnl_eur: number; pnl_pct: number; current_price: number}> {
  if (currentPriceOverride === undefined || currentPriceOverride === null || currentPriceOverride <= 0) {
    throw new Error(`Valid current price must be provided for ${inputs.symbol} - no API calls allowed (got: ${currentPriceOverride})`);
  }
  
  const result = calculateOpenPosition(inputs, currentPriceOverride);
  
  return {
    current_value: result.currentValue || 0,
    pnl_eur: result.pnlEur || 0,
    pnl_pct: result.pnlPct || 0,
    current_price: result.currentPrice || currentPriceOverride
  };
}

// Legacy compatibility for existing components
export type ValuationInputs = OpenPositionInputs;

export function checkIntegrity(inputs: OpenPositionInputs): IntegrityCheck {
  const errors: string[] = [];
  const epsilon = 0.01; // 1 cent tolerance
  
  // Check: purchaseValue should equal amount * entryPrice
  const expected_purchase_value = inputs.amount * inputs.entryPrice;
  if (Math.abs(inputs.purchaseValue - expected_purchase_value) > epsilon) {
    errors.push(`Purchase value mismatch: ${inputs.purchaseValue} ≠ ${inputs.amount} × ${inputs.entryPrice} = ${expected_purchase_value}`);
  }
  
  // Check for suspicious values
  if (inputs.entryPrice === 100 && inputs.amount >= 10) {
    errors.push('Suspicious entry price of €100 with high amount (possible placeholder corruption)');
  }
  
  if (inputs.amount <= 0 || inputs.entryPrice <= 0 || inputs.purchaseValue <= 0) {
    errors.push('Invalid negative or zero values detected');
  }
  
  return {
    is_valid: errors.length === 0,
    errors
  };
}
