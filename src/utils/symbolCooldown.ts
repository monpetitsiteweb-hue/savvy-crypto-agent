// Per-Symbol Cooldown Tracker
// Prevents rapid-fire trades on the same symbol

interface CooldownEntry {
  lastTradeTime: number;
  tradeType: 'buy' | 'sell';
}

// In-memory cooldown map (per session)
const cooldownMap = new Map<string, CooldownEntry>();

/**
 * Check if a symbol is in cooldown period
 */
export function isSymbolInCooldown(
  symbol: string,
  tradeType: 'buy' | 'sell',
  cooldownMs: number
): { inCooldown: boolean; remainingMs: number; lastTradeTime?: number } {
  const baseSymbol = symbol.replace('-EUR', '');
  const key = `${baseSymbol}_${tradeType}`;
  
  const entry = cooldownMap.get(key);
  if (!entry) {
    return { inCooldown: false, remainingMs: 0 };
  }
  
  const elapsed = Date.now() - entry.lastTradeTime;
  const remaining = cooldownMs - elapsed;
  
  if (remaining <= 0) {
    return { inCooldown: false, remainingMs: 0, lastTradeTime: entry.lastTradeTime };
  }
  
  return { 
    inCooldown: true, 
    remainingMs: remaining, 
    lastTradeTime: entry.lastTradeTime 
  };
}

/**
 * Record a trade and start cooldown for that symbol
 */
export function recordTradeForCooldown(
  symbol: string,
  tradeType: 'buy' | 'sell'
): void {
  const baseSymbol = symbol.replace('-EUR', '');
  const key = `${baseSymbol}_${tradeType}`;
  
  cooldownMap.set(key, {
    lastTradeTime: Date.now(),
    tradeType,
  });
}

/**
 * Get default cooldown duration from config
 */
export function getCooldownMs(config: any, tradeType: 'buy' | 'sell'): number {
  // Use existing config values - no new knobs
  if (tradeType === 'buy') {
    // buyCooldownMinutes from strategy config
    const buyCooldownMin = config?.buyCooldownMinutes ?? config?.tradeCooldownMinutes ?? 2;
    return buyCooldownMin * 60 * 1000;
  }
  
  // For sells, use unified config minHoldPeriodMs as approximation
  const sellCooldownMs = config?.unified_config?.minHoldPeriodMs ?? config?.minHoldPeriodMs ?? 60000;
  return sellCooldownMs;
}

/**
 * Clear cooldown for a symbol (e.g., after reset)
 */
export function clearSymbolCooldown(symbol: string, tradeType?: 'buy' | 'sell'): void {
  const baseSymbol = symbol.replace('-EUR', '');
  
  if (tradeType) {
    cooldownMap.delete(`${baseSymbol}_${tradeType}`);
  } else {
    cooldownMap.delete(`${baseSymbol}_buy`);
    cooldownMap.delete(`${baseSymbol}_sell`);
  }
}

/**
 * Clear all cooldowns (e.g., on engine restart)
 */
export function clearAllCooldowns(): void {
  cooldownMap.clear();
}

/**
 * Get all current cooldowns (for debugging)
 */
export function getAllCooldowns(): Record<string, CooldownEntry> {
  const result: Record<string, CooldownEntry> = {};
  cooldownMap.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
